import {EventEmitter} from "node:events"

export interface ContainerStateEvent {
    type: "container_state"
    stackId: string
    serviceName: string
    containerState: string
    healthStatus: string | null
    stackStatus: string
    statusLog?: {
        id: string
        fromStatus: string | null
        toStatus: string
        message: string | null
        createdAt: string
    }
}

export interface StackStatusEvent {
    type: "stack_status"
    stackId: string
    stackStatus: string
}

export interface ConfigChangedEvent {
    type: "config_changed"
    stackId: string
    newHash: string
}

export interface ConfigErrorEvent {
    type: "config_error"
    stackId: string
    message: string
}

export interface UpdateAvailableEvent {
    type: "update_available"
    stackId: string
    imageRef: string
    latestTag: string | null
    hasUpdate: boolean
}

export type StateEvent =
    | ContainerStateEvent
    | StackStatusEvent
    | ConfigChangedEvent
    | ConfigErrorEvent
    | UpdateAvailableEvent

export class StateBroadcaster extends EventEmitter {
    publish(event: StateEvent): void {
        this.emit("event", event)
    }

    subscribe(handler: (event: StateEvent) => void): () => void {
        this.on("event", handler)
        return () => this.off("event", handler)
    }
}

export const stateEventBroadcaster = new StateBroadcaster()
stateEventBroadcaster.setMaxListeners(100)
