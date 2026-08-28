import {useEffect, useRef} from "react"

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

export interface NotificationCreatedEvent {
    type: "notification_created"
    notificationId: string
}

export type StateEvent = ContainerStateEvent | StackStatusEvent | ConfigChangedEvent | ConfigErrorEvent | UpdateAvailableEvent | NotificationCreatedEvent

const BASE = globalThis.location?.port === "5173" ? "http://localhost:3000" : ""

export function useContainerEvents(onEvent: (event: StateEvent) => void) {
    const handler = useRef(onEvent)
    handler.current = onEvent

    useEffect(() => {
        const es = new EventSource(`${BASE}/api/events`, {withCredentials: true})
        es.onmessage = (e) => handler.current(JSON.parse(e.data))
        es.onerror = () => {} // Native EventSource auto-reconnects
        return () => es.close()
    }, [])
}
