import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {z} from "zod"
import {
    backupSettingsSchema,
    backupDefaultsSchema,
    stackBackupConfigSchema,
    restoreSnapshotSchema,
} from "@docktor/shared"
import {requireAuth} from "../lib/auth-middleware.js"
import {backupService, getBackupBroadcaster, settingsRepository} from "../application/index.js"
import {backupRepository} from "../repositories/backup-repository.js"
import {stackRepository} from "../repositories/stack-repository.js"
import {resticExecutor} from "../infrastructure/restic-executor.js"
import {backupScheduler} from "../jobs/backup-scheduler.js"
import {encrypt} from "../lib/crypto.js"
import {prisma} from "../lib/db.js"
import cron from "node-cron"

const stackParamsSchema = z.object({id: z.string()})
const backupParamsSchema = z.object({id: z.string()})

const backupsPlugin: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    // ── POST /api/stacks/:id/backup — Trigger manual backup ───────────────────

    app.post(
        "/api/stacks/:id/backup",
        {schema: {params: stackParamsSchema}},
        async (request, reply) => {
            const {id} = request.params
            console.log(`[backups] POST /api/stacks/${id}/backup - initiating backup`)
            const backup = await backupService.initiateBackup(id, "MANUAL")
            console.log(`[backups] Backup initiated with ID: ${backup.id}`)

            // Fire-and-forget: fetch required args and run backup asynchronously
            void (async () => {
                try {
                    console.log(`[backups] Fetching backup dependencies for ${backup.id}`)
                    const [backupRecord, stack, repoConfig] = await Promise.all([
                        backupRepository.findByIdOrThrow(backup.id),
                        stackRepository.findByIdOrThrow(id),
                        backupService.getBackupRepoConfig(),
                    ])
                    console.log(`[backups] Dependencies fetched. repoConfig exists: ${!!repoConfig}`)
                    if (repoConfig) {
                        console.log(`[backups] Starting runBackup for ${backup.id}`)
                        await backupService.runBackup(backupRecord, stack, repoConfig)
                        console.log(`[backups] runBackup completed for ${backup.id}`)
                    } else {
                        console.error(`[backups] No repoConfig - backup repository not configured`)
                    }
                } catch (err) {
                    app.log.error({err}, "[backups] fire-and-forget runBackup failed")
                }
            })()

            return reply.status(202).send({backupId: backup.id})
        },
    )

    // ── POST /api/stacks/:id/restore — Trigger restore from snapshot ──────────

    app.post(
        "/api/stacks/:id/restore",
        {schema: {params: stackParamsSchema, body: restoreSnapshotSchema}},
        async (request, reply) => {
            const {id} = request.params
            const {snapshotId} = request.body
            const backup = await backupService.runRestore(id, snapshotId)
            return reply.status(202).send({backupId: backup.id})
        },
    )

    // ── GET /api/stacks/:id/backups — List backup history for a stack ─────────

    app.get(
        "/api/stacks/:id/backups",
        {schema: {params: stackParamsSchema}},
        async (request) => {
            const {id} = request.params
            const backups = await backupRepository.findByStackId(id)
            return backups.map((b) => backupRepository.toDto(b))
        },
    )

    // ── GET /api/stacks/:id/snapshots — List restic snapshots for a stack ─────

    app.get(
        "/api/stacks/:id/snapshots",
        {schema: {params: stackParamsSchema}},
        async (request, reply) => {
            const {id} = request.params
            const stack = await stackRepository.findByIdOrThrow(id)
            const transitionalStates = ["BACKING_UP", "RESTORING"]
            if (transitionalStates.includes(stack.status)) {
                return reply.status(409).send({error: "Backup in progress, try again shortly"})
            }
            const snapshots = await backupService.getSnapshots(id)
            return snapshots
        },
    )

    // ── GET /api/stacks/:id/volume-warnings — Get absolute-path volume warnings

    app.get(
        "/api/stacks/:id/volume-warnings",
        {schema: {params: stackParamsSchema}},
        async (request) => {
            const {id} = request.params
            const warnings = await backupService.getVolumeWarnings(id)
            return {warnings}
        },
    )

    // ── GET /api/backups/:id — Get a single backup record ────────────────────

    app.get(
        "/api/backups/:id",
        {schema: {params: backupParamsSchema}},
        async (request) => {
            const {id} = request.params
            const backup = await backupRepository.findByIdOrThrow(id)
            return backupRepository.toDto(backup)
        },
    )

    // ── GET /api/backups/:id/stream — SSE stream for backup progress ──────────

    app.get(
        "/api/backups/:id/stream",
        {schema: {params: backupParamsSchema}},
        async (request, reply) => {
            const {id} = request.params
            const backup = await backupRepository.findByIdOrThrow(id)

            reply.hijack()

            reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            })
            reply.raw.write(": connected\n\n")

            // If backup is already finished, stream stored log lines and close
            if (backup.status !== "IN_PROGRESS") {
                for (const line of backup.logLines) {
                    reply.raw.write(`data: ${JSON.stringify({line})}\n\n`)
                }
                reply.raw.write(`data: ${JSON.stringify({done: true, status: backup.status})}\n\n`)
                reply.raw.end()
                return
            }

            // Backup is in progress — subscribe to live broadcaster
            const emitter = getBackupBroadcaster(id)
            if (!emitter) {
                // Broadcaster gone (race condition) — end immediately
                reply.raw.write(`data: ${JSON.stringify({done: true, status: backup.status})}\n\n`)
                reply.raw.end()
                return
            }

            await new Promise<void>((resolve) => {
                const onLine = (line: string): void => {
                    reply.raw.write(`data: ${JSON.stringify({line})}\n\n`)
                }

                const onDone = (): void => {
                    reply.raw.write(`data: ${JSON.stringify({done: true})}\n\n`)
                    reply.raw.end()
                    resolve()
                }

                emitter.on("line", onLine)
                emitter.once("done", onDone)

                request.raw.on("close", () => {
                    emitter.off("line", onLine)
                    emitter.off("done", onDone)
                    resolve()
                })
            })
        },
    )

    // ── GET /api/stacks/:id/backup-config — Get per-stack backup config ───────

    app.get(
        "/api/stacks/:id/backup-config",
        {schema: {params: stackParamsSchema}},
        async (request) => {
            const {id} = request.params
            const stack = await stackRepository.findByIdOrThrow(id)

            const globalSchedule = await settingsRepository.get("backup.defaultSchedule")
            const globalRetentionRaw = await settingsRepository.get("backup.defaultRetention")
            const globalRetention = globalRetentionRaw
                ? (JSON.parse(globalRetentionRaw) as {keepDaily: number; keepWeekly: number; keepMonthly: number})
                : null

            const retention = stack.backupRetention
                ? (JSON.parse(stack.backupRetention) as {keepDaily: number; keepWeekly: number; keepMonthly: number})
                : null

            return {
                useGlobalSchedule: !stack.backupSchedule,
                schedule: stack.backupSchedule,
                useGlobalRetention: !stack.backupRetention,
                retention,
                preHook: stack.backupPreHook,
                postHook: stack.backupPostHook,
                globalSchedule,
                globalRetention,
            }
        },
    )

    // ── PUT /api/stacks/:id/backup-config — Save per-stack backup config ──────

    app.put(
        "/api/stacks/:id/backup-config",
        {schema: {params: stackParamsSchema, body: stackBackupConfigSchema}},
        async (request, reply) => {
            const {id} = request.params
            const {useGlobalSchedule, schedule, useGlobalRetention, retention, preHook, postHook} = request.body

            // Validate cron expression if a custom schedule is provided
            const effectiveSchedule = useGlobalSchedule ? null : (schedule ?? null)
            if (effectiveSchedule && !cron.validate(effectiveSchedule)) {
                return reply.status(400).send({error: "Invalid cron expression"})
            }

            const effectiveRetention = useGlobalRetention ? null : (retention ?? null)

            await prisma.stack.update({
                where: {id},
                data: {
                    backupSchedule: effectiveSchedule,
                    backupRetention: effectiveRetention ? JSON.stringify(effectiveRetention) : null,
                    backupPreHook: preHook ?? null,
                    backupPostHook: postHook ?? null,
                },
            })

            // Update BackupScheduler accordingly
            if (effectiveSchedule) {
                backupScheduler.upsert(id, effectiveSchedule)
            } else {
                backupScheduler.remove(id)
            }

            return reply.status(200).send({success: true})
        },
    )

    // ── GET /api/settings/backup — Get backup repository settings ─────────────

    app.get("/api/settings/backup", async () => {
        const keys = [
            "backup.repoType",
            "backup.repoPath",
            "backup.sftpHost",
            "backup.sftpUser",
            "backup.sftpKey",
            "backup.s3Endpoint",
            "backup.s3Bucket",
            "backup.s3AccessKey",
            "backup.s3SecretKey",
            "backup.password",
        ]
        const values = await settingsRepository.getMany(keys)
        return {
            repoType: values["backup.repoType"] ?? null,
            repoPath: values["backup.repoPath"] ?? null,
            sftpHost: values["backup.sftpHost"] ?? null,
            sftpUser: values["backup.sftpUser"] ?? null,
            // Never return sensitive keys — return presence indicator only
            hasSftpKey: !!values["backup.sftpKey"],
            s3Endpoint: values["backup.s3Endpoint"] ?? null,
            s3Bucket: values["backup.s3Bucket"] ?? null,
            s3AccessKey: values["backup.s3AccessKey"] ?? null,
            // Never return secret key — return presence indicator only
            hasS3SecretKey: !!values["backup.s3SecretKey"],
            // Never return password — return presence indicator only
            hasPassword: !!values["backup.password"],
        }
    })

    // ── PUT /api/settings/backup — Save backup repository settings ────────────

    app.put(
        "/api/settings/backup",
        {schema: {body: backupSettingsSchema}},
        async (request, reply) => {
            const {repoType, repoPath, sftpHost, sftpUser, sftpKey, s3Endpoint, s3Bucket, s3AccessKey, s3SecretKey, password} =
                request.body

            await settingsRepository.upsert("backup.repoType", repoType)
            if (repoPath !== undefined) await settingsRepository.upsert("backup.repoPath", repoPath)
            if (sftpHost !== undefined) await settingsRepository.upsert("backup.sftpHost", sftpHost)
            if (sftpUser !== undefined) await settingsRepository.upsert("backup.sftpUser", sftpUser)
            if (s3Endpoint !== undefined) await settingsRepository.upsert("backup.s3Endpoint", s3Endpoint)
            if (s3Bucket !== undefined) await settingsRepository.upsert("backup.s3Bucket", s3Bucket)
            if (s3AccessKey !== undefined) await settingsRepository.upsert("backup.s3AccessKey", s3AccessKey)

            // Encrypt sensitive fields
            if (sftpKey) {
                const encryptedKey = encrypt(sftpKey)
                await prisma.setting.upsert({
                    where: {key: "backup.sftpKey"},
                    create: {key: "backup.sftpKey", value: encryptedKey, encrypted: true},
                    update: {value: encryptedKey, encrypted: true},
                })
            }
            if (s3SecretKey) {
                const encryptedSecret = encrypt(s3SecretKey)
                await prisma.setting.upsert({
                    where: {key: "backup.s3SecretKey"},
                    create: {key: "backup.s3SecretKey", value: encryptedSecret, encrypted: true},
                    update: {value: encryptedSecret, encrypted: true},
                })
            }
            if (password) {
                const encryptedPassword = encrypt(password)
                await prisma.setting.upsert({
                    where: {key: "backup.password"},
                    create: {key: "backup.password", value: encryptedPassword, encrypted: true},
                    update: {value: encryptedPassword, encrypted: true},
                })
            }

            return reply.status(200).send({success: true})
        },
    )

    // ── GET /api/settings/backup-defaults — Get global default schedule/retention

    app.get("/api/settings/backup-defaults", async () => {
        const keys = ["backup.defaultSchedule", "backup.defaultRetention"]
        const values = await settingsRepository.getMany(keys)
        const retentionRaw = values["backup.defaultRetention"]
        return {
            defaultSchedule: values["backup.defaultSchedule"] ?? null,
            defaultRetention: retentionRaw
                ? (JSON.parse(retentionRaw) as {keepDaily: number; keepWeekly: number; keepMonthly: number})
                : null,
        }
    })

    // ── PUT /api/settings/backup-defaults — Save global defaults ─────────────

    app.put(
        "/api/settings/backup-defaults",
        {schema: {body: backupDefaultsSchema}},
        async (request, reply) => {
            const {defaultSchedule, defaultRetention} = request.body
            if (defaultSchedule !== undefined) {
                await settingsRepository.upsert("backup.defaultSchedule", defaultSchedule)
            }
            if (defaultRetention !== undefined) {
                await settingsRepository.upsert("backup.defaultRetention", JSON.stringify(defaultRetention))
            }
            return reply.status(200).send({success: true})
        },
    )

    // ── GET /api/settings/backup/status — Check restic binary availability ────

    app.get("/api/settings/backup/status", async () => {
        return resticExecutor.checkVersion()
    })
}

export default backupsPlugin
