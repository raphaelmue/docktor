import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook} from "@testing-library/react";
import {useProxyStatus} from "../../../src/hooks/use-proxy-status.js";
import type {StateEvent} from "@/hooks/use-container-events";

// Captures the handler useProxyStatus registers with useContainerEvents so
// tests can drive SSE events directly without a real EventSource — mirrors
// use-stack.test.ts's convention.
let capturedHandler: ((event: StateEvent) => void) | undefined;
vi.mock("@/hooks/use-container-events", () => ({
    useContainerEvents: vi.fn((handler: (event: StateEvent) => void) => {
        capturedHandler = handler;
    }),
}));

beforeEach(() => {
    capturedHandler = undefined;
});

function proxyCertStatusEvent(overrides: Partial<{
    proxyConfigId: string;
    stackId: string;
    domain: string;
    status: "pending" | "issued" | "failed";
    message: string;
}> = {}): StateEvent {
    return {
        type: "proxy_cert_status",
        proxyConfigId: "cfg-1",
        stackId: "my-stack",
        domain: "app.example.com",
        status: "pending",
        ...overrides,
    } as StateEvent;
}

describe("useProxyStatus", () => {
    it("starts with an empty statuses map", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));
        expect(result.current.statuses).toEqual({});
    });

    it("merges a proxy_cert_status event whose stackId matches into statuses", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));

        act(() => {
            capturedHandler?.(proxyCertStatusEvent({proxyConfigId: "cfg-1", status: "issued"}));
        });

        expect(result.current.statuses).toEqual({
            "cfg-1": {status: "issued"},
        });
    });

    it("includes message when present on the event", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));

        act(() => {
            capturedHandler?.(
                proxyCertStatusEvent({proxyConfigId: "cfg-1", status: "failed", message: "ACME challenge failed"}),
            );
        });

        expect(result.current.statuses).toEqual({
            "cfg-1": {status: "failed", message: "ACME challenge failed"},
        });
    });

    it("ignores an event for a different stackId, leaving the map unchanged", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));

        act(() => {
            capturedHandler?.(proxyCertStatusEvent({proxyConfigId: "cfg-1", stackId: "other-stack"}));
        });

        expect(result.current.statuses).toEqual({});
    });

    it("ignores every other event type", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));

        act(() => {
            capturedHandler?.({type: "stack_status", stackId: "my-stack", stackStatus: "RUNNING"} as StateEvent);
        });

        expect(result.current.statuses).toEqual({});
    });

    it("keeps two events for two different proxyConfigId values both in the map", () => {
        const {result} = renderHook(() => useProxyStatus("my-stack"));

        act(() => {
            capturedHandler?.(proxyCertStatusEvent({proxyConfigId: "cfg-1", status: "issued"}));
        });
        act(() => {
            capturedHandler?.(proxyCertStatusEvent({proxyConfigId: "cfg-2", status: "pending"}));
        });

        expect(result.current.statuses).toEqual({
            "cfg-1": {status: "issued"},
            "cfg-2": {status: "pending"},
        });
    });

    it("resets the map to empty when stackId changes", () => {
        const {result, rerender} = renderHook(({stackId}) => useProxyStatus(stackId), {
            initialProps: {stackId: "my-stack"},
        });

        act(() => {
            capturedHandler?.(proxyCertStatusEvent({proxyConfigId: "cfg-1", status: "issued"}));
        });
        expect(result.current.statuses).toEqual({"cfg-1": {status: "issued"}});

        act(() => {
            rerender({stackId: "other-stack"});
        });

        expect(result.current.statuses).toEqual({});
    });
});
