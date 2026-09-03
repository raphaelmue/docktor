import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanDatabase, createTestUser, getApp, getPrisma, startContainer, stopContainer} from "./setup.js";
import type {FastifyInstance} from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {DockerExecutor} from "../../src/infrastructure/docker-executor.js";

const COMPOSE_CONTENT = "services:\n  web:\n    image: nginx:latest\n";

describe("Proxy API", () => {
    let app: FastifyInstance;
    let cookie: string;
    let stacksRoot: string;

    beforeAll(async () => {
        await startContainer();
        app = await getApp();

        // Never let a real `docker compose` command run against this host —
        // STATE.md records a live `docker compose up` in a prior phase's
        // test stopping and removing a real user's unrelated containers.
        vi.spyOn(DockerExecutor.prototype, "up").mockResolvedValue(undefined);
        vi.spyOn(DockerExecutor.prototype, "down").mockResolvedValue(undefined);
        vi.spyOn(DockerExecutor.prototype, "stop").mockResolvedValue(undefined);
        vi.spyOn(DockerExecutor.prototype, "restart").mockResolvedValue(undefined);
        vi.spyOn(DockerExecutor.prototype, "composePull").mockResolvedValue("");
        vi.spyOn(DockerExecutor.prototype, "ps").mockResolvedValue([]);
        vi.spyOn(DockerExecutor.prototype, "imageDigest").mockResolvedValue(null);
    }, 60_000);

    afterAll(async () => {
        try {
            await cleanDatabase();
        } finally {
            await stopContainer();
            await fs.rm(stacksRoot, {recursive: true, force: true}).catch(() => {});
        }
    });

    beforeEach(async () => {
        await cleanDatabase();
        const user = await createTestUser();
        cookie = user.cookie;

        stacksRoot = await fs.mkdtemp(path.join(os.tmpdir(), "docktor-proxy-test-"));
        process.env.DOCKTOR_STACKS_DIR = stacksRoot;
    });

    async function seedStack(id: string, opts: {isProtected?: boolean} = {}) {
        const hostPath = path.join(stacksRoot, id);
        await fs.mkdir(hostPath, {recursive: true});
        await fs.writeFile(path.join(hostPath, "docker-compose.yml"), COMPOSE_CONTENT, "utf-8");
        await getPrisma().stack.create({
            data: {
                id,
                displayName: id,
                hostPath,
                status: "RUNNING",
                isProtected: opts.isProtected ?? false,
            },
        });
        return hostPath;
    }

    describe("POST /api/stacks/:id/services/:serviceName/proxy", () => {
        it("assigns a domain, writes the routing env vars + network into the compose file, and creates a ProxyConfig row", async () => {
            const hostPath = await seedStack("web-stack");
            await seedStack("docktor-proxy", {isProtected: true});

            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            });

            expect(res.statusCode).toBe(201);
            const body = res.json();
            expect(body.domain).toBe("app.example.com");
            expect(body.stackId).toBe("web-stack");
            expect(body.serviceName).toBe("web");

            const composeContent = await fs.readFile(path.join(hostPath, "docker-compose.yml"), "utf-8");
            expect(composeContent).toContain("VIRTUAL_HOST");
            expect(composeContent).toContain("VIRTUAL_PORT");
            expect(composeContent).toContain("LETSENCRYPT_HOST");
            expect(composeContent).toContain("docktor_proxy");
        });

        it("returns 409 and leaves the target compose file untouched when the domain is already assigned to another service", async () => {
            const hostPath = await seedStack("web-stack");
            await seedStack("other-stack");
            await seedStack("docktor-proxy", {isProtected: true});

            const first = await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            });
            expect(first.statusCode).toBe(201);

            const beforeSecond = await fs.readFile(path.join(stacksRoot, "other-stack", "docker-compose.yml"), "utf-8");

            const second = await app.inject({
                method: "POST",
                url: "/api/stacks/other-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "app.example.com", internalPort: 9090, tlsEnabled: true},
            });

            expect(second.statusCode).toBe(409);
            const afterSecond = await fs.readFile(path.join(stacksRoot, "other-stack", "docker-compose.yml"), "utf-8");
            expect(afterSecond).toBe(beforeSecond);
            void hostPath;
        });

        it("returns 400 for an invalid hostname", async () => {
            await seedStack("web-stack");
            await seedStack("docktor-proxy", {isProtected: true});

            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "not a hostname", internalPort: 8080, tlsEnabled: true},
            });

            expect(res.statusCode).toBe(400);
        });

        it("returns 400 and leaves the compose file unchanged when the docktor-proxy stack is not deployed", async () => {
            const hostPath = await seedStack("web-stack");
            const before = await fs.readFile(path.join(hostPath, "docker-compose.yml"), "utf-8");

            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            });

            expect(res.statusCode).toBe(400);
            const after = await fs.readFile(path.join(hostPath, "docker-compose.yml"), "utf-8");
            expect(after).toBe(before);
        });

        it("returns 401 without a session cookie", async () => {
            await seedStack("web-stack");
            await seedStack("docktor-proxy", {isProtected: true});

            const res = await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                payload: {domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("GET /api/stacks/:id/proxy-configs", () => {
        it("returns the created row", async () => {
            await seedStack("web-stack");
            await seedStack("docktor-proxy", {isProtected: true});

            await app.inject({
                method: "POST",
                url: "/api/stacks/web-stack/services/web/proxy",
                headers: {cookie},
                payload: {domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            });

            const res = await app.inject({
                method: "GET",
                url: "/api/stacks/web-stack/proxy-configs",
                headers: {cookie},
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body).toHaveLength(1);
            expect(body[0].domain).toBe("app.example.com");
        });

        it("returns 401 without a session cookie", async () => {
            await seedStack("web-stack");

            const res = await app.inject({
                method: "GET",
                url: "/api/stacks/web-stack/proxy-configs",
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("DELETE /api/proxy-configs/:proxyConfigId", () => {
        it("returns 401 without a session cookie", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/proxy-configs/does-not-exist",
            });

            expect(res.statusCode).toBe(401);
        });
    });
});
