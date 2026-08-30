import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook} from "@testing-library/react";
import {useBackupStream} from "../../../src/hooks/use-backup-stream.js";

// Mock EventSource globally (jsdom does not provide it)
function createMockEventSource() {
    return {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        close: vi.fn(),
        url: "",
        withCredentials: false,
        readyState: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
}

let mockEventSourceInstance: ReturnType<typeof createMockEventSource>;
const MockEventSource = vi.fn(function () {
    mockEventSourceInstance = createMockEventSource();
    return mockEventSourceInstance;
});

function emit(payload: unknown) {
    const message = new MessageEvent("message", {data: JSON.stringify(payload)});
    act(() => {
        mockEventSourceInstance.onmessage?.(message);
    });
}

describe("useBackupStream", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).EventSource = MockEventSource;
        mockEventSourceInstance = createMockEventSource();
    });

    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (global as any).EventSource;
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
});
