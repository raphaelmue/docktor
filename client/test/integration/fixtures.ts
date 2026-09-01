import {expect, test as base} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export {expect} from "@playwright/test";

const COVERAGE_DIR = path.join(process.cwd(), ".test/playwright-coverage");

/**
 * `webServer` in playwright.config.ts starts only the vite dev server on
 * :5173 — nothing starts the Fastify API on :3000, which is the origin
 * `client/src/lib/api.ts` hardcodes when `location.port === "5173"`. Every
 * spec is expected to be fully self-sufficient (stub every outbound
 * `**\/api/**` call via `page.route`), so any request that falls through
 * unstubbed must fail the test loudly and immediately rather than either
 * silently hitting whatever happens to be listening on :3000, or hanging.
 */
export const test = base.extend<{_coverage: void; _apiRouteGuard: void}>({
    _apiRouteGuard: [
        async ({page}, use) => {
            const unstubbed: string[] = [];

            // Registered before the test body runs, so any page.route("**/api/...")
            // a test adds for a specific endpoint takes priority (Playwright checks
            // the most-recently-registered matching handler first) and this
            // catch-all only ever sees requests no test-level stub claimed.
            await page.route("**/api/**", (route) => {
                unstubbed.push(`${route.request().method()} ${route.request().url()}`);
                return route.abort("failed");
            });

            // The global SSE stream (`useContainerEvents`, mounted by
            // useStack/useStacks/settings on nearly every authenticated page)
            // is infrastructure noise, not test-specific behaviour — stub it
            // centrally (registered after the catch-all, so it wins) rather
            // than making every spec think about it.
            await page.route("**/api/events", (route) =>
                route.fulfill({status: 200, contentType: "text/event-stream", body: ""}),
            );

            await use();

            if (unstubbed.length > 0) {
                throw new Error(
                    "Unstubbed API request(s) reached the network — every e2e spec must stub every " +
                        "outbound **/api/** call via page.route(), so a test can never silently be answered " +
                        `by whatever service the operator has bound to :3000:\n${unstubbed.join("\n")}`,
                );
            }
        },
        {auto: true},
    ],
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
