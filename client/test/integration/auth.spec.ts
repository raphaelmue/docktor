import {test, expect, type Page} from "@playwright/test";

const mockUser = {id: "1", name: "E2E Tester", email: "test@example.com"};
const mockSession = {session: {id: "sess-1", userId: "1"}, user: mockUser};

/** Mock the session endpoint to return no active session (unauthenticated). */
async function mockNoSession(page: Page) {
    await page.route("**/api/auth/get-session", (route) =>
        route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(null)}),
    );
}

test.describe("Authentication", () => {
    test("login page renders with form elements", async ({page}) => {
        await mockNoSession(page);
        await page.goto("/login");

        await expect(page.getByText("Sign in to Docktor")).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByLabel(/password/i)).toBeVisible();
        await expect(page.getByRole("button", {name: /sign in/i})).toBeVisible();
    });

    test("signup page renders with form elements", async ({page}) => {
        await mockNoSession(page);
        await page.goto("/signup");

        await expect(page.getByText("Create an account")).toBeVisible();
        await expect(page.getByLabel(/name/i)).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByLabel(/password/i)).toBeVisible();
        await expect(page.getByRole("button", {name: /sign up/i})).toBeVisible();
    });

    test("protected route redirects unauthenticated user to login", async ({page}) => {
        await mockNoSession(page);
        await page.goto("/stacks");

        await expect(page).toHaveURL(/\/login/);
    });

    test("sign up creates account and redirects to dashboard", async ({page}) => {
        // Mock signup endpoint
        await page.route("**/api/auth/sign-up/email", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({user: mockUser, session: {id: "sess-1", userId: "1"}}),
            }),
        );

        // After signup, session check returns authenticated user
        await page.route("**/api/auth/get-session", (route) =>
            route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(mockSession)}),
        );

        await page.goto("/signup");

        await page.getByLabel(/name/i).fill("E2E Tester");
        await page.getByLabel(/email/i).fill("test@example.com");
        await page.getByLabel(/password/i).fill("TestPassword123!");
        await page.getByRole("button", {name: /sign up/i}).click();

        await expect(page).toHaveURL("/", {timeout: 10_000});
    });

    test("login with valid credentials redirects to dashboard", async ({page}) => {
        let hasSession = false;

        await page.route("**/api/auth/get-session", (route) => {
            if (hasSession) {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify(mockSession),
                });
            }
            return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(null)});
        });

        // Mock sign-in endpoint
        await page.route("**/api/auth/sign-in/email", (route) => {
            hasSession = true;
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({user: mockUser, session: {id: "sess-1", userId: "1"}}),
            });
        });

        await page.goto("/login");

        await page.getByLabel(/email/i).fill("test@example.com");
        await page.getByLabel(/password/i).fill("TestPassword123!");
        await page.getByRole("button", {name: /sign in/i}).click();

        await expect(page).toHaveURL("/", {timeout: 10_000});
    });

    test("login with invalid credentials shows error", async ({page}) => {
        await mockNoSession(page);

        // Mock failed sign-in — better-auth returns 401 for invalid credentials
        await page.route("**/api/auth/sign-in/email", (route) =>
            route.fulfill({
                status: 401,
                contentType: "application/json",
                body: JSON.stringify({message: "Invalid email or password"}),
            }),
        );

        await page.goto("/login");

        await page.getByLabel(/email/i).fill("wrong@example.com");
        await page.getByLabel(/password/i).fill("WrongPassword123!");
        await page.getByRole("button", {name: /sign in/i}).click();

        await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    });
});
