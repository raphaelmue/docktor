import {test, expect} from "./fixtures";
import type {Page} from "@playwright/test";

const mockUser = {id: "1", name: "admin", email: "admin@example.com"};
const mockAuthSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

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

const yellowStack = {
    path: "/home/user/db/docker-compose.yml",
    directory: "/home/user/db",
    compatibility: "yellow" as const,
    serviceCount: 1,
    namedVolumes: ["pgdata"],
    absolutePaths: [] as string[],
    inlineEnvVars: false,
    unsupportedFeatures: [] as string[],
};

const redStack = {
    path: "/home/user/legacy/docker-compose.yml",
    directory: "/home/user/legacy",
    compatibility: "red" as const,
    serviceCount: 1,
    namedVolumes: [] as string[],
    absolutePaths: [] as string[],
    inlineEnvVars: false,
    unsupportedFeatures: ["configs"],
};

/** GET /api/setup/status — no admin user exists yet, wizard should render. */
async function mockSetupIncomplete(page: Page) {
    await page.route("**/api/setup/status", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({setupComplete: false})}),
    );
}

/** GET /api/setup/status — setup already finished. */
async function mockSetupComplete(page: Page) {
    await page.route("**/api/setup/status", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({setupComplete: true})}),
    );
}

/** POST /api/setup/step1 + the better-auth sign-in call triggered by auto-login. */
async function mockStep1(page: Page) {
    await page.route("**/api/setup/step1", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({user: mockUser, sessionToken: "tok-1"}),
        }),
    );
    await page.route("**/api/auth/sign-in/email", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockAuthSession)}),
    );
}

async function mockStep2(page: Page) {
    await page.route("**/api/setup/step2", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({success: true})}),
    );
}

/** Drives the wizard from a fresh /setup load through account + instance steps. */
async function completeAccountAndSettingsSteps(page: Page) {
    await mockSetupIncomplete(page);
    await mockStep1(page);
    await mockStep2(page);

    await page.goto("/setup");

    await page.getByLabel(/email/i).fill("admin@example.com");
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByRole("button", {name: "Next"}).click();
    await expect(page.getByRole("button", {name: /step 2: settings/i})).toHaveAttribute("aria-current", "step");

    // Instance name/timezone come pre-filled with sensible defaults — submit as-is.
    await page.getByRole("button", {name: "Next"}).click();
    await expect(page.getByRole("button", {name: /step 3: backup/i})).toHaveAttribute("aria-current", "step");
}

/** Continues from step 3 (Backup) through step 4 (Notifications) by skipping both. */
async function skipToBrownfieldStep(page: Page) {
    await page.getByRole("button", {name: "Skip"}).click(); // step 3 -> 4
    await expect(page.getByRole("button", {name: /step 4: notifications/i})).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", {name: "Skip"}).click(); // step 4 -> 5
    await expect(page.getByRole("button", {name: /step 5: import/i})).toHaveAttribute("aria-current", "step");
}

async function reachBrownfieldStep(page: Page) {
    await completeAccountAndSettingsSteps(page);
    await skipToBrownfieldStep(page);
}

