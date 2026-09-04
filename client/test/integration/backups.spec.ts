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
    // [id].tsx dereferences these unconditionally (Overview tab's
    // Deployments/Status Log cards) — omitting them crashes the whole page.
    deployments: [] as unknown[],
    statusLogs: [] as unknown[],
};

// Matches StackBackupConfig (client/src/lib/backups-api.ts) — both toggles
// default to false so the override fields (the ones tests assert on) render.
const mockBackupConfig = {
    useGlobalSchedule: false,
    schedule: "0 2 * * *",
    useGlobalRetention: false,
    retention: {keepDaily: 7, keepWeekly: 4, keepMonthly: 6},
    preHook: "docker compose stop",
    postHook: "docker compose start",
    globalSchedule: "0 3 * * *",
    globalRetention: {keepDaily: 7, keepWeekly: 4, keepMonthly: 12},
};

// Matches BackupRecord — statuses are IN_PROGRESS/COMPLETED/FAILED, not
// SUCCESS/RUNNING, and size lives on `sizeBytes` (string), not `size`.
const mockBackups = [
    {
        id: "backup-1",
        stackId: "test-stack",
        resticSnapshotId: "snap-123",
        trigger: "MANUAL",
        status: "COMPLETED",
        startedAt: "2026-03-19T10:00:00Z",
        completedAt: "2026-03-19T10:05:00Z",
        sizeBytes: "1024000",
        errorMessage: null,
        logLines: ["Backup completed successfully"],
        createdAt: "2026-03-19T10:00:00Z",
    },
    {
        id: "backup-2",
        stackId: "test-stack",
        resticSnapshotId: "",
        trigger: "SCHEDULED",
        status: "IN_PROGRESS",
        startedAt: "2026-03-19T11:00:00Z",
        completedAt: null,
        sizeBytes: null,
        errorMessage: null,
        logLines: [],
        createdAt: "2026-03-19T11:00:00Z",
    },
];

// Matches ResticSnapshot — the UI renders `short_id.slice(0, 8)`, not `id`.
const mockSnapshots = [
    {
        id: "snap-123",
        short_id: "snap-123",
        time: "2026-03-19T10:00:00Z",
        hostname: "docktor-host",
        paths: ["/stacks/test-stack"],
        tags: ["test-stack"],
    },
    {
        id: "snap-456",
        short_id: "snap-456",
        time: "2026-03-18T10:00:00Z",
        hostname: "docktor-host",
        paths: ["/stacks/test-stack"],
        tags: ["test-stack"],
    },
];

// Matches BackupSettings (repo-level) — field names have no "repository"
// prefix, and there is no sftpPort/s3Region; SFTP uses repoPath + sftpHost/
// sftpUser, S3 uses s3Endpoint/s3Bucket/s3AccessKey.
const mockBackupSettings = {
    repoType: "local" as const,
    repoPath: null,
    sftpHost: null,
    sftpUser: null,
    s3Endpoint: null,
    s3Bucket: null,
    s3AccessKey: null,
    hasPassword: true,
    hasSftpKey: false,
    hasS3SecretKey: false,
};

const mockResticStatus = {available: true, version: "0.17.0"};

// Matches BackupDefaults — a separate endpoint from BackupSettings, with its
// own RetentionPolicy shape (keepDaily/keepWeekly/keepMonthly, no "years").
const mockBackupDefaults = {
    defaultSchedule: "0 3 * * *",
    defaultRetention: {keepDaily: 7, keepWeekly: 4, keepMonthly: 12},
};

const mockGeneralSettings = {instanceName: "Docktor", baseUrl: "", timezone: "UTC"};
const mockSmtpSettings = {
    host: "",
    port: 587,
    encryption: "starttls" as const,
    username: "",
    hasPassword: false,
    from: "",
};
const mockNotificationTriggers = {
    stackError: true,
    diskWarning: true,
    diskThresholdPercent: 90,
    diskThresholdBytes: 0,
    backupFailure: true,
};

