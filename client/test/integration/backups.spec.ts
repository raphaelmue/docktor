import {expect, test} from "./fixtures";
import type {Page} from "@playwright/test";

const mockUser = {id: "1", name: "E2E Tester", email: "test@example.com"};
const mockSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

const mockStack = {
    id: "test-stack",
    displayName: "Test Stack",
    description: "Stack for backup testing",
    hostPath: "/stacks/test-stack",
    status: "RUNNING",
    configChanged: false,
    lastKnownHash: "abc123",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    services: [
        {
            id: "svc-1",
            stackId: "test-stack",
            serviceName: "web",
            image: "nginx",
            imageTag: "latest",
            ports: JSON.stringify([{host: 8080, container: 80}]),
            volumes: JSON.stringify([{host: "/data/web", container: "/app"}]),
            containerId: null,
            containerState: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
        },
    ],
};

const mockBackupConfig = {
    schedule: "0 2 * * *",
    retention: {days: 7, weeks: 4, months: 6, years: 1},
    preHook: "docker compose stop",
    postHook: "docker compose start",
};

const mockBackups = [
    {
        id: "backup-1",
        stackId: "test-stack",
        trigger: "MANUAL",
        status: "SUCCESS",
        startedAt: "2026-03-19T10:00:00Z",
        completedAt: "2026-03-19T10:05:00Z",
        size: 1024000,
        snapshotId: "snap-123",
        errorMessage: null,
        logLines: 50,
    },
    {
        id: "backup-2",
        stackId: "test-stack",
        trigger: "SCHEDULED",
        status: "RUNNING",
        startedAt: "2026-03-19T11:00:00Z",
        completedAt: null,
        size: null,
        snapshotId: null,
        errorMessage: null,
        logLines: 25,
    },
];

const mockSnapshots = [
    {
        id: "snap-123",
        time: "2026-03-19T10:00:00Z",
        hostname: "docktor-host",
        paths: ["/stacks/test-stack"],
        tags: ["test-stack"],
    },
    {
        id: "snap-456",
        time: "2026-03-18T10:00:00Z",
        hostname: "docktor-host",
        paths: ["/stacks/test-stack"],
        tags: ["test-stack"],
    },
];

const mockSettings = {
    repositoryType: "LOCAL",
    repositoryPath: "/backup/repo",
    repositoryPassword: "encrypted-password",
    sftpHost: null,
    sftpPort: null,
    sftpUser: null,
    sftpPath: null,
    s3Bucket: null,
    s3Region: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    defaults: {
        schedule: "0 3 * * *",
        retention: {days: 7, weeks: 4, months: 6, years: 1},
    },
};

async function mockApiRoutes(page: Page) {
    await page.route("**/api/auth/session", async (route) => {
        await route.fulfill({json: mockSession});
    });

    await page.route("**/api/stacks/test-stack", async (route) => {
        await route.fulfill({json: mockStack});
    });

    await page.route("**/api/stacks/test-stack/backups/config", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackupConfig});
        } else if (route.request().method() === "PUT") {
            await route.fulfill({json: {...mockBackupConfig, ...JSON.parse(route.request().postData() || "{}")}});
        }
    });

    await page.route("**/api/stacks/test-stack/backups", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackups});
        } else if (route.request().method() === "POST") {
            await route.fulfill({json: {id: "backup-new", ...mockBackups[1]}});
        }
    });

    await page.route("**/api/stacks/test-stack/snapshots", async (route) => {
        await route.fulfill({json: mockSnapshots});
    });

    await page.route("**/api/settings/backups", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockSettings});
        } else if (route.request().method() === "PUT") {
            await route.fulfill({json: {...mockSettings, ...JSON.parse(route.request().postData() || "{}")}});
        }
    });
}

