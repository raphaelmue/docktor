import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
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
