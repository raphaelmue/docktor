import {useEffect, useState} from "react"
import {useContainerEvents} from "@/hooks/use-container-events"

export interface ProxyStatusEntry {
    status: "pending" | "issued" | "failed"
    message?: string
}

export type ProxyStatusMap = Record<string, ProxyStatusEntry>

/**
 * Subscribes to proxy_cert_status SSE events for one stack, returning a map
 * from proxyConfigId to its live {status, message}. Built on top of the
 * existing useContainerEvents(onEvent) hook rather than opening a second
 * EventSource — the app already runs one /api/events stream, and a second
 * connection per stack detail page would multiply server-side subscribers
 * for no benefit. Cleanup (closing the EventSource on unmount) is inherited
 * from useContainerEvents, which already does this per CLAUDE.md's leak
 * rule — this hook has no cleanup logic of its own to duplicate.
 */
export function useProxyStatus(stackId: string) {
    const [statuses, setStatuses] = useState<ProxyStatusMap>({})

    // A stackId change means this is a different stack's status history —
    // stale entries from the previous stack must not linger.
    useEffect(() => {
        setStatuses({})
    }, [stackId])

    useContainerEvents((event) => {
        if (event.type !== "proxy_cert_status") return
        if (event.stackId !== stackId) return

        setStatuses((prev) => ({
            ...prev,
            [event.proxyConfigId]: {
                status: event.status,
                ...(event.message !== undefined && {message: event.message}),
            },
        }))
    })

    return {statuses}
}
