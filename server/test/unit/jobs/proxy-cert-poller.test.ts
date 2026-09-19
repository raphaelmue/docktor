import {readFileSync} from "node:fs";
import path from "node:path";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {CERT_EXPIRY_WARNING_DAYS, classifyCertificateExpiry, ProxyCertPoller} from "../../../../src/jobs/proxy-cert-poller.js";
import {certificateExpiry, parseCertificate} from "../../../../src/domain/certificate-validation.js";

function createMockDockerodeClient() {
    return {
        listContainers: vi.fn(),
        getLogTail: vi.fn(),
    };
}

function createMockRepo() {
    return {
        findAllForCertPolling: vi.fn(),
        updateCertStatus: vi.fn(),
    };
}

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
    };
}

function createMockFs() {
    return {
        access: vi.fn(),
        readFile: vi.fn(),
    };
}

function tlsRow(overrides: Partial<{
    id: string;
    stackId: string;
    serviceName: string;
    domain: string;
    tlsEnabled: boolean;
    certStatus: string;
    certSource: string;
    certificate: {domainPattern: string; expiresAt: Date} | null;
}> = {}) {
    return {
        id: "cfg-1",
        stackId: "stack-1",
        serviceName: "web",
        domain: "app.example.com",
        tlsEnabled: true,
        certStatus: "pending",
        certSource: "acme",
        certificate: null,
        ...overrides,
    };
}

/** A custom-sourced row linked to a Certificate with the given domain pattern/expiry. */
function customTlsRow(overrides: Partial<{
    id: string;
    stackId: string;
    serviceName: string;
    domain: string;
    certStatus: string;
    domainPattern: string;
    expiresAt: Date | null;
}> = {}) {
    return tlsRow({
        id: overrides.id ?? "cfg-custom-1",
        stackId: overrides.stackId ?? "stack-1",
        serviceName: overrides.serviceName ?? "web",
        domain: overrides.domain ?? "cloud.example.com",
        certStatus: overrides.certStatus ?? "pending",
        certSource: "custom",
        certificate: {
            domainPattern: overrides.domainPattern ?? "cloud.example.com",
            expiresAt: overrides.expiresAt ?? null,
        },
    });
}

const ACME_CONTAINER = {
    Id: "acme-container-id",
    Names: ["/docktor-proxy-acme"],
};

