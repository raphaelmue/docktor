import {beforeEach, describe, expect, it, vi} from "vitest";
import {renderHook, waitFor} from "@testing-library/react";
import {useStacks} from "../../../src/hooks/use-stacks";
import {listStacks} from "@/lib/stacks-api";

vi.mock("@/lib/stacks-api", () => ({
    listStacks: vi.fn(),
}));

const mockListStacks = vi.mocked(listStacks);

beforeEach(() => {
    mockListStacks.mockReset();
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
});
