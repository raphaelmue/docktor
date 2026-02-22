import {test, expect, type Page} from "@playwright/test";

const mockUser = {id: "1", name: "E2E Tester", email: "test@example.com"};
const mockSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

const mockStacks = [
    {
        id: "my-app",
        displayName: "My App",
        description: "A test application",
        hostPath: "/stacks/my-app",
        status: "RUNNING",
        configChanged: false,
        lastKnownHash: "abc123",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        services: [
            {
                id: "svc-1",
                stackId: "my-app",
                serviceName: "web",
                image: "nginx",
                imageTag: "latest",
                ports: JSON.stringify([{host: 8080, container: 80}]),
                volumes: null,
                containerId: null,
                containerState: null,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
            },
        ],
    },
    {
        id: "db-stack",
        displayName: "Database Stack",
        description: null,
        hostPath: "/stacks/db-stack",
        status: "STOPPED",
        configChanged: false,
        lastKnownHash: "def456",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        services: [],
    },
];

const mockStackDetail = {
    ...mockStacks[0],
    deployments: [
        {
            id: "dep-1",
            composeHash: "abc123",
            deployedAt: "2026-01-01T12:00:00Z",
            success: true,
            errorMessage: null,
        },
    ],
    statusLogs: [
        {
            id: "log-1",
            fromStatus: null,
            toStatus: "DRAFT",
            message: "Stack created",
            createdAt: "2026-01-01T00:00:00Z",
        },
        {
            id: "log-2",
            fromStatus: "DRAFT",
            toStatus: "RUNNING",
            message: "Deployment started",
            createdAt: "2026-01-01T12:00:00Z",
        },
    ],
};

/** Mock authenticated session for all tests. */
async function mockAuthenticated(page: Page) {
    await page.route("**/api/auth/get-session", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockSession)}),
    );
}

/** Mock the stacks list API. */
async function mockStacksList(page: Page, stacks = mockStacks) {
    await page.route("**/api/stacks", (route) => {
        if (route.request().method() === "GET") {
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(stacks)});
        }
        return route.continue();
    });
}

