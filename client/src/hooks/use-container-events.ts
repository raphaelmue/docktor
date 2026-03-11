import {useEffect, useRef} from "react"

export interface ContainerStateEvent {
    type: "container_state"
    stackId: string
    serviceName: string
    containerState: string
    healthStatus: string | null
    stackStatus: string
}

const BASE = globalThis.location?.port === "5173" ? "http://localhost:3000" : ""

export function useContainerEvents(onEvent: (event: ContainerStateEvent) => void) {
    const handler = useRef(onEvent)
    handler.current = onEvent

    useEffect(() => {
        const es = new EventSource(`${BASE}/api/events`, {withCredentials: true})
        es.onmessage = (e) => handler.current(JSON.parse(e.data))
        es.onerror = () => {} // Native EventSource auto-reconnects
        return () => es.close()
    }, [])
}
