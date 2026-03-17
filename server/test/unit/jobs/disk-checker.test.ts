import { beforeEach, describe, expect, it, vi } from "vitest"
import { DiskChecker } from "../../../src/jobs/disk-checker.js"

vi.mock("node:fs/promises", () => ({ statfs: vi.fn() }))

import { statfs } from "node:fs/promises"

const mockStatfs = vi.mocked(statfs)

function createMockNotificationService() {
    return {
        notify: vi.fn().mockResolvedValue(undefined),
    }
}

function createMockSettings() {
    return {
        getMany: vi.fn(),
        findLastDiskAlert: vi.fn(),
        setDiskAlertActive: vi.fn(),
    }
}

// Helper to build statfs return value from percent free
function makeStatfs(freePercent: number, totalBytes: bigint = 100n * 1024n * 1024n * 1024n) {
    const bsize = 4096
    const blocks = Number(totalBytes / BigInt(bsize))
    const bavail = Math.floor((blocks * freePercent) / 100)
    return { bsize, blocks, bavail, bfree: bavail, files: 0, ffree: 0 }
}

// Helper to build statfs return value from free bytes
function makeStatfsFromBytes(freeBytes: bigint, totalBytes: bigint = 100n * 1024n * 1024n * 1024n) {
    const bsize = 4096
    const blocks = Number(totalBytes / BigInt(bsize))
    const bavail = Number(freeBytes / BigInt(bsize))
    return { bsize, blocks, bavail, bfree: bavail, files: 0, ffree: 0 }
}

describe("DiskChecker", () => {
    let checker: DiskChecker
    let notificationService: ReturnType<typeof createMockNotificationService>
    let settings: ReturnType<typeof createMockSettings>

    beforeEach(() => {
        vi.clearAllMocks()
        notificationService = createMockNotificationService()
        settings = createMockSettings()
        checker = new DiskChecker(notificationService as any, settings as any)

        // Default settings: disk warning enabled, thresholds at defaults
        settings.getMany.mockResolvedValue({
            "notify.diskWarning": "true",
            "disk.thresholdPercent": "10",
            "disk.thresholdBytes": "2147483648",
        })
        settings.findLastDiskAlert.mockResolvedValue(null)
    })

    it("triggers notification when free percent below threshold", async () => {
        // 5% free — below 10% threshold
        mockStatfs.mockResolvedValue(makeStatfs(5) as any)
        settings.findLastDiskAlert.mockResolvedValue({ active: false })

        await checker.check()

        expect(notificationService.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: "disk_warning" }),
        )
    })

    it("triggers notification when free bytes below threshold", async () => {
        // 1GB free — below 2GB threshold
        const oneGB = 1n * 1024n * 1024n * 1024n
        mockStatfs.mockResolvedValue(makeStatfsFromBytes(oneGB) as any)
        settings.findLastDiskAlert.mockResolvedValue({ active: false })

        await checker.check()

        expect(notificationService.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: "disk_warning" }),
        )
    })

    it("suppresses duplicate when alert already active", async () => {
        mockStatfs.mockResolvedValue(makeStatfs(5) as any)
        settings.findLastDiskAlert.mockResolvedValue({ active: true })

        await checker.check()

        expect(notificationService.notify).not.toHaveBeenCalled()
    })

    it("clears alert when disk recovers above thresholds", async () => {
        // 50% free — above both thresholds
        mockStatfs.mockResolvedValue(makeStatfs(50) as any)
        settings.findLastDiskAlert.mockResolvedValue({ active: true })

        await checker.check()

        expect(settings.setDiskAlertActive).toHaveBeenCalledWith(false)
        expect(notificationService.notify).not.toHaveBeenCalled()
    })

    it("skips check when toggle is disabled", async () => {
        settings.getMany.mockResolvedValue({
            "notify.diskWarning": "false",
            "disk.thresholdPercent": "10",
            "disk.thresholdBytes": "2147483648",
        })

        await checker.check()

        expect(mockStatfs).not.toHaveBeenCalled()
        expect(notificationService.notify).not.toHaveBeenCalled()
    })
})
