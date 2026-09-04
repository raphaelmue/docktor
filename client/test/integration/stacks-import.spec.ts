import {expect, test} from "./fixtures";
import type {Page} from "@playwright/test";

// Entry point + page for the post-setup brownfield import flow (todo item
// M6) — BF-01 through BF-05 already have full wizard coverage in
// setup-wizard.spec.ts; this spec only proves the new authenticated path
// reachable from the Stacks page renders and is wired to the right
// endpoints.
const mockUser = {id: "1", name: "E2E Tester", email: "test@example.com"};
const mockSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

const greenStack = {
    path: "/home/user/app/docker-compose.yml",
    directory: "/home/user/app",
    compatibility: "green" as const,
    serviceCount: 1,
    namedVolumes: [] as string[],
    absolutePaths: [] as string[],
    inlineEnvVars: false,
    unsupportedFeatures: [] as string[],
};

async function mockAuthenticated(page: Page) {
    await page.route("**/api/auth/get-session", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockSession)}),
    );
}

async function mockStacksList(page: Page, stacks: unknown[] = []) {
    await page.route("**/api/stacks", (route) => {
        if (route.request().method() === "GET") {
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(stacks)});
        }
        return route.continue();
    });
}

test.describe("Stacks - Import Existing Stack entry point", () => {
    test("navigates from the Stacks page to /stacks/import and renders the scan form", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page);

        await page.goto("/stacks");
        await page.getByRole("link", {name: /import existing stack/i}).click();

        await expect(page).toHaveURL(/\/stacks\/import$/);
        await expect(page.getByRole("heading", {name: "Import Existing Stack"})).toBeVisible();
        await expect(page.getByLabel(/directories to scan/i)).toBeVisible();
        await expect(page.getByRole("button", {name: /scan/i})).toBeVisible();
    });

    test("import page scans /api/stacks/import/scan (not /api/setup/scan) and can adopt a discovered stack", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacksList(page);

        await page.route("**/api/stacks/import/scan", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({stacks: [greenStack], skippedDirectories: 0}),
            }),
        );
        await page.route("**/api/stacks/import/adopt", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({id: "app"})}),
        );

        await page.goto("/stacks/import");

        await page.getByLabel(/directories to scan/i).fill("/home/user");
        await page.getByRole("button", {name: /scan/i}).click();

        await expect(page.getByText("Discovered Stacks (1)")).toBeVisible();

        await page.getByRole("button", {name: "Adopt"}).click();

        await expect(page.getByText(/adopted successfully/i)).toBeVisible();
        await expect(page.getByText("Imported")).toBeVisible();
    });
});
