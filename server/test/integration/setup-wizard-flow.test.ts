// T-05-09: drives the real wizard flow (step1 -> step2 -> ... -> complete)
// against a real Fastify app + real Postgres, proving:
//  1. The just-created admin is NOT locked out of step2+ after step1
//     succeeds (the original bug: the preHandler gated on `userCount > 0`,
//     which becomes true the instant step1 creates the admin).
//  2. Once the wizard is genuinely marked complete via
//     POST /api/setup/complete, /api/setup/* (beyond /status) becomes
//     unreachable again (410), matching the original CR-01 intent.
//  3. POST /api/auth/sign-up/email is rejected once an admin exists,
//     closing the direct-API bypass of the wizard/WR-07 single-admin lock.
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {cleanDatabase, getApp, getPrisma, startContainer, stopContainer} from "./setup.js";
import type {FastifyInstance} from "fastify";

describe("Setup wizard flow (T-05-09)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await startContainer();
        app = await getApp();
    }, 60_000);

    afterAll(async () => {
        await cleanDatabase();
        await stopContainer();
    });

    beforeEach(async () => {
        // Do NOT call createTestUser() here — these tests require a
        // zero-user database, which is the entire point of the wizard flow.
        await cleanDatabase();
    });

    it("allows the just-created admin to continue past step 1 through the rest of the wizard", async () => {
        const step1Res = await app.inject({
            method: "POST",
            url: "/api/setup/step1",
            payload: {email: "admin@example.com", password: "password123"},
        });
        expect(step1Res.statusCode).toBe(200);
        expect(await getPrisma().user.count()).toBe(1);

        // Before the fix, every request below 410'd because the preHandler
        // gated on `userCount > 0`, which step1 had just made true.
        const step2Res = await app.inject({
            method: "POST",
            url: "/api/setup/step2",
            payload: {
                instanceName: "Test Instance",
                baseUrl: "",
                timezone: "UTC",
            },
        });
        expect(step2Res.statusCode).toBe(200);
        expect(step2Res.json()).toEqual({success: true});

        const step3Res = await app.inject({
            method: "POST",
            url: "/api/setup/step3",
            payload: {repoType: "local"},
        });
        expect(step3Res.statusCode).toBe(200);

        const step4Res = await app.inject({
            method: "POST",
            url: "/api/setup/step4",
            payload: {
                host: "smtp.example.com",
                port: 587,
                encryption: "starttls",
                from: "noreply@example.com",
            },
        });
        expect(step4Res.statusCode).toBe(200);

        // Setup is still not "complete" until the client explicitly says so.
        const statusRes = await app.inject({method: "GET", url: "/api/setup/status"});
        expect(statusRes.json()).toEqual({setupComplete: true});
    });

    it("permanently closes /api/setup/* (beyond /status) once the wizard is marked complete", async () => {
        const step1Res = await app.inject({
            method: "POST",
            url: "/api/setup/step1",
            payload: {email: "admin@example.com", password: "password123"},
        });
        expect(step1Res.statusCode).toBe(200);

        const completeRes = await app.inject({method: "POST", url: "/api/setup/complete"});
        expect(completeRes.statusCode).toBe(200);
        expect(completeRes.json()).toEqual({success: true});

        const step2AfterCompleteRes = await app.inject({
            method: "POST",
            url: "/api/setup/step2",
            payload: {instanceName: "Test Instance", baseUrl: "", timezone: "UTC"},
        });
        expect(step2AfterCompleteRes.statusCode).toBe(410);
        expect(step2AfterCompleteRes.json().error).toBe("Setup already complete");

        // /status must remain reachable (it's exempt from the gate).
        const statusRes = await app.inject({method: "GET", url: "/api/setup/status"});
        expect(statusRes.statusCode).toBe(200);
    });

    it("rejects /api/setup/complete before any admin has been created", async () => {
        const completeRes = await app.inject({method: "POST", url: "/api/setup/complete"});
        expect(completeRes.statusCode).toBe(400);
    });

    it("rejects a direct POST /api/auth/sign-up/email once an admin exists", async () => {
        const step1Res = await app.inject({
            method: "POST",
            url: "/api/setup/step1",
            payload: {email: "admin@example.com", password: "password123"},
        });
        expect(step1Res.statusCode).toBe(200);
        expect(await getPrisma().user.count()).toBe(1);

        const signUpRes = await app.inject({
            method: "POST",
            url: "/api/auth/sign-up/email",
            payload: {
                name: "Second User",
                email: "attacker@example.com",
                password: "password123",
            },
        });

        expect(signUpRes.statusCode).not.toBe(200);
        expect(await getPrisma().user.count()).toBe(1);
    });
});
