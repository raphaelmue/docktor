import {EventEmitter} from "node:events"
import {spawn} from "node:child_process"
import {readFile} from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import yaml from "yaml"
import {decrypt} from "../lib/crypto.js"
import {assertTransition} from "../domain/stack-status-machine.js"
import {createComposeConfig} from "../domain/compose-config.js"
import {BadRequestError} from "../lib/errors.js"
import type {StackStatus, BackupTrigger} from "../generated/prisma/enums.js"
import type {ResticExecutor, BackupRepoConfig, RetentionPolicy, ResticSnapshot} from "../infrastructure/restic-executor.js"
import {isRepositoryNotFoundError} from "../infrastructure/restic-executor.js"
import type {BackupRepository} from "../repositories/backup-repository.js"
import type {NotificationService} from "./notification-service.js"
import type {DockerExecutor} from "../infrastructure/docker-executor.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"

// ─── Module-level broadcaster map ────────────────────────────────────────────

const backupBroadcasters = new Map<string, EventEmitter>()
const backupLogBuffers = new Map<string, string[]>()

export function getBackupBroadcaster(backupId: string): EventEmitter | undefined {
    return backupBroadcasters.get(backupId)
}

/**
 * Returns the registered emitter for `backupId`, creating and registering one
 * if absent. The only function permitted to write to `backupBroadcasters`.
 * Called at backup-creation time (initiateBackup/runRestore) so a subscriber
 * that learns the id before runBackup/runRestore starts still finds a live
 * emitter — closing the CR-02 race window.
 */
export function ensureBackupBroadcaster(backupId: string): EventEmitter {
    const existing = backupBroadcasters.get(backupId)
    if (existing) return existing
    const emitter = new EventEmitter()
    backupBroadcasters.set(backupId, emitter)
    return emitter
}

/**
 * Returns the live line accumulator for `backupId`, creating and registering
 * one if absent. This is the same array `runBackup`/`runRestore` push every
 * emitted line into, so a subscriber that arrives mid-run can be sent the
 * lines it missed. Companion of `ensureBackupBroadcaster`; freed by
 * `disposeBackupBroadcaster`. The only function permitted to write to
 * `backupLogBuffers`.
 */
export function ensureBackupLogBuffer(backupId: string): string[] {
    const existing = backupLogBuffers.get(backupId)
    if (existing) return existing
    const lines: string[] = []
    backupLogBuffers.set(backupId, lines)
    return lines
}

/**
 * Returns the live line accumulator for `backupId`, or `undefined` if no run
 * has started one. `readonly` because only the service writes to it — the
 * route only reads it.
 */
export function getBackupLogBuffer(backupId: string): readonly string[] | undefined {
    return backupLogBuffers.get(backupId)
}

/**
 * Drops all listeners and removes `backupId` from the map. The only function
 * permitted to remove from `backupBroadcasters`.
 */
export function disposeBackupBroadcaster(backupId: string): void {
    const existing = backupBroadcasters.get(backupId)
    existing?.removeAllListeners()
    backupBroadcasters.delete(backupId)
    backupLogBuffers.delete(backupId)
}

// ─── Dependency interfaces ────────────────────────────────────────────────────

export interface BackupStackRepo {
    findByIdOrThrow(id: string): Promise<{
        id: string
        slug?: string
        hostPath?: string
        status: StackStatus
        previousStatus: StackStatus | null
        backupPreHook: string | null
        backupPostHook: string | null
        backupSchedule: string | null
        backupRetention: string | null
        displayName?: string
    }>
    update(id: string, data: Record<string, unknown>): Promise<void>
    clearConfigChanged(id: string): Promise<void>
    updateStackHash(args: {stackId: string; hash: string}): Promise<void>
    replaceServices(stackId: string, composeConfig: any): Promise<void>
}

export interface BackupSettingsService {
    getSetting(key: string): Promise<string | null>
    getMany(keys: string[]): Promise<Record<string, string>>
}

export interface BackupFilesystem {
    readCompose?(stackId: string): Promise<string>
    readComposeFile?(stackId: string): Promise<string>
    getStackDirectory?(stackId: string): string
}

// ─── Setting key constants ────────────────────────────────────────────────────

