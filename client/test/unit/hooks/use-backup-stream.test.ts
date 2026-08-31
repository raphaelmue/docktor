import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook} from "@testing-library/react";
import {useBackupStream, BACKUP_STREAM_RECONNECT_DELAYS_MS} from "../../../src/hooks/use-backup-stream.js";

// Mock EventSource globally (jsdom does not provide it)
function createMockEventSource() {
    return {
        onopen: null as (() => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        close: vi.fn(),
        url: "",
        withCredentials: false,
        // Defaults to CLOSED (2) — the pre-04-17 "onerror always closes" test
        // fires onerror without touching readyState, so the default has to
        // reproduce that pre-existing assumption. Tests that care about the
        // CONNECTING-vs-CLOSED branch set readyState explicitly via fireError().
        readyState: 2,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
}

let mockEventSourceInstance: ReturnType<typeof createMockEventSource>;
let instances: ReturnType<typeof createMockEventSource>[];
const MockEventSource = vi.fn(function () {
    mockEventSourceInstance = createMockEventSource();
    instances.push(mockEventSourceInstance);
    return mockEventSourceInstance;
});

function emit(payload: unknown, instance: ReturnType<typeof createMockEventSource> = mockEventSourceInstance) {
    const message = new MessageEvent("message", {data: JSON.stringify(payload)});
    act(() => {
        instance.onmessage?.(message);
    });
}

function fireOpen(instance: ReturnType<typeof createMockEventSource> = mockEventSourceInstance) {
    act(() => {
        instance.onopen?.();
    });
}

function fireError(
    readyState: number,
    instance: ReturnType<typeof createMockEventSource> = mockEventSourceInstance,
) {
    instance.readyState = readyState;
    act(() => {
        instance.onerror?.(new Event("error"));
    });
}

const READY_STATE_CONNECTING = 0;
const READY_STATE_CLOSED = 2;

describe("useBackupStream", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        instances = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).EventSource = MockEventSource;
        mockEventSourceInstance = createMockEventSource();
    });

    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (global as any).EventSource;
        vi.useRealTimers();
    });

    it("opens an EventSource to /api/backups/{backupId}/stream with withCredentials true when active", () => {
        renderHook(() => useBackupStream("b1", true));

        expect(MockEventSource).toHaveBeenCalledWith(
            "/api/backups/b1/stream",
            expect.objectContaining({withCredentials: true}),
        );
    });

    it("opens no EventSource when active is false", () => {
        renderHook(() => useBackupStream("b1", false));

        expect(MockEventSource).not.toHaveBeenCalled();
    });

    it("opens no EventSource when backupId is empty", () => {
        renderHook(() => useBackupStream("", true));

        expect(MockEventSource).not.toHaveBeenCalled();
    });

    it("appends a message carrying a line to lines in arrival order", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({line: "first"});
        emit({line: "second"});

        expect(result.current.lines).toEqual(["first", "second"]);
    });

    it("sets status to completed and closes the EventSource on done with status COMPLETED", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({done: true, status: "COMPLETED"});

        expect(result.current.status).toBe("completed");
        expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it("sets status to failed and closes the EventSource on done with status FAILED", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({done: true, status: "FAILED"});

        expect(result.current.status).toBe("failed");
        expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it("sets status to failed (not completed) on a done payload with no status field", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({done: true});

        expect(result.current.status).toBe("failed");
    });

    it("sets status to disconnected and closes the EventSource on onerror", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        act(() => {
            mockEventSourceInstance.onerror?.(new Event("error"));
        });

        expect(result.current.status).toBe("disconnected");
        expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it("ignores a malformed JSON payload, leaving lines and status unchanged", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        const message = new MessageEvent("message", {data: "not json"});
        act(() => {
            mockEventSourceInstance.onmessage?.(message);
        });

        expect(result.current.lines).toEqual([]);
        expect(result.current.status).toBe("streaming");
    });

    it("closes the EventSource on unmount", () => {
        const {unmount} = renderHook(() => useBackupStream("b1", true));

        unmount();

        expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it("sets status to disconnected on a done payload with status IN_PROGRESS, not failed, and schedules no reconnect", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({done: true, status: "IN_PROGRESS"});

        expect(result.current.status).toBe("disconnected");
        expect(mockEventSourceInstance.close).toHaveBeenCalled();
        expect(instances).toHaveLength(1);
    });

    it("an onerror fired while readyState is CONNECTING sets disconnected, does not close, and opens no replacement", () => {
        const {result} = renderHook(() => useBackupStream("b1", true));

        fireError(READY_STATE_CONNECTING);

        expect(result.current.status).toBe("disconnected");
        expect(mockEventSourceInstance.close).not.toHaveBeenCalled();
        expect(instances).toHaveLength(1);
    });

    it("an onerror fired while readyState is CLOSED closes the EventSource and reconnects after the first backoff delay", async () => {
        vi.useFakeTimers();
        const {result} = renderHook(() => useBackupStream("b1", true));

        fireError(READY_STATE_CLOSED);

        expect(mockEventSourceInstance.close).toHaveBeenCalled();
        expect(instances).toHaveLength(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0]);
        });

        expect(instances).toHaveLength(2);
        expect(result.current.status).toBe("disconnected");
    });

    it("a replacement connection that opens sets status back to streaming", async () => {
        vi.useFakeTimers();
        const {result} = renderHook(() => useBackupStream("b1", true));

        fireError(READY_STATE_CLOSED);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0]);
        });

        expect(result.current.status).toBe("disconnected");
        fireOpen(instances[instances.length - 1]);
        expect(result.current.status).toBe("streaming");
    });

    it("resets the attempt counter on open, so the next CLOSED error reconnects at the first delay again", async () => {
        vi.useFakeTimers();
        renderHook(() => useBackupStream("b1", true));

        // First disconnect + reconnect
        fireError(READY_STATE_CLOSED);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0]);
        });
        expect(instances).toHaveLength(2);

        // Successful open resets the attempt counter
        fireOpen(instances[1]);

        // Second disconnect should reconnect at delay[0] again, not delay[1]
        fireError(READY_STATE_CLOSED, instances[1]);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0] - 1);
        });
        expect(instances).toHaveLength(2);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(instances).toHaveLength(3);
    });

    it("stops manual reconnection after BACKUP_STREAM_RECONNECT_DELAYS_MS.length attempts", async () => {
        vi.useFakeTimers();
        renderHook(() => useBackupStream("b1", true));

        fireError(READY_STATE_CLOSED);

        for (let i = 0; i < BACKUP_STREAM_RECONNECT_DELAYS_MS.length; i++) {
            const delay = BACKUP_STREAM_RECONNECT_DELAYS_MS[i];
            await act(async () => {
                await vi.advanceTimersByTimeAsync(delay);
            });
            const latest = instances[instances.length - 1];
            fireError(READY_STATE_CLOSED, latest);
        }

        // One initial connection + one per delay entry = length + 1
        expect(instances).toHaveLength(BACKUP_STREAM_RECONNECT_DELAYS_MS.length + 1);

        // No further reconnect should be scheduled — advance well past any
        // remaining timers and confirm no growth.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60000);
        });
        expect(instances).toHaveLength(BACKUP_STREAM_RECONNECT_DELAYS_MS.length + 1);
    });

    it("opens no replacement when unmounted while a reconnect is pending", async () => {
        vi.useFakeTimers();
        const {unmount} = renderHook(() => useBackupStream("b1", true));

        fireError(READY_STATE_CLOSED);
        expect(instances).toHaveLength(1);

        unmount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0] + 1000);
        });

        expect(instances).toHaveLength(1);
    });

    it("repopulates the full log from the server replay after a reconnect, with every line present exactly once", async () => {
        vi.useFakeTimers();
        const {result} = renderHook(() => useBackupStream("b1", true));

        emit({line: "one"});
        emit({line: "two"});
        expect(result.current.lines).toEqual(["one", "two"]);

        fireError(READY_STATE_CLOSED);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BACKUP_STREAM_RECONNECT_DELAYS_MS[0]);
        });

        expect(instances).toHaveLength(2);

        const replacement = instances[instances.length - 1];
        fireOpen(replacement);

        // The server replays the whole log known so far on every subscription
        // (WR-01), so the replacement connection re-emits "one" and "two"
        // before the new "three" — these are not duplicate/stray events, they
        // are the server's replay of what it already accumulated.
        emit({line: "one"}, replacement);
        emit({line: "two"}, replacement);
        emit({line: "three"}, replacement);

        expect(result.current.lines).toEqual(["one", "two", "three"]);
    });
});
