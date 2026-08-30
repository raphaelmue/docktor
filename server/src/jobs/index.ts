import {statePoller} from "./state-poller.js"
import {fileWatcher} from "./file-watcher.js"
import {updateChecker} from "./update-checker.js"
import {diskChecker} from "./disk-checker.js"
import {notificationWatcher} from "./notification-watcher.js"
import {backupScheduler} from "./backup-scheduler.js"

// A job that fails to start (e.g. the DB isn't reachable yet on a cold
// docker-compose start) must not prevent the other jobs — or the HTTP
// server itself — from coming up, so each job's startup is isolated here.
async function startJob(name: string, start: () => Promise<void> | void): Promise<void> {
    try {
        await start()
    } catch (err) {
        console.error(`[Jobs] ${name} failed to start:`, err)
    }
}

export async function startJobs(): Promise<void> {
    // Recover orphaned in-progress backups before starting scheduler
    const {backupService} = await import("../application/index.js")
    await startJob("BackupRecovery", () => backupService.recoverInProgressBackups())

    await startJob("StatePoller", () => statePoller.start())
    await startJob("FileWatcher", () => fileWatcher.start())
    await startJob("UpdateChecker", () => updateChecker.start())
    await startJob("DiskChecker", () => diskChecker.start())
    await startJob("NotificationWatcher", () => notificationWatcher.start())
    await startJob("BackupScheduler", () => backupScheduler.start())
}

export function stopJobs(): void {
    statePoller.stop()
    void fileWatcher.stop()
    updateChecker.stop()
    diskChecker.stop()
    notificationWatcher.stop()
    backupScheduler.stop()
}
