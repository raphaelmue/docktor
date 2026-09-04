import {describe, expect, it, vi} from "vitest";
import {PROXY_STACK_ID, ProxyService} from "../../../src/application/proxy-service.js";
import {BadRequestError, ConflictError, NotFoundError} from "../../../src/lib/errors.js";
import {Prisma} from "../../../src/generated/prisma/client.js";
import {readServiceProxyEnv, setServiceProxyEnv, PROXY_NETWORK_NAME} from "../../../src/lib/compose-proxy-editor.js";
import {
    ACME_COMPANION_CONTAINER_NAME,
    NGINX_PROXY_CONTAINER_NAME,
} from "../../../src/lib/proxy-stack-compose.js";

interface FakeRow {
    id: string;
    stackId: string;
    serviceName: string;
    domain: string;
    internalPort: number;
    tlsEnabled: boolean;
}

/**
 * An in-memory stand-in for ProxyRepository that enforces the same
 * @@unique([domain]) constraint the real Prisma model does (by throwing a
 * real Prisma.PrismaClientKnownRequestError with code P2002), so
 * ProxyService's error-translation and adoption-skip logic can be exercised
 * exactly as it runs against the real repository.
 */
function createFakeProxyRepo(initialRows: FakeRow[] = []) {
    const rows: FakeRow[] = [...initialRows];
    let counter = rows.length;

    const create = vi.fn(async (data: Omit<FakeRow, "id">) => {
        if (rows.some((row) => row.domain === data.domain)) {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`domain`)", {
                code: "P2002",
                clientVersion: "test",
            });
        }
        const row: FakeRow = {id: `row-${++counter}`, ...data};
        rows.push(row);
        return row;
    });

    const findByIdOrThrow = vi.fn(async (id: string) => {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new NotFoundError(`ProxyConfig "${id}" not found`);
        return row;
    });

    const findByStackAndService = vi.fn(async (stackId: string, serviceName: string) => {
        return rows.filter((r) => r.stackId === stackId && r.serviceName === serviceName);
    });

    const updateConfig = vi.fn(async (id: string, data: Partial<FakeRow>) => {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error(`row "${id}" not found`);
        Object.assign(row, data);
        return row;
    });

    const del = vi.fn(async (id: string) => {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`row "${id}" not found`);
        rows.splice(idx, 1);
    });

    return {
        create,
        findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
        findByIdOrThrow,
        findByStackId: vi.fn(async (stackId: string) => rows.filter((r) => r.stackId === stackId)),
        findByStackAndService,
        findAll: vi.fn(async () => [...rows]),
        updateConfig,
        updateCertStatus: vi.fn(),
        delete: del,
        get _rows() {
            return rows;
        },
    };
}

function createMockStackRepo() {
    return {
        findByIdOrThrow: vi.fn().mockResolvedValue({id: "web-stack"}),
        findById: vi.fn().mockResolvedValue(null),
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn().mockImplementation(async (data: any) => ({
            id: data.id,
            displayName: data.displayName,
            hostPath: data.hostPath,
            isProtected: data.isProtected ?? false,
            status: "DRAFT",
        })),
    };
}

function createMockStackService() {
    return {
        deployStack: vi.fn().mockResolvedValue({success: true}),
    };
}

