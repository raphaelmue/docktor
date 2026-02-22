import {test, expect, type Page} from "@playwright/test";

const mockSession = {
    session: {id: "sess-1", userId: "1"},
    user: {id: "1", name: "E2E Tester", email: "test@example.com"},
};

/** Minimal stack factory — only fields the DataTable/StackList render are needed. */
function makeStack(i: number) {
    return {
        id: `stack-${i}`,
        displayName: `Stack ${i}`,
        description: i === 1 ? "First stack description" : null,
        hostPath: `/stacks/stack-${i}`,
        status: "STOPPED",
        configChanged: false,
        lastKnownHash: `hash-${i}`,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        services: [],
    };
}

async function mockAuthenticated(page: Page) {
    await page.route("**/api/auth/get-session", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(mockSession),
        }),
    );
}

async function mockStacks(page: Page, stacks: ReturnType<typeof makeStack>[]) {
    await page.route("**/api/stacks", (route) => {
        if (route.request().method() === "GET") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(stacks),
            });
        }
        return route.continue();
    });
}

/**
 * Returns a locator for the four icon-only pagination navigation buttons
 * (First, Prev, Next, Last). Scoped via the "Rows per page" label which is
 * unique to the pagination section. Its grandparent div also contains the
 * nav button group.
 *
 * Button order: 0 = First, 1 = Prev, 2 = Next, 3 = Last
 */
function paginationNavButtons(page: Page) {
    // "Rows per page" <span> → parent <div> → grandparent flex container
    // that also holds the page counter and the nav button group
    return page.getByText("Rows per page").locator("xpath=../..").getByRole("button");
}

