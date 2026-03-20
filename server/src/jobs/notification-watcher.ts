import type {StateEvent} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"
import type {NotificationEvent} from "../application/notification-service.js"

export interface NotificationWatcherBroadcaster {
    subscribe(handler: (event: StateEvent) => void): () => void
}

export interface NotificationWatcherNotificationService {
    notify(event: NotificationEvent): Promise<void>
}

export class NotificationWatcher {
    private activeIncidents: Map<string, Set<string>> = new Map()
    private unhealthyTimers: Map<string, NodeJS.Timeout> = new Map()
    private unsubscribe: (() => void) | null = null

    constructor(
        private readonly notificationService: NotificationWatcherNotificationService,
        private readonly broadcaster: NotificationWatcherBroadcaster,
    ) {}

    start(): void {
        this.unsubscribe = this.broadcaster.subscribe((event: StateEvent) => {
            void this.handleStateEvent(event)
        })
        console.log("[NotificationWatcher] Started - subscribed to StateBroadcaster")
    }

    stop(): void {
        console.log("[NotificationWatcher] Stopped")
        this.unsubscribe?.()
        this.unsubscribe = null

        for (const timer of this.unhealthyTimers.values()) {
            clearTimeout(timer)
        }
        this.unhealthyTimers.clear()
        this.activeIncidents.clear()
    }

    async handleStateEvent(event: StateEvent): Promise<void> {
        if (event.type !== "container_state") return

        const {stackId, stackStatus} = event

        if (!this.activeIncidents.has(stackId)) {
            this.activeIncidents.set(stackId, new Set())
        }
        const active = this.activeIncidents.get(stackId)!

        if (stackStatus === "ERROR") {
            // Cancel any pending UNHEALTHY timer (ERROR supersedes UNHEALTHY)
            const existingTimer = this.unhealthyTimers.get(stackId)
            if (existingTimer !== undefined) {
                clearTimeout(existingTimer)
                this.unhealthyTimers.delete(stackId)
            }

            if (!active.has("error")) {
                active.add("error")
                const timestamp = new Date().toISOString()
                await this.notificationService.notify({
                    type: "stack_error",
                    stackId,
                    subject: `Stack error: ${stackId}`,
                    message: `Stack ${stackId} entered ERROR state at ${timestamp}\n\nThis notification will not repeat until the stack recovers.`,
                })
            }
            return
        }

        if (stackStatus === "UNHEALTHY") {
            if (!active.has("unhealthy") && !this.unhealthyTimers.has(stackId)) {
                const timer = setTimeout(() => {
                    this.unhealthyTimers.delete(stackId)
                    const currentActive = this.activeIncidents.get(stackId)
                    if (currentActive && !currentActive.has("unhealthy")) {
                        currentActive.add("unhealthy")
                        void this.notificationService.notify({
                            type: "stack_unhealthy",
                            stackId,
                            subject: `Stack unhealthy: ${stackId}`,
                            message: `Stack ${stackId} has been UNHEALTHY for over 2 minutes.\n\nThis notification will not repeat until the stack recovers.`,
                        })
                    }
                }, 120_000)
                this.unhealthyTimers.set(stackId, timer)
            }
            return
        }

        // Recovery: RUNNING, HEALTHY, STOPPED
        if (stackStatus === "RUNNING" || stackStatus === "HEALTHY" || stackStatus === "STOPPED") {
            const existingTimer = this.unhealthyTimers.get(stackId)
            if (existingTimer !== undefined) {
                clearTimeout(existingTimer)
                this.unhealthyTimers.delete(stackId)
            }
            this.activeIncidents.delete(stackId)
        }
    }
}

let _watcher: NotificationWatcher | null = null

async function createProductionWatcher(): Promise<NotificationWatcher> {
    const {notificationService} = await import("../application/index.js")
    return new NotificationWatcher(notificationService, stateEventBroadcaster)
}

export const notificationWatcher = {
    start: async () => {
        if (!_watcher) {
            _watcher = await createProductionWatcher()
        }
        _watcher.start()
    },
    stop: () => _watcher?.stop(),
}
