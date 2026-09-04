import {expect, test} from "./fixtures";
import type {Page} from "@playwright/test";

const mockUser = {id: "1", name: "E2E Tester", email: "test@example.com"};
const mockSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

const mockStack = {
    id: "test-stack",
    displayName: "Test Stack",
    description: "Stack for proxy testing",
    hostPath: "/stacks/test-stack",
    status: "RUNNING",
    configChanged: false,
    configError: null,
    lastKnownHash: "abc123",
    isProtected: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    services: [
        {
            id: "svc-1",
            stackId: "test-stack",
            serviceName: "web",
            image: "nginx",
            imageTag: "latest",
            ports: null,
            volumes: JSON.stringify([{host: "/data/web", container: "/app"}]),
            containerId: null,
            containerState: null,
            healthStatus: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
        },
    ],
    // [id].tsx dereferences these unconditionally (Overview tab's
    // Deployments/Status Log cards) — omitting them crashes the whole page.
    deployments: [] as unknown[],
    statusLogs: [] as unknown[],
};

function makeProxyConfig(overrides: Record<string, unknown> = {}) {
    return {
        id: "cfg-1",
        stackId: "test-stack",
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

function makeProxyState(overrides: Record<string, unknown> = {}) {
    return {
        deployed: true,
        status: "RUNNING",
        acmeEmail: "",
        showInDashboard: false,
        ...overrides,
    };
}

// Common stubs every "/stacks/test-stack/proxy" navigation needs regardless
// of the flow under test — mirrors backups.spec.ts's mockApiRoutes shape.
// [id].tsx's compose/env load effect fires on mount for every tab, not just
// the Compose/Environment tabs.
async function mockCommonRoutes(page: Page) {
    await page.route("**/api/auth/get-session", async (route) => {
        await route.fulfill({json: mockSession});
    });

    await page.route("**/api/stacks/test-stack", async (route) => {
        await route.fulfill({json: mockStack});
    });

    await page.route("**/api/stacks/test-stack/compose", async (route) => {
        await route.fulfill({json: {content: "services:\n  web:\n    image: nginx:latest"}});
    });
    await page.route("**/api/stacks/test-stack/env", async (route) => {
        await route.fulfill({json: {content: ""}});
    });
}

async function mockProxyConfigs(page: Page, configs: unknown[]) {
    await page.route("**/api/stacks/test-stack/proxy-configs", async (route) => {
        await route.fulfill({json: configs});
    });
}

async function mockProxySettings(page: Page, state: Record<string, unknown>) {
    await page.route("**/api/settings/proxy", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: makeProxyState(state)});
        }
    });
}

test.describe("Proxy UI", () => {
    test.beforeEach(async ({page}) => {
        await mockCommonRoutes(page);
    });

    test("gates the assign form behind the proxy stack's deployed state", async ({page}) => {
        await mockProxyConfigs(page, []);
        await mockProxySettings(page, {deployed: false, status: null});

        await page.goto("/stacks/test-stack/proxy");

        await expect(page.getByText("Proxy stack not deployed")).toBeVisible();
        await expect(page.getByRole("link", {name: "Go to Settings"})).toBeVisible();
        await expect(page.getByLabel(/^domain$/i)).not.toBeVisible();
    });

    test("shows the empty state and assigns a new domain", async ({page}) => {
        await mockProxyConfigs(page, []);
        await mockProxySettings(page, {deployed: true});

        let assignBody: Record<string, unknown> | null = null;
        await page.route("**/api/stacks/test-stack/services/web/proxy", async (route) => {
            if (route.request().method() === "POST") {
                assignBody = JSON.parse(route.request().postData() || "{}");
                await route.fulfill({status: 201, json: makeProxyConfig(assignBody ?? {})});
            }
        });

        await page.goto("/stacks/test-stack/proxy");

        await expect(page.getByText("No domains configured")).toBeVisible();

        await page.getByLabel(/^domain$/i).fill("new.example.com");
        await page.getByLabel(/internal port/i).fill("8080");

        await page.getByRole("button", {name: "Assign Domain"}).click();

        await expect.poll(() => assignBody).toEqual(
            expect.objectContaining({domain: "new.example.com", internalPort: 8080}),
        );
        await expect(page.getByText("Domain assigned")).toBeVisible();
    });

    test("renders both live cert statuses for two domains on one service row", async ({page}) => {
        await mockProxyConfigs(page, [
            makeProxyConfig({id: "cfg-1", domain: "a.example.com", certStatus: "issued"}),
            makeProxyConfig({id: "cfg-2", domain: "b.example.com", certStatus: "failed"}),
        ]);
        await mockProxySettings(page, {deployed: true});

        await page.goto("/stacks/test-stack/proxy");

        const row = page.getByRole("row").filter({hasText: "a.example.com"});
        await expect(row).toBeVisible();
        await expect(row.getByText("b.example.com")).toBeVisible();
        await expect(row.getByText("Secured")).toBeVisible();
        await expect(row.getByText("Cert failed")).toBeVisible();
    });

    test("removes a domain after confirming the destructive dialog", async ({page}) => {
        await mockProxyConfigs(page, [makeProxyConfig({id: "cfg-1", domain: "app.example.com"})]);
        await mockProxySettings(page, {deployed: true});

        let deleteCalled = false;
        await page.route("**/api/proxy-configs/cfg-1", async (route) => {
            if (route.request().method() === "DELETE") {
                deleteCalled = true;
                await route.fulfill({status: 204});
            }
        });

        await page.goto("/stacks/test-stack/proxy");
        await expect(page.getByText("app.example.com")).toBeVisible();

        await page.getByRole("button", {name: /remove app\.example\.com/i}).click();

        await expect(page.getByText(/redeployed without this domain's routing and TLS configuration/i)).toBeVisible();
        expect(deleteCalled).toBe(false);

        await page.getByRole("button", {name: "Remove"}).click();

        await expect.poll(() => deleteCalled).toBe(true);
        await expect(page.getByText("Domain removed")).toBeVisible();
    });
});
