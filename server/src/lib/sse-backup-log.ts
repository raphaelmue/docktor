import type {EventEmitter} from "node:events"

/**
 * Formats a single log line as an SSE `data:` frame. Byte-identical to the
 * shape the route wrote inline before this helper existed, so the client's
 * existing `JSON.parse` handler is unaffected.
 */
export function formatLogLineFrame(line: string): string {
    return `data: ${JSON.stringify({line})}\n\n`
}

/**
 * Formats the terminal SSE `data:` frame carrying the backup's final status.
 * Byte-identical to the shape the route wrote inline before this helper
 * existed.
 */
export function formatDoneFrame(status: string): string {
    return `data: ${JSON.stringify({done: true, status})}\n\n`
}

/**
 * HTTP-agnostic seam `streamLiveBackupLog` writes through. Keeps the helper
 * free of Fastify types so it is unit-testable without a socket.
 */
export interface BackupLogStreamPort {
    write(frame: string): void
    end(): void
    onClientClose(handler: () => void): void
}

/**
 * Replays every already-accumulated log line to a new subscriber, then
 * forwards further lines as they are emitted, until the backup reaches a
 * terminal state or the client disconnects.
 *
 * The replay snapshot, the replay writes, and attaching the `line` listener
 * all happen in one synchronous block with no `await` between them. Because
 * Node cannot interleave an `emit` into a synchronous block, a subscriber
 * receives every line exactly once: lines already accumulated arrive via the
 * replay, lines emitted afterwards arrive via the listener, and no line can
 * fall into or be duplicated across the boundary between the two.
 */
export function streamLiveBackupLog(args: {
    emitter: EventEmitter
    buffered: readonly string[]
    fallbackStatus: string
    port: BackupLogStreamPort
}): Promise<void> {
    return new Promise<void>((resolve) => {
        // 1. Snapshot the buffered lines.
        const replay = [...args.buffered]

        // 2. Replay them before attaching any listener.
        for (const line of replay) {
            args.port.write(formatLogLineFrame(line))
        }

        // 3-4. Define the live-forwarding and terminal handlers.
        const onLine = (line: string): void => {
            args.port.write(formatLogLineFrame(line))
        }

        const onDone = (finalStatus?: string): void => {
            args.port.write(formatDoneFrame(finalStatus ?? args.fallbackStatus))
            args.emitter.off("line", onLine)
            args.emitter.off("done", onDone)
            args.port.end()
            resolve()
        }

        // 5. Attach listeners — still within the same synchronous block.
        args.emitter.on("line", onLine)
        args.emitter.once("done", onDone)

        // 6. A client disconnect detaches both listeners without ending the
        // (already-gone) socket.
        args.port.onClientClose(() => {
            args.emitter.off("line", onLine)
            args.emitter.off("done", onDone)
            resolve()
        })
    })
}
