import {describe, expect, it, beforeAll, afterAll, beforeEach} from "vitest";
import {startContainer, stopContainer, getApp, cleanDatabase, createTestUser} from "./setup.js";
import type {FastifyInstance} from "fastify";

describe("Stacks API", () => {
    let app: FastifyInstance;
    let cookie: string;

    beforeAll(async () => {
        await startContainer();
        app = await getApp();
    }, 60_000);

    afterAll(async () => {
        await cleanDatabase();
        await stopContainer();
    });

    beforeEach(async () => {
        await cleanDatabase();
        const user = await createTestUser();
        cookie = user.cookie;
    });

    const COMPOSE_CONTENT = "services:\n  web:\n    image: nginx:latest\n";

    it("POST /api/stacks → 201", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/stacks",
            headers: {cookie},
            payload: {
                displayName: "Test Stack",
                composeContent: COMPOSE_CONTENT,
            },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json();
        expect(body.id).toBe("test-stack");
        expect(body.displayName).toBe("Test Stack");
    });

    it("GET /api/stacks → lists stacks", async () => {
        await app.inject({
            method: "POST",
            url: "/api/stacks",
            headers: {cookie},
            payload: {
                displayName: "Stack One",
                composeContent: COMPOSE_CONTENT,
            },
        });

        const res = await app.inject({
            method: "GET",
            url: "/api/stacks",
            headers: {cookie},
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe("stack-one");
    });

    it("GET /api/stacks/:id → 404 for missing", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/stacks/non-existent",
            headers: {cookie},
        });

        expect(res.statusCode).toBe(404);
    });

    it("PUT /api/stacks/:id → updates metadata", async () => {
        await app.inject({
            method: "POST",
            url: "/api/stacks",
            headers: {cookie},
            payload: {
                displayName: "Update Me",
                composeContent: COMPOSE_CONTENT,
            },
        });

        const res = await app.inject({
            method: "PUT",
            url: "/api/stacks/update-me",
            headers: {cookie},
            payload: {
                displayName: "Updated Name",
                description: "New description",
            },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.displayName).toBe("Updated Name");
        expect(body.description).toBe("New description");
    });

    it("DELETE /api/stacks/:id → 204", async () => {
        await app.inject({
            method: "POST",
            url: "/api/stacks",
            headers: {cookie},
            payload: {
                displayName: "Delete Me",
                composeContent: COMPOSE_CONTENT,
            },
        });

        const res = await app.inject({
            method: "DELETE",
            url: "/api/stacks/delete-me",
            headers: {cookie},
        });

        expect(res.statusCode).toBe(204);

        const getRes = await app.inject({
            method: "GET",
            url: "/api/stacks/delete-me",
            headers: {cookie},
        });
        expect(getRes.statusCode).toBe(404);
    });

    it("returns 401 without authentication", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/stacks",
        });

        expect(res.statusCode).toBe(401);
    });
});