const BACKUP_SETTING_KEYS = {
    REPO_TYPE: "backup.repoType",
    REPO_PATH: "backup.repoPath",
    SFTP_HOST: "backup.sftpHost",
    SFTP_USER: "backup.sftpUser",
    SFTP_KEY: "backup.sftpKey",
    S3_ENDPOINT: "backup.s3Endpoint",
    S3_BUCKET: "backup.s3Bucket",
    S3_ACCESS_KEY: "backup.s3AccessKey",
    S3_SECRET_KEY: "backup.s3SecretKey",
    PASSWORD: "backup.password",
    DEFAULT_SCHEDULE: "backup.defaultSchedule",
    DEFAULT_RETENTION: "backup.defaultRetention",
} as const

// ─── Internal type shapes ─────────────────────────────────────────────────────

interface BackupRecord {
    id: string
    stackId: string
    trigger: BackupTrigger
    logLines: string[]
}

interface StackRecord {
    id: string
    slug?: string
    hostPath?: string
    status: StackStatus
    previousStatus: StackStatus | null
    backupPreHook: string | null
    backupPostHook: string | null
    backupSchedule: string | null
    backupRetention: string | null
    displayName?: string
}

// ─── BackupService ────────────────────────────────────────────────────────────

export class BackupService {
    constructor(
        private readonly resticExecutor: ResticExecutor,
        private readonly backupRepo: BackupRepository,
        private readonly stackRepo: BackupStackRepo,
        private readonly settings: BackupSettingsService,
        private readonly notificationService: NotificationService,
        private readonly filesystem: BackupFilesystem,
        private readonly docker: DockerExecutor,
        private readonly broadcaster: Pick<StateBroadcaster, "publish">,
    ) {}

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Validates the state transition, creates an IN_PROGRESS Backup record,
     * and transitions the stack to BACKING_UP.
     * Returns the new backup id.
     */
    async initiateBackup(
        stackId: string,
        trigger: BackupTrigger = "MANUAL",
    ): Promise<{id: string}> {
        const stack = await this.stackRepo.findByIdOrThrow(stackId)
        assertTransition(stack.status, "BACKUP")

        const repoConfig = await this.getBackupRepoConfig()
        if (!repoConfig) {
            throw new BadRequestError(
                "No backup repository is configured. Configure one in Settings > Backup.",
            )
        }

        const backup = await this.backupRepo.create({
            stackId,
            trigger,
            status: "IN_PROGRESS",
            startedAt: new Date(),
            resticSnapshotId: "",
        })

        // Register the broadcaster now — before this method returns — so a
        // client that learns the backup id from the 202 response always finds
        // a live emitter, even if it subscribes before runBackup starts.
        ensureBackupBroadcaster(backup.id)

        await this.writeStackStatus(stackId, {
            status: "BACKING_UP",
            previousStatus: stack.status,
        })

        return {id: backup.id}
    }