function createMockSettings(overrides: {acmeEmail?: string; showInDashboard?: boolean} = {}) {
    return {
        getProxySettings: vi.fn().mockResolvedValue({
            acmeEmail: overrides.acmeEmail ?? "",
            showInDashboard: overrides.showInDashboard ?? false,
        }),
        updateProxySettings: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockDocker(
    containers: Array<{Id: string; Names: string[]; State: string; Ports: Array<{PublicPort?: number}>}> = [],
) {
    return {
        listContainers: vi.fn().mockResolvedValue(containers),
    };
}

/** A fake filesystem holding a single compose string in closure. */
function createFakeFs(initialContent: string, opts: {delayed?: boolean} = {}) {
    let content = initialContent;
    const readCompose = vi.fn(async (_stackId: string) => {
        const snapshot = content;
        if (opts.delayed) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        return snapshot;
    });
    const writeCompose = vi.fn(async (_stackId: string, newContent: string) => {
        content = newContent;
    });
    const createDirectory = vi.fn().mockResolvedValue("/stacks/docktor-proxy");
    return {
        readCompose,
        writeCompose,
        createDirectory,
        get content() {
            return content;
        },
    };
}

function buildService(
    repo = createFakeProxyRepo(),
    stackRepo = createMockStackRepo(),
    fs = createFakeFs("services:\n  web:\n    image: nginx:latest\n"),
    stackService = createMockStackService(),
    settings = createMockSettings(),
    docker = createMockDocker(),
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ProxyService(repo as any, stackRepo as any, fs as any, stackService as any, settings as any, docker as any);
    return {service, repo, stackRepo, fs, stackService, settings, docker};
}

describe("ProxyService.removeDomain (PRXY-04)", () => {
    it("throws NotFoundError for an unknown id and performs no compose write", async () => {
        const {service, fs} = buildService();

        await expect(service.removeDomain("missing-id")).rejects.toBeInstanceOf(NotFoundError);
        expect(fs.writeCompose).not.toHaveBeenCalled();
    });

    it("deletes the row and re-renders the remaining comma-joined domain set when other rows remain for the service", async () => {
        const content = setServiceProxyEnv("services:\n  web:\n    image: nginx:latest\n", "web", {
            virtualHost: "a.example.com,b.example.com,c.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });
        const {service, repo, fs, stackService} = buildService(
            createFakeProxyRepo([
                {id: "row-a", stackId: "web-stack", serviceName: "web", domain: "a.example.com", internalPort: 8080, tlsEnabled: false},
                {id: "row-b", stackId: "web-stack", serviceName: "web", domain: "b.example.com", internalPort: 8080, tlsEnabled: false},
                {id: "row-c", stackId: "web-stack", serviceName: "web", domain: "c.example.com", internalPort: 8080, tlsEnabled: false},
            ]),
            createMockStackRepo(),
            createFakeFs(content),
        );

        await service.removeDomain("row-b");

        const readBack = readServiceProxyEnv(fs.content, "web");
        expect(readBack.virtualHost).toBe("a.example.com,c.example.com");
        expect(repo._rows.map((r) => r.id)).toEqual(["row-a", "row-c"]);
        expect(stackService.deployStack).toHaveBeenCalledWith("web-stack");
    });

    it("clears the env vars and removes the docktor_proxy network entry when removing a service's last domain, without touching a second service's VIRTUAL_HOST or network entry", async () => {
        let content = "services:\n  web:\n    image: nginx:latest\n  api:\n    image: node:latest\n";
        content = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: "app.example.com",
        });
        content = setServiceProxyEnv(content, "api", {
            virtualHost: "api.example.com",
            virtualPort: "3000",
            letsencryptHost: null,
        });

        const {service, repo, fs} = buildService(
            createFakeProxyRepo([
                {id: "row-web", stackId: "web-stack", serviceName: "web", domain: "app.example.com", internalPort: 8080, tlsEnabled: true},
            ]),
            createMockStackRepo(),
            createFakeFs(content),
        );

        await service.removeDomain("row-web");

        expect(fs.content).not.toContain("VIRTUAL_HOST: app.example.com");
        expect(fs.content).toContain("VIRTUAL_HOST: api.example.com");
        expect(fs.content).toContain(`- ${PROXY_NETWORK_NAME}`);
        expect(fs.content).toMatch(/networks:\s*\n\s*docktor_proxy:\s*\n\s*external: true/);
        expect(repo._rows).toHaveLength(0);
    });

    it("performs no compose write on a repeat removal of the same id", async () => {
        const {service, fs} = buildService(
            createFakeProxyRepo([
                {id: "row-1", stackId: "web-stack", serviceName: "web", domain: "app.example.com", internalPort: 8080, tlsEnabled: false},
            ]),
        );

        await service.removeDomain("row-1");
        fs.writeCompose.mockClear();

        await expect(service.removeDomain("row-1")).rejects.toBeInstanceOf(NotFoundError);
        expect(fs.writeCompose).not.toHaveBeenCalled();
    });
});

describe("ProxyService.assignDomain — adoption of hand-written domains", () => {
    it("adopts a domain already present in the compose file's VIRTUAL_HOST with no matching row, and both domains appear in the rewritten value", async () => {
        const content =
            'services:\n  web:\n    image: nginx:latest\n    environment:\n      VIRTUAL_HOST: old.example.com\n      VIRTUAL_PORT: "9090"\n';
        const {service, repo, fs} = buildService(createFakeProxyRepo(), createMockStackRepo(), createFakeFs(content));

        const result = await service.assignDomain("web-stack", "web", {
            domain: "new.example.com",
            internalPort: 9090,
            tlsEnabled: true,
        });

        expect(result.domain).toBe("new.example.com");
        const domains = repo._rows.map((r) => r.domain).sort();
        expect(domains).toEqual(["new.example.com", "old.example.com"]);

        const readBack = readServiceProxyEnv(fs.content, "web");
        expect(readBack.virtualHost).toBe("old.example.com,new.example.com");
        expect(readBack.letsencryptHost).toBe("new.example.com");

        const adopted = repo._rows.find((r) => r.domain === "old.example.com")!;
        expect(adopted.internalPort).toBe(9090);
        expect(adopted.tlsEnabled).toBe(false);
    });

    it("skips an adopted domain that collides with a row owned by another service, warning rather than aborting, and still assigns the requested domain", async () => {
        const content =
            'services:\n  web:\n    image: nginx:latest\n    environment:\n      VIRTUAL_HOST: old.example.com\n      VIRTUAL_PORT: "9090"\n';
        const {service, repo} = buildService(
            createFakeProxyRepo([
                {id: "row-other", stackId: "web-stack", serviceName: "other", domain: "old.example.com", internalPort: 8080, tlsEnabled: false},
            ]),
            createMockStackRepo(),
            createFakeFs(content),
        );
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await service.assignDomain("web-stack", "web", {
            domain: "new.example.com",
            internalPort: 9090,
            tlsEnabled: false,
        });

        expect(result.domain).toBe("new.example.com");
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("old.example.com"));
        expect(repo._rows.filter((r) => r.serviceName === "web").map((r) => r.domain)).toEqual(["new.example.com"]);

        warnSpy.mockRestore();
    });
});

describe("ProxyService.assignDomain — rollback on failure", () => {
    it("rolls back a brand-new row when the compose write fails", async () => {
        const repo = createFakeProxyRepo();
        const stackRepo = createMockStackRepo();
        const stackService = createMockStackService();
        const fs = {
            readCompose: vi.fn().mockResolvedValue("services:\n  web:\n    image: nginx:latest\n"),
            writeCompose: vi.fn().mockRejectedValue(new Error("disk full")),
            createDirectory: vi.fn().mockResolvedValue("/stacks/web-stack"),
        };
        const settings = createMockSettings();
        const docker = createMockDocker();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = new ProxyService(repo as any, stackRepo as any, fs as any, stackService as any, settings as any, docker as any);

        await expect(
            service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: false}),
        ).rejects.toThrow("disk full");

        expect(repo._rows).toHaveLength(0);
    });
});

