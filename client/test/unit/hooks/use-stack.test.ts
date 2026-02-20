import {describe, expect, it, vi, beforeEach} from "vitest";
import {renderHook, waitFor} from "@testing-library/react";
import {useStack} from "../../../src/hooks/use-stack";

vi.mock("@/lib/stacks-api", () => ({
    getStack: vi.fn(),
}));

import {getStack} from "@/lib/stacks-api";

const mockGetStack = vi.mocked(getStack);

beforeEach(() => {
    mockGetStack.mockReset();
});

describe("useStack", () => {
    it("starts in loading state", () => {
        mockGetStack.mockReturnValue(new Promise(() => {}));

        const {result} = renderHook(() => useStack("my-app"));
        expect(result.current.loading).toBe(true);
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
    });

    it("returns error on failure", async () => {
        mockGetStack.mockRejectedValue(new Error("Not found"));

        const {result} = renderHook(() => useStack("missing"));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe("Not found");
        expect(result.current.stack).toBeNull();
    });

    it("calls getStack with the provided id", async () => {
        mockGetStack.mockResolvedValue({id: "test-id"} as any);

        renderHook(() => useStack("test-id"));

        await waitFor(() => expect(mockGetStack).toHaveBeenCalledWith("test-id"));
    });
});
