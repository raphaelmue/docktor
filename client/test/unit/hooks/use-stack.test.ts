import * as React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, render, renderHook, screen, waitFor} from "@testing-library/react";
import {toast} from "sonner";
import {useStack} from "../../../src/hooks/use-stack";
import {getStack} from "@/lib/stacks-api";
import type {StateEvent} from "@/hooks/use-container-events";

vi.mock("@/lib/stacks-api", () => ({
    getStack: vi.fn(),
}));

// Captures the handler useStack registers with useContainerEvents so tests can
// drive SSE events directly without a real EventSource.
let capturedHandler: ((event: StateEvent) => void) | undefined;
vi.mock("@/hooks/use-container-events", () => ({
    useContainerEvents: vi.fn((handler: (event: StateEvent) => void) => {
        capturedHandler = handler;
    }),
}));

// The config_changed branch calls toast.warning and the config_error branch
// calls toast.error — mock sonner so neither ever reaches a real (unmounted) toaster.
vi.mock("sonner", () => ({
    toast: {
        warning: vi.fn(),
        error: vi.fn(),
    },
}));

const mockGetStack = vi.mocked(getStack);

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
    mockGetStack.mockReset();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
    capturedHandler = undefined;
});

describe("useStack", () => {
    it("starts in loading state", () => {
        mockGetStack.mockReturnValue(new Promise(() => {}));

        const {result} = renderHook(() => useStack("my-app"));
        expect(result.current.loading).toBe(true);
        expect(result.current.isRefreshing).toBe(false);
        expect(result.current.stack).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it("returns stack on success", async () => {
        const stack = {id: "my-app", displayName: "My App"};
        mockGetStack.mockResolvedValue(stack as any);

        const {result} = renderHook(() => useStack("my-app"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stack).toEqual(stack);
        expect(result.current.error).toBeNull();
        expect(result.current.isRefreshing).toBe(false);
    });

    it("returns error on failure", async () => {
        mockGetStack.mockRejectedValue(new Error("Not found"));

        const {result} = renderHook(() => useStack("missing"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe("Not found");
        expect(result.current.stack).toBeNull();
        expect(result.current.isRefreshing).toBe(false);
    });

    it("calls getStack with the provided id", async () => {
        mockGetStack.mockResolvedValue({id: "test-id"} as any);

        renderHook(() => useStack("test-id"));

        await waitFor(() => expect(mockGetStack).toHaveBeenCalledWith("test-id"));
    });

    it("a config_changed event sets isRefreshing while in flight and never touches loading", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        const updatedStack = {id: "my-app", displayName: "My App v2"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        const refresh = deferred<any>();
        mockGetStack.mockReturnValueOnce(refresh.promise);

        const {result} = renderHook(() => useStack("my-app"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stack).toEqual(initialStack);
        expect(result.current.isRefreshing).toBe(false);

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.stack).toEqual(initialStack);

        await act(async () => {
            refresh.resolve(updatedStack);
            await refresh.promise;
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.loading).toBe(false);
        expect(result.current.stack).toEqual(updatedStack);
    });

    it("a config_changed event shows a warning-styled (yellow) toast, matching the config-changed badge elsewhere", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        mockGetStack.mockResolvedValueOnce(initialStack as any);

        renderHook(() => useStack("my-app"));
        await waitFor(() => expect(mockGetStack).toHaveBeenCalledTimes(1));

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        expect(toast.warning).toHaveBeenCalledWith(
            "Configuration file changed externally",
            expect.objectContaining({
                className: expect.stringContaining("yellow"),
            }),
        );
    });

    it("a config_error event sets isRefreshing while in flight and never touches loading or error", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        const updatedStack = {id: "my-app", displayName: "My App v2", configError: "bad yaml"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        const refresh = deferred<any>();
        mockGetStack.mockReturnValueOnce(refresh.promise);

        const {result} = renderHook(() => useStack("my-app"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stack).toEqual(initialStack);
        expect(result.current.isRefreshing).toBe(false);

        act(() => {
            capturedHandler!({type: "config_error", stackId: "my-app", message: "bad yaml"});
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.stack).toEqual(initialStack);

        await act(async () => {
            refresh.resolve(updatedStack);
            await refresh.promise;
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.stack).toEqual(updatedStack);
    });

    it("a config_error event shows a destructive (red) toast carrying the parser message", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        mockGetStack.mockResolvedValueOnce(initialStack as any);

        renderHook(() => useStack("my-app"));
        await waitFor(() => expect(mockGetStack).toHaveBeenCalledTimes(1));

        act(() => {
            capturedHandler!({type: "config_error", stackId: "my-app", message: "Invalid YAML: bad indentation"});
        });

        expect(toast.error).toHaveBeenCalledWith(
            "Invalid YAML: bad indentation",
            expect.objectContaining({
                className: expect.stringContaining("red"),
            }),
        );
    });

    it("ignores a config_error event for a different stack id", async () => {
        mockGetStack.mockResolvedValueOnce({id: "my-app", displayName: "My App"} as any);
        const {result} = renderHook(() => useStack("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        mockGetStack.mockClear();

        act(() => {
            capturedHandler!({type: "config_error", stackId: "other-app", message: "bad yaml"});
        });

        expect(mockGetStack).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("an update_available event behaves like config_changed, without touching loading", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        const updatedStack = {id: "my-app", displayName: "My App v2"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        const refresh = deferred<any>();
        mockGetStack.mockReturnValueOnce(refresh.promise);

        const {result} = renderHook(() => useStack("my-app"));
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

        await waitFor(() => expect(result.current.isRefreshing).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.stack).toEqual(initialStack);

        await act(async () => {
            refresh.resolve(updatedStack);
            await refresh.promise;
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.stack).toEqual(updatedStack);
        expect(result.current.loading).toBe(false);
    });

    it("ignores an event for a different stack id", async () => {
        mockGetStack.mockResolvedValueOnce({id: "my-app", displayName: "My App"} as any);
        const {result} = renderHook(() => useStack("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        mockGetStack.mockClear();

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "other-app"});
        });

        expect(mockGetStack).not.toHaveBeenCalled();
    });

    it("a background refresh failure leaves the previous stack and error untouched", async () => {
        const initialStack = {id: "my-app", displayName: "My App"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        mockGetStack.mockRejectedValueOnce(new Error("network down"));

        const {result} = renderHook(() => useStack("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.stack).toEqual(initialStack);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it("refetch() performs a background refresh, not an initial one", async () => {
        const initialStack = {id: "my-app", displayName: "My App"};
        const refreshedStack = {id: "my-app", displayName: "My App Updated"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        mockGetStack.mockResolvedValueOnce(refreshedStack as any);

        const {result} = renderHook(() => useStack("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.refetch();
        });

        expect(result.current.loading).toBe(false);
        await waitFor(() => expect(result.current.stack).toEqual(refreshedStack));
        expect(result.current.loading).toBe(false);
    });

    // Pins the exact mechanism [id].tsx's handleSaveCompose()/handleSaveEnv()
    // rely on: calling refetch() after a successful save picks up the fresh
    // configChanged flag on the same tab that saved, with no manual reload
    // and without touching loading (a full-tree remount would drop the
    // editor's in-progress state).
    it("refetch() picks up a fresh configChanged flag without touching loading, matching a post-save refresh", async () => {
        const staleStack = {id: "my-app", displayName: "My App", configChanged: true};
        const savedStack = {id: "my-app", displayName: "My App", configChanged: false};
        mockGetStack.mockResolvedValueOnce(staleStack as any);
        mockGetStack.mockResolvedValueOnce(savedStack as any);

        const {result} = renderHook(() => useStack("my-app"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stack).toEqual(staleStack);

        act(() => {
            result.current.refetch();
        });

        expect(result.current.loading).toBe(false);
        await waitFor(() => expect(result.current.stack).toEqual(savedStack));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });
});

// Task 2: pin the actual regression (a full-tree remount) with a node-identity
// assertion, not only flag assertions. Probe is deliberately defined here, not
// in src, so it renders exactly the mechanism at fault and nothing else.
function Probe({id}: {id: string}) {
    const {stack} = useStack(id);
    if (!stack) {
        return React.createElement("div", {"data-testid": "probe-loading"}, "Loading");
    }
    return React.createElement("div", {"data-testid": "probe-stack"}, stack.displayName);
}

describe("useStack — mounted tree survives a config_changed event", () => {
    it("keeps the same DOM node identity across an SSE-driven refresh", async () => {
        const initialStack = {id: "my-app", displayName: "My App v1"};
        const updatedStack = {id: "my-app", displayName: "My App v2"};
        mockGetStack.mockResolvedValueOnce(initialStack as any);
        mockGetStack.mockResolvedValueOnce(updatedStack as any);

        render(React.createElement(Probe, {id: "my-app"}));

        const firstNode = await screen.findByTestId("probe-stack");
        expect(firstNode.textContent).toBe("My App v1");

        act(() => {
            capturedHandler!({type: "config_changed", stackId: "my-app"});
        });

        await waitFor(() => expect(screen.getByTestId("probe-stack").textContent).toBe("My App v2"));
        const secondNode = screen.getByTestId("probe-stack");

        expect(secondNode).toBe(firstNode);
    });

    it("control: node identity differs across a genuine unmount/remount", async () => {
        mockGetStack.mockResolvedValue({id: "my-app", displayName: "My App"} as any);

        const {unmount} = render(React.createElement(Probe, {id: "my-app"}));
        const firstNode = await screen.findByTestId("probe-stack");

        unmount();

        render(React.createElement(Probe, {id: "my-app"}));
        const secondNode = await screen.findByTestId("probe-stack");

        expect(secondNode).not.toBe(firstNode);
    });
});