describe("ProxyCertPoller", () => {
    let docker: ReturnType<typeof createMockDockerodeClient>;
    let repo: ReturnType<typeof createMockRepo>;
    let broadcaster: ReturnType<typeof createMockBroadcaster>;
    let fs: ReturnType<typeof createMockFs>;
    let poller: ProxyCertPoller;

    beforeEach(() => {
        vi.clearAllMocks();
        docker = createMockDockerodeClient();
        repo = createMockRepo();
        broadcaster = createMockBroadcaster();
        fs = createMockFs();
        poller = new ProxyCertPoller(docker as any, repo as any, broadcaster as any, fs as any);
    });

    describe("reconcile — TLS-disabled rows", () => {
        it("ignores rows with tlsEnabled: false entirely (never probes fs or writes)", async () => {
            repo.findAllForCertPolling.mockResolvedValue([tlsRow({tlsEnabled: false})]);

            await poller.reconcile();

            expect(fs.access).not.toHaveBeenCalled();
            expect(repo.updateCertStatus).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
        });
    });

    describe("reconcile — issued", () => {
        it("reports issued and persists+publishes when the *.crt file exists and status changed", async () => {
            const row = tlsRow({certStatus: "pending"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith(`${row.domain}.crt`)) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "issued"}),
            );
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "proxy_cert_status",
                    proxyConfigId: row.id,
                    stackId: row.stackId,
                    domain: row.domain,
                    status: "issued",
                }),
            );
        });

        it("reports issued when the fullchain.pem path exists instead of the .crt path", async () => {
            const row = tlsRow({certStatus: "pending"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            // Windows CI fix: the production candidate is built via
            // path.join(this.certsDir, domain, "fullchain.pem")
            // (proxy-cert-poller.ts's hasCertificateFile), which joins with
            // the host-native separator — "\\" on win32. A hardcoded
            // "${domain}/fullchain.pem" suffix here never matched that
            // candidate on a windows-latest CI runner, so this mock always
            // threw ENOENT for it, hasCertificateFile() always returned
            // false, the computed status stayed "pending" (equal to the
            // row's already-"pending" stored status), and
            // repo.updateCertStatus was never called at all — the exact
            // "Number of calls: 0" failure this test previously produced on
            // Windows. Building the expected suffix the same way production
            // does keeps the two in lockstep on every platform.
            const fullchainSuffix = path.join(row.domain, "fullchain.pem");
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith(fullchainSuffix)) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "issued"}),
            );
        });
    });

    describe("reconcile — no publish/write when unchanged", () => {
        it("triggers neither updateCertStatus nor publish when computed status equals stored status", async () => {
            const row = tlsRow({certStatus: "issued"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p.endsWith(`${row.domain}.crt`)) return;
                if (p === poller["certsDir"]) return; // certs dir probe
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(repo.updateCertStatus).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
        });
    });

    describe("reconcile — unreadable certs directory", () => {
        it("leaves every row untouched, publishes nothing, and logs once when the certs directory read throws", async () => {
            const rows = [tlsRow({id: "cfg-1"}), tlsRow({id: "cfg-2", domain: "other.example.com"})];
            repo.findAllForCertPolling.mockResolvedValue(rows);
            fs.access.mockRejectedValue(new Error("EACCES: permission denied"));
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

            await poller.reconcile();

            expect(repo.updateCertStatus).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledOnce();

            consoleErrorSpy.mockRestore();
        });
    });

    describe("reconcile — pending vs failed", () => {
        it("yields pending (not failed) when no cert file exists and no matching error line is found", async () => {
            const row = tlsRow({certStatus: "issued"}); // was issued, now missing -> should NOT flip to failed
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return; // dir probe succeeds
                throw new Error("ENOENT");
            });
            docker.listContainers.mockResolvedValue([ACME_CONTAINER]);
            docker.getLogTail.mockResolvedValue("some unrelated log line with no domain mention");

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "pending"}),
            );
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({status: "pending"}),
            );
        });

        it("yields failed with the matching acme-companion log line stored as certMessage", async () => {
            const row = tlsRow({certStatus: "pending", domain: "broken.example.com"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });
            docker.listContainers.mockResolvedValue([ACME_CONTAINER]);
            const errorLine = "2026-09-04T00:00:00Z [broken.example.com] Challenge failed for domain: unauthorized";
            docker.getLogTail.mockResolvedValue(`irrelevant line\n${errorLine}\nanother irrelevant line`);

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "failed", certMessage: errorLine}),
            );
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({status: "failed", message: errorLine}),
            );
        });
    });

    describe("reconcile — log tail fetch discipline", () => {
        it("fetches the log tail zero times when every TLS-enabled row already has a certificate file", async () => {
            const row = tlsRow();
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p.endsWith(`${row.domain}.crt`)) return;
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(docker.getLogTail).not.toHaveBeenCalled();
        });

        it("fetches the log tail at most once per reconcile even with multiple domains missing certs", async () => {
            const rows = [
                tlsRow({id: "cfg-1", domain: "a.example.com"}),
                tlsRow({id: "cfg-2", domain: "b.example.com"}),
            ];
            repo.findAllForCertPolling.mockResolvedValue(rows);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });
            docker.listContainers.mockResolvedValue([ACME_CONTAINER]);
            docker.getLogTail.mockResolvedValue("");

            await poller.reconcile();

            expect(docker.getLogTail).toHaveBeenCalledTimes(1);
        });
    });

    describe("reconcile — no .key file access", () => {
        it("never passes a path ending in .key to the filesystem port", async () => {
            const row = tlsRow();
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p.endsWith(`${row.domain}.crt`)) return;
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            for (const call of fs.access.mock.calls) {
                expect(String(call[0]).endsWith(".key")).toBe(false);
            }
        });
    });

    describe("start/stop", () => {
        it("stop() called twice does not throw", () => {
            expect(() => {
                poller.stop();
                poller.stop();
            }).not.toThrow();
        });
    });

    describe("reconcile — custom-sourced rows (D-11/D-13)", () => {
        it("never fetches the container log tail for a custom-sourced row, even when its certificate file is missing", async () => {
            const row = customTlsRow();
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(docker.getLogTail).not.toHaveBeenCalled();
            expect(docker.listContainers).not.toHaveBeenCalled();
        });

        it("resolves a wildcard certificate's file from the linked certificate's own domain pattern (wildcard label stripped), never from the row's own routing hostname", async () => {
            const row = customTlsRow({
                domain: "cloud.example.com",
                domainPattern: "*.example.com",
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            });
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith("example.com.crt")) return;
                throw new Error("ENOENT");
            });
            fs.readFile.mockResolvedValue("dummy-pem-content");

            await poller.reconcile();

            const accessedPaths = fs.access.mock.calls.map((call: unknown[]) => String(call[0]));
            expect(accessedPaths.some((p: string) => p.endsWith("example.com.crt"))).toBe(true);
            expect(accessedPaths.some((p: string) => p.includes("cloud.example.com"))).toBe(false);
            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "issued"}),
            );
        });

        it("classifies a custom row with a present file and a far-off expiry as issued", async () => {
            const row = customTlsRow({
                domainPattern: "cloud.example.com",
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            });
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith("cloud.example.com.crt")) return;
                throw new Error("ENOENT");
            });
            fs.readFile.mockResolvedValue("dummy-pem-content");

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "issued"}),
            );
        });

        it("classifies a custom row with a present file and an expiry inside the warning window as expiring, with a message naming the expiry date", async () => {
            const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
            const row = customTlsRow({certStatus: "issued", domainPattern: "cloud.example.com", expiresAt});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith("cloud.example.com.crt")) return;
                throw new Error("ENOENT");
            });
            fs.readFile.mockResolvedValue("dummy-pem-content");

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({
                    certStatus: "expiring",
                    certMessage: expect.stringContaining(expiresAt.toISOString().slice(0, 10)),
                }),
            );
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({status: "expiring"}),
            );
        });

        it("classifies a custom row with a present file and an already-past expiry as failed, with a message naming the expiry date", async () => {
            const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const row = customTlsRow({certStatus: "issued", domainPattern: "cloud.example.com", expiresAt});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith("cloud.example.com.crt")) return;
                throw new Error("ENOENT");
            });
            fs.readFile.mockResolvedValue("dummy-pem-content");

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({
                    certStatus: "failed",
                    certMessage: expect.stringContaining(expiresAt.toISOString().slice(0, 10)),
                }),
            );
        });

        it("classifies a custom row with a missing file as failed (not pending), with a message saying the file is absent", async () => {
            const row = customTlsRow({domainPattern: "cloud.example.com"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(repo.updateCertStatus).toHaveBeenCalledWith(
                row.id,
                expect.objectContaining({certStatus: "failed"}),
            );
            const call = repo.updateCertStatus.mock.calls[0];
            expect(String(call[1].certMessage)).toMatch(/not found/i);
        });

        it("publishes an event whose status is one of the four vocabulary members on a custom-row status change", async () => {
            const row = customTlsRow({domainPattern: "cloud.example.com"});
            repo.findAllForCertPolling.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                throw new Error("ENOENT");
            });

            await poller.reconcile();

            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "proxy_cert_status",
                    status: expect.stringMatching(/^(pending|issued|failed|expiring)$/),
                }),
            );
        });

        it("never passes a path ending in .key to the filesystem port across a mixed ACME + custom reconcile", async () => {
            const acme = tlsRow({id: "cfg-acme", domain: "app.example.com"});
            const custom = customTlsRow({id: "cfg-custom", domainPattern: "cloud.example.com"});
            repo.findAllForCertPolling.mockResolvedValue([acme, custom]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith(`${acme.domain}.crt`)) return;
                if (p.endsWith("cloud.example.com.crt")) return;
                throw new Error("ENOENT");
            });
            fs.readFile.mockResolvedValue("dummy-pem-content");

            await poller.reconcile();

            for (const call of fs.access.mock.calls) {
                expect(String(call[0]).endsWith(".key")).toBe(false);
            }
            for (const call of fs.readFile.mock.calls) {
                expect(String(call[0]).endsWith(".key")).toBe(false);
            }
        });
    });
});

