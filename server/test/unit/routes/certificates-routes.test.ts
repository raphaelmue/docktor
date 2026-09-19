import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// Both mocks are mandatory: without them, importing the real route module
// transitively loads better-auth (database module graph) and the Prisma-backed
// application services this test exists to avoid needing a database for.
const requireAuth = vi.fn(async () => undefined);
vi.mock("../../../src/lib/auth-middleware.js", () => ({
    requireAuth: (...args: unknown[]) => requireAuth(...args),
}));

const create = vi.fn(async () => ({
    id: "cert1",
    domainPattern: "*.example.com",
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
}));
const listAll = vi.fn(async () => []);
const del = vi.fn(async () => undefined);

vi.mock("../../../src/application/index.js", () => ({
    certificateService: {
        create: (...args: unknown[]) => create(...args),
        listAll: (...args: unknown[]) => listAll(...args),
        delete: (...args: unknown[]) => del(...args),
    },
}));

import Fastify from "fastify";
import {serializerCompiler, validatorCompiler, type ZodTypeProvider} from "fastify-type-provider-zod";
import certificateRoutes from "../../../src/routes/certificates.js";

async function buildTestApp() {
    const app = Fastify({logger: false}).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(certificateRoutes);
    return app;
}

function buildMultipartBody(
    fields: Record<string, string>,
    files: Record<string, {filename: string; content: string; contentType?: string}>,
) {
    const boundary = "----testboundary0123456789";
    const lines: string[] = [];

    for (const [name, value] of Object.entries(fields)) {
        lines.push(`--${boundary}`);
        lines.push(`Content-Disposition: form-data; name="${name}"`);
        lines.push("");
        lines.push(value);
    }

    for (const [name, file] of Object.entries(files)) {
        lines.push(`--${boundary}`);
        lines.push(`Content-Disposition: form-data; name="${name}"; filename="${file.filename}"`);
        lines.push(`Content-Type: ${file.contentType ?? "application/octet-stream"}`);
        lines.push("");
        lines.push(file.content);
    }

    lines.push(`--${boundary}--`);
    lines.push("");

    return {
        payload: lines.join("\r\n"),
        headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
    };
}

const CERT_URL = "/api/certificates";

describe("POST /api/certificates", () => {
    let app: Awaited<ReturnType<typeof buildTestApp>>;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        requireAuth.mockClear();
        requireAuth.mockImplementation(async () => undefined);
        create.mockClear();
        listAll.mockClear();
        del.mockClear();
        await app.close();
    });

    it("returns 201 with a body containing id, domainPattern, and expiresAt for a valid multipart upload", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBe(201);
        const body = res.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("domainPattern");
        expect(body).toHaveProperty("expiresAt");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("never includes privateKey, certificate, or caBundle in the response body", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        const serialized = res.body;
        expect(serialized).not.toContain("privateKey");
        expect(serialized).not.toContain("caBundle");
        expect(serialized).not.toContain("BEGIN");
    });

    it("returns 400 without calling the service when domainPattern fails the shared pattern regex", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "not a hostname"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBe(400);
        expect(create).not.toHaveBeenCalled();
    });

    it("never reaches the handler when the authentication hook rejects the request", async () => {
        requireAuth.mockImplementation(async (_request: unknown, reply: any) => {
            return reply.status(401).send({error: "Unauthorized"});
        });

        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBe(401);
        expect(create).not.toHaveBeenCalled();
    });

    it("returns 400 without calling the service when the certificate file part is missing", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBe(400);
        expect(create).not.toHaveBeenCalled();
    });

    it("returns 400 without calling the service when the privateKey file part is missing", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBe(400);
        expect(create).not.toHaveBeenCalled();
    });

    it("maps an over-limit file upload to a 4xx client error, not a 500", async () => {
        const oversizedContent = "A".repeat(70 * 1024); // exceeds CERT_UPLOAD_MAX_BYTES (64 KiB)
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: oversizedContent},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(create).not.toHaveBeenCalled();
    });

    it("maps an over-limit file count (more than 3 file parts) to a 4xx client error, not a 500", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
                caBundle: {filename: "bundle.pem", content: "-----BEGIN CERTIFICATE-----\nbundle\n-----END CERTIFICATE-----"},
                extra: {filename: "extra.pem", content: "-----BEGIN CERTIFICATE-----\nextra\n-----END CERTIFICATE-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(create).not.toHaveBeenCalled();
    });

    it("maps an over-limit field count (more than 2 non-file fields) to a 4xx client error, not a 500", async () => {
        const {payload, headers} = buildMultipartBody(
            {domainPattern: "*.example.com", extraFieldOne: "a", extraFieldTwo: "b"},
            {
                certificate: {filename: "cert.pem", content: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"},
                privateKey: {filename: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"},
            },
        );

        const res = await app.inject({method: "POST", url: CERT_URL, payload, headers});

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(create).not.toHaveBeenCalled();
    });
});

describe("GET /api/certificates", () => {
    let app: Awaited<ReturnType<typeof buildTestApp>>;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        requireAuth.mockClear();
        requireAuth.mockImplementation(async () => undefined);
        listAll.mockClear();
        await app.close();
    });

    it("returns 200 with an array whose serialised body contains none of privateKey, caBundle, or BEGIN", async () => {
        listAll.mockResolvedValueOnce([
            {
                id: "cert1",
                domainPattern: "*.example.com",
                expiresAt: "2027-01-01T00:00:00.000Z",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ]);

        const res = await app.inject({method: "GET", url: CERT_URL});

        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.json())).toBe(true);
        expect(res.body).not.toContain("privateKey");
        expect(res.body).not.toContain("caBundle");
        expect(res.body).not.toContain("BEGIN");
    });
});

describe("DELETE /api/certificates/:id", () => {
    let app: Awaited<ReturnType<typeof buildTestApp>>;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        requireAuth.mockClear();
        requireAuth.mockImplementation(async () => undefined);
        del.mockClear();
        await app.close();
    });

    it("returns 204 with an empty body on success", async () => {
        const res = await app.inject({method: "DELETE", url: `${CERT_URL}/cert1`});

        expect(res.statusCode).toBe(204);
        expect(res.body).toBe("");
        expect(del).toHaveBeenCalledWith("cert1");
    });

    it("surfaces the service's ConflictError as a 409", async () => {
        const {ConflictError} = await import("../../../src/lib/errors.js");
        del.mockRejectedValueOnce(new ConflictError("Certificate is still referenced by: app.example.com"));

        const res = await app.inject({method: "DELETE", url: `${CERT_URL}/cert1`});

        expect(res.statusCode).toBe(409);
    });
});
