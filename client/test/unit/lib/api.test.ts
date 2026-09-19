import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiError, apiFetch} from "../../../src/lib/api";

const originalFetch = globalThis.fetch;

function mockFetch(response: Partial<Response>) {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: vi.fn().mockResolvedValue(response.json ?? {}),
        ...response,
    });
}

beforeEach(() => {
    // Set location.port so BASE resolves to empty string
    Object.defineProperty(globalThis, "location", {
        value: {port: "3000"},
        writable: true,
    });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("ApiError", () => {
    it("has name and status", () => {
        const err = new ApiError("Not found", 404);
        expect(err.message).toBe("Not found");
        expect(err.status).toBe(404);
        expect(err.name).toBe("ApiError");
        expect(err).toBeInstanceOf(Error);
    });
});

describe("apiFetch", () => {
    it("fetches JSON on success", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({id: "1"})});

        const result = await apiFetch("/api/test");
        expect(result).toEqual({id: "1"});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "/api/test",
            expect.objectContaining({credentials: "include"}),
        );
    });

    it("sets Content-Type when body is provided", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        await apiFetch("/api/test", {
            method: "POST",
            body: JSON.stringify({name: "test"}),
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            "/api/test",
            expect.objectContaining({
                headers: expect.objectContaining({"Content-Type": "application/json"}),
            }),
        );
    });

    it("sets no Content-Type header when the body is a FormData instance", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        const form = new FormData();
        form.append("domainPattern", "example.com");
        await apiFetch("/api/test", {method: "POST", body: form});

        const call = vi.mocked(globalThis.fetch).mock.calls[0];
        const sentHeaders = (call[1] as RequestInit).headers as Record<string, string>;
        // Case-insensitive check — a differently-cased header must not pass unnoticed.
        const hasContentType = Object.keys(sentHeaders).some(
            (key) => key.toLowerCase() === "content-type",
        );
        expect(hasContentType).toBe(false);
    });

    it("sets no Content-Type header when no body is provided", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        await apiFetch("/api/test");

        const call = vi.mocked(globalThis.fetch).mock.calls[0];
        const sentHeaders = (call[1] as RequestInit).headers as Record<string, string>;
        expect(Object.keys(sentHeaders)).toHaveLength(0);
    });

    it("honours an explicit caller-supplied Content-Type header instead of overwriting it", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        await apiFetch("/api/test", {
            method: "POST",
            body: "raw text",
            headers: {"Content-Type": "text/plain"},
        });

        const call = vi.mocked(globalThis.fetch).mock.calls[0];
        const sentHeaders = (call[1] as RequestInit).headers as Record<string, string>;
        // Header names are normalized case-insensitively (via the Headers
        // API, per WR-03) rather than preserving the caller's exact casing —
        // HTTP header names are case-insensitive, so this is an equivalent,
        // not a different, request.
        const contentTypeEntry = Object.entries(sentHeaders).find(
            ([key]) => key.toLowerCase() === "content-type",
        );
        expect(contentTypeEntry?.[1]).toBe("text/plain");
    });

    it("normalizes a Headers instance passed as options.headers into a plain record", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        const suppliedHeaders = new Headers();
        suppliedHeaders.set("X-Custom", "value");
        await apiFetch("/api/test", {method: "POST", body: "raw", headers: suppliedHeaders});

        const call = vi.mocked(globalThis.fetch).mock.calls[0];
        const sentHeaders = (call[1] as RequestInit).headers as Record<string, string>;
        expect(sentHeaders["x-custom"]).toBe("value");
    });

    it("normalizes a tuple-array HeadersInit passed as options.headers into a plain record", async () => {
        mockFetch({ok: true, status: 200, json: () => Promise.resolve({})});

        await apiFetch("/api/test", {
            method: "POST",
            body: "raw",
            headers: [["X-Custom", "value"]],
        });

        const call = vi.mocked(globalThis.fetch).mock.calls[0];
        const sentHeaders = (call[1] as RequestInit).headers as Record<string, string>;
        expect(sentHeaders["x-custom"]).toBe("value");
    });

    it("returns undefined for 204 responses", async () => {
        mockFetch({ok: true, status: 204});

        const result = await apiFetch("/api/test");
        expect(result).toBeUndefined();
    });

    it("throws ApiError on non-ok response", async () => {
        mockFetch({
            ok: false,
            status: 404,
            json: () => Promise.resolve({error: "Stack not found"}),
        });

        await expect(apiFetch("/api/test")).rejects.toThrow(ApiError);
        await expect(apiFetch("/api/test")).rejects.toThrow("Stack not found");
    });

    it("falls back to status message when body has no error field", async () => {
        mockFetch({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
        });

        await expect(apiFetch("/api/test")).rejects.toThrow("Request failed with status 500");
    });

    it("handles json parse failure on error response", async () => {
        mockFetch({
            ok: false,
            status: 500,
            json: () => Promise.reject(new Error("parse error")),
        });

        await expect(apiFetch("/api/test")).rejects.toThrow("Request failed with status 500");
    });
});
