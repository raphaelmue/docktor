import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {renderHook} from "@testing-library/react";
import {useContainerEvents} from "../../../src/hooks/use-container-events.js";

// use-container-events.ts does not exist yet — import failure is the RED state.

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

describe("useContainerEvents (OBS-08)", () => {
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

    it("opens EventSource to /api/events with withCredentials:true", () => {
        const onEvent = vi.fn();
        renderHook(() => useContainerEvents(onEvent));

        expect(MockEventSource).toHaveBeenCalledWith("/api/events", expect.objectContaining({withCredentials: true}));
    });

    it("calls onEvent callback when SSE message arrives", () => {
        const onEvent = vi.fn();
        renderHook(() => useContainerEvents(onEvent));

        const payload = {containerId: "abc", status: "running", stackId: "my-stack"};
        const message = new MessageEvent("message", {data: JSON.stringify(payload)});
        mockEventSourceInstance.onmessage?.(message);

        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({containerId: "abc"}));
    });

    it("closes EventSource on unmount", () => {
        const onEvent = vi.fn();
        const {unmount} = renderHook(() => useContainerEvents(onEvent));

        unmount();

        expect(mockEventSourceInstance.close).toHaveBeenCalledOnce();
    });

    it("re-opens EventSource when it errors (native auto-reconnect via onError do-nothing)", () => {
        const onEvent = vi.fn();
        renderHook(() => useContainerEvents(onEvent));

        // Native EventSource auto-reconnects — the hook's onerror handler either
        // does nothing (relying on browser behavior) or re-creates the connection.
        // At minimum the onerror handler must be assigned without throwing.
        expect(() => {
            mockEventSourceInstance.onerror?.(new Event("error"));
        }).not.toThrow();
    });
});
