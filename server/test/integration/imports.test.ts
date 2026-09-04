// T-05.1-32/T-05.1-33/T-05.1-36: proves the four new /api/stacks/import/*
// routes (a) reject unauthenticated requests exactly like every other
// authenticated route, and (b) do not reintroduce the exposure that made
// /api/setup/scan and /api/setup/adopt reachable forever before T-05-09 —
// including a direct regression guard that the setup routes' 410 gate is
// still closed once the wizard is complete.
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {cleanDatabase, createTestUser, getApp, startContainer, stopContainer} from "./setup.js";
import type {FastifyInstance} from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Imports API (post-setup brownfield scan/adopt/migrate)", () => {
    let app: FastifyInstance;
    let cookie: string;
    let scanDir: string;

    beforeAll(async () => {
        await startContainer();
        app = await getApp();
    }, 60_000);

    afterAll(async () => {
        try {
            await cleanDatabase();
        } finally {
            await stopContainer();
        }
    });

    beforeEach(async () => {
        await cleanDatabase();
        const user = await createTestUser();
        cookie = user.cookie;

        scanDir = await fs.mkdtemp(path.join(os.tmpdir(), "docktor-imports-test-"));
        await fs.writeFile(
            path.join(scanDir, "docker-compose.yml"),
            "services:\n  web:\n    image: nginx:latest\n",
            "utf-8",
        );
    });

    afterEach(async () => {
        await fs.rm(scanDir, {recursive: true, force: true});
    });

    describe("Authentication (T-05.1-32)", () => {
        it("POST /api/stacks/import/scan without a session → 401", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/import/scan",
                payload: {directories: [scanDir]},
            });
            expect(res.statusCode).toBe(401);
        });

        it("POST /api/stacks/import/adopt without a session → 401", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/import/adopt",
                payload: {composePath: path.join(scanDir, "docker-compose.yml"), displayName: "test"},
            });
            expect(res.statusCode).toBe(401);
        });

        it("POST /api/stacks/import/migrate/preview without a session → 401", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/import/migrate/preview",
                payload: {
                    composePath: path.join(scanDir, "docker-compose.yml"),
                    volumeSelections: [],
                    namedVolumeSelections: {},
                },
            });
            expect(res.statusCode).toBe(401);
        });

        it("POST /api/stacks/import/migrate without a session → 401", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/import/migrate",
                payload: {
                    composePath: path.join(scanDir, "docker-compose.yml"),
                    displayName: "test",
                    volumeSelections: [],
                    namedVolumeSelections: {},
                },
            });
            expect(res.statusCode).toBe(401);
        });
    });

    it("POST /api/stacks/import/scan → returns a ScanResult-shaped body for an authenticated request", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/stacks/import/scan",
            headers: {cookie},
            payload: {directories: [scanDir]},
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.skippedDirectories).toBe(0);
        expect(body.stacks).toHaveLength(1);
        expect(body.stacks[0].directory).toBe(scanDir);
        expect(body.stacks[0].serviceCount).toBe(1);
    });

    it("POST /api/stacks/import/adopt → registers a stack visible via GET /api/stacks (T-05.1-35 slug guarantee)", async () => {
        const composePath = path.join(scanDir, "docker-compose.yml");

        const adoptRes = await app.inject({
            method: "POST",
            url: "/api/stacks/import/adopt",
            headers: {cookie},
            payload: {composePath, displayName: "My Imported App"},
        });

        expect(adoptRes.statusCode).toBe(200);
        const adoptBody = adoptRes.json();
        // slugify() guarantee: the returned id must be a URL-safe slug, not
        // the raw display name.
        expect(adoptBody.id).toBe("my-imported-app");

        const listRes = await app.inject({
            method: "GET",
            url: "/api/stacks",
            headers: {cookie},
        });
        expect(listRes.statusCode).toBe(200);
        const stacks = listRes.json();
        expect(stacks.map((s: {id: string}) => s.id)).toContain("my-imported-app");
    });

    describe("Regression guard: T-05-09's /api/setup/* 410 gate stays closed (T-05.1-36)", () => {
        it("/api/setup/scan and /api/setup/adopt 410 once the wizard is complete, while /api/stacks/import/* still works", async () => {
            const completeRes = await app.inject({method: "POST", url: "/api/setup/complete"});
            expect(completeRes.statusCode).toBe(200);

            const setupScanRes = await app.inject({
                method: "POST",
                url: "/api/setup/scan",
                payload: {directories: [scanDir]},
            });
            expect(setupScanRes.statusCode).toBe(410);

            const setupAdoptRes = await app.inject({
                method: "POST",
                url: "/api/setup/adopt",
                payload: {composePath: path.join(scanDir, "docker-compose.yml"), displayName: "attacker"},
            });
            expect(setupAdoptRes.statusCode).toBe(410);

            // The authenticated replacement routes must still work.
            const importScanRes = await app.inject({
                method: "POST",
                url: "/api/stacks/import/scan",
                headers: {cookie},
                payload: {directories: [scanDir]},
            });
            expect(importScanRes.statusCode).toBe(200);
            expect(importScanRes.json().stacks).toHaveLength(1);
        });
    });
});
