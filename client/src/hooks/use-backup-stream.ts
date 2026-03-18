import {useState, useEffect, useRef} from "react"

export function useBackupStream(
    backupId: string | null,
    active: boolean,
): {lines: string[]; status: "streaming" | "done" | "error"} {
    const [lines, setLines] = useState<string[]>([])
    const [status, setStatus] = useState<"streaming" | "done" | "error">("streaming")
    const esRef = useRef<EventSource | null>(null)

    useEffect(() => {
        if (!active || !backupId) return

        setLines([])
        setStatus("streaming")

        const url = `/api/backups/${backupId}/stream`
        const es = new EventSource(url, {withCredentials: true})
        esRef.current = es

        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data) as {line?: string; done?: boolean; status?: string}
                if (data.line) {
                    setLines((prev) => [...prev, data.line!])
                }
                if (data.done) {
                    setStatus(data.status === "COMPLETED" ? "done" : "error")
                    es.close()
                }
            } catch {
                // ignore parse errors
            }
        }

        es.onerror = () => {
            setStatus("error")
            es.close()
        }

        return () => {
            es.close()
            esRef.current = null
        }
    }, [backupId, active])

    return {lines, status}
}
