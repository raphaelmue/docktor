import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {CertificateService} from "../../../src/application/certificate-service.js";
import {BadRequestError, ConflictError, NotFoundError} from "../../../src/lib/errors.js";
import {encrypt} from "../../../src/lib/crypto.js";
import {Prisma} from "../../../src/generated/prisma/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/certs");

const leafCert = readFileSync(path.join(FIXTURES_DIR, "leaf.crt"), "utf-8");
const leafKey = readFileSync(path.join(FIXTURES_DIR, "leaf.key"), "utf-8");
const unrelatedKey = readFileSync(path.join(FIXTURES_DIR, "unrelated.key"), "utf-8");
const caBundle = readFileSync(path.join(FIXTURES_DIR, "ca-bundle.crt"), "utf-8");

const TEST_KEY = "a".repeat(64); // 32 bytes hex

interface FakeRow {
    id: string;
    domainPattern: string;
    privateKey: string;
    certificate: string;
    caBundle: string | null;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

function toDto(row: FakeRow) {
    return {
        id: row.id,
        domainPattern: row.domainPattern,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function createFakeCertRepo(initialRows: FakeRow[] = []) {
    const rows: FakeRow[] = [...initialRows];
    let counter = rows.length;

    const create = vi.fn(async (data: Omit<FakeRow, "id" | "createdAt" | "updatedAt">) => {
        if (rows.some((row) => row.domainPattern === data.domainPattern)) {
            throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed on the fields: (`domainPattern`)",
                {code: "P2002", clientVersion: "test"},
            );
        }
        const row: FakeRow = {
            id: `cert-${++counter}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
        };
        rows.push(row);
        return row;
    });

    const findByIdOrThrow = vi.fn(async (id: string) => {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new NotFoundError(`Certificate "${id}" not found`);
        return row;
    });

    const del = vi.fn(async (id: string) => {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`row "${id}" not found`);
        rows.splice(idx, 1);
    });

    const referencingDomainsByRepoId = new Map<string, string[]>();

    return {
        create,
        findByIdOrThrow,
        findAll: vi.fn(async () => [...rows]),
        findReferencingDomains: vi.fn(async (id: string) => referencingDomainsByRepoId.get(id) ?? []),
        delete: del,
        toDto: vi.fn((row: FakeRow) => toDto(row)),
        setReferencingDomains(id: string, domains: string[]) {
            referencingDomainsByRepoId.set(id, domains);
        },
        get _rows() {
            return rows;
        },
    };
}

function createFakeFs() {
    return {
        writeCertificateFiles: vi.fn(async () => undefined),
        removeCertificateFiles: vi.fn(async () => undefined),
    };
}

function buildService(repo = createFakeCertRepo(), fs = createFakeFs()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new CertificateService(repo as any, fs as any);
    return {service, repo, fs};
}

describe("CertificateService", () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
    });

    afterEach(() => {
        delete process.env.ENCRYPTION_KEY;
    });

    describe("create()", () => {
        it("throws BadRequestError for an invalid key/certificate pair and never persists or writes a file", async () => {
            const {service, repo, fs} = buildService();

            await expect(
                service.create({
                    domainPattern: "*.example.com",
                    certificatePem: leafCert,
                    privateKeyPem: unrelatedKey,
                }),
            ).rejects.toBeInstanceOf(BadRequestError);

            expect(repo.create).not.toHaveBeenCalled();
            expect(fs.writeCertificateFiles).not.toHaveBeenCalled();
        });

        it("throws BadRequestError when the certificate does not cover the declared domain pattern, and never persists or writes a file", async () => {
            const {service, repo, fs} = buildService();

            await expect(
                service.create({
                    domainPattern: "*.not-covered.test",
                    certificatePem: leafCert,
                    privateKeyPem: leafKey,
                }),
            ).rejects.toBeInstanceOf(BadRequestError);

            expect(repo.create).not.toHaveBeenCalled();
            expect(fs.writeCertificateFiles).not.toHaveBeenCalled();
        });

        it("encrypts the private key before persisting — the value passed to the repository differs from and never contains the supplied key PEM", async () => {
            const {service, repo} = buildService();

            await service.create({domainPattern: "*.example.com", certificatePem: leafCert, privateKeyPem: leafKey});

            expect(repo.create).toHaveBeenCalledTimes(1);
            const persistedKey = repo.create.mock.calls[0][0].privateKey as string;
            expect(persistedKey).not.toBe(leafKey);
            expect(persistedKey).not.toContain(leafKey);
        });

        it("writes the key file using the decrypted plaintext — the value passed to the filesystem port equals the supplied key PEM", async () => {
            const {service, fs} = buildService();

            await service.create({domainPattern: "*.example.com", certificatePem: leafCert, privateKeyPem: leafKey});

            expect(fs.writeCertificateFiles).toHaveBeenCalledTimes(1);
            const [, content] = fs.writeCertificateFiles.mock.calls[0];
            expect(content.privateKey).toBe(leafKey);
        });

        it("passes the leaf certificate and the CA bundle through to the filesystem port when a CA bundle is supplied — CertificateFilesystem owns the leaf+bundle concatenation (Step D), the service passes both fields through unmodified", async () => {
            const {service, fs} = buildService();

            await service.create({
                domainPattern: "*.example.com",
                certificatePem: leafCert,
                privateKeyPem: leafKey,
                caBundlePem: caBundle,
            });

            const [, content] = fs.writeCertificateFiles.mock.calls[0];
            expect(content.certificate).toBe(leafCert);
            expect(content.caBundle).toBe(caBundle);
        });

        it("throws ConflictError (not a raw Prisma error) when a certificate for the domain pattern already exists, and never writes a file", async () => {
            const repo = createFakeCertRepo([
                {
                    id: "cert-1",
                    domainPattern: "*.example.com",
                    privateKey: encrypt(leafKey),
                    certificate: leafCert,
                    caBundle: null,
                    expiresAt: new Date("2030-01-01"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);
            const fs = createFakeFs();
            const {service} = buildService(repo, fs);

            const error = await service
                .create({domainPattern: "*.example.com", certificatePem: leafCert, privateKeyPem: leafKey})
                .catch((e) => e);

            expect(error).toBeInstanceOf(ConflictError);
            expect((error as Error).message).toContain("*.example.com");
            expect(fs.writeCertificateFiles).not.toHaveBeenCalled();
        });

        it("deletes the just-created row and rethrows when the filesystem write rejects", async () => {
            const repo = createFakeCertRepo();
            const fs = createFakeFs();
            fs.writeCertificateFiles.mockRejectedValue(new Error("disk full"));
            const {service} = buildService(repo, fs);

            await expect(
                service.create({domainPattern: "*.example.com", certificatePem: leafCert, privateKeyPem: leafKey}),
            ).rejects.toThrow("disk full");

            expect(repo._rows).toHaveLength(0);
        });
    });

    describe("listAll()", () => {
        it("returns only metadata fields — no privateKey, certificate, or caBundle key", async () => {
            const repo = createFakeCertRepo([
                {
                    id: "cert-1",
                    domainPattern: "*.example.com",
                    privateKey: encrypt(leafKey),
                    certificate: leafCert,
                    caBundle: null,
                    expiresAt: new Date("2030-01-01"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);
            const {service} = buildService(repo);

            const result = await service.listAll();

            expect(result).toHaveLength(1);
            for (const row of result) {
                expect(row).not.toHaveProperty("privateKey");
                expect(row).not.toHaveProperty("certificate");
                expect(row).not.toHaveProperty("caBundle");
            }
        });
    });

    describe("delete()", () => {
        it("throws NotFoundError for an unknown id", async () => {
            const {service} = buildService();

            await expect(service.delete("missing")).rejects.toBeInstanceOf(NotFoundError);
        });

        it("throws ConflictError naming every referencing domain when the certificate is still referenced, and performs no delete/remove", async () => {
            const repo = createFakeCertRepo([
                {
                    id: "cert-1",
                    domainPattern: "*.example.com",
                    privateKey: encrypt(leafKey),
                    certificate: leafCert,
                    caBundle: null,
                    expiresAt: new Date("2030-01-01"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);
            repo.setReferencingDomains("cert-1", ["app.example.com", "cloud.example.com"]);
            const fs = createFakeFs();
            const {service} = buildService(repo, fs);

            const error = await service.delete("cert-1").catch((e) => e);

            expect(error).toBeInstanceOf(ConflictError);
            expect((error as Error).message).toContain("app.example.com");
            expect((error as Error).message).toContain("cloud.example.com");
            expect(repo.delete).not.toHaveBeenCalled();
            expect(fs.removeCertificateFiles).not.toHaveBeenCalled();
        });

        it("removes the files and the row for an unreferenced certificate", async () => {
            const repo = createFakeCertRepo([
                {
                    id: "cert-1",
                    domainPattern: "*.example.com",
                    privateKey: encrypt(leafKey),
                    certificate: leafCert,
                    caBundle: null,
                    expiresAt: new Date("2030-01-01"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);
            const fs = createFakeFs();
            const {service} = buildService(repo, fs);

            await service.delete("cert-1");

            expect(fs.removeCertificateFiles).toHaveBeenCalledWith("example.com");
            expect(repo.delete).toHaveBeenCalledWith("cert-1");
            expect(repo._rows).toHaveLength(0);
        });
    });
});