    /**
     * Orchestrates the restic backup process.
     * Accepts the pre-fetched backup record, stack record, and repo config.
     * Handles success/failure state transitions, log accumulation, SSE broadcasting,
     * and sends backup_failure notification on error.
     */
    async runBackup(
        backupRecord: BackupRecord,
        stack: StackRecord,
        repoConfig: BackupRepoConfig,
    ): Promise<void> {
        const emitter = ensureBackupBroadcaster(backupRecord.id)

        const lines = ensureBackupLogBuffer(backupRecord.id)
        let finalStatus: "COMPLETED" | "FAILED" = "FAILED"
        console.log(`[BackupService] Starting backup ${backupRecord.id} for stack ${stack.id}`)

        try {
            const env = this.buildEnv(repoConfig, stack.hostPath ?? undefined)
            const stackPath = stack.hostPath ?? "."
            console.log(`[BackupService] Using repository: ${env.RESTIC_REPOSITORY}`)
            const onLine = (line: string): void => {
                console.log(`[BackupService] Log line: ${line}`)
                lines.push(line)
                emitter.emit("line", line)
            }

            // Run pre-hook if configured
            if (stack.backupPreHook) {
                await this.runHook(stack.backupPreHook, stackPath)
            }

            // Build backup args: prepend "backup" subcommand, run from stack directory
            const backupArgs = ["backup", ...this.resticExecutor.buildBackupArgs(stackPath, stack.id)]
            console.log(`[BackupService] Running restic with args:`, backupArgs)
            await this.runWithAutoInit(backupArgs, env, onLine, stackPath)

            // Run forget / prune only for scheduled backups, not manual ones
            if (backupRecord.trigger === "SCHEDULED") {
                const retentionPolicy = this.parseRetentionPolicy(stack.backupRetention)
                const forgetArgs = this.resticExecutor.buildForgetArgs(stack.id, retentionPolicy)
                await this.resticExecutor.run(forgetArgs, env, onLine, stackPath)
            }

            // Run post-hook if configured
            if (stack.backupPostHook) {
                await this.runHook(stack.backupPostHook, stackPath)
            }

            // Parse snapshot id from JSON output
            const snapshotId = this.parseSnapshotId(lines)
            console.log(`[BackupService] Backup completed. Total lines: ${lines.length}, Snapshot ID: ${snapshotId}`)

            await this.backupRepo.update(backupRecord.id, {
                status: "COMPLETED",
                completedAt: new Date(),
                logLines: lines,
                resticSnapshotId: snapshotId ?? "",
            })

            // Restore stack to its previous status
            const targetStatus = stack.previousStatus ?? "RUNNING"
            await this.writeStackStatus(stack.id, {status: targetStatus})
            finalStatus = "COMPLETED"
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            console.error(`[BackupService] Backup failed:`, err)

            const errorLine = `[error] ${errorMessage}`
            lines.push(errorLine)
            emitter.emit("line", errorLine)

            await this.backupRepo.update(backupRecord.id, {
                status: "FAILED",
                completedAt: new Date(),
                logLines: lines,
                errorMessage,
            })

            await this.writeStackStatus(stack.id, {status: "ERROR"})

            await this.notificationService.notify({
                type: "backup_failure",
                stackId: stack.id,
                subject: `Backup failed: ${stack.displayName ?? stack.id}`,
                message: `Backup failed for stack "${stack.displayName ?? stack.id}" (repo: ${repoConfig.repoType}). Error: ${errorMessage}`,
            })
        } finally {
            emitter.emit("done", finalStatus)
            disposeBackupBroadcaster(backupRecord.id)
        }
    }

    /**
     * Creates an IN_PROGRESS restore Backup record, registers the broadcaster,
     * and transitions the stack to RESTORING. Returns the new backup id.
     *
     * Mirrors initiateBackup/runBackup's split: the route awaits only this
     * method before replying 202, then runs runRestoreProcess() fire-and-forget.
     * Without this split, the route synchronously awaited the entire restore —
     * the record was always already terminal by the time a client could open
     * the SSE stream, and a failed restore's error was invisible to the caller
     * of this method (the client's "Restore started" toast always fired,
     * whether or not the restore actually succeeded).
     */
    async initiateRestore(stackId: string, snapshotId: string): Promise<{id: string}> {
        const stack = await this.stackRepo.findByIdOrThrow(stackId)
        assertTransition(stack.status, "RESTORE")

        const repoConfig = await this.getBackupRepoConfig()
        if (!repoConfig) {
            throw new BadRequestError(
                "No backup repository is configured. Configure one in Settings > Backup.",
            )
        }

        const backup = await this.backupRepo.create({
            stackId,
            trigger: "RESTORE",
            status: "IN_PROGRESS",
            startedAt: new Date(),
            resticSnapshotId: snapshotId,
        })

        // Register the broadcaster now — before this method returns — so a
        // client that learns the backup id from the 202 response always finds
        // a live emitter, even if it subscribes before runRestoreProcess starts.
        ensureBackupBroadcaster(backup.id)

        await this.writeStackStatus(stackId, {
            status: "RESTORING",
            previousStatus: stack.status,
        })

        return {id: backup.id}
    }

