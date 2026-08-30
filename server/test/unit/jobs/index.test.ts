import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../src/jobs/state-poller.js", () => ({
    statePoller: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/jobs/file-watcher.js", () => ({
    fileWatcher: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/jobs/update-checker.js", () => ({
    updateChecker: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/jobs/disk-checker.js", () => ({
    diskChecker: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/jobs/notification-watcher.js", () => ({
    notificationWatcher: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/jobs/backup-scheduler.js", () => ({
    backupScheduler: { start: vi.fn(), stop: vi.fn() },
}))
vi.mock("../../../src/application/index.js", () => ({
    backupService: { recoverInProgressBackups: vi.fn() },
}))

import { startJobs, stopJobs } from "../../../src/jobs/index.js"
import { statePoller } from "../../../src/jobs/state-poller.js"
import { fileWatcher } from "../../../src/jobs/file-watcher.js"
import { updateChecker } from "../../../src/jobs/update-checker.js"
import { diskChecker } from "../../../src/jobs/disk-checker.js"
import { notificationWatcher } from "../../../src/jobs/notification-watcher.js"
import { backupScheduler } from "../../../src/jobs/backup-scheduler.js"
import { backupService } from "../../../src/application/index.js"

describe("startJobs", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    it("starts every job when none fail", async () => {
        await startJobs()

        expect(backupService.recoverInProgressBackups).toHaveBeenCalledOnce()
        expect(statePoller.start).toHaveBeenCalledOnce()
        expect(fileWatcher.start).toHaveBeenCalledOnce()
        expect(updateChecker.start).toHaveBeenCalledOnce()
        expect(diskChecker.start).toHaveBeenCalledOnce()
        expect(notificationWatcher.start).toHaveBeenCalledOnce()
        expect(backupScheduler.start).toHaveBeenCalledOnce()
    })

    it("does not throw and still starts the remaining jobs when backup recovery fails (e.g. DB not ready yet on cold start)", async () => {
        vi.mocked(backupService.recoverInProgressBackups).mockRejectedValueOnce(
            new Error("ECONNREFUSED"),
        )

        await expect(startJobs()).resolves.toBeUndefined()

        expect(statePoller.start).toHaveBeenCalledOnce()
        expect(fileWatcher.start).toHaveBeenCalledOnce()
        expect(updateChecker.start).toHaveBeenCalledOnce()
        expect(diskChecker.start).toHaveBeenCalledOnce()
        expect(notificationWatcher.start).toHaveBeenCalledOnce()
        expect(backupScheduler.start).toHaveBeenCalledOnce()
        expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it("isolates a single job failure so every other job still starts", async () => {
        vi.mocked(fileWatcher.start).mockRejectedValueOnce(new Error("boom"))

        await expect(startJobs()).resolves.toBeUndefined()

        expect(backupService.recoverInProgressBackups).toHaveBeenCalledOnce()
        expect(statePoller.start).toHaveBeenCalledOnce()
        expect(updateChecker.start).toHaveBeenCalledOnce()
        expect(diskChecker.start).toHaveBeenCalledOnce()
        expect(notificationWatcher.start).toHaveBeenCalledOnce()
        expect(backupScheduler.start).toHaveBeenCalledOnce()
    })
})

describe("stopJobs", () => {
    it("stops every job", () => {
        stopJobs()

        expect(statePoller.stop).toHaveBeenCalledOnce()
        expect(fileWatcher.stop).toHaveBeenCalledOnce()
        expect(updateChecker.stop).toHaveBeenCalledOnce()
        expect(diskChecker.stop).toHaveBeenCalledOnce()
        expect(notificationWatcher.stop).toHaveBeenCalledOnce()
        expect(backupScheduler.stop).toHaveBeenCalledOnce()
    })
})
