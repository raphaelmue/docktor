import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook, waitFor} from "@testing-library/react";
import {useStacks} from "../../../src/hooks/use-stacks";
import {listStacks} from "@/lib/stacks-api";
import type {StateEvent} from "@/hooks/use-container-events";

vi.mock("@/lib/stacks-api", () => ({
    listStacks: vi.fn(),
}));

// Captures the handler useStacks registers with useContainerEvents so tests can
// drive SSE events directly without a real EventSource.
let capturedHandler: ((event: StateEvent) => void) | undefined;
vi.mock("@/hooks/use-container-events", () => ({
    useContainerEvents: vi.fn((handler: (event: StateEvent) => void) => {
        capturedHandler = handler;
    }),
}));

const mockListStacks = vi.mocked(listStacks);

beforeEach(() => {
    mockListStacks.mockReset();
    capturedHandler = undefined;
});

describe("useStacks", () => {
    it("starts in loading state", () => {
        mockListStacks.mockReturnValue(new Promise(() => {}));

        const {result} = renderHook(() => useStacks());
        expect(result.current.loading).toBe(true);
        expect(result.current.stacks).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it("returns stacks on success", async () => {
        const stacks = [{id: "my-app", displayName: "My App", services: []}];
        mockListStacks.mockResolvedValue(stacks as any);

        const {result} = renderHook(() => useStacks());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stacks).toEqual(stacks);
        expect(result.current.error).toBeNull();
    });

    it("returns error on failure", async () => {
        mockListStacks.mockRejectedValue(new Error("Network error"));

        const {result} = renderHook(() => useStacks());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe("Network error");
        expect(result.current.stacks).toEqual([]);
    });

    it("a config_error event triggers a refetch", async () => {
        const stacks = [{id: "my-app", displayName: "My App", services: [], configError: null}];
        const refetchedStacks = [{id: "my-app", displayName: "My App", services: [], configError: "bad yaml"}];
        mockListStacks.mockResolvedValueOnce(stacks as any);
        mockListStacks.mockResolvedValueOnce(refetchedStacks as any);

        const {result} = renderHook(() => useStacks());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            capturedHandler!({type: "config_error", stackId: "my-app", message: "bad yaml"});
        });

        await waitFor(() => expect(result.current.stacks).toEqual(refetchedStacks));
    });
});
