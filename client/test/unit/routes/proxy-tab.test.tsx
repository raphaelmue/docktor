import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProxyTab} from "@/routes/app/stacks/components/proxy-tab";
import {
    assignDomain,
    getProxyConfigs,
    getProxySettings,
    removeDomain,
    type ProxyConfig,
    type ProxyState,
} from "@/lib/proxy-api";
import {useProxyStatus} from "@/hooks/use-proxy-status";
import type {Service} from "@/lib/stacks-api";

// jsdom doesn't implement pointer capture — required for Radix Select
// interaction via userEvent, mirrors service-upgrade-dialog.test.tsx.
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

vi.mock("@/lib/proxy-api", () => ({
    getProxyConfigs: vi.fn(),
    getProxySettings: vi.fn(),
    assignDomain: vi.fn(),
    removeDomain: vi.fn(),
}));

vi.mock("@/hooks/use-proxy-status", () => ({
    useProxyStatus: vi.fn(),
}));

// Mirrors the pattern in stack-detail-page.test.tsx: resolve/reject the
// underlying promise and invoke sonner's success/error callbacks directly.
vi.mock("sonner", () => ({
    toast: {
        promise: vi.fn((promise: Promise<unknown>, opts: any) => {
            promise.then(
                (result) => {
                    if (typeof opts.success === "function") opts.success(result);
                },
                (err) => {
                    if (typeof opts.error === "function") opts.error(err);
                },
            );
            return promise.catch(() => {});
        }),
    },
}));

const mockGetProxyConfigs = vi.mocked(getProxyConfigs);
const mockGetProxySettings = vi.mocked(getProxySettings);
const mockAssignDomain = vi.mocked(assignDomain);
const mockRemoveDomain = vi.mocked(removeDomain);
const mockUseProxyStatus = vi.mocked(useProxyStatus);