async function mockApiRoutes(page: Page) {
    await page.route("**/api/auth/get-session", async (route) => {
        await route.fulfill({json: mockSession});
    });

    await page.route("**/api/stacks/test-stack", async (route) => {
        await route.fulfill({json: mockStack});
    });

    await page.route("**/api/stacks/test-stack/events", async (route) => {
        await route.fulfill({json: []});
    });

    await page.route("**/api/stacks/test-stack/volume-warnings", async (route) => {
        await route.fulfill({json: {warnings: []}});
    });

    // The stack detail page's Compose/Environment tabs fetch on mount
    // regardless of which tab is active (see stacks.spec.ts's stack detail
    // tests for the same pattern).
    await page.route("**/api/stacks/test-stack/compose", async (route) => {
        await route.fulfill({json: {content: "services:\n  web:\n    image: nginx:latest"}});
    });
    await page.route("**/api/stacks/test-stack/env", async (route) => {
        await route.fulfill({json: {content: ""}});
    });

    await page.route("**/api/stacks/test-stack/backup-config", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackupConfig});
        } else if (route.request().method() === "PUT") {
            await route.fulfill({json: {...mockBackupConfig, ...JSON.parse(route.request().postData() || "{}")}});
        }
    });

    await page.route("**/api/stacks/test-stack/backup", async (route) => {
        if (route.request().method() === "POST") {
            await route.fulfill({json: {backupId: "backup-new"}});
        }
    });

    await page.route("**/api/stacks/test-stack/backups", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackups});
        }
    });

    await page.route("**/api/backups/backup-1", async (route) => {
        await route.fulfill({json: mockBackups[0]});
    });

    await page.route("**/api/stacks/test-stack/snapshots", async (route) => {
        await route.fulfill({json: mockSnapshots});
    });

    await page.route("**/api/settings/backup", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackupSettings});
        } else if (route.request().method() === "PUT") {
            await route.fulfill({json: {...mockBackupSettings, ...JSON.parse(route.request().postData() || "{}")}});
        }
    });

    await page.route("**/api/settings/backup/status", async (route) => {
        await route.fulfill({json: mockResticStatus});
    });

    await page.route("**/api/settings/backup-defaults", async (route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({json: mockBackupDefaults});
        } else if (route.request().method() === "PUT") {
            await route.fulfill({json: {...mockBackupDefaults, ...JSON.parse(route.request().postData() || "{}")}});
        }
    });

    // The Settings page mounts General/Notifications/Backup cards
    // simultaneously regardless of the active tab, so every "Settings Backup
    // tab" test needs these stubbed too, not just the backup-specific ones.
    await page.route("**/api/settings/general", async (route) => {
        await route.fulfill({json: mockGeneralSettings});
    });
    await page.route("**/api/settings/smtp", async (route) => {
        await route.fulfill({json: mockSmtpSettings});
    });
    await page.route("**/api/settings/notification-triggers", async (route) => {
        await route.fulfill({json: mockNotificationTriggers});
    });
    await page.route("**/api/notifications", async (route) => {
        await route.fulfill({json: []});
    });
}

