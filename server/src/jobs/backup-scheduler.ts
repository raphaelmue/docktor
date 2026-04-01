import cron from "node-cron"

// ─── Dependency interfaces ────────────────────────────────────────────────────

export interface BackupSchedulerService {
    initiateBackup(stackId: string, trigger: "MANUAL" | "SCHEDULED"): Promise<{id: string} | undefined>
    runBackup(
        backupRecord: {id: string; stackId: string; logLines: string[]},
        stack: {id: string; hostPath?: string; status: string; previousStatus: string | null; backupPreHook: string | null; backupPostHook: string | null; backupSchedule: string | null; backupRetention: string | null},
        repoConfig: {repoType: "local" | "sftp" | "s3"; password: string; repoPath?: string; sftpHost?: string; sftpUser?: string; sftpKey?: string; s3Endpoint?: string; s3Bucket?: string; s3AccessKey?: string; s3SecretKey?: string},
    ): Promise<void>
    getBackupRepoConfig(): Promise<{repoType: "local" | "sftp" | "s3"; password: string; repoPath?: string; sftpHost?: string; sftpUser?: string; sftpKey?: string; s3Endpoint?: string; s3Bucket?: string; s3AccessKey?: string; s3SecretKey?: string} | null>
}

export interface BackupSchedulerStackRepo {
    findAllWithSchedule(): Promise<Array<{id: string; backupSchedule: string | null}>>
    findByIdOrThrow(id: string): Promise<{id: string; hostPath?: string; status: string; previousStatus: string | null; backupPreHook: string | null; backupPostHook: string | null; backupSchedule: string | null; backupRetention: string | null}>
}

export interface BackupSchedulerBackupRepo {
    findByIdOrThrow(id: string): Promise<{id: string; stackId: string; logLines: string[]}>
}

export interface BackupSchedulerSettings {
    getSetting(key: string): Promise<string | null>
}

// ─── BackupScheduler ──────────────────────────────────────────────────────────

export class BackupScheduler {
    private tasks = new Map<string, cron.ScheduledTask>()

    constructor(
        private readonly service: BackupSchedulerService,
        private readonly stackRepo: BackupSchedulerStackRepo,
        private readonly settings: BackupSchedulerSettings,
    ) {}

    /**
     * Creates or replaces a cron task for the given stack.
     * Validates the cron expression before scheduling.
     */
    upsert(stackId: string, cronExpr: string): void {
        // Validate expression; cron.validate returns false for invalid expressions
        if (cron.validate(cronExpr) === false) {
            console.error(`[BackupScheduler] Invalid cron expression for stack ${stackId}: ${cronExpr}`)
            return
        }

        // Stop existing task for this stack if one exists
        const existing = this.tasks.get(stackId)
        if (existing) {
            existing.stop()
        }

        const task = cron.schedule(cronExpr, () => {
            void this.runScheduledBackup(stackId)
        }, {scheduled: true})

        this.tasks.set(stackId, task)
    }

    /**
     * Stops and removes the cron task for the given stack.
     * No-op if no task is registered.
     */
    remove(stackId: string): void {
        const task = this.tasks.get(stackId)
        if (!task) return
        task.stop()
        this.tasks.delete(stackId)
    }

    /**
     * Stops all registered cron tasks and clears the map.
     */
    stop(): void {
        for (const task of this.tasks.values()) {
            task.stop()
        }
        this.tasks.clear()
    }

    /**
     * Loads all stacks with backup schedules and registers cron tasks.
     * Uses the per-stack schedule if set, otherwise falls back to the global default.
     */
    async loadAll(): Promise<void> {
        const stacks = await this.stackRepo.findAllWithSchedule()
        const globalDefault = await this.settings.getSetting("backup.defaultSchedule")

        let registered = 0
        for (const stack of stacks) {
            const schedule = stack.backupSchedule ?? globalDefault
            if (!schedule) continue

            this.upsert(stack.id, schedule)
            registered++
        }

        console.log(`[BackupScheduler] Registered ${registered} backup schedule(s)`)
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Invokes backup for a stack on schedule. Errors are logged and swallowed
     * to prevent cron task crashes.
     */
    private async runScheduledBackup(stackId: string): Promise<void> {
        try {
            const result = await this.service.initiateBackup(stackId, "SCHEDULED")
            if (result) {
                void this.service.runBackup(result.id)
            }
        } catch (err) {
            console.error(`[BackupScheduler] Scheduled backup failed for stack ${stackId}:`, err)
        }
    }
}

// ─── Lazy production singleton ────────────────────────────────────────────────

let _scheduler: BackupScheduler | null = null

async function createProductionScheduler(): Promise<BackupScheduler> {
    const {backupService, settingsService} = await import("../application/index.js")
    const {stackRepository} = await import("../repositories/stack-repository.js")

    return new BackupScheduler(
        backupService,
        {findAllWithSchedule: () => stackRepository.findAll()},
        settingsService,
    )
}

export const backupScheduler = {
    start: async () => {
        _scheduler = await createProductionScheduler()
        await _scheduler.loadAll()
    },
    stop: () => _scheduler?.stop(),
    upsert: (stackId: string, cronExpr: string) => _scheduler?.upsert(stackId, cronExpr),
    remove: (stackId: string) => _scheduler?.remove(stackId),
}
