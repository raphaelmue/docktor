import {useEffect, useRef} from "react";
import Ansi from "ansi-to-react";
import {ScrollArea} from "@/components/ui/scroll-area";
import {cn} from "@/lib/utils";

interface LogOutputProps {
    lines: string[];
    autoScroll?: boolean;
    className?: string;
    emptyMessage?: string;
}

/**
 * Generic log output component that displays an array of log lines.
 * Supports ANSI color codes and auto-scrolling.
 */
export function LogOutput({
    lines,
    autoScroll = true,
    className,
    emptyMessage = "No output yet...",
}: Readonly<LogOutputProps>) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll effect
    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines.length, autoScroll]);

    return (
        <ScrollArea className={cn("h-96", className)}>
            <div
                ref={scrollRef}
                className="p-4 font-mono text-xs whitespace-pre-wrap bg-muted/30"
                aria-live={autoScroll ? "polite" : "off"}
            >
                {lines.length === 0 ? (
                    <span className="text-muted-foreground">{emptyMessage}</span>
                ) : (
                    lines.map((line, idx) => (
                        <div key={idx}>
                            <Ansi>{line}</Ansi>
                        </div>
                    ))
                )}
            </div>
        </ScrollArea>
    );
}
