import cron from "node-cron"
import type {NotificationEvent} from "../application/notification-service.js"

export interface DiskCheckerNotificationService {
    notify(event: NotificationEvent): Promise<void>
}

export interface DiskCheckerSettings {
    getMany(keys: string[]): Promise<Record<string, string>>
    findLastDiskAlert(): Promise<{active: boolean} | null>
    setDiskAlertActive(active: boolean): Promise<void>
}

export class DiskChecker {
    private cronTask: cron.ScheduledTask | null = null
    private readonly monitorPath: string

    constructor(
        private readonly notificationService: DiskCheckerNotificationService,
        private readonly settings: DiskCheckerSettings,
        monitorPath?: string,
    ) {
        this.monitorPath = monitorPath ?? "/var/lib/docker"
    }

    start(): void {
        void this.check()
        this.cronTask = cron.schedule("0 0 * * *", () => {
            void this.check()
        })
    }

    stop(): void {
        this.cronTask?.stop()
        this.cronTask = null
    }

    async check(): Promise<void> {
        // check() is invoked fire-and-forget (`void this.check()`) from both
        // start() and the cron callback below — nothing awaits its promise,
        // so an uncaught rejection here becomes an unhandled promise
        // rejection that crashes the entire Node process, taking down the
        // HTTP server and every other job with it. This is most likely to
        // bite on the very first run against a freshly-provisioned database,
        // where the Setting table may not exist yet if the startup
        // schema-sync step (see lib/schema-sync.ts) hasn't completed or was
        // disabled. The whole body is guarded so a settings-query failure
        // degrades to a logged skip instead of a server-wide crash loop,
        // matching the fault-isolation guarantee every other job gets from
        // its own individually try/caught startJobs() registration.
        try {
            const settings = await this.settings.getMany([
                "notify.diskWarning",
                "disk.thresholdPercent",
                "disk.thresholdBytes",
            ])

            if (settings["notify.diskWarning"] === "false") return

            const thresholdPercent = Number(settings["disk.thresholdPercent"] ?? "10")
            const thresholdBytes = BigInt(settings["disk.thresholdBytes"] ?? "2147483648")

            await this.checkDiskUsage(thresholdPercent, thresholdBytes)
        } catch (err) {
            console.error("[DiskChecker] check failed:", err)
        }
    }

    private async checkDiskUsage(thresholdPercent: number, thresholdBytes: bigint): Promise<void> {
        let stats: {bsize: number; blocks: number; bavail: number}
        try {
            const {statfs} = await import("node:fs/promises")
            stats = await statfs(this.monitorPath)
        } catch (err) {
            console.error("[DiskChecker] statfs failed:", err)
            return
        }

        const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize)
        const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize)
        const freePercent = totalBytes > 0n ? Number(freeBytes * 100n / totalBytes) : 100

        const belowPercent = freePercent < thresholdPercent
        const belowBytes = freeBytes < thresholdBytes
        const triggered = belowPercent || belowBytes

        const lastAlert = await this.settings.findLastDiskAlert()

        if (triggered && (!lastAlert || !lastAlert.active)) {
            await this.settings.setDiskAlertActive(true)

            const freeMB = Number(freeBytes / (1024n * 1024n))
            const totalMB = Number(totalBytes / (1024n * 1024n))
            const thresholdKind = belowPercent ? `below ${thresholdPercent}%` : `below ${Number(thresholdBytes / (1024n * 1024n * 1024n))}GB`
            const message = [
                `Disk space warning on ${this.monitorPath}`,
                ``,
                `Free space: ${freeMB} MB (${freePercent}%) of ${totalMB} MB total`,
                `Threshold crossed: ${thresholdKind}`,
                ``,
                `This notification will not repeat until disk space recovers above the threshold.`,
            ].join("\n")

            await this.notificationService.notify({
                type: "disk_warning",
                subject: "Disk space warning",
                message,
            })
        } else if (!triggered && lastAlert?.active) {
            await this.settings.setDiskAlertActive(false)
        }
    }
}

let _checker: DiskChecker | null = null

async function createProductionChecker(): Promise<DiskChecker> {
    const [{notificationService, settingsRepository}, {notificationRepository}] = await Promise.all([
        import("../application/index.js"),
        import("../repositories/notification-repository.js"),
    ])

    const combinedSettings: DiskCheckerSettings = {
        getMany: (keys: string[]) => settingsRepository.getMany(keys),
        findLastDiskAlert: () => notificationRepository.findLastDiskAlert(),
        setDiskAlertActive: (active: boolean) => notificationRepository.setDiskAlertActive(active),
    }

    const monitorPath = process.env.DOCKER_DATA_PATH ?? (process.platform === "win32" ? "." : "/var/lib/docker")

    return new DiskChecker(notificationService, combinedSettings, monitorPath)
}

export const diskChecker = {
    start: async () => {
        _checker = await createProductionChecker()
        _checker.start()
    },
    stop: () => _checker?.stop(),
}