describe("classifyCertificateExpiry", () => {
    it("returns issued for a not-after date comfortably beyond the warning window", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const validTo = new Date("2026-06-01T00:00:00Z");

        expect(classifyCertificateExpiry(validTo, now, CERT_EXPIRY_WARNING_DAYS)).toBe("issued");
    });

    it("returns expiring for a not-after date inside the warning window", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const validTo = new Date("2026-01-10T00:00:00Z");

        expect(classifyCertificateExpiry(validTo, now, CERT_EXPIRY_WARNING_DAYS)).toBe("expiring");
    });

    it("returns expiring at exactly the warning-window boundary", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const validTo = new Date(now.getTime() + CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

        expect(classifyCertificateExpiry(validTo, now, CERT_EXPIRY_WARNING_DAYS)).toBe("expiring");
    });

    it("returns failed for a not-after date already in the past", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const validTo = new Date("2025-12-01T00:00:00Z");

        expect(classifyCertificateExpiry(validTo, now, CERT_EXPIRY_WARNING_DAYS)).toBe("failed");
    });
});

describe("classifyCertificateExpiry — proof against the real fixture certificate's own not-after date (Task 3)", () => {
    it("classifies issued/expiring/failed at three clock points derived from server/test/fixtures/certs/leaf.crt's real notAfter, not a hand-written date", () => {
        // This is the genuine 09-06 self-signed fixture used throughout the
        // certificate feature's tests — parsed with the same production
        // helper (parseCertificate/certificateExpiry) the poller itself
        // uses, so the boundaries below are derived from real X.509 content
        // and would catch a date-unit or timezone mistake a hand-written
        // literal date could not.
        const pem = readFileSync(
            new URL("../../fixtures/certs/leaf.crt", import.meta.url),
            "utf-8",
        );
        const parsed = parseCertificate(pem);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error("fixture certificate failed to parse");
        const notAfter = certificateExpiry(parsed.cert);

        const comfortablyBefore = new Date(notAfter.getTime() - 60 * 24 * 60 * 60 * 1000);
        const insideWindow = new Date(notAfter.getTime() - 10 * 24 * 60 * 60 * 1000);
        const afterExpiry = new Date(notAfter.getTime() + 24 * 60 * 60 * 1000);

        expect(classifyCertificateExpiry(notAfter, comfortablyBefore, CERT_EXPIRY_WARNING_DAYS)).toBe("issued");
        expect(classifyCertificateExpiry(notAfter, insideWindow, CERT_EXPIRY_WARNING_DAYS)).toBe("expiring");
        expect(classifyCertificateExpiry(notAfter, afterExpiry, CERT_EXPIRY_WARNING_DAYS)).toBe("failed");
    });
});