function makeService(overrides: Partial<Service> = {}): Service {
    return {
        id: "svc-1",
        stackId: "my-app",
        serviceName: "web",
        image: "nginx",
        imageTag: "latest",
        ports: null,
        volumes: null,
        containerId: null,
        containerState: "running",
        healthStatus: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
    return {
        id: "cfg-1",
        stackId: "my-app",
        serviceName: "web",
        domain: "app.example.com",
        internalPort: 80,
        tlsEnabled: true,
        certStatus: "pending",
        certMessage: null,
        certCheckedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeState(overrides: Partial<ProxyState> = {}): ProxyState {
    return {
        deployed: true,
        status: "RUNNING",
        acmeEmail: "",
        showInDashboard: false,
        ...overrides,
    };
}

function renderTab(services: Service[] = [makeService()]) {
    return render(<ProxyTab stackId="my-app" services={services} />);
}

beforeEach(() => {
    mockGetProxyConfigs.mockReset();
    mockGetProxySettings.mockReset();
    mockAssignDomain.mockReset();
    mockRemoveDomain.mockReset();
    mockUseProxyStatus.mockReset();
    mockUseProxyStatus.mockReturnValue({statuses: {}});
});

describe("ProxyTab", () => {
    it("renders the gating state and no assign form when the proxy stack is not deployed", async () => {
        mockGetProxyConfigs.mockResolvedValue([]);
        mockGetProxySettings.mockResolvedValue(makeState({deployed: false, status: null}));

        renderTab();

        expect(await screen.findByText("Proxy stack not deployed")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Deploy the managed proxy stack in Settings before assigning domains to services.",
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", {name: "Go to Settings"})).toBeInTheDocument();
        expect(screen.queryByLabelText(/domain/i)).not.toBeInTheDocument();
    });

    it("renders the empty state when the proxy stack is deployed with no configs", async () => {
        mockGetProxyConfigs.mockResolvedValue([]);
        mockGetProxySettings.mockResolvedValue(makeState());

        renderTab();

        expect(await screen.findByText("No domains configured")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Assign a domain to a service below to make it available at a custom URL with automatic HTTPS.",
            ),
        ).toBeInTheDocument();
    });

    it("renders one table row per service, aggregating multiple domains into that row", async () => {
        mockGetProxyConfigs.mockResolvedValue([
            makeConfig({id: "cfg-1", domain: "a.example.com"}),
            makeConfig({id: "cfg-2", domain: "b.example.com"}),
        ]);
        mockGetProxySettings.mockResolvedValue(makeState());

        renderTab();

        await screen.findByText("a.example.com");
        expect(screen.getByText("b.example.com")).toBeInTheDocument();

        const rows = screen.getAllByRole("row");
        // 1 header row + 1 aggregated service row
        expect(rows).toHaveLength(2);
    });

    it("renders Secured/Cert pending/Cert failed for issued/pending/failed statuses", async () => {
        mockGetProxyConfigs.mockResolvedValue([
            makeConfig({id: "cfg-1", domain: "a.example.com", certStatus: "issued"}),
            makeConfig({id: "cfg-2", domain: "b.example.com", certStatus: "pending", serviceName: "api"}),
            makeConfig({id: "cfg-3", domain: "c.example.com", certStatus: "failed", serviceName: "db"}),
        ]);
        mockGetProxySettings.mockResolvedValue(makeState());

        renderTab([makeService(), makeService({id: "svc-2", serviceName: "api"}), makeService({id: "svc-3", serviceName: "db"})]);

        await screen.findByText("Secured");
        expect(screen.getByText("Cert pending")).toBeInTheDocument();
        expect(screen.getByText("Cert failed")).toBeInTheDocument();
    });

    it("prefers a live useProxyStatus entry over the fetched row's stored certStatus", async () => {
        mockGetProxyConfigs.mockResolvedValue([makeConfig({id: "cfg-1", certStatus: "pending"})]);
        mockGetProxySettings.mockResolvedValue(makeState());
        mockUseProxyStatus.mockReturnValue({statuses: {"cfg-1": {status: "issued"}}});

        renderTab();

        expect(await screen.findByText("Secured")).toBeInTheDocument();
        expect(screen.queryByText("Cert pending")).not.toBeInTheDocument();
    });

    it("opens a confirmation dialog with the D-08 copy and only removes after confirming", async () => {
        mockGetProxyConfigs.mockResolvedValue([makeConfig({id: "cfg-1", domain: "app.example.com", serviceName: "web"})]);
        mockGetProxySettings.mockResolvedValue(makeState());
        mockRemoveDomain.mockResolvedValue(undefined);
        const user = userEvent.setup();

        renderTab();
        await screen.findByText("app.example.com");

        await user.click(screen.getByRole("button", {name: /remove app\.example\.com/i}));

        expect(
            await screen.findByText(
                "Remove app.example.com from web? The service will be redeployed without this domain's routing and TLS configuration.",
            ),
        ).toBeInTheDocument();
        expect(mockRemoveDomain).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", {name: "Remove"}));

        await waitFor(() => expect(mockRemoveDomain).toHaveBeenCalledWith("cfg-1"));
    });

    it("does not call removeDomain when the confirmation dialog is cancelled", async () => {
        mockGetProxyConfigs.mockResolvedValue([makeConfig({id: "cfg-1", domain: "app.example.com"})]);
        mockGetProxySettings.mockResolvedValue(makeState());
        const user = userEvent.setup();

        renderTab();
        await screen.findByText("app.example.com");

        await user.click(screen.getByRole("button", {name: /remove app\.example\.com/i}));
        await screen.findByRole("button", {name: "Cancel"});
        await user.click(screen.getByRole("button", {name: "Cancel"}));

        expect(mockRemoveDomain).not.toHaveBeenCalled();
    });

    it("leaves assignDomain uncalled and shows a validation message for an invalid domain", async () => {
        mockGetProxyConfigs.mockResolvedValue([]);
        mockGetProxySettings.mockResolvedValue(makeState());
        const user = userEvent.setup();

        renderTab();
        await screen.findByText("No domains configured");

        await user.type(screen.getByLabelText(/^domain$/i), "not a domain");
        await user.click(screen.getByRole("button", {name: "Assign Domain"}));

        expect(await screen.findByText(/valid hostname/i)).toBeInTheDocument();
        expect(mockAssignDomain).not.toHaveBeenCalled();
    });

    it("assigns a domain and reloads the list on success", async () => {
        mockGetProxyConfigs
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([makeConfig({id: "cfg-new", domain: "new.example.com"})]);
        mockGetProxySettings.mockResolvedValue(makeState());
        mockAssignDomain.mockResolvedValue(makeConfig({id: "cfg-new", domain: "new.example.com"}));
        const user = userEvent.setup();

        renderTab();
        await screen.findByText("No domains configured");

        await user.type(screen.getByLabelText(/^domain$/i), "new.example.com");
        await user.click(screen.getByRole("button", {name: "Assign Domain"}));

        await waitFor(() => expect(mockAssignDomain).toHaveBeenCalledWith("my-app", "web", expect.objectContaining({
            domain: "new.example.com",
        })));
        expect(await screen.findByText("new.example.com")).toBeInTheDocument();
    });

    it("renders the D-13 warning when the selected service already publishes a host port", async () => {
        mockGetProxyConfigs.mockResolvedValue([]);
        mockGetProxySettings.mockResolvedValue(makeState());

        renderTab([makeService({ports: JSON.stringify([{host: 8080, container: 80}])})]);

        expect(
            await screen.findByText(
                "This service already publishes port 8080 directly to the host. Enabling the proxy will not remove that binding — both will remain active.",
            ),
        ).toBeInTheDocument();
    });
});