describe("ProxyService.assignDomain — idempotent re-assign (PRXY-05)", () => {
    it("updates internalPort and tlsEnabled in place for a re-assigned domain, without creating a second row or raising ConflictError", async () => {
        const {service, repo} = buildService();

        const first = await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: false});
        const second = await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 9090, tlsEnabled: true});

        expect(second.id).toBe(first.id);
        expect(second.internalPort).toBe(9090);
        expect(second.tlsEnabled).toBe(true);
        expect(repo._rows.filter((r) => r.stackId === "web-stack" && r.serviceName === "web")).toHaveLength(1);
    });

    it("still raises ConflictError when the domain is owned by a different service", async () => {
        const {service} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs("services:\n  web:\n    image: nginx:latest\n  other:\n    image: nginx:latest\n"),
        );

        await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: false});

        await expect(
            service.assignDomain("web-stack", "other", {domain: "app.example.com", internalPort: 8080, tlsEnabled: false}),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it("leaves the compose file byte-identical after re-assigning identical values twice", async () => {
        const {service, fs} = buildService();

        await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: true});
        const afterFirst = fs.content;
        await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: true});
        const afterSecond = fs.content;

        expect(afterSecond).toBe(afterFirst);
    });

    it("still raises BadRequestError for a brand-new domain with a conflicting port", async () => {
        const {service} = buildService();

        await service.assignDomain("web-stack", "web", {domain: "app.example.com", internalPort: 8080, tlsEnabled: false});

        await expect(
            service.assignDomain("web-stack", "web", {domain: "second.example.com", internalPort: 9090, tlsEnabled: false}),
        ).rejects.toBeInstanceOf(BadRequestError);
    });
});

