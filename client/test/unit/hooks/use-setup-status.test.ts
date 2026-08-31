import {beforeEach, describe, expect, it, vi} from "vitest";
import {renderHook, waitFor} from "@testing-library/react";
import {useSetupStatus} from "../../../src/hooks/use-setup-status";
import {checkSetupStatus} from "@/lib/setup-api";
import {ApiError} from "@/lib/api";

vi.mock("@/lib/setup-api", () => ({
    checkSetupStatus: vi.fn(),
}));

const mockCheckSetupStatus = vi.mocked(checkSetupStatus);

beforeEach(() => {
    mockCheckSetupStatus.mockReset();
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
});
