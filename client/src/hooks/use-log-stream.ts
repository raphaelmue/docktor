import {useCallback, useEffect, useRef, useState} from "react";

export interface LogLineEvent {
    type: "log"
    service: string
    line: string
    timestamp?: string
}

export function useLogStream(
    stackId: string,
    service: string,
    enabled: boolean,
): {
    lines: LogLineEvent[]
    connected: boolean
    clear: () => void
} {
    const [lines, setLines] = useState<LogLineEvent[]>([])
    const [connected, setConnected] = useState(false)
    const esRef = useRef<EventSource | null>(null)

    useEffect(() => {
        if (!enabled) {
            if (esRef.current) {
                esRef.current.close()
                esRef.current = null
                setConnected(false)
            }
            return
        }

        // Close any existing connection before opening a new one
        if (esRef.current) {
            esRef.current.close()
            esRef.current = null
            setConnected(false)
        }

        const url = `/api/stacks/${stackId}/logs?service=${encodeURIComponent(service)}`
        const es = new EventSource(url, {withCredentials: true})
        esRef.current = es

        es.onopen = () => setConnected(true)
        es.onerror = () => setConnected(false)

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as LogLineEvent
                setLines(prev => [...prev, parsed])
            } catch {
                // Ignore malformed messages
            }
        }

        return () => {
            es.close()
            esRef.current = null
            setConnected(false)
        }
    }, [stackId, service, enabled])

    const clear = useCallback(() => {
        setLines([])
    }, [])

    return {lines, connected, clear}
}
