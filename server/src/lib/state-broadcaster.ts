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

export type StateEvent = ContainerStateEvent | StackStatusEvent

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