test.describe("DataTable", () => {
    // ─── Empty state ────────────────────────────────────────────────────────────

    test("shows the empty message when there is no data", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, []);

        await page.goto("/stacks");

        await expect(page.getByText("No stacks yet")).toBeVisible();
    });

    test("does not render a table when there is no data", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, []);

        await page.goto("/stacks");

        await expect(page.getByRole("table")).not.toBeVisible();
    });

    // ─── Column rendering ────────────────────────────────────────────────────────

    test("renders all column headers", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, [makeStack(1)]);

        await page.goto("/stacks");

        await expect(page.getByRole("columnheader", {name: "Name"})).toBeVisible();
        await expect(page.getByRole("columnheader", {name: "Status"})).toBeVisible();
        await expect(page.getByRole("columnheader", {name: "Services"})).toBeVisible();
        await expect(page.getByRole("columnheader", {name: "Created"})).toBeVisible();
    });

    // ─── Row rendering ───────────────────────────────────────────────────────────

    test("renders one row per data item", async ({page}) => {
        await mockAuthenticated(page);
        const stacks = [makeStack(1), makeStack(2), makeStack(3)];
        await mockStacks(page, stacks);

        await page.goto("/stacks");

        await expect(page.getByRole("row")).toHaveCount(stacks.length + 1); // +1 for header row
    });

    test("renders each item's display name in its row", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, [makeStack(1), makeStack(2)]);

        await page.goto("/stacks");

        await expect(page.getByText("Stack 1")).toBeVisible();
        await expect(page.getByText("Stack 2")).toBeVisible();
    });

    test("renders an item's optional description below its name", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, [makeStack(1)]); // makeStack(1) has a description

        await page.goto("/stacks");

        await expect(page.getByText("First stack description")).toBeVisible();
    });

    // ─── Row click navigation ────────────────────────────────────────────────────

    test("clicking a row navigates to the item's detail page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, [makeStack(1)]);

        // Stub the detail page APIs so the navigation can complete
        await page.route("**/api/stacks/stack-1", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    ...makeStack(1),
                    deployments: [],
                    statusLogs: [],
                }),
            }),
        );
        await page.route("**/api/stacks/stack-1/compose", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({content: ""}),
            }),
        );
        await page.route("**/api/stacks/stack-1/env", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({content: ""}),
            }),
        );

        await page.goto("/stacks");
        await page.getByRole("row", {name: /Stack 1/}).click();

        await expect(page).toHaveURL("/stacks/stack-1", {timeout: 10_000});
    });

    // ─── Pagination visibility ───────────────────────────────────────────────────

    test("hides pagination controls when all items fit on one page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 5}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        await expect(page.getByText("Rows per page")).not.toBeVisible();
    });

    test("shows pagination controls when items exceed the default page size", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        await expect(page.getByText("Rows per page")).toBeVisible();
        await expect(page.getByText("15 items")).toBeVisible();
        await expect(page.getByText("Page 1 of 2")).toBeVisible();
    });

    // ─── Pagination content ──────────────────────────────────────────────────────

    test("shows only the first page of items on initial load", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        // Default page size is 10; items 1–10 are visible, 11–15 are not
        await expect(page.getByText("Stack 1", {exact: true})).toBeVisible();
        await expect(page.getByText("Stack 10", {exact: true})).toBeVisible();
        await expect(page.getByText("Stack 11", {exact: true})).not.toBeVisible();
    });

    test("shows the correct items when navigating to a later page via URL", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks?page=2");

        await expect(page.getByText("Stack 11", {exact: true})).toBeVisible();
        await expect(page.getByText("Stack 15", {exact: true})).toBeVisible();
        await expect(page.getByText("Stack 1", {exact: true})).not.toBeVisible();
        await expect(page.getByText("Page 2 of 2")).toBeVisible();
    });

    // ─── Pagination navigation buttons ──────────────────────────────────────────

    test("first and previous buttons are disabled on the first page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        const navButtons = paginationNavButtons(page);
        await expect(navButtons.nth(0)).toBeDisabled(); // First page
        await expect(navButtons.nth(1)).toBeDisabled(); // Previous page
    });

    test("next and last buttons are enabled on the first page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        const navButtons = paginationNavButtons(page);
        await expect(navButtons.nth(2)).toBeEnabled(); // Next page
        await expect(navButtons.nth(3)).toBeEnabled(); // Last page
    });

    test("next and last buttons are disabled on the last page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks?page=2");

        const navButtons = paginationNavButtons(page);
        await expect(navButtons.nth(2)).toBeDisabled(); // Next page
        await expect(navButtons.nth(3)).toBeDisabled(); // Last page
    });

    test("clicking next advances to the next page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        await paginationNavButtons(page).nth(2).click(); // Next

        await expect(page.getByText("Page 2 of 2")).toBeVisible();
        await expect(page.getByText("Stack 11")).toBeVisible();
    });

    test("clicking previous goes back to the previous page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks?page=2");

        await paginationNavButtons(page).nth(1).click(); // Prev

        await expect(page.getByText("Page 1 of 2")).toBeVisible();
        await expect(page.getByText("Stack 1", {exact: true})).toBeVisible();
    });

    test("clicking last jumps to the final page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        await paginationNavButtons(page).nth(3).click(); // Last

        await expect(page.getByText("Page 2 of 2")).toBeVisible();
        await expect(page.getByText("Stack 15")).toBeVisible();
    });

    test("clicking first jumps back to page one", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks?page=2");

        await paginationNavButtons(page).nth(0).click(); // First

        await expect(page.getByText("Page 1 of 2")).toBeVisible();
        await expect(page.getByText("Stack 1", {exact: true})).toBeVisible();
    });

    // ─── Page size selector ──────────────────────────────────────────────────────

    test("changing page size to 25 shows all items on a single page", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 15}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks");

        await page.getByRole("combobox").click();
        await page.getByRole("option", {name: "25"}).click();

        // All 15 items visible, pagination hidden
        await expect(page.getByText("Stack 15")).toBeVisible();
        await expect(page.getByText("Rows per page")).not.toBeVisible();
    });

    test("changing page size resets to page 1", async ({page}) => {
        await mockAuthenticated(page);
        await mockStacks(page, Array.from({length: 30}, (_, i) => makeStack(i + 1)));

        await page.goto("/stacks?page=2");
        await expect(page.getByText("Page 2 of 3")).toBeVisible();

        await page.getByRole("combobox").click();
        await page.getByRole("option", {name: "25"}).click();

        await expect(page.getByText("Page 1 of 2")).toBeVisible();
    });
});
