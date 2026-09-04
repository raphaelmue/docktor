// WR-07: closes the `05-VERIFICATION.md` `human_verification` item for the
// TOCTOU window between "count users" and "create the first admin" in
// routes/setup.ts. Static analysis can confirm the `Setting.key` unique
// primary-key lock is wired, but only an executed race against a real
// Postgres instance can prove it actually admits exactly one account.
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {cleanDatabase, getApp, getPrisma, startContainer, stopContainer} from "./setup.js";
import type {FastifyInstance} from "fastify";

describe("Setup step 1 concurrency (WR-07)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await startContainer();
        app = await getApp();
    }, 60_000);

    afterAll(async () => {
        // try/finally: stopContainer() must run even if cleanDatabase() throws
        // (e.g. startContainer() failed partway and left prismaClient unset) —
        // otherwise a failed run strands the testcontainers Postgres container.
        try {
            await cleanDatabase();
        } finally {
            await stopContainer();
        }
    });

    beforeEach(async () => {
        // Do NOT call createTestUser() here — these tests require a
        // zero-user database, which is the entire point of the race.
        await cleanDatabase();
    });

    it("admits exactly one admin when two step1 requests race", async () => {
        const payload = {email: "admin@example.com", password: "password123"};

        const [first, second] = await Promise.all([
            app.inject({method: "POST", url: "/api/setup/step1", payload}),
            app.inject({method: "POST", url: "/api/setup/step1", payload}),
        ]);

        const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
        expect(codes).toEqual([200, 400]);

        const loser = first.statusCode === 400 ? first : second;
        expect(loser.json().error).toBe("Setup already complete");

        expect(await getPrisma().user.count()).toBe(1);
    });

    it("rejects a step1 request issued after setup already completed", async () => {
        const payload = {email: "admin@example.com", password: "password123"};

        const firstRes = await app.inject({method: "POST", url: "/api/setup/step1", payload});
        expect(firstRes.statusCode).toBe(200);

        const secondRes = await app.inject({method: "POST", url: "/api/setup/step1", payload});
        expect(secondRes.statusCode).toBe(400);
        expect(secondRes.json().error).toBe("Setup already complete");

        expect(await getPrisma().user.count()).toBe(1);
    });
});