    /**
     * Orchestrates a restore: stop → restic restore → redeploy.
     * Accepts the pre-fetched backup record and stack record (mirrors runBackup).
     * Handles success/failure state transitions, log accumulation, SSE broadcasting,
     * and sends restore notifications.
     */
    async runRestoreProcess(backupRecord: BackupRecord, stack: StackRecord, snapshotId: string): Promise<void> {
        const emitter = ensureBackupBroadcaster(backupRecord.id)

        const lines = ensureBackupLogBuffer(backupRecord.id)
        let finalStatus: "COMPLETED" | "FAILED" = "FAILED"

        // Send restore start notification
        await this.notificationService.notify({
            type: "backup_failure", // Reuse backup_failure type for restore events
            stackId: stack.id,
            subject: `Restore started: ${stack.displayName ?? stack.id}`,
            message: `Restore started for stack "${stack.displayName ?? stack.id}" from snapshot ${snapshotId}`,
        })

        try {
            // Fetch repo config to build env for restic. initiateRestore() already
            // checked this before creating the backup record, but the two calls
            // aren't atomic — an admin can clear the backup repository settings in
            // the narrow window between them. Re-check here and fail with the same
            // clear message instead of silently running restic with an empty env
            // (WR-05): letting that happen produces whatever raw error restic emits
            // for a missing repository, wrapped as a generic failure below.
            const repoConfig = await this.getBackupRepoConfig()
            if (!repoConfig) {
                throw new BadRequestError(
                    "No backup repository is configured. Configure one in Settings > Backup.",
                )
            }
            const env: Record<string, string> = this.buildEnv(repoConfig, stack.hostPath ?? undefined)
            const stackPath = stack.hostPath ?? "."

            const onLine = (line: string): void => {
                lines.push(line)
                emitter.emit("line", line)
            }

            // Step 1: Stop containers before restoring files
            console.log(`[BackupService] Stopping stack ${stack.id} before restore`)
            try {
                await this.docker.stop(stack.id)
            } catch (err) {
                console.warn(`[BackupService] Stop failed (stack may already be stopped):`, err)
                // Continue anyway — stack might already be stopped
            }

            // Step 2: Restore snapshot to "." (current directory) by running from stack directory
            console.log(`[BackupService] Restoring snapshot ${snapshotId} to ${stackPath}`)
            await this.resticExecutor.run(["restore", snapshotId, "--target", "."], env, onLine, stackPath)

            // Step 3: Redeploy containers with restored configuration
            console.log(`[BackupService] Redeploying stack ${stack.id} after restore`)
            await this.docker.up(stack.id)

            // Step 4: Sync database with restored compose file to prevent "config changed" warning
            console.log(`[BackupService] Syncing database with restored compose file`)
            const composePath = path.join(stackPath, "docker-compose.yml")
            const restoredContent = await readFile(composePath, "utf-8")
            const composeConfig = createComposeConfig(restoredContent)
            await this.stackRepo.updateStackHash({stackId: stack.id, hash: composeConfig.hash})
            await this.stackRepo.replaceServices(stack.id, composeConfig)

            await this.backupRepo.update(backupRecord.id, {
                status: "COMPLETED",
                completedAt: new Date(),
                logLines: lines,
            })

            await this.writeStackStatus(stack.id, {status: "RUNNING"})
            await this.stackRepo.clearConfigChanged(stack.id)

            // Send restore success notification
            await this.notificationService.notify({
                type: "backup_failure", // Reuse backup_failure type
                stackId: stack.id,
                subject: `Restore completed: ${stack.displayName ?? stack.id}`,
                message: `Restore completed successfully for stack "${stack.displayName ?? stack.id}" from snapshot ${snapshotId}`,
            })
            finalStatus = "COMPLETED"
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            console.error(`[BackupService] Restore failed:`, err)

            const errorLine = `[error] ${errorMessage}`
            lines.push(errorLine)
            emitter.emit("line", errorLine)

            await this.backupRepo.update(backupRecord.id, {
                status: "FAILED",
                completedAt: new Date(),
                logLines: lines,
                errorMessage,
            })

            await this.writeStackStatus(stack.id, {status: "ERROR"})

            await this.notificationService.notify({
                type: "backup_failure",
                stackId: stack.id,
                subject: `Restore failed: ${stack.displayName ?? stack.id}`,
                message: `Restore failed for stack "${stack.displayName ?? stack.id}". Snapshot: ${snapshotId}. Error: ${errorMessage}`,
            })

            // Attempt to restart containers even if restore failed partially
            try {
                console.log(`[BackupService] Attempting to restart stack ${stack.id} after restore failure`)
                await this.docker.up(stack.id)
            } catch (restartErr) {
                console.error(`[BackupService] Failed to restart stack after restore failure:`, restartErr)
            }
        } finally {
            emitter.emit("done", finalStatus)
            disposeBackupBroadcaster(backupRecord.id)
        }
    }

