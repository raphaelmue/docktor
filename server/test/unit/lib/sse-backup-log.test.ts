import {describe, expect, it, vi} from "vitest"
import {EventEmitter} from "node:events"
import {
    formatLogLineFrame,
    formatDoneFrame,
    streamLiveBackupLog,
    type BackupLogStreamPort,
} from "../../../src/lib/sse-backup-log.js"

function createFakePort(): BackupLogStreamPort & {writes: string[]; endCalls: number; closeHandler?: () => void} {
    const port = {
        writes: [] as string[],
        endCalls: 0,
        closeHandler: undefined as (() => void) | undefined,
        write(frame: string): void {
            port.writes.push(frame)
        },
        end(): void {
            port.endCalls += 1
        },
        onClientClose(handler: () => void): void {
            port.closeHandler = handler
        },
    }
    return port
}

describe("sse-backup-log", () => {
    describe("formatLogLineFrame()", () => {
        it("produces the expected SSE data frame for a line", () => {
            expect(formatLogLineFrame("snapshot abc123 saved")).toBe(
                `data: ${JSON.stringify({line: "snapshot abc123 saved"})}\n\n`,
            )
        })
    })

    describe("formatDoneFrame()", () => {
        it("produces the expected SSE data frame for a status", () => {
            expect(formatDoneFrame("COMPLETED")).toBe(`data: ${JSON.stringify({done: true, status: "COMPLETED"})}\n\n`)
        })
    })

    describe("streamLiveBackupLog()", () => {
        it("writes buffered lines, in order, before any listener-driven frame", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            const promise = streamLiveBackupLog({
                emitter,
                buffered: ["one", "two", "three"],
                fallbackStatus: "IN_PROGRESS",
                port,
            })

            expect(port.writes).toEqual([
                formatLogLineFrame("one"),
                formatLogLineFrame("two"),
                formatLogLineFrame("three"),
            ])

            emitter.emit("done", "COMPLETED")
            await promise
        })

        it("appends a line emitted after streamLiveBackupLog returns once and only once — full sequence is replay-then-live with no repeats", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            const promise = streamLiveBackupLog({
                emitter,
                buffered: ["one", "two"],
                fallbackStatus: "IN_PROGRESS",
                port,
            })

            emitter.emit("line", "three")
            emitter.emit("done", "COMPLETED")
            await promise

            expect(port.writes).toEqual([
                formatLogLineFrame("one"),
                formatLogLineFrame("two"),
                formatLogLineFrame("three"),
                formatDoneFrame("COMPLETED"),
            ])
        })

        it("a line already present in buffered, even if also emitted before the call, appears exactly once", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            // "one" was already accumulated into `buffered` by the time this
            // subscriber calls streamLiveBackupLog — it must not be delivered
            // a second time just because the emitter also carries it.
            const promise = streamLiveBackupLog({
                emitter,
                buffered: ["one"],
                fallbackStatus: "IN_PROGRESS",
                port,
            })

            emitter.emit("done", "COMPLETED")
            await promise

            const lineWrites = port.writes.filter((frame) => frame === formatLogLineFrame("one"))
            expect(lineWrites).toHaveLength(1)
        })

        it("emit('done', 'COMPLETED') writes the done frame carrying COMPLETED, calls end() once, and resolves", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            const promise = streamLiveBackupLog({emitter, buffered: [], fallbackStatus: "IN_PROGRESS", port})
            emitter.emit("done", "COMPLETED")
            await promise

            expect(port.writes.at(-1)).toBe(formatDoneFrame("COMPLETED"))
            expect(port.endCalls).toBe(1)
        })

        it("emit('done') with no argument writes the done frame carrying fallbackStatus", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            const promise = streamLiveBackupLog({emitter, buffered: [], fallbackStatus: "IN_PROGRESS", port})
            emitter.emit("done")
            await promise

            expect(port.writes.at(-1)).toBe(formatDoneFrame("IN_PROGRESS"))
        })

        it("writes nothing further after the promise resolves via done — listeners were detached", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()

            const promise = streamLiveBackupLog({emitter, buffered: [], fallbackStatus: "IN_PROGRESS", port})
            emitter.emit("done", "COMPLETED")
            await promise

            const writeCountAtDone = port.writes.length
            emitter.emit("line", "late line")

            expect(port.writes).toHaveLength(writeCountAtDone)
        })

        it("invoking the onClientClose handler resolves the promise, writes no further frames, calls end() zero times, and detaches both listeners", async () => {
            const emitter = new EventEmitter()
            const port = createFakePort()
            const resolved = vi.fn()

            const promise = streamLiveBackupLog({emitter, buffered: ["one"], fallbackStatus: "IN_PROGRESS", port}).then(
                resolved,
            )

            const writeCountBeforeClose = port.writes.length
            expect(port.closeHandler).toBeDefined()
            port.closeHandler?.()
            await promise

            expect(resolved).toHaveBeenCalledTimes(1)
            expect(port.writes).toHaveLength(writeCountBeforeClose)
            expect(port.endCalls).toBe(0)
            expect(emitter.listenerCount("line")).toBe(0)
            expect(emitter.listenerCount("done")).toBe(0)
        })
    })
})