test.describe("Stacks", () => {
    test("stacks list page shows all stacks", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page);

        await page.goto("/stacks");

        await expect(page.getByRole("heading", {name: "Stacks"})).toBeVisible();
        await expect(page.getByText("My App")).toBeVisible();
        await expect(page.getByText("Database Stack")).toBeVisible();
        await expect(page.getByText("Running")).toBeVisible();
        await expect(page.getByText("Stopped")).toBeVisible();
    });

    test("stacks list page shows empty state", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page, []);

        await page.goto("/stacks");

        await expect(page.getByText("No stacks yet")).toBeVisible();
    });

    test("stacks list has create stack button that navigates", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page);

        await page.goto("/stacks");
        await page.getByRole("link", {name: /create stack/i}).click();

        await expect(page).toHaveURL("/stacks/create");
    });

    test("create stack page renders form", async ({page}) => {
        await mockAuthenticated(page);

        await page.goto("/stacks/create");

        await expect(page.getByRole("heading", {name: "Create Stack"})).toBeVisible();
        await expect(page.getByLabel(/name/i)).toBeVisible();
        await expect(page.getByLabel(/description/i)).toBeVisible();
        await expect(page.getByLabel(/docker compose file/i)).toBeVisible();
        await expect(page.getByRole("button", {name: /create stack/i})).toBeVisible();
        await expect(page.getByRole("button", {name: /cancel/i})).toBeVisible();
    });

    test("create stack submits and redirects to detail page", async ({page}) => {
        await mockAuthenticated(page);

        // Mock POST /api/stacks
        await page.route("**/api/stacks", (route) => {
            if (route.request().method() === "POST") {
                return route.fulfill({
                    status: 201,
                    contentType: "application/json",
                    body: JSON.stringify({id: "new-stack", displayName: "New Stack", services: []}),
                });
            }
            return route.continue();
        });

        // Mock the detail page APIs for redirect target
        await page.route("**/api/stacks/new-stack", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({...mockStackDetail, id: "new-stack", displayName: "New Stack", status: "DRAFT"}),
            }),
        );
        await page.route("**/api/stacks/new-stack/compose", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: "services:"})}),
        );
        await page.route("**/api/stacks/new-stack/env", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );

        await page.goto("/stacks/create");

        await page.getByLabel(/name/i).fill("New Stack");
        await page.getByLabel(/docker compose file/i).fill("services:\n  web:\n    image: nginx");
        await page.getByRole("button", {name: /create stack/i}).click();

        await expect(page).toHaveURL("/stacks/new-stack", {timeout: 10_000});
    });

    test("stack detail page shows stack info and services", async ({page}) => {
        await mockAuthenticated(page);
        await page.route("**/api/stacks/my-app", (route) => {
            if (route.request().url().endsWith("/compose")) return route.continue();
            if (route.request().url().endsWith("/env")) return route.continue();
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(mockStackDetail),
            });
        });
        await page.route("**/api/stacks/my-app/compose", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({content: "services:\n  web:\n    image: nginx:latest"}),
            }),
        );
        await page.route("**/api/stacks/my-app/env", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );

        await page.goto("/stacks/my-app");

        await expect(page.getByRole("heading", {name: "My App"})).toBeVisible();
        await expect(page.getByText("A test application")).toBeVisible();
        await expect(page.getByText("Running", {exact: true})).toBeVisible();

        // Services table
        await expect(page.getByText("web")).toBeVisible();
        await expect(page.getByText("nginx")).toBeVisible();

        // Tabs
        await expect(page.getByRole("tab", {name: "Overview"})).toBeVisible();
        await expect(page.getByRole("tab", {name: "Compose"})).toBeVisible();
        await expect(page.getByRole("tab", {name: "Environment"})).toBeVisible();
    });

    test("stack detail page shows deploy and stop buttons for running stack", async ({page}) => {
        await mockAuthenticated(page);
        await page.route("**/api/stacks/my-app", (route) => {
            if (route.request().url().endsWith("/compose") || route.request().url().endsWith("/env")) {
                return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})});
            }
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockStackDetail)});
        });
        await page.route("**/api/stacks/my-app/compose", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );
        await page.route("**/api/stacks/my-app/env", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );

        await page.goto("/stacks/my-app");

        await expect(page.getByRole("button", {name: /deploy/i})).toBeVisible();
        await expect(page.getByRole("button", {name: /stop/i})).toBeVisible();
        await expect(page.getByRole("button", {name: /restart/i})).toBeVisible();
    });

    test("stack detail compose tab shows editor", async ({page}) => {
        await mockAuthenticated(page);
        await page.route("**/api/stacks/my-app", (route) => {
            if (route.request().url().endsWith("/compose") || route.request().url().endsWith("/env")) {
                return route.continue();
            }
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockStackDetail)});
        });
        await page.route("**/api/stacks/my-app/compose", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({content: "services:\n  web:\n    image: nginx:latest"}),
            }),
        );
        await page.route("**/api/stacks/my-app/env", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: "FOO=bar"})}),
        );

        await page.goto("/stacks/my-app");

        await page.getByRole("tab", {name: "Compose"}).click();
        await expect(page.getByText("docker-compose.yml")).toBeVisible();

        await page.getByRole("tab", {name: "Environment"}).click();
        await expect(page.getByText(".env")).toBeVisible();
    });

    test("dashboard shows stack stats and recent stacks", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page);

        await page.goto("/");

        await expect(page.getByRole("heading", {name: "Dashboard"})).toBeVisible();
        await expect(page.getByText("Total Stacks")).toBeVisible();
        await expect(page.getByText("Running").first()).toBeVisible();
        await expect(page.getByText("My App")).toBeVisible();
    });

    test("breadcrumbs show correct navigation on detail page", async ({page}) => {
        await mockAuthenticated(page);
        await page.route("**/api/stacks/my-app", (route) => {
            if (route.request().url().endsWith("/compose") || route.request().url().endsWith("/env")) {
                return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})});
            }
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockStackDetail)});
        });
        await page.route("**/api/stacks/my-app/compose", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );
        await page.route("**/api/stacks/my-app/env", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({content: ""})}),
        );

        await page.goto("/stacks/my-app");

        // Breadcrumb should show "Stacks > My App"
        await expect(page.getByLabel("breadcrumb").getByRole("link", {name: "Stacks"})).toBeVisible();
        await expect(page.locator("[aria-current='page']", {hasText: "My App"})).toBeVisible();
    });

    test("stack detail shows 404 for non-existent stack", async ({page}) => {
        await mockAuthenticated(page);
        await page.route("**/api/stacks/non-existent", (route) => {
            if (route.request().url().endsWith("/compose") || route.request().url().endsWith("/env")) {
                return route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "Not found"})});
            }
            return route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "Not found"})});
        });
        await page.route("**/api/stacks/non-existent/compose", (route) =>
            route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "Not found"})}),
        );
        await page.route("**/api/stacks/non-existent/env", (route) =>
            route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "Not found"})}),
        );

        await page.goto("/stacks/non-existent");

        await expect(page.getByText(/not found/i)).toBeVisible();
    });
});