    /**
     * Reads backup repository settings and decrypts secrets.
     * Returns null if the repository is not configured.
     */
    async getBackupRepoConfig(): Promise<BackupRepoConfig | null> {
        const keys = Object.values(BACKUP_SETTING_KEYS)
        const raw = await this.settings.getMany(keys)
        const values: Record<string, string> = raw ?? {}

        const repoType = values[BACKUP_SETTING_KEYS.REPO_TYPE] as BackupRepoConfig["repoType"] | undefined
        if (!repoType) return null

        const rawPassword = values[BACKUP_SETTING_KEYS.PASSWORD] ?? ""
        let password = ""
        if (rawPassword) {
            try {
                password = decrypt(rawPassword)
            } catch {
                // Decryption failed — log and leave password empty to avoid using ciphertext
                console.error("[BackupService] failed to decrypt backup repository password")
            }
        }

        const rawSftpKey = values[BACKUP_SETTING_KEYS.SFTP_KEY]
        let sftpKey: string | undefined
        if (rawSftpKey) {
            try {
                sftpKey = decrypt(rawSftpKey)
            } catch {
                console.error("[BackupService] failed to decrypt SFTP key")
            }
        }

        const rawS3SecretKey = values[BACKUP_SETTING_KEYS.S3_SECRET_KEY]
        let s3SecretKey: string | undefined
        if (rawS3SecretKey) {
            try {
                s3SecretKey = decrypt(rawS3SecretKey)
            } catch {
                console.error("[BackupService] failed to decrypt S3 secret key")
            }
        }

        return {
            repoType,
            repoPath: values[BACKUP_SETTING_KEYS.REPO_PATH],
            sftpHost: values[BACKUP_SETTING_KEYS.SFTP_HOST],
            sftpUser: values[BACKUP_SETTING_KEYS.SFTP_USER],
            sftpKey,
            s3Endpoint: values[BACKUP_SETTING_KEYS.S3_ENDPOINT],
            s3Bucket: values[BACKUP_SETTING_KEYS.S3_BUCKET],
            s3AccessKey: values[BACKUP_SETTING_KEYS.S3_ACCESS_KEY],
            s3SecretKey,
            password,
        }
    }

    /**
     * Detects bind-mount volumes pointing to absolute paths outside the stack directory.
     * Returns warning strings like "web: /etc/nginx/conf.d".
     */
    detectAbsolutePathVolumes(composeContent: string, stackPath: string): string[] {
        const warnings: string[] = []

        let doc: unknown
        try {
            doc = yaml.parse(composeContent)
        } catch {
            return warnings
        }

        if (!doc || typeof doc !== "object") return warnings
        const services = (doc as Record<string, unknown>).services
        if (!services || typeof services !== "object") return warnings

        for (const [serviceName, service] of Object.entries(services as Record<string, unknown>)) {
            if (!service || typeof service !== "object") continue
            const volumes = (service as Record<string, unknown>).volumes
            if (!Array.isArray(volumes)) continue

            for (const volume of volumes) {
                let source: string | undefined

                if (typeof volume === "string") {
                    // Short syntax: "host:container" or "host:container:options"
                    const parts = volume.split(":")
                    if (parts.length >= 2) {
                        source = parts[0]
                    }
                } else if (volume && typeof volume === "object") {
                    // Long syntax: {type: "bind", source: "...", target: "..."}
                    const vol = volume as Record<string, unknown>
                    if (vol.type === "bind" && typeof vol.source === "string") {
                        source = vol.source
                    }
                }

                if (source) {
                    // Expand tilde paths (Docker Compose supports ~ expansion)
                    const resolvedSource = source.startsWith("~")
                        ? path.join(os.homedir(), source.slice(1))
                        : source

                    if (path.isAbsolute(resolvedSource) && !resolvedSource.startsWith(stackPath)) {
                        warnings.push(`${serviceName}: ${source}`)
                    }
                }
            }
        }

        return warnings
    }