describe("ProxyService — concurrent compose writes against one stack (T-06-09, held-out backstop)", () => {
    it("serializes five concurrent assignDomain calls for one service so no domain is lost to a compose write race", async () => {
        const {service, repo, fs} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs("services:\n  web:\n    image: nginx:latest\n", {delayed: true}),
        );

        const domains = ["d1.example.com", "d2.example.com", "d3.example.com", "d4.example.com", "d5.example.com"];
        await Promise.all(
            domains.map((domain) => service.assignDomain("web-stack", "web", {domain, internalPort: 8080, tlsEnabled: false})),
        );

        const readBack = readServiceProxyEnv(fs.content, "web");
        const fileDomains = (readBack.virtualHost ?? "").split(",").filter(Boolean);
        for (const domain of domains) {
            expect(fileDomains).toContain(domain);
        }
        expect(repo._rows.filter((r) => r.stackId === "web-stack" && r.serviceName === "web")).toHaveLength(5);
    });

    it("serializes a concurrent assignDomain and removeDomain against the same stack so the compose file matches the final DB rows", async () => {
        const baseContent = setServiceProxyEnv("services:\n  web:\n    image: nginx:latest\n", "web", {
            virtualHost: "existing.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });
        const {service, repo, fs} = buildService(
            createFakeProxyRepo([
                {id: "row-1", stackId: "web-stack", serviceName: "web", domain: "existing.example.com", internalPort: 8080, tlsEnabled: false},
            ]),
            createMockStackRepo(),
            createFakeFs(baseContent, {delayed: true}),
        );

        await Promise.all([
            service.assignDomain("web-stack", "web", {domain: "new.example.com", internalPort: 8080, tlsEnabled: false}),
            service.removeDomain("row-1"),
        ]);

        const finalRows = repo._rows.filter((r) => r.stackId === "web-stack" && r.serviceName === "web");
        const finalDomains = new Set(finalRows.map((r) => r.domain));

        const readBack = readServiceProxyEnv(fs.content, "web");
        const fileDomains = new Set((readBack.virtualHost ?? "").split(",").filter(Boolean));

        expect(fileDomains).toEqual(finalDomains);
    });
});

describe("ProxyService.deployProxyStack (PRXY-02)", () => {
    it("checks host ports free, writes the compose file, creates the Stack row with isProtected: true and id docktor-proxy, then deploys", async () => {
        const stackRepo = createMockStackRepo();
        const fs = createFakeFs("");
        const stackService = createMockStackService();
        const settings = createMockSettings({acmeEmail: "admin@example.com"});
        const docker = createMockDocker([]);
        const {service} = buildService(createFakeProxyRepo(), stackRepo, fs, stackService, settings, docker);

        await service.deployProxyStack();

        expect(docker.listContainers).toHaveBeenCalled();
        expect(fs.createDirectory).toHaveBeenCalledWith(PROXY_STACK_ID);
        expect(fs.writeCompose).toHaveBeenCalledWith(PROXY_STACK_ID, expect.stringContaining("nginx-proxy"));
        expect(stackRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({id: PROXY_STACK_ID, displayName: "Docktor Proxy", isProtected: true}),
        );
        expect(stackService.deployStack).toHaveBeenCalledWith(PROXY_STACK_ID);
    });

    it("throws ConflictError naming the container when a running container publishes host port 80", async () => {
        const docker = createMockDocker([
            {Id: "c1", Names: ["/some-other-app"], State: "running", Ports: [{PublicPort: 80}]},
        ]);
        const {service, stackRepo} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs(""),
            createMockStackService(),
            createMockSettings(),
            docker,
        );

        await expect(service.deployProxyStack()).rejects.toBeInstanceOf(ConflictError);
        await expect(service.deployProxyStack()).rejects.toThrow(/some-other-app/);
        expect(stackRepo.create).not.toHaveBeenCalled();
    });

    it("resolves (no ConflictError) when the same container publishing port 80 is stopped", async () => {
        const docker = createMockDocker([
            {Id: "c1", Names: ["/some-other-app"], State: "exited", Ports: [{PublicPort: 80}]},
        ]);
        const {service} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs(""),
            createMockStackService(),
            createMockSettings(),
            docker,
        );

        await expect(service.deployProxyStack()).resolves.not.toThrow();
    });

    it("ignores containers named docktor-proxy-nginx and docktor-proxy-acme when checking for port conflicts", async () => {
        const docker = createMockDocker([
            {Id: "c1", Names: [`/${NGINX_PROXY_CONTAINER_NAME}`], State: "running", Ports: [{PublicPort: 80}]},
            {Id: "c2", Names: [`/${ACME_COMPANION_CONTAINER_NAME}`], State: "running", Ports: [{PublicPort: 443}]},
        ]);
        const {service} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs(""),
            createMockStackService(),
            createMockSettings(),
            docker,
        );

        await expect(service.deployProxyStack()).resolves.not.toThrow();
    });

    it("does not call listContainers/assertHostPortsFree and creates no second row when the docktor-proxy stack already exists", async () => {
        const stackRepo = createMockStackRepo();
        stackRepo.findById.mockResolvedValue({id: PROXY_STACK_ID, status: "RUNNING", isProtected: true});
        const fs = createFakeFs("");
        const stackService = createMockStackService();
        const docker = createMockDocker();
        const {service} = buildService(createFakeProxyRepo(), stackRepo, fs, stackService, createMockSettings(), docker);

        await service.deployProxyStack();

        expect(docker.listContainers).not.toHaveBeenCalled();
        expect(stackRepo.create).not.toHaveBeenCalled();
        expect(fs.writeCompose).toHaveBeenCalledWith(PROXY_STACK_ID, expect.stringContaining("nginx-proxy"));
        expect(stackService.deployStack).toHaveBeenCalledWith(PROXY_STACK_ID);
    });

    it("throws BadRequestError whose message contains the real deployStack errorMessage verbatim when deployStack fails", async () => {
        const stackService = createMockStackService();
        stackService.deployStack.mockResolvedValue({success: false, errorMessage: "bind: address already in use"});
        const {service} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs(""),
            stackService,
            createMockSettings(),
            createMockDocker(),
        );

        await expect(service.deployProxyStack()).rejects.toThrow(/bind: address already in use/);
    });
});