test.describe("Backup UI", () => {
    test.beforeEach(async ({page}) => {
        await mockApiRoutes(page);
    });

    test("displays stack actions dropdown with backup option", async ({page}) => {
        await page.goto("/stacks/test-stack");

        // Wait for page to load
        await expect(page.getByRole("heading", {name: "Test Stack"})).toBeVisible();

        // Find and click the dropdown trigger (icon-only button, identified by
        // its aria-label rather than visible text).
        await page.getByRole("button", {name: "Stack actions"}).click();

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
        await expect(page.getByText("Backup Configuration")).toBeVisible();
        await expect(page.getByRole("heading", {name: "History"})).toBeVisible();
        await expect(page.getByRole("heading", {name: "Snapshots"})).toBeVisible();
    });

    test("shows backup configuration form with schedule and retention", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Verify schedule override field shows the cron expression
        // (useGlobalSchedule: false in the mock, so the override input renders)
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

        // Wait for backup history to load — status badge labels are
        // "Completed"/"In Progress" (BackupStatusBadge), not the raw enum.
        await expect(page.getByText("Completed", {exact: true})).toBeVisible();
        await expect(page.getByText("In Progress", {exact: true})).toBeVisible();

        // Verify trigger types are displayed
        await expect(page.getByText(/manual/i)).toBeVisible();
        await expect(page.getByText(/scheduled/i)).toBeVisible();

        // Verify "View details" links exist
        const viewLinks = page.getByRole("link", {name: /view details/i});
        await expect(viewLinks.first()).toBeVisible();
    });

    test("displays snapshots section with restore buttons", async ({page}) => {
        await page.goto("/stacks/test-stack");
        await page.getByRole("tab", {name: /backups/i}).click();

        // Wait for snapshots to load (rendered as short_id, truncated to 8 chars)
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
        await page.waitForSelector("text=/snap-123/i");
        const restoreBtn = page.getByRole("button", {name: /restore/i}).first();
        await restoreBtn.click();

        // Verify dialog appears
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await expect(page.getByText(/type\s+test stack\s+to confirm/i)).toBeVisible();

        // Verify restore button is initially disabled
        const confirmBtn = page.getByRole("button", {name: /restore snapshot/i});
        await expect(confirmBtn).toBeDisabled();

        // Type incorrect stack name - button should stay disabled
        const nameInput = page.locator('input[placeholder*="stack name"]');
        await nameInput.fill("wrong-name");
        await expect(confirmBtn).toBeDisabled();

        // Type correct stack name - button should enable
        await nameInput.fill("Test Stack");
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
        await expect(page.getByText("Completed", {exact: true})).toBeVisible();

        // Verify trigger type is displayed
        await expect(page.getByText(/manual/i)).toBeVisible();
    });

    test("Settings Backup tab shows repository configuration", async ({page}) => {
        await page.goto("/settings");

        // Click Backup tab
        await page.getByRole("tab", {name: /backup/i}).click();

        // Verify Repository card is visible
        await expect(page.getByText("Backup Repository")).toBeVisible();

        // Verify repository type selector shows Local
        await expect(page.getByText("Local", {exact: true})).toBeVisible();
    });

    test("Settings Backup tab shows conditional fields for SFTP", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Change repository type to SFTP
        const typeSelect = page.locator("#repoType");
        await typeSelect.click();
        await page.getByRole("option", {name: /SFTP/i}).click();

        // Verify SFTP-specific fields appear (there is no dedicated "port"
        // field in the real form — SFTP uses repoPath/host/username/key)
        await expect(page.getByLabel(/repository path/i)).toBeVisible();
        await expect(page.getByLabel(/host/i)).toBeVisible();
        await expect(page.getByLabel(/username/i)).toBeVisible();
        await expect(page.getByLabel(/private key/i)).toBeVisible();

        // Verify S3 fields are NOT visible
        await expect(page.getByLabel(/bucket/i)).not.toBeVisible();
    });

    test("Settings Backup tab shows conditional fields for S3", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Change repository type to S3
        const typeSelect = page.locator("#repoType");
        await typeSelect.click();
        await page.getByRole("option", {name: /S3-compatible/i}).click();

        // Verify S3-specific fields appear (there is no "region" field in the
        // real form — S3 uses endpoint/bucket/access key/secret key)
        await expect(page.getByLabel(/endpoint url/i)).toBeVisible();
        await expect(page.getByLabel(/bucket name/i)).toBeVisible();
        await expect(page.getByLabel(/access key id/i)).toBeVisible();
        await expect(page.getByLabel(/secret access key/i)).toBeVisible();

        // Verify SFTP fields are NOT visible
        await expect(page.getByLabel(/^host$/i)).not.toBeVisible();
    });

    test("Settings Backup tab shows defaults card", async ({page}) => {
        await page.goto("/settings");
        await page.getByRole("tab", {name: /backup/i}).click();

        // Verify Defaults card
        await expect(page.getByText("Default Backup Settings")).toBeVisible();
        await expect(page.getByLabel(/default schedule/i)).toBeVisible();
        await expect(page.getByLabel(/keep daily/i)).toBeVisible();
        await expect(page.getByLabel(/keep weekly/i)).toBeVisible();
        await expect(page.getByLabel(/keep monthly/i)).toBeVisible();

        // Verify default schedule value
        await expect(page.locator('input[value="0 3 * * *"]')).toBeVisible();
    });
});