    /**
     * Fetches the list of restic snapshots for a stack.
     */
    async getSnapshots(stackId: string): Promise<ResticSnapshot[]> {
        const stack = await this.stackRepo.findByIdOrThrow(stackId)
        const repoConfig = await this.getBackupRepoConfig()
        if (!repoConfig) return []
        const env = this.buildEnv(repoConfig, stack.hostPath ?? undefined)
        return this.resticExecutor.snapshots(env, stackId)
    }

    /**
     * Returns volume warnings for a stack's compose file.
     */
    async getVolumeWarnings(stackId: string): Promise<string[]> {
        const readFn = this.filesystem.readComposeFile ?? this.filesystem.readCompose
        if (!readFn) return []
        const content = await readFn.call(this.filesystem, stackId)
        const stackPath = this.filesystem.getStackDirectory?.(stackId) ?? ""
        return this.detectAbsolutePathVolumes(content, stackPath)
    }

    /**
     * Ends an IN_PROGRESS backup that never reached restic — e.g. a missing
     * dependency in the manual-trigger or scheduled fire-and-forget fetch.
     * Marks the row FAILED with the given reason, transitions the stack to
     * ERROR so it can be acted on again, and sends a backup_failure
     * notification. Idempotent: a no-op on an unknown backup id or a backup
     * that has already reached a terminal status (COMPLETED/FAILED), so it
     * never clobbers a row that runBackup already finished.
     */
    async abortBackup(backupId: string, stackId: string, errorMessage: string): Promise<void> {
        const backup = await this.backupRepo.findById(backupId)
        if (!backup || backup.status !== "IN_PROGRESS") return

        // A rejected notify() must not be able to strand a subscribed SSE
        // client with a stream that never ends — the terminal `done` and the
        // broadcaster disposal happen in `finally` regardless of outcome.
        try {
            await this.backupRepo.update(backupId, {
                status: "FAILED",
                completedAt: new Date(),
                errorMessage,
                logLines: [`[error] ${errorMessage}`],
            })

            await this.writeStackStatus(stackId, {status: "ERROR"})

            let displayName = stackId
            try {
                const stack = await this.stackRepo.findByIdOrThrow(stackId)
                displayName = stack.displayName ?? stackId
            } catch {
                // Stack row unreadable — fall back to the stack id in the notification text
            }

            await this.notificationService.notify({
                type: "backup_failure",
                stackId,
                subject: `Backup failed: ${displayName}`,
                message: `Backup failed for stack "${displayName}". Error: ${errorMessage}`,
            })
        } finally {
            getBackupBroadcaster(backupId)?.emit("done", "FAILED")
            disposeBackupBroadcaster(backupId)
        }
    }

