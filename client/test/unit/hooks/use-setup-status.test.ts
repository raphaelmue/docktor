import {beforeEach, describe, expect, it, vi} from "vitest";
import {renderHook, waitFor} from "@testing-library/react";
import {resetSetupStatusCacheForTests, useSetupStatus} from "../../../src/hooks/use-setup-status";
import {checkSetupStatus} from "@/lib/setup-api";
import {ApiError} from "@/lib/api";

vi.mock("@/lib/setup-api", () => ({
    checkSetupStatus: vi.fn(),
}));

const mockCheckSetupStatus = vi.mocked(checkSetupStatus);

beforeEach(() => {
    mockCheckSetupStatus.mockReset();
    // The hook caches the resolved status at module scope so repeated
    // FirstRunGate mounts within a page session don't re-fetch — reset it
    // between tests so each test observes a fresh request.
    resetSetupStatusCacheForTests();
});

describe("useSetupStatus", () => {
    it("returns idle and never calls checkSetupStatus when disabled", () => {
        const {result} = renderHook(() => useSetupStatus(false));

        expect(result.current).toBe("idle");
        expect(mockCheckSetupStatus).not.toHaveBeenCalled();
    });

    it("returns loading while the request is pending", () => {
        mockCheckSetupStatus.mockReturnValue(new Promise(() => {}));

        const {result} = renderHook(() => useSetupStatus(true));

        expect(result.current).toBe("loading");
    });

    it("returns incomplete when setupComplete is false", async () => {
        mockCheckSetupStatus.mockResolvedValue({setupComplete: false});

        const {result} = renderHook(() => useSetupStatus(true));

        await waitFor(() => expect(result.current).toBe("incomplete"));
    });

    it("returns complete when setupComplete is true", async () => {
        mockCheckSetupStatus.mockResolvedValue({setupComplete: true});

        const {result} = renderHook(() => useSetupStatus(true));

        await waitFor(() => expect(result.current).toBe("complete"));
    });

    it("returns error when the status check rejects", async () => {
        mockCheckSetupStatus.mockRejectedValue(new ApiError("Service Unavailable", 503));

        const {result} = renderHook(() => useSetupStatus(true));

        await waitFor(() => expect(result.current).toBe("error"));
    });

    it("WR-02: reuses the cached result across mounts instead of re-fetching", async () => {
        mockCheckSetupStatus.mockResolvedValue({setupComplete: true});

        const first = renderHook(() => useSetupStatus(true));
        await waitFor(() => expect(first.result.current).toBe("complete"));
        first.unmount();

        // A second mount within the same page session (e.g. FirstRunGate
        // remounting after another unauthenticated redirect) must not issue
        // a second request, and must not pass through "loading" again.
        const second = renderHook(() => useSetupStatus(true));

        expect(second.result.current).toBe("complete");
        expect(mockCheckSetupStatus).toHaveBeenCalledTimes(1);
    });

    it("WR-02: does not cache a failed status check, allowing the next mount to retry", async () => {
        mockCheckSetupStatus.mockRejectedValueOnce(new ApiError("Service Unavailable", 503));

        const first = renderHook(() => useSetupStatus(true));
        await waitFor(() => expect(first.result.current).toBe("error"));
        first.unmount();

        mockCheckSetupStatus.mockResolvedValueOnce({setupComplete: true});

        const second = renderHook(() => useSetupStatus(true));
        await waitFor(() => expect(second.result.current).toBe("complete"));

        expect(mockCheckSetupStatus).toHaveBeenCalledTimes(2);
    });
});