test.describe("Backup UI", () => {
    test.beforeEach(async ({page}) => {
        await mockApiRoutes(page);
    });

    test("displays stack actions dropdown with backup option", async ({page}) => {
        await page.goto("/stacks/test-stack");

        // Wait for page to load
        await expect(page.getByText("Test Stack")).toBeVisible();

        // Find and click the dropdown trigger (ellipsis button)
        const dropdownTrigger = page.locator('button[aria-haspopup="menu"]').filter({hasText: /⋯|•••/});
        await dropdownTrigger.click();

        // Verify dropdown menu items
        await expect(page.getByRole("menuitem", {name: /stop/i})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: /restart/i})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: /update images/i})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: /backup now/i})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: /delete/i})).toBeVisible();
    });

    test("displays Backups tab with three sections", async ({page}) => {
        await page.goto("/stacks/test-stack");

        // Click Backups tab
        await page.getByRole("tab", {name: /backups/i}).click();

        // Verify three main sections are visible
        await expect(page.getByText(/backup configuration/i)).toBeVisible();
        await expect(page.getByText(/backup history/i)).toBeVisible();
        await expect(page.getByText(/snapshots/i)).toBeVisible();
    });

    test("shows backup configuration form with schedule and retention", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Verify schedule field shows the cron expression
        await expect(page.locator('input[value="0 2 * * *"]')).toBeVisible();

        // Verify pre/post hook fields
        await expect(page.locator('input[value="docker compose stop"]')).toBeVisible();
        await expect(page.locator('input[value="docker compose start"]')).toBeVisible();

        // Verify "Backup Now" button in card header
        const backupNowBtn = page.getByRole("button", {name: /backup now/i}).first();
        await expect(backupNowBtn).toBeVisible();
    });

    test("displays backup history table with status badges", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Wait for backup history to load
        await expect(page.getByText(/SUCCESS/i)).toBeVisible();
        await expect(page.getByText(/RUNNING/i)).toBeVisible();

        // Verify trigger types are displayed
        await expect(page.getByText(/MANUAL/i)).toBeVisible();
        await expect(page.getByText(/SCHEDULED/i)).toBeVisible();

        // Verify "View details" links exist
        const viewLinks = page.getByRole("link", {name: /view details/i});
        await expect(viewLinks.first()).toBeVisible();
    });

    test("displays snapshots section with restore buttons", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Wait for snapshots to load
        await expect(page.getByText(/snap-123/i)).toBeVisible();
        await expect(page.getByText(/snap-456/i)).toBeVisible();

        // Verify restore buttons are present
        const restoreButtons = page.getByRole("button", {name: /restore/i});
        await expect(restoreButtons.first()).toBeVisible();

        // Verify refresh button exists
        await expect(page.getByRole("button", {name: /refresh/i})).toBeVisible();
    });

    test("opens restore confirmation dialog with typed-name gate", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Wait for snapshots and click first restore button
        await page.waitForSelector('text=/snap-123/i');
        const restoreBtn = page.getByRole("button", {name: /restore/i}).first();
        await restoreBtn.click();

        // Verify dialog appears
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await expect(page.getByText(/type.*stack name/i)).toBeVisible();

        // Verify restore button is initially disabled
        const confirmBtn = page.getByRole("button", {name: /restore snapshot/i});
        await expect(confirmBtn).toBeDisabled();

        // Type incorrect stack name - button should stay disabled
        const nameInput = page.locator('input[placeholder*="stack name"]');
        await nameInput.fill("wrong-name");
        await expect(confirmBtn).toBeDisabled();

        // Type correct stack name - button should enable
        await nameInput.fill("test-stack");
        await expect(confirmBtn).toBeEnabled();

        // Verify destructive styling (red button)
        await expect(confirmBtn).toHaveClass(/destructive/i);
    });

    test("navigates to backup detail page and shows metadata", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Click "View details" link for first backup
        await page.getByRole("link", {name: /view details/i}).first().click();

        // Verify navigation to backup detail page
        await expect(page).toHaveURL(/\/stacks\/test-stack\/backups\/backup-1/);

        // Verify backup status badge is visible
        await expect(page.getByText(/SUCCESS/i)).toBeVisible();

        // Verify trigger type is displayed
        await expect(page.getByText(/MANUAL/i)).toBeVisible();
    });

    test("Settings Backup tab shows repository configuration", async ({page}) => {
        await page.goto("/settings");

        // Click Backup tab
        await page.getByRole("tab", {name: /backup/i}).click();

        // Verify Repository card is visible
        await expect(page.getByText(/repository configuration/i)).toBeVisible();

        // Verify repository type selector shows LOCAL
        await expect(page.getByText(/LOCAL/i)).toBeVisible();

        // Verify path field for local repository
        await expect(page.locator('input[value="/backup/repo"]')).toBeVisible();
    });

    test("Settings Backup tab shows conditional fields for SFTP", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Change repository type to SFTP
        const typeSelect = page.locator('button[role="combobox"]').first();
        await typeSelect.click();
        await page.getByRole("option", {name: /SFTP/i}).click();

        // Verify SFTP-specific fields appear
        await expect(page.getByLabel(/host/i)).toBeVisible();
        await expect(page.getByLabel(/port/i)).toBeVisible();
        await expect(page.getByLabel(/user/i)).toBeVisible();
        await expect(page.getByLabel(/path/i)).toBeVisible();

        // Verify S3 fields are NOT visible
        await expect(page.getByLabel(/bucket/i)).not.toBeVisible();
    });

    test("Settings Backup tab shows conditional fields for S3", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Change repository type to S3
        const typeSelect = page.locator('button[role="combobox"]').first();
        await typeSelect.click();
        await page.getByRole("option", {name: /S3/i}).click();

        // Verify S3-specific fields appear
        await expect(page.getByLabel(/bucket/i)).toBeVisible();
        await expect(page.getByLabel(/region/i)).toBeVisible();
        await expect(page.getByLabel(/access key/i)).toBeVisible();
        await expect(page.getByLabel(/secret key/i)).toBeVisible();

        // Verify SFTP fields are NOT visible
        await expect(page.getByLabel(/sftp host/i)).not.toBeVisible();
    });

    test("Settings Backup tab shows defaults card", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Verify Defaults card
        await expect(page.getByText(/default schedule/i)).toBeVisible();
        await expect(page.getByText(/default retention/i)).toBeVisible();

        // Verify default schedule value
        await expect(page.locator('input[value="0 3 * * *"]')).toBeVisible();
    });
});
