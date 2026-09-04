import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotificationWatcher } from "../../../src/jobs/notification-watcher.js"

function createMockNotificationService() {
    return {
        notify: vi.fn().mockResolvedValue(undefined),
    }
}

function createMockBroadcaster() {
    return {
        subscribe: vi.fn().mockReturnValue(vi.fn()),
    }
}

describe("NotificationWatcher", () => {
    let watcher: NotificationWatcher
    let notificationService: ReturnType<typeof createMockNotificationService>
    let broadcaster: ReturnType<typeof createMockBroadcaster>
    let subscribedHandler: ((event: unknown) => Promise<void>) | null = null

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        notificationService = createMockNotificationService()
        broadcaster = createMockBroadcaster()
        // Capture the handler passed to subscribe
        broadcaster.subscribe.mockImplementation((handler: (event: unknown) => Promise<void>) => {
            subscribedHandler = handler
            return vi.fn()
        })
        watcher = new NotificationWatcher(notificationService as any, broadcaster as any)
        watcher.start()
    })

    afterEach(() => {
        vi.useRealTimers()
        watcher.stop()
    })

    it("fires notification on ERROR transition", async () => {
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "exited",
            healthStatus: null,
            stackStatus: "ERROR",
        })

        expect(notificationService.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: "stack_error", stackId: "my-stack" }),
        )
    })

    it("suppresses duplicate ERROR for same stack", async () => {
        const event = {
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "exited",
            healthStatus: null,
            stackStatus: "ERROR",
        }

        await subscribedHandler!(event)
        await subscribedHandler!(event)

        expect(notificationService.notify).toHaveBeenCalledTimes(1)
    })

    it("fires notification after UNHEALTHY grace period", async () => {
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "running",
            healthStatus: "unhealthy",
            stackStatus: "UNHEALTHY",
        })

        // No notification yet — within grace period
        expect(notificationService.notify).not.toHaveBeenCalled()

        // Advance timers by 2 minutes
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

        expect(notificationService.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: "stack_unhealthy", stackId: "my-stack" }),
        )
    })

    it("cancels UNHEALTHY timer on recovery to RUNNING", async () => {
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "running",
            healthStatus: "unhealthy",
            stackStatus: "UNHEALTHY",
        })

        // Recover before grace period expires
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "running",
            healthStatus: "healthy",
            stackStatus: "RUNNING",
        })

        // Advance past grace period — notification should NOT fire
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

        expect(notificationService.notify).not.toHaveBeenCalled()
    })

    it("clears active incidents on recovery", async () => {
        // First ERROR — should notify
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "exited",
            healthStatus: null,
            stackStatus: "ERROR",
        })
        expect(notificationService.notify).toHaveBeenCalledTimes(1)

        // Recover — clears incident
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "running",
            healthStatus: "healthy",
            stackStatus: "RUNNING",
        })

        // Second ERROR after recovery — should notify again
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "exited",
            healthStatus: null,
            stackStatus: "ERROR",
        })
        expect(notificationService.notify).toHaveBeenCalledTimes(2)
    })

    it("clears timers on stop()", async () => {
        await subscribedHandler!({
            type: "container_state",
            stackId: "my-stack",
            serviceName: "web",
            containerState: "running",
            healthStatus: "unhealthy",
            stackStatus: "UNHEALTHY",
        })

        watcher.stop()

        // Advance past grace period — notification should NOT fire because watcher was stopped
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

        expect(notificationService.notify).not.toHaveBeenCalled()
    })
})
