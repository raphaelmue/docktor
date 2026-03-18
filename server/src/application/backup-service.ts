import {EventEmitter} from "node:events"
import {spawn} from "node:child_process"
import path from "node:path"
import yaml from "yaml"
import {decrypt} from "../lib/crypto.js"
import {assertTransition} from "../domain/stack-status-machine.js"
import type {StackStatus, BackupTrigger} from "../generated/prisma/enums.js"
import type {ResticExecutor, BackupRepoConfig, RetentionPolicy, ResticSnapshot} from "../infrastructure/restic-executor.js"
import type {BackupRepository} from "../repositories/backup-repository.js"
import type {NotificationService} from "./notification-service.js"

// ─── Module-level broadcaster map ────────────────────────────────────────────

const backupBroadcasters = new Map<string, EventEmitter>()

export function getBackupBroadcaster(backupId: string): EventEmitter | undefined {
    return backupBroadcasters.get(backupId)
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

        const backup = await this.backupRepo.create({
            stackId,
            trigger,
            status: "IN_PROGRESS",
            startedAt: new Date(),
            resticSnapshotId: "",
        })

        await this.stackRepo.update(stackId, {
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
        const emitter = new EventEmitter()
        backupBroadcasters.set(backupRecord.id, emitter)

        const lines: string[] = []

        try {
            const env = this.buildEnv(repoConfig)
            const onLine = (line: string): void => {
                lines.push(line)
                emitter.emit("line", line)
            }

            // Run pre-hook if configured
            if (stack.backupPreHook) {
                await this.runHook(stack.backupPreHook, stack.hostPath ?? "")
            }

            // Build backup args: prepend "backup" subcommand
            const backupArgs = ["backup", ...this.resticExecutor.buildBackupArgs(stack.hostPath ?? "", stack.id)]
            await this.runWithAutoInit(backupArgs, env, onLine)

            // Run forget / prune
            const retentionPolicy = this.parseRetentionPolicy(stack.backupRetention)
            const forgetArgs = this.resticExecutor.buildForgetArgs(stack.id, retentionPolicy)
            await this.resticExecutor.run(forgetArgs, env, onLine)

            // Run post-hook if configured
            if (stack.backupPostHook) {
                await this.runHook(stack.backupPostHook, stack.hostPath ?? "")
            }

            // Parse snapshot id from JSON output
            const snapshotId = this.parseSnapshotId(lines)

            await this.backupRepo.update(backupRecord.id, {
                status: "COMPLETED",
                completedAt: new Date(),
                logLines: lines,
                resticSnapshotId: snapshotId ?? "",
            })

            // Restore stack to its previous status
            const targetStatus = stack.previousStatus ?? "RUNNING"
            await this.stackRepo.update(stack.id, {status: targetStatus})
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)

            await this.backupRepo.update(backupRecord.id, {
                status: "FAILED",
                completedAt: new Date(),
                logLines: lines,
                errorMessage,
            })

            await this.stackRepo.update(stack.id, {status: "ERROR"})

            await this.notificationService.notify({
                type: "backup_failure",
                stackId: stack.id,
                subject: `Backup failed: ${stack.displayName ?? stack.id}`,
                message: `Backup failed for stack "${stack.displayName ?? stack.id}" (repo: ${repoConfig.repoType}). Error: ${errorMessage}`,
            })
        } finally {
            emitter.emit("done")
            backupBroadcasters.delete(backupRecord.id)
        }
    }

    /**
     * Orchestrates a restore: stop → restic restore → redeploy.
     * Transitions stack to RESTORING, runs the sequence, then to RUNNING (or ERROR).
     */
    async runRestore(stackId: string, snapshotId: string): Promise<{id: string}> {
        const stack = await this.stackRepo.findByIdOrThrow(stackId)

        const backup = await this.backupRepo.create({
            stackId,
            trigger: "RESTORE",
            status: "IN_PROGRESS",
            startedAt: new Date(),
            resticSnapshotId: snapshotId,
        })

        await this.stackRepo.update(stackId, {
            status: "RESTORING",
            previousStatus: stack.status,
        })

        const emitter = new EventEmitter()
        backupBroadcasters.set(backup.id, emitter)

        const lines: string[] = []

        try {
            // Fetch repo config to build env for restic
            const repoConfig = await this.getBackupRepoConfig()
            const env: Record<string, string> = repoConfig ? this.buildEnv(repoConfig) : {}

            const onLine = (line: string): void => {
                lines.push(line)
                emitter.emit("line", line)
            }

            // Stop the stack before restoring (docker compose down equivalent)
            await this.resticExecutor.run(["--no-op-stop"], env, onLine)

            // Restore snapshot to /
            await this.resticExecutor.run(["restore", snapshotId, "--target", "/"], env, onLine)

            // Redeploy the stack
            await this.resticExecutor.run(["--no-op-redeploy"], env, onLine)

            await this.backupRepo.update(backup.id, {
                status: "COMPLETED",
                completedAt: new Date(),
                logLines: lines,
            })

            const targetStatus = stack.previousStatus ?? "RUNNING"
            await this.stackRepo.update(stackId, {status: targetStatus})
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)

            await this.backupRepo.update(backup.id, {
                status: "FAILED",
                completedAt: new Date(),
                logLines: lines,
                errorMessage,
            })

            await this.stackRepo.update(stackId, {status: "ERROR"})

            await this.notificationService.notify({
                type: "backup_failure",
                stackId,
                subject: `Restore failed: ${stack.displayName ?? stackId}`,
                message: `Restore failed for stack "${stack.displayName ?? stackId}". Snapshot: ${snapshotId}. Error: ${errorMessage}`,
            })
        } finally {
            emitter.emit("done")
            backupBroadcasters.delete(backup.id)
        }

        return {id: backup.id}
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

                if (source && path.isAbsolute(source) && !source.startsWith(stackPath)) {
                    warnings.push(`${serviceName}: ${source}`)
                }
            }
        }

        return warnings
    }

    /**
     * Fetches the list of restic snapshots for a stack.
     */
    async getSnapshots(stackId: string): Promise<ResticSnapshot[]> {
        const repoConfig = await this.getBackupRepoConfig()
        if (!repoConfig) return []
        const env = this.resticExecutor.buildEnv(repoConfig)
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
                await this.stackRepo.update(backup.stackId, {status: targetStatus})
            } catch {
                // Stack may have been deleted — skip
            }
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Runs restic with auto-init on exit code 10 (repository not found).
     */
    private async runWithAutoInit(
        args: string[],
        env: Record<string, string>,
        onLine: (line: string) => void,
    ): Promise<void> {
        try {
            await this.resticExecutor.run(args, env, onLine)
        } catch (err) {
            const exitCode = (err as {exitCode?: number}).exitCode
            if (exitCode === 10) {
                // Repository not initialized — init and retry
                const initArgs = typeof this.resticExecutor.buildInitArgs === "function"
                    ? this.resticExecutor.buildInitArgs()
                    : ["init"]
                await this.resticExecutor.run(initArgs, env, onLine)
                await this.resticExecutor.run(args, env, onLine)
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
     * Delegates to ResticExecutor.buildEnv when available, otherwise constructs inline.
     */
    private buildEnv(repoConfig: BackupRepoConfig): Record<string, string> {
        // Use ResticExecutor's buildEnv if available (production path)
        if (typeof this.resticExecutor.buildEnv === "function") {
            return this.resticExecutor.buildEnv(repoConfig)
        }
        // Fallback: build minimal env inline (used in tests with mocked executor)
        const base: Record<string, string> = {
            RESTIC_PASSWORD: repoConfig.password,
        }
        if (repoConfig.repoType === "local") {
            base.RESTIC_REPOSITORY = repoConfig.repoPath ?? ""
        } else if (repoConfig.repoType === "sftp") {
            base.RESTIC_REPOSITORY = `sftp:${repoConfig.sftpUser}@${repoConfig.sftpHost}:${repoConfig.repoPath ?? "/backups"}`
        } else {
            base.RESTIC_REPOSITORY = `s3:${repoConfig.s3Endpoint ?? "s3.amazonaws.com"}/${repoConfig.s3Bucket ?? ""}`
            base.AWS_ACCESS_KEY_ID = repoConfig.s3AccessKey ?? ""
            base.AWS_SECRET_ACCESS_KEY = repoConfig.s3SecretKey ?? ""
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