describe("ProxyService.getProxyStackState", () => {
    it("returns deployed: false and status: null when the proxy stack does not exist", async () => {
        const {service} = buildService(
            createFakeProxyRepo(),
            createMockStackRepo(),
            createFakeFs(""),
            createMockStackService(),
            createMockSettings({acmeEmail: "admin@example.com", showInDashboard: true}),
        );

        const result = await service.getProxyStackState();

        expect(result).toEqual({
            deployed: false,
            status: null,
            acmeEmail: "admin@example.com",
            showInDashboard: true,
        });
    });

    it("returns deployed: true and the Stack row's status when the proxy stack exists", async () => {
        const stackRepo = createMockStackRepo();
        stackRepo.findById.mockResolvedValue({id: PROXY_STACK_ID, status: "RUNNING", isProtected: true});
        const {service} = buildService(
            createFakeProxyRepo(),
            stackRepo,
            createFakeFs(""),
            createMockStackService(),
            createMockSettings({acmeEmail: "admin@example.com", showInDashboard: false}),
        );

        const result = await service.getProxyStackState();

        expect(result).toEqual({
            deployed: true,
            status: "RUNNING",
            acmeEmail: "admin@example.com",
            showInDashboard: false,
        });
    });
});

describe("ProxyService.updateProxySettingsAndSync (PRXY-03)", () => {
    it("re-renders and redeploys when acmeEmail changed and the proxy stack exists", async () => {
        const stackRepo = createMockStackRepo();
        stackRepo.findById.mockResolvedValue({id: PROXY_STACK_ID, status: "RUNNING", isProtected: true});
        stackRepo.exists.mockResolvedValue(true);
        const settings = createMockSettings({acmeEmail: "old@example.com"});
        settings.getProxySettings
            .mockResolvedValueOnce({acmeEmail: "old@example.com", showInDashboard: false})
            .mockResolvedValueOnce({acmeEmail: "new@example.com", showInDashboard: false});
        const fs = createFakeFs("");
        const stackService = createMockStackService();
        const {service} = buildService(createFakeProxyRepo(), stackRepo, fs, stackService, settings);

        await service.updateProxySettingsAndSync({acmeEmail: "new@example.com"});

        expect(settings.updateProxySettings).toHaveBeenCalledWith({acmeEmail: "new@example.com"});
        expect(fs.writeCompose).toHaveBeenCalledWith(PROXY_STACK_ID, expect.stringContaining("nginx-proxy"));
        expect(stackService.deployStack).toHaveBeenCalledWith(PROXY_STACK_ID);
    });

    it("does not redeploy when acmeEmail is unchanged", async () => {
        const stackRepo = createMockStackRepo();
        stackRepo.findById.mockResolvedValue({id: PROXY_STACK_ID, status: "RUNNING", isProtected: true});
        const settings = createMockSettings({acmeEmail: "same@example.com"});
        const fs = createFakeFs("");
        const stackService = createMockStackService();
        const {service} = buildService(createFakeProxyRepo(), stackRepo, fs, stackService, settings);

        await service.updateProxySettingsAndSync({acmeEmail: "same@example.com", showInDashboard: true});

        expect(settings.updateProxySettings).toHaveBeenCalledWith({acmeEmail: "same@example.com", showInDashboard: true});
        expect(fs.writeCompose).not.toHaveBeenCalled();
        expect(stackService.deployStack).not.toHaveBeenCalled();
    });

    it("does not redeploy when acmeEmail changed but the proxy stack does not exist yet", async () => {
        const stackRepo = createMockStackRepo();
        stackRepo.findById.mockResolvedValue(null);
        stackRepo.exists.mockResolvedValue(false);
        const settings = createMockSettings({acmeEmail: "old@example.com"});
        const fs = createFakeFs("");
        const stackService = createMockStackService();
        const {service} = buildService(createFakeProxyRepo(), stackRepo, fs, stackService, settings);

        await service.updateProxySettingsAndSync({acmeEmail: "new@example.com"});

        expect(fs.writeCompose).not.toHaveBeenCalled();
        expect(stackService.deployStack).not.toHaveBeenCalled();
    });
});

