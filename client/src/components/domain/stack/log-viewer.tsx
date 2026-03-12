import {useEffect, useRef, useState} from "react";
import Ansi from "ansi-to-react";
import {type LogLineEvent, useLogStream} from "@/hooks/use-log-stream";
import {Button} from "@/components/ui/button";

interface LogViewerProps {
    stackId: string
    serviceNames?: string[]
    initialService?: string
}

function formatLine(line: LogLineEvent, showTimestamps: boolean, showServicePrefix: boolean): string {
    let parts = ""
    if (showTimestamps && line.timestamp) {
        // Format as HH:MM:SS
        const ts = new Date(line.timestamp)
        const hh = ts.getHours().toString().padStart(2, "0")
        const mm = ts.getMinutes().toString().padStart(2, "0")
        const ss = ts.getSeconds().toString().padStart(2, "0")
        parts += `${hh}:${mm}:${ss} `
    }
    if (showServicePrefix) {
        parts += `[${line.service}] `
    }
    parts += line.line
    return parts
}

export function LogViewer({stackId, serviceNames = [], initialService}: LogViewerProps) {
    const [selectedService, setSelectedService] = useState<string>(initialService ?? "all")
    const [autoScroll, setAutoScroll] = useState(true)
    const [showTimestamps, setShowTimestamps] = useState(false)
    const [lineWrap, setLineWrap] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    const {lines, connected, clear} = useLogStream(stackId, selectedService, true)

    // Update selected service when initialService prop changes (e.g., from "Logs" button)
    useEffect(() => {
        if (initialService !== undefined) {
            setSelectedService(initialService)
        }
    }, [initialService])

    // Auto-scroll effect
    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            const el = scrollRef.current
            if (typeof el.scrollTo === "function") {
                el.scrollTo(0, el.scrollHeight)
            } else {
                el.scrollTop = el.scrollHeight
            }
        }
    }, [lines, autoScroll])

    const showServicePrefix = selectedService === "all"

    return (
        <div className="space-y-2">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <select
                    className="h-8 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={selectedService}
                    onChange={(e) => {
                        setSelectedService(e.target.value)
                        clear()
                    }}
                    aria-label="Select service"
                >
                    <option value="all">All services</option>
                    {serviceNames.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>

                <Button
                    size="sm"
                    variant={autoScroll ? "default" : "outline"}
                    onClick={() => setAutoScroll(v => !v)}
                    title="Toggle auto-scroll"
                >
                    Auto-scroll
                </Button>

                <Button
                    size="sm"
                    variant={showTimestamps ? "default" : "outline"}
                    onClick={() => setShowTimestamps(v => !v)}
                    title="Toggle timestamps"
                >
                    Timestamps
                </Button>

                <Button
                    size="sm"
                    variant={lineWrap ? "default" : "outline"}
                    onClick={() => setLineWrap(v => !v)}
                    title="Toggle line wrap"
                >
                    Wrap
                </Button>

                <Button
                    size="sm"
                    variant="outline"
                    onClick={clear}
                    title="Clear log output"
                >
                    Clear
                </Button>

                <span className="text-xs text-muted-foreground ml-auto">
                    {connected ? "Connected" : "Disconnected"}
                </span>
            </div>

            {/* Terminal */}
            <div
                data-testid="log-viewer-terminal"
                ref={scrollRef}
                className="bg-black rounded font-mono text-sm text-green-400 h-96 overflow-y-auto p-2"
            >
                {lines.length === 0 ? (
                    <span className="text-gray-500">No log output yet...</span>
                ) : (
                    lines.map((line, i) => (
                        <div
                            key={i}
                            className={lineWrap ? "break-all" : "whitespace-nowrap"}
                        >
                            <Ansi>{formatLine(line, showTimestamps, showServicePrefix)}</Ansi>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
