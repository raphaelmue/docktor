import {defineConfig, devices} from "@playwright/test";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "..");

export default defineConfig({
    testDir: "test/integration",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [["html", {outputFolder: ".test/integration/report"}]],
    outputDir: ".test/integration/tests",
    snapshotDir: ".test/integration/snapshots",
    use: {
        baseURL: "http://localhost:5173",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: {...devices["Desktop Chrome"]},
        },
    ],
    webServer: {
        command: "yarn workspace @docktor/client exec vite",
        cwd: monorepoRoot,
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
    },
});