test.describe("Setup Wizard", () => {
    test.describe("First-run wizard flow", () => {
        // WIZ-01: the server's first-run gate (app.ts) returns 503 + redirectTo
        // when no users exist, but no client-side code currently reads that
        // response and navigates to /setup — main.tsx / ProtectedRoute have no
        // such handling. This is a real feature gap uncovered while fixing
        // CR-05, not something this fixer should silently paper over with a
        // fabricated assertion. Left skipped (with this explanation, not a
        // blind TODO) until the redirect is actually implemented.
        test("should redirect to /setup when no users exist", async ({page}) => {
            test.skip(true, "Client has no handling of the 503 first-run-gate response yet (see app.ts) — not implemented");
        });

        test("should show 5-step stepper with Account as first step", async ({page}) => {
            // WIZ-07: Wizard UI
            await mockSetupIncomplete(page);
            await page.goto("/setup");

            await expect(page.getByRole("button", {name: /step 1: account/i})).toHaveAttribute("aria-current", "step");
            await expect(page.getByRole("button", {name: /step 2: settings/i})).toBeVisible();
            await expect(page.getByRole("button", {name: /step 3: backup/i})).toBeVisible();
            await expect(page.getByRole("button", {name: /step 4: notifications/i})).toBeVisible();
            await expect(page.getByRole("button", {name: /step 5: import/i})).toBeVisible();
        });

        test("should create admin account and auto-login on step 1 submit", async ({page}) => {
            // WIZ-02: Account creation
            await mockSetupIncomplete(page);
            await mockStep1(page);
            await page.goto("/setup");

            await page.getByLabel(/email/i).fill("admin@example.com");
            await page.getByLabel(/^password$/i).fill("password123");
            await page.getByRole("button", {name: "Next"}).click();

            await expect(page.getByRole("button", {name: /step 2: settings/i})).toHaveAttribute("aria-current", "step");
            await expect(page.getByText("Account created successfully")).toBeVisible();
        });

        test("should save instance settings on step 2 submit", async ({page}) => {
            // WIZ-03: Instance settings
            await mockSetupIncomplete(page);
            await mockStep1(page);
            await mockStep2(page);
            await page.goto("/setup");

            await page.getByLabel(/email/i).fill("admin@example.com");
            await page.getByLabel(/^password$/i).fill("password123");
            await page.getByRole("button", {name: "Next"}).click();
            await expect(page.getByRole("button", {name: /step 2: settings/i})).toHaveAttribute("aria-current", "step");

            await page.getByRole("button", {name: "Next"}).click();

            await expect(page.getByRole("button", {name: /step 3: backup/i})).toHaveAttribute("aria-current", "step");
            await expect(page.getByText("Settings saved")).toBeVisible();
        });

        test("should allow skipping optional steps 3-5", async ({page}) => {
            // WIZ-04, WIZ-05, WIZ-06: Optional steps
            await completeAccountAndSettingsSteps(page);
            await skipToBrownfieldStep(page);

            await expect(page.getByText("Import Existing Stacks")).toBeVisible();
        });

        test("should redirect to dashboard after wizard completion", async ({page}) => {
            // WIZ-07: Post-wizard redirect
            await reachBrownfieldStep(page);

            // Dashboard requires an authenticated session once navigated to.
            await page.route("**/api/auth/get-session", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockAuthSession)}),
            );

            await page.getByRole("button", {name: "Finish Setup"}).click();
            await expect(page).toHaveURL("/");
        });

        test("should show 'Setup Complete' if visiting /setup after completion", async ({page}) => {
            // WIZ-07: Re-visit prevention
            await mockSetupComplete(page);
            await page.goto("/setup");

            await expect(page.getByText("Setup has already been completed.")).toBeVisible();
            await expect(page.getByRole("link", {name: /go to dashboard/i})).toBeVisible();
        });
    });

    test.describe("Brownfield scan flow", () => {
        test("should scan directories and display discovered stacks", async ({page}) => {
            // BF-01: Scan filesystem
            await reachBrownfieldStep(page);

            await page.route("**/api/setup/scan", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({stacks: [greenStack], skippedDirectories: 0}),
                }),
            );

            await page.getByLabel(/directories to scan/i).fill("/home/user");
            await page.getByRole("button", {name: /scan/i}).click();

            await expect(page.getByText("Discovered Stacks (1)")).toBeVisible();
            await expect(page.getByText(greenStack.directory)).toBeVisible();
        });

        test("should display compatibility badges (green/yellow/red)", async ({page}) => {
            // BF-02: Compatibility assessment
            await reachBrownfieldStep(page);

            await page.route("**/api/setup/scan", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({stacks: [greenStack, yellowStack, redStack], skippedDirectories: 0}),
                }),
            );

            await page.getByLabel(/directories to scan/i).fill("/home/user");
            await page.getByRole("button", {name: /scan/i}).click();

            await expect(page.getByText("Ready")).toBeVisible();
            await expect(page.getByText("Migration Recommended")).toBeVisible();
            await expect(page.getByText("Unsupported")).toBeVisible();
        });

        test("should show skipped directories count when permission errors occur", async ({page}) => {
            // BF-01: Permission handling
            await reachBrownfieldStep(page);

            await page.route("**/api/setup/scan", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({stacks: [greenStack], skippedDirectories: 2}),
                }),
            );

            await page.getByLabel(/directories to scan/i).fill("/home/user, /root");
            await page.getByRole("button", {name: /scan/i}).click();

            await expect(page.getByText(/2 directories skipped \(permission denied\)/i)).toBeVisible();
        });
    });

    test.describe("Adopt in-place flow", () => {
        async function scanForGreenStack(page: Page) {
            await reachBrownfieldStep(page);
            await page.route("**/api/setup/scan", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({stacks: [greenStack], skippedDirectories: 0}),
                }),
            );
            await page.getByLabel(/directories to scan/i).fill("/home/user");
            await page.getByRole("button", {name: /scan/i}).click();
            await expect(page.getByText("Discovered Stacks (1)")).toBeVisible();
        }

        test("should adopt green stack with zero downtime", async ({page}) => {
            // BF-03: Adopt in-place
            await scanForGreenStack(page);

            await page.route("**/api/setup/adopt", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({id: "app"})}),
            );

            await page.getByRole("button", {name: "Adopt"}).click();

            await expect(page.getByText(/adopted successfully/i)).toBeVisible();
            await expect(page.getByText("Imported")).toBeVisible();
        });

        test("should navigate to the adopted stack via the success toast action", async ({page}) => {
            // BF-03: Post-adopt navigation (the shipped UI links to the stack
            // detail page directly via the toast action, not the dashboard list —
            // adapted from the original "post-adopt dashboard" description)
            await scanForGreenStack(page);

            await page.route("**/api/setup/adopt", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({id: "app"})}),
            );

            await page.getByRole("button", {name: "Adopt"}).click();
            await page.getByRole("button", {name: /view stack/i}).click();

            await expect(page).toHaveURL(/\/stacks\/app/);
        });
    });

    test.describe("Migration wizard flow", () => {
        async function scanForYellowStack(page: Page) {
            await reachBrownfieldStep(page);
            await page.route("**/api/setup/scan", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({stacks: [yellowStack], skippedDirectories: 0}),
                }),
            );
            await page.getByLabel(/directories to scan/i).fill("/home/user");
            await page.getByRole("button", {name: /scan/i}).click();
            await expect(page.getByText("Discovered Stacks (1)")).toBeVisible();
        }

        test("should open migration wizard when clicking Migrate button", async ({page}) => {
            // BF-04: Migration wizard entry
            await scanForYellowStack(page);

            await page.getByRole("button", {name: "Migrate"}).click();

            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(page.getByText("Select Data to Migrate")).toBeVisible();
        });

        test("should display volume selection checkboxes in step 1", async ({page}) => {
            // BF-04: Volume selection
            await scanForYellowStack(page);
            await page.getByRole("button", {name: "Migrate"}).click();

            await expect(page.getByRole("checkbox", {name: "pgdata"})).toBeChecked();
        });

        test("should show diff preview in step 2", async ({page}) => {
            // BF-04: Diff preview
            await scanForYellowStack(page);
            await page.getByRole("button", {name: "Migrate"}).click();

            await page.route("**/api/setup/migrate/preview", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({diff: "  services:\n-   pgdata:\n+   ./volumes/pgdata:", extractedEnv: ""}),
                }),
            );

            await page.getByRole("button", {name: "Next"}).click();

            await expect(page.getByText("Review Changes")).toBeVisible();
            await expect(page.getByText("Original")).toBeVisible();
            await expect(page.getByText("Migrated")).toBeVisible();
        });

        test("should start background migration on confirm", async ({page}) => {
            // BF-04: Background migration
            await scanForYellowStack(page);
            await page.getByRole("button", {name: "Migrate"}).click();

            await page.route("**/api/setup/migrate/preview", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({diff: "", extractedEnv: ""})}),
            );
            await page.getByRole("button", {name: "Next"}).click();
            await expect(page.getByText("Review Changes")).toBeVisible();

            await page.route("**/api/setup/migrate", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({success: true, stackId: "db", originalPath: yellowStack.directory}),
                }),
            );

            await page.getByRole("button", {name: "Confirm & Migrate"}).click();

            await expect(page.getByText(/migrating db/i)).toBeVisible();
        });

        test("should show success toast with link to stack on completion", async ({page}) => {
            // BF-04: Migration feedback
            await scanForYellowStack(page);
            await page.getByRole("button", {name: "Migrate"}).click();

            await page.route("**/api/setup/migrate/preview", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({diff: "", extractedEnv: ""})}),
            );
            await page.getByRole("button", {name: "Next"}).click();

            await page.route("**/api/setup/migrate", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({success: true, stackId: "db", originalPath: yellowStack.directory}),
                }),
            );
            await page.getByRole("button", {name: "Confirm & Migrate"}).click();

            await expect(page.getByText(/migration complete/i)).toBeVisible();
            await expect(page.getByRole("button", {name: /view stack/i})).toBeVisible();
        });

        test("should show error toast on migration failure", async ({page}) => {
            // BF-05: Rollback on failure — the service performs the rollback
            // server-side and reports it in `result.error`; the client surfaces
            // that message via a toast rather than a separate "Rollback complete"
            // element (adapted to the actual MigrationResult contract).
            await scanForYellowStack(page);
            await page.getByRole("button", {name: "Migrate"}).click();

            await page.route("**/api/setup/migrate/preview", (route) =>
                route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({diff: "", extractedEnv: ""})}),
            );
            await page.getByRole("button", {name: "Next"}).click();

            await page.route("**/api/setup/migrate", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        success: false,
                        error: "Migration failed: disk full. Rollback complete.",
                        originalPath: yellowStack.directory,
                    }),
                }),
            );
            await page.getByRole("button", {name: "Confirm & Migrate"}).click();

            await expect(page.getByText(/rollback complete/i)).toBeVisible();
        });
    });
});
