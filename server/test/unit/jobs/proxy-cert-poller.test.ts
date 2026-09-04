import {beforeEach, describe, expect, it, vi} from "vitest";
import {ProxyCertPoller} from "../../../../src/jobs/proxy-cert-poller.js";

function createMockDockerodeClient() {
    return {
        listContainers: vi.fn(),
        getLogTail: vi.fn(),
    };
}

function createMockRepo() {
    return {
        findAll: vi.fn(),
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
    };
}

function tlsRow(overrides: Partial<{
    id: string;
    stackId: string;
    serviceName: string;
    domain: string;
    tlsEnabled: boolean;
    certStatus: string;
}> = {}) {
    return {
        id: "cfg-1",
        stackId: "stack-1",
        serviceName: "web",
        domain: "app.example.com",
        tlsEnabled: true,
        certStatus: "pending",
        ...overrides,
    };
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
            repo.findAll.mockResolvedValue([tlsRow({tlsEnabled: false})]);

            await poller.reconcile();

            expect(fs.access).not.toHaveBeenCalled();
            expect(repo.updateCertStatus).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
        });
    });

    describe("reconcile — issued", () => {
        it("reports issued and persists+publishes when the *.crt file exists and status changed", async () => {
            const row = tlsRow({certStatus: "pending"});
            repo.findAll.mockResolvedValue([row]);
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
            repo.findAll.mockResolvedValue([row]);
            fs.access.mockImplementation(async (p: string) => {
                if (p === poller["certsDir"]) return;
                if (p.endsWith(`${row.domain}/fullchain.pem`)) return;
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
            repo.findAll.mockResolvedValue([row]);
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
            repo.findAll.mockResolvedValue(rows);
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
            repo.findAll.mockResolvedValue([row]);
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
            repo.findAll.mockResolvedValue([row]);
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
            repo.findAll.mockResolvedValue([row]);
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
            repo.findAll.mockResolvedValue(rows);
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
            repo.findAll.mockResolvedValue([row]);
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
});
