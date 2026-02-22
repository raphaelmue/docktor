import {test as base, expect} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export {expect} from "@playwright/test";

const COVERAGE_DIR = path.join(process.cwd(), ".test/playwright-coverage");

/**
 * Extends Playwright's `test` with an auto-fixture that collects Istanbul
 * coverage from `window.__coverage__` after every test when VITE_COVERAGE=true.
 */
export const test = base.extend<{_coverage: void}>({
    _coverage: [
        async ({page}, use) => {
            await use();

            if (process.env.VITE_COVERAGE !== "true") return;

            const coverage = await page
                .evaluate(() => (window as unknown as {__coverage__: unknown}).__coverage__)
                .catch(() => null);

            if (coverage) {
                fs.mkdirSync(COVERAGE_DIR, {recursive: true});
                const file = path.join(
                    COVERAGE_DIR,
                    `coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
                );
                fs.writeFileSync(file, JSON.stringify(coverage));
            }
        },
        {auto: true},
    ],
});
