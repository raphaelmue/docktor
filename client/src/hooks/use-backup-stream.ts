import {useState, useEffect, useRef} from "react"

export type BackupStreamStatus = "streaming" | "completed" | "failed" | "disconnected"

// Inlined rather than read off the global `EventSource.CLOSED` because this
// hook's own unit test substitutes a mock EventSource that carries no static
// members.
const EVENT_SOURCE_CLOSED = 2

// Manual reconnect schedule used once the browser's own native EventSource
// retry has given up (readyState reaches CLOSED). Five attempts spanning
// roughly thirty seconds; its length is also the attempt bound.
export const BACKUP_STREAM_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000]

export function useBackupStream(
    backupId: string | null,
    active: boolean,
): {lines: string[]; status: BackupStreamStatus} {
    const [lines, setLines] = useState<string[]>([])
    const [status, setStatus] = useState<BackupStreamStatus>("streaming")
    const esRef = useRef<EventSource | null>(null)

    useEffect(() => {
        if (!active || !backupId) return

        let attempt = 0
        let timer: ReturnType<typeof setTimeout> | null = null
        let torndown = false

        function connect(): void {
            // The server replays the entire log known so far at the start of
            // every subscription to GET /api/backups/:id/stream — the
            // terminal-status and missing-broadcaster branches replay the
            // persisted record, and the live branch replays the in-memory
            // accumulator (WR-01, BCK-03). A fresh connection is therefore
            // always authoritative, so clearing here is exactly what stops a
            // reconnect's replay from showing every line twice.
            setLines([])

            const url = `/api/backups/${backupId}/stream`
            const es = new EventSource(url, {withCredentials: true})
            esRef.current = es

            es.onopen = () => {
                attempt = 0
                setStatus("streaming")
            }

            es.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data) as {line?: string; done?: boolean; status?: string}
                    if (data.line) {
                        setLines((prev) => [...prev, data.line!])
                    }
                    if (data.done) {
                        if (data.status === "COMPLETED") {
                            setStatus("completed")
                        } else if (data.status === "FAILED") {
                            setStatus("failed")
                        } else if (data.status !== undefined) {
                            // Present but non-terminal (e.g. IN_PROGRESS) — the
                            // server is stating it has no verdict yet, not that
                            // the backup failed. Never render a non-verdict as
                            // a verdict; the page's own resync re-reads the
                            // record, which is the authority.
                            setStatus("disconnected")
                        } else {
                            // Absent status field is a malformed frame, not an
                            // in-progress report — preserve 04-16's mapping.
                            setStatus("failed")
                        }
                        es.close()
                    }
                } catch {
                    // ignore parse errors
                }
            }

            es.onerror = () => {
                setStatus("disconnected")
                if (es.readyState === EVENT_SOURCE_CLOSED) {
                    // The browser has given up retrying — take over with
                    // bounded manual backoff.
                    es.close()
                    scheduleReconnect()
                }
                // Otherwise the browser is already retrying natively; leave the
                // EventSource open and let onopen restore the status.
            }
        }

        function scheduleReconnect(): void {
            if (torndown) return
            if (attempt >= BACKUP_STREAM_RECONNECT_DELAYS_MS.length) return

            const delay = BACKUP_STREAM_RECONNECT_DELAYS_MS[attempt]
            attempt += 1

            timer = setTimeout(() => {
                timer = null
                if (torndown) return
                connect()
            }, delay)
        }

        connect()

        return () => {
            torndown = true
            if (timer) clearTimeout(timer)
            esRef.current?.close()
            esRef.current = null
        }
    }, [backupId, active])

    return {lines, status}
}
