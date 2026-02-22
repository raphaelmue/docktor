import {describe, expect, it, vi, beforeEach} from "vitest";

// Mock apiFetch before importing stacks-api
vi.mock("@/lib/api", () => ({
    apiFetch: vi.fn(),
    ApiError: class extends Error {
        constructor(message: string, public status: number) {
            super(message);
        }
    },
}));

import {apiFetch} from "@/lib/api";
import {
    listStacks,
    getStack,
    createStack,
    updateStack,
    deleteStack,
    deployStack,
    stopStack,
    restartStack,
    getComposeContent,
    getEnvContent,
} from "../../../src/lib/stacks-api";

const mockApiFetch = vi.mocked(apiFetch);

beforeEach(() => {
    mockApiFetch.mockReset();
});

describe("stacks-api", () => {
    it("listStacks calls GET /api/stacks", async () => {
        mockApiFetch.mockResolvedValue([{id: "my-app"}]);

        const result = await listStacks();
        expect(result).toEqual([{id: "my-app"}]);
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks");
    });

    it("getStack calls GET /api/stacks/:id", async () => {
        mockApiFetch.mockResolvedValue({id: "my-app"});

        const result = await getStack("my-app");
        expect(result).toEqual({id: "my-app"});
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app");
    });

    it("createStack calls POST /api/stacks with body", async () => {
        mockApiFetch.mockResolvedValue({id: "new-stack"});

        await createStack({displayName: "New Stack", composeContent: "services:"});
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks", {
            method: "POST",
            body: JSON.stringify({displayName: "New Stack", composeContent: "services:"}),
        });
    });

    it("updateStack calls PUT /api/stacks/:id", async () => {
        mockApiFetch.mockResolvedValue({id: "my-app"});

        await updateStack("my-app", {displayName: "Updated"});
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app", {
            method: "PUT",
            body: JSON.stringify({displayName: "Updated"}),
        });
    });

    it("deleteStack calls DELETE /api/stacks/:id", async () => {
        mockApiFetch.mockResolvedValue(undefined);

        await deleteStack("my-app");
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app", {method: "DELETE"});
    });

    it("deployStack calls POST /api/stacks/:id/deploy", async () => {
        mockApiFetch.mockResolvedValue({success: true});

        const result = await deployStack("my-app");
        expect(result).toEqual({success: true});
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app/deploy", {method: "POST"});
    });

    it("stopStack calls POST /api/stacks/:id/stop", async () => {
        mockApiFetch.mockResolvedValue({success: true});

        await stopStack("my-app");
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app/stop", {method: "POST"});
    });

    it("restartStack calls POST /api/stacks/:id/restart", async () => {
        mockApiFetch.mockResolvedValue({success: true});

        await restartStack("my-app");
        expect(mockApiFetch).toHaveBeenCalledWith("/api/stacks/my-app/restart", {method: "POST"});
    });

    it("getComposeContent calls GET /api/stacks/:id/compose", async () => {
        mockApiFetch.mockResolvedValue({content: "services:"});

        const result = await getComposeContent("my-app");
        expect(result).toEqual({content: "services:"});
    });

    it("getEnvContent calls GET /api/stacks/:id/env", async () => {
        mockApiFetch.mockResolvedValue({content: "FOO=bar"});

        const result = await getEnvContent("my-app");
        expect(result).toEqual({content: "FOO=bar"});
    });
});