    /**
     * Recovers in-progress backups on server startup by marking them FAILED.
     * Called from jobs/index.ts startJobs().
     */
    async recoverInProgressBackups(): Promise<void> {
        const inProgress = await this.backupRepo.findInProgress()
        for (const backup of inProgress) {
            await this.backupRepo.update(backup.id, {
                status: "FAILED",
                completedAt: new Date(),
                errorMessage: "Server restarted during backup",
            })

            try {
                const stack = await this.stackRepo.findByIdOrThrow(backup.stackId)
                const targetStatus = stack.previousStatus ?? "ERROR"
                await this.writeStackStatus(backup.stackId, {status: targetStatus})
            } catch {
                // Stack may have been deleted — skip
            }
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Writes a stack status update through stackRepo.update() and then
     * publishes a stack_status SSE event so every open browser tab sees the
     * transition live — mirroring StackService.transitionStatus()'s
     * broadcaster convention (plan 05.1-02).
     *
     * The publish is wrapped in try/catch: a throwing SSE subscriber must
     * never propagate out of here. In abortBackup() especially, an exception
     * escaping this call would skip the caller's `finally` block that emits
     * the terminal `done` frame and disposes the backup broadcaster, leaving
     * every subscribed SSE client on a stream that never closes.
     */
    private async writeStackStatus(
        stackId: string,
        data: Record<string, unknown> & {status: StackStatus},
    ): Promise<void> {
        await this.stackRepo.update(stackId, data)
        try {
            this.broadcaster.publish({type: "stack_status", stackId, stackStatus: data.status})
        } catch (err) {
            console.error("[BackupService] broadcaster publish failed", err)
        }
    }

    /**
     * Runs restic with auto-init on exit code 10 (repository not found).
     */
    private async runWithAutoInit(
        args: string[],
        env: Record<string, string>,
        onLine: (line: string) => void,
        cwd?: string,
    ): Promise<void> {
        try {
            await this.resticExecutor.run(args, env, onLine, cwd)
        } catch (err) {
            if (isRepositoryNotFoundError(err)) {
                // Repository not initialized — init and retry
                const initArgs = typeof this.resticExecutor.buildInitArgs === "function"
                    ? this.resticExecutor.buildInitArgs()
                    : ["init"]
                await this.resticExecutor.run(initArgs, env, onLine, cwd)
                await this.resticExecutor.run(args, env, onLine, cwd)
            } else {
                throw err
            }
        }
    }

    /**
     * Executes a shell hook command. Returns undefined if the hook is null/empty.
     */
    async runHook(
        command: string | null | undefined,
        stackPath: string,
    ): Promise<{stdout: string; exitCode: number} | undefined> {
        if (!command) return undefined

        return new Promise((resolve) => {
            const child = spawn("/bin/sh", ["-c", command], {
                cwd: stackPath,
                stdio: ["ignore", "pipe", "pipe"],
            })

            let stdout = ""
            child.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8")
            })
            child.stderr.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8")
            })
            child.on("close", (code) => {
                if ((code ?? 0) !== 0) {
                    console.warn(`[BackupService] hook exited with code ${String(code)}: ${command}`)
                }
                resolve({stdout, exitCode: code ?? 1})
            })
            child.on("error", (err) => {
                console.error("[BackupService] hook spawn error:", err)
                resolve({stdout: "", exitCode: 1})
            })
        })
    }

    /**
     * Parses the retention policy from JSON, falling back to defaults.
     */
    private parseRetentionPolicy(retentionJson: string | null): RetentionPolicy {
        if (retentionJson) {
            try {
                return JSON.parse(retentionJson) as RetentionPolicy
            } catch {
                // Fall through to defaults
            }
        }
        return {keepDaily: 7, keepWeekly: 4, keepMonthly: 12}
    }

    /**
     * Builds the restic env object from a BackupRepoConfig.
     * Uses stack-specific backup directory within the stack's hostPath.
     */
    private buildEnv(repoConfig: BackupRepoConfig, stackPath?: string): Record<string, string> {
        const base: Record<string, string> = {
            RESTIC_PASSWORD: repoConfig.password,
        }

        // Always use stack-local backup directory
        if (stackPath) {
            base.RESTIC_REPOSITORY = path.resolve(stackPath, "backups")
        } else {
            // Fallback to configured repo (shouldn't happen in production)
            if (repoConfig.repoType === "local") {
                base.RESTIC_REPOSITORY = repoConfig.repoPath ?? ""
            } else if (repoConfig.repoType === "sftp") {
                base.RESTIC_REPOSITORY = `sftp:${repoConfig.sftpUser}@${repoConfig.sftpHost}:${repoConfig.repoPath ?? "/backups"}`
            } else {
                base.RESTIC_REPOSITORY = `s3:${repoConfig.s3Endpoint ?? "s3.amazonaws.com"}/${repoConfig.s3Bucket ?? ""}`
                base.AWS_ACCESS_KEY_ID = repoConfig.s3AccessKey ?? ""
                base.AWS_SECRET_ACCESS_KEY = repoConfig.s3SecretKey ?? ""
            }
        }
        return base
    }

    /**
     * Attempts to parse the restic snapshot id from JSON output lines.
     * Returns undefined if not parseable.
     */
    private parseSnapshotId(lines: string[]): string | undefined {
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line) as Record<string, unknown>
                if (parsed.snapshot_id && typeof parsed.snapshot_id === "string") {
                    return parsed.snapshot_id as string
                }
                if (parsed.short_id && typeof parsed.short_id === "string") {
                    return parsed.short_id as string
                }
            } catch {
                // not JSON — skip
            }
        }
        return undefined
    }
}
