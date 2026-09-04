import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook, waitFor} from "@testing-library/react";
import {useStackEvents} from "../../../src/hooks/use-stack-events";
import {getStackEvents} from "@/lib/stacks-api";
import type {StateEvent} from "@/hooks/use-container-events";

vi.mock("@/lib/stacks-api", () => ({
    getStackEvents: vi.fn(),
}));

// Captures the handler useStackEvents registers with useContainerEvents so
// tests can drive SSE events directly without a real EventSource.
let capturedHandler: ((event: StateEvent) => void) | undefined;
vi.mock("@/hooks/use-container-events", () => ({
    useContainerEvents: vi.fn((handler: (event: StateEvent) => void) => {
        capturedHandler = handler;
    }),
}));

const mockGetStackEvents = vi.mocked(getStackEvents);

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

beforeEach(() => {
    mockGetStackEvents.mockReset();
    capturedHandler = undefined;
});

describe("useStackEvents", () => {
    it("starts in loading state", () => {
        mockGetStackEvents.mockReturnValue(new Promise(() => {}));

        const {result} = renderHook(() => useStackEvents("my-app"));
        expect(result.current.loading).toBe(true);
        expect(result.current.isRefreshing).toBe(false);
        expect(result.current.events).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it("resolves to the returned entries on mount", async () => {
        const events = [
            {id: "1", type: "config_changed", message: null, payload: null, createdAt: "2026-08-28T00:00:00Z"},
        ];
        mockGetStackEvents.mockResolvedValue(events as any);

        const {result} = renderHook(() => useStackEvents("my-app"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events).toEqual(events);
        expect(result.current.error).toBeNull();
        expect(result.current.isRefreshing).toBe(false);
    });

    it("requests events for the id it was given and no other", async () => {
        mockGetStackEvents.mockResolvedValue([] as any);

        renderHook(() => useStackEvents("my-app"));

        await waitFor(() => expect(mockGetStackEvents).toHaveBeenCalledWith("my-app"));
        expect(mockGetStackEvents).toHaveBeenCalledTimes(1);
    });

    it("a config_changed event for that stack id triggers a background refresh without clearing entries", async () => {
        const initialEvents = [
            {id: "1", type: "config_changed", message: null, payload: null, createdAt: "2026-08-28T00:00:00Z"},
        ];
        const refreshedEvents = [
            {id: "2", type: "config_changed", message: null, payload: null, createdAt: "2026-08-28T00:01:00Z"},
            ...initialEvents,
        ];
        mockGetStackEvents.mockResolvedValueOnce(initialEvents as any);
        const refresh = deferred<any>();
        mockGetStackEvents.mockReturnValueOnce(refresh.promise);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events).toEqual(initialEvents);

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.events).toEqual(initialEvents);

        await act(async () => {
            refresh.resolve(refreshedEvents);
            await refresh.promise;
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.events).toEqual(refreshedEvents);
        expect(result.current.loading).toBe(false);
    });

    it("a config_error event for that stack id triggers the same background refresh", async () => {
        const initialEvents: any[] = [];
        const refreshedEvents = [
            {id: "1", type: "config_error", message: "bad yaml", payload: null, createdAt: "2026-08-28T00:00:00Z"},
        ];
        mockGetStackEvents.mockResolvedValueOnce(initialEvents);
        mockGetStackEvents.mockResolvedValueOnce(refreshedEvents as any);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            capturedHandler!({type: "config_error", stackId: "my-app", message: "bad yaml"});
        });

        await waitFor(() => expect(result.current.events).toEqual(refreshedEvents));
        expect(result.current.loading).toBe(false);
    });

    it("an update_available event for that stack id triggers the same background refresh", async () => {
        const initialEvents: any[] = [];
        const refreshedEvents = [
            {
                id: "1",
                type: "update_available",
                message: "nginx:1.27",
                payload: null,
                createdAt: "2026-08-28T00:00:00Z",
            },
        ];
        mockGetStackEvents.mockResolvedValueOnce(initialEvents);
        mockGetStackEvents.mockResolvedValueOnce(refreshedEvents as any);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            capturedHandler!({
                type: "update_available",
                stackId: "my-app",
                imageRef: "nginx:latest",
                latestTag: "1.27",
                hasUpdate: true,
            });
        });

        await waitFor(() => expect(result.current.events).toEqual(refreshedEvents));
        expect(result.current.loading).toBe(false);
    });

    it("a container_state event triggers no refresh", async () => {
        mockGetStackEvents.mockResolvedValueOnce([] as any);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        mockGetStackEvents.mockClear();

        act(() => {
            capturedHandler!({
                type: "container_state",
                stackId: "my-app",
                serviceName: "web",
                containerState: "running",
                healthStatus: null,
                stackStatus: "RUNNING",
            });
        });

        expect(mockGetStackEvents).not.toHaveBeenCalled();
    });

    it("ignores an event for a different stack id", async () => {
        mockGetStackEvents.mockResolvedValueOnce([] as any);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        mockGetStackEvents.mockClear();

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "other-app"});
        });

        expect(mockGetStackEvents).not.toHaveBeenCalled();
    });

    it("a background refresh that rejects leaves the previous entries in place and leaves error null", async () => {
        const initialEvents = [
            {id: "1", type: "config_changed", message: null, payload: null, createdAt: "2026-08-28T00:00:00Z"},
        ];
        mockGetStackEvents.mockResolvedValueOnce(initialEvents as any);
        mockGetStackEvents.mockRejectedValueOnce(new Error("network down"));

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.events).toEqual(initialEvents);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it("an initial load that rejects sets error and leaves entries null", async () => {
        mockGetStackEvents.mockRejectedValue(new Error("not found"));

        const {result} = renderHook(() => useStackEvents("my-app"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe("not found");
        expect(result.current.events).toBeNull();
        expect(result.current.isRefreshing).toBe(false);
    });

    it("refetch() performs a background refresh, not an initial one", async () => {
        const initialEvents: any[] = [];
        const refreshedEvents = [
            {id: "1", type: "config_changed", message: null, payload: null, createdAt: "2026-08-28T00:00:00Z"},
        ];
        mockGetStackEvents.mockResolvedValueOnce(initialEvents);
        mockGetStackEvents.mockResolvedValueOnce(refreshedEvents as any);

        const {result} = renderHook(() => useStackEvents("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.refetch();
        });

        expect(result.current.loading).toBe(false);
        await waitFor(() => expect(result.current.events).toEqual(refreshedEvents));
        expect(result.current.loading).toBe(false);
    });
});
