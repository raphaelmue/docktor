/**
 * Playwright global teardown — runs after all tests finish.
 *
 * When VITE_COVERAGE=true this script:
 *  1. Reads every per-test Istanbul JSON written by the coverage fixture
 *  2. Merges them into a single coverage map
 *  3. Generates an LCOV report to .test/playwright-coverage/lcov.info
 *  4. Uses lcov-result-merger to merge it with the Vitest unit-test
 *     coverage at .test/coverage/lcov.info
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {execSync} from "node:child_process";

// CJS modules must be loaded with require() in an ESM context — dynamic
// import() only exposes a `default` key for CJS packages, not named exports.
const require = createRequire(import.meta.url);

// ESM equivalent of __dirname — teardown lives at client/test/playwright-teardown.ts
// so one level up resolves to the client/ root
const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_DIR = path.join(CLIENT_ROOT, ".test/playwright-coverage");
const VITEST_LCOV = path.join(CLIENT_ROOT, ".test/coverage/lcov.info");
const MERGED_LCOV = path.join(CLIENT_ROOT, ".test/coverage/lcov.info");

export default async function teardown() {
    if (process.env.VITE_COVERAGE !== "true") return;

    if (!fs.existsSync(COVERAGE_DIR)) {
        console.log("[coverage] No Playwright coverage files found — skipping.");
        return;
    }

    const jsonFiles = fs.readdirSync(COVERAGE_DIR).filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) {
        console.log("[coverage] No Playwright coverage files found — skipping.");
        return;
    }

    const {createCoverageMap} = require("istanbul-lib-coverage") as typeof import("istanbul-lib-coverage");
    const libReport = require("istanbul-lib-report") as typeof import("istanbul-lib-report");
    const reports = require("istanbul-reports") as typeof import("istanbul-reports");

    // Merge all per-test coverage snapshots
    const map = createCoverageMap({});
    for (const file of jsonFiles) {
        const raw = JSON.parse(fs.readFileSync(path.join(COVERAGE_DIR, file), "utf-8"));
        map.merge(raw);
    }

    // Generate LCOV into the playwright-coverage directory
    const ctx = libReport.createContext({dir: COVERAGE_DIR, coverageMap: map});
    // @ts-ignore — istanbul-reports typings are loose
    reports.create("lcovonly").execute(ctx);

    const playwrightLcov = path.join(COVERAGE_DIR, "lcov.info");
    console.log(`[coverage] Playwright LCOV written to ${playwrightLcov}`);

    // Merge with Vitest coverage (if it exists)
    if (fs.existsSync(VITEST_LCOV)) {
        execSync(
            `npx lcov-result-merger '${playwrightLcov}' '${VITEST_LCOV}' '${MERGED_LCOV}'`,
            {stdio: "inherit"},
        );
        console.log(`[coverage] Merged LCOV written to ${MERGED_LCOV}`);
    } else {
        // No Vitest coverage yet — just copy the Playwright LCOV to the expected path
        fs.mkdirSync(path.dirname(MERGED_LCOV), {recursive: true});
        fs.copyFileSync(playwrightLcov, MERGED_LCOV);
        console.log(`[coverage] LCOV copied to ${MERGED_LCOV}`);
    }
}
