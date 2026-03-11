import {EventEmitter} from "node:events"

export interface ContainerStateEvent {
    type: "container_state"
    stackId: string
    serviceName: string
    containerState: string
    healthStatus: string | null
    stackStatus: string
}

export class StateBroadcaster extends EventEmitter {
    publish(event: ContainerStateEvent): void {
        this.emit("event", event)
    }

    subscribe(handler: (event: ContainerStateEvent) => void): () => void {
        this.on("event", handler)
        return () => this.off("event", handler)
    }
}

export const stateEventBroadcaster = new StateBroadcaster()
stateEventBroadcaster.setMaxListeners(100)
