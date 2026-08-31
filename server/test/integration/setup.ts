import {PostgreSqlContainer, type StartedPostgreSqlContainer} from "@testcontainers/postgresql";
import {execSync} from "node:child_process";
import {buildApp} from "../../src/app.js";
import type {FastifyInstance} from "fastify";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "../../src/generated/prisma/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prismaConfigPath = path.resolve(__dirname, "../../prisma/prisma.config.ts");
// Prisma is a root devDependency — resolve it by path so it works without
// being on $PATH (e.g. in CI or when running vitest directly)
const prismaBin = path.resolve(__dirname, "../../../node_modules/.bin/prisma");

let container: StartedPostgreSqlContainer;
let app: FastifyInstance;
let prismaClient: PrismaClient;

export async function startContainer(): Promise<void> {
    container = await new PostgreSqlContainer("postgres:17")
        .withDatabase("docktor_test")
        .withUsername("docktor")
        .withPassword("docktor")
        .start();

    const connectionString = container.getConnectionUri();

    // Set env vars before building the app (lazy db.ts will pick these up)
    process.env.DATABASE_URL = connectionString;
    process.env.NODE_ENV = "test";
    process.env.BETTER_AUTH_SECRET = "test-secret";

    // Push schema to the test database
    execSync(`${prismaBin} db push --config=${prismaConfigPath}`, {
        env: {...process.env, DATABASE_URL: connectionString},
        stdio: "pipe",
    });

    // Create a Prisma client for test helpers (cleanup, etc.)
    const adapter = new PrismaPg({connectionString});
    prismaClient = new PrismaClient({adapter});
}

export async function stopContainer(): Promise<void> {
    if (app) {
        await app.close();
    }
    if (container) {
        await container.stop();
    }
}

export async function getApp(): Promise<FastifyInstance> {
    if (!app) {
        app = await buildApp();
        await app.ready();
    }
    return app;
}

export function getPrisma(): PrismaClient {
    if (!prismaClient) {
        throw new Error("startContainer() must be called before getPrisma()");
    }
    return prismaClient;
}

export async function cleanDatabase(): Promise<void> {
    const p = prismaClient;
    await p.statusLog.deleteMany();
    await p.deployment.deleteMany();
    await p.proxyConfig.deleteMany();
    await p.backup.deleteMany();
    await p.service.deleteMany();
    await p.stack.deleteMany();
    await p.session.deleteMany();
    await p.account.deleteMany();
    await p.verification.deleteMany();
    await p.setting.deleteMany();
    await p.user.deleteMany();
}

export async function createTestUser(): Promise<{cookie: string}> {
    const email = `test-${Date.now()}@example.com`;
    const password = "TestPassword123!";

    // Sign up via better-auth API
    const signupRes = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: {
            name: "Test User",
            email,
            password,
        },
    });

    // Extract session cookie from the sign-up response
    const setCookieHeaders = signupRes.headers["set-cookie"];
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const sessionCookie = cookies
        .filter(Boolean)
        .map((c) => c!.split(";")[0])
        .find((c) => c.startsWith("better-auth.session_token="));

    if (!sessionCookie) {
        throw new Error(`Failed to create test user (status: ${signupRes.statusCode}): ${signupRes.body}`);
    }

    return {cookie: sessionCookie};
}
