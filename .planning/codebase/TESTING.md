# Testing Patterns

**Analysis Date:** 2026-03-10

## Test Framework

**Runner (unit + server integration):**
- Vitest 4.x
- Config: `server/vitest.config.ts`, `client/vitest.config.ts`

**Runner (client E2E/integration):**
- Playwright 1.x
- Config: `client/playwright.config.ts`

**Assertion Libraries:**
- Vitest built-in `expect` (all workspaces)
- `@testing-library/jest-dom` matchers extended via `client/test/setup.ts` (loaded via `setupFiles`)

**Mocking:**
- `vi.fn()`, `vi.mock()`, `vi.mocked()` from Vitest
- `page.route()` from Playwright for client E2E network interception

**Component rendering (client unit):**
- `@testing-library/react` — `render`, `screen`, `within`, `renderHook`, `waitFor`
- `@testing-library/user-event` — `userEvent.setup()` for simulated interactions

**Run Commands:**
```bash
# From repo root
yarn test                        # All workspaces, all test types
yarn test:unit                   # Unit tests only (client + server)
yarn test:integration            # Integration tests only (client Playwright)

# Per workspace
yarn workspace @docktor/server test              # All server tests (unit + integration)
yarn workspace @docktor/server test:unit         # Server unit tests only
yarn workspace @docktor/server test:integration  # Server integration (Testcontainers)
yarn workspace @docktor/client test              # Client unit tests (Vitest)
yarn workspace @docktor/client test:integration  # Client E2E (Playwright)
```

## Test File Organization

**Server tests — separate directory, mirrors `src/`:**
```
server/
├── src/
│   ├── application/stack-service.ts
│   ├── domain/compose-config.ts
│   ├── domain/stack-status-machine.ts
│   └── jobs/state-poller.ts
└── test/
    ├── unit/
    │   ├── application/stack-service.test.ts
    │   ├── domain/compose-config.test.ts
    │   ├── domain/stack-status-machine.test.ts
    │   ├── jobs/state-poller.test.ts
    │   └── lib/errors.test.ts
    │   └── lib/slugify.test.ts
    │   └── lib/stacks-dir.test.ts
    │   └── lib/compose-parser.test.ts
    └── integration/
        ├── setup.ts           # Testcontainers lifecycle helpers
        ├── stacks.test.ts
        └── settings.test.ts
```

**Client unit tests — separate directory, mirrors `src/`:**
```
client/
├── src/
│   ├── hooks/use-stacks.ts
│   ├── lib/api.ts
│   └── routes/auth/components/login-form.tsx
└── test/
    ├── setup.ts               # Extends jest-dom matchers
    ├── unit/
    │   ├── hooks/use-stacks.test.ts
    │   ├── hooks/use-stack.test.ts
    │   ├── lib/api.test.ts
    │   ├── lib/stacks-api.test.ts
    │   └── routes/auth/components/login-form.test.tsx
    └── integration/           # Playwright E2E
        ├── fixtures.ts        # Extended test object with coverage fixture
        ├── auth.spec.ts
        └── stacks.spec.ts
        └── components/data/table/data-table.spec.ts
```

**Naming conventions:**
- Vitest unit/integration: `*.test.ts` or `*.test.tsx`
- Playwright E2E: `*.spec.ts`
- Server test includes pattern: `test/unit/**/*.test.ts` and `test/integration/**/*.test.ts`
- Client test includes pattern: `test/unit/**/*.test.{ts,tsx}`

## Test Structure

**Vitest suite pattern:**
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("ModuleName", () => {
    // Shared state declared with let
    let service: StackService;
    let repo: ReturnType<typeof createMockRepo>;

    beforeEach(() => {
        // Fresh mocks before every test
        repo = createMockRepo();
        service = new StackService(repo as any, ...);
    });

    describe("methodName", () => {
        it("describes expected behaviour", async () => {
            // Arrange
            repo.exists.mockResolvedValue(false);
            // Act
            const result = await service.createStack({...});
            // Assert
            expect(result).toEqual({...});
            expect(repo.create).toHaveBeenCalled();
        });
    });
});
```

**Playwright E2E pattern:**
```typescript
import { test, expect } from "./fixtures";

test.describe("Feature", () => {
    test("scenario description", async ({ page }) => {
        // Network mock setup
        await page.route("**/api/auth/get-session", (route) =>
            route.fulfill({ status: 200, body: JSON.stringify(null) }),
        );
        // Navigation
        await page.goto("/login");
        // Assertions
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });
});
```

**Setup/teardown patterns:**
- Unit tests: `beforeEach` resets mocks, recreates subjects
- Server integration tests: `beforeAll` starts Testcontainer + builds app; `afterAll` cleans DB + stops container; `beforeEach` cleans DB + creates fresh test user
- Client E2E: Playwright `webServer` config auto-starts `vite` dev server; no manual setup needed

## Mocking

**Framework:** Vitest `vi.mock()` for module-level mocking

**Module mock pattern:**
```typescript
// Always declare vi.mock before importing the mocked module
vi.mock("@/lib/stacks-api", () => ({
    listStacks: vi.fn(),
}));

import { listStacks } from "@/lib/stacks-api";
const mockListStacks = vi.mocked(listStacks);

beforeEach(() => {
    mockListStacks.mockReset();
});
```

**Mock factory functions (server unit tests):**
Rather than using `vi.mock()` on modules, server unit tests create explicit mock objects via factory functions:
```typescript
function createMockRepo() {
    return {
        findByIdOrThrow: vi.fn(),
        findAll: vi.fn(),
        exists: vi.fn(),
        create: vi.fn(),
        // ... all methods stubbed
    };
}
// Used as:
service = new StackService(repo as any, fs as any, docker as any);
```

**Partial mocking (keep real implementation):**
```typescript
vi.mock("react-router", async () => {
    const actual = await vi.importActual("react-router");
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});
```

**Playwright network mocking:**
```typescript
await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: mockUser, session: {...} }),
    }),
);
```
Stateful mocking (toggling response based on test state) is done with closure variables:
```typescript
let hasSession = false;
await page.route("**/api/auth/get-session", (route) => {
    if (hasSession) return route.fulfill({...authenticated...});
    return route.fulfill({...unauthenticated...});
});
```

**What to mock:**
- External I/O at the boundary: API calls (`apiFetch`), Docker executor, filesystem, auth client
- Module-level dependencies injected via constructor (server) or module mock (client)

**What NOT to mock:**
- Pure domain logic (e.g., `createComposeConfig`, `canTransition`) — tested directly with real inputs
- Shared validation schemas — consumed directly in tests

## Fixtures and Factories

**Playwright fixture extension (`client/test/integration/fixtures.ts`):**
```typescript
export const test = base.extend<{ _coverage: void }>({
    _coverage: [
        async ({ page }, use) => {
            await use();
            // Collects Istanbul coverage from window.__coverage__ when VITE_COVERAGE=true
            const coverage = await page.evaluate(() => window.__coverage__).catch(() => null);
            if (coverage) {
                fs.writeFileSync(coverageFile, JSON.stringify(coverage));
            }
        },
        { auto: true },
    ],
});
```
All Playwright tests import `{ test, expect }` from `./fixtures` (not directly from `@playwright/test`).

**Test data factories (server unit tests):**
```typescript
function makeContainer(overrides: Partial<ContainerStatus> = {}): ContainerStatus {
    return {
        service: "web",
        state: "running",
        status: "Up 5 minutes",
        ports: "",
        health: "",
        exitCode: 0,
        ...overrides,
    };
}
```
Factory functions with `overrides` spread pattern are used to create minimal valid test data.

**Server integration test helpers (`server/test/integration/setup.ts`):**
- `startContainer()` — spins up `postgres:17` via Testcontainers, runs `prisma db push`, builds Fastify app
- `stopContainer()` — closes app, stops container
- `getApp()` — returns singleton `FastifyInstance` (lazy init)
- `cleanDatabase()` — deletes all rows in dependency order via PrismaClient
- `createTestUser()` — signs up via `/api/auth/sign-up/email`, extracts session cookie for authenticated requests

## Coverage

**Provider:** `@vitest/coverage-v8`

**Configuration (server `vitest.config.ts`):**
- Reports: `lcov` + `text`
- Output: `server/.test/coverage/`
- Includes: `src/**/*.ts`
- Excludes: `src/generated/**`

**Configuration (client `vitest.config.ts`):**
- Reports: `lcov` + `text`
- Output: `client/.test/coverage/`
- Includes: `src/**/*.{ts,tsx}`
- Excludes: `src/generated/**`, `src/components/ui/**` (shadcn generated components)

**Playwright coverage:**
- Istanbul-based coverage collected from `window.__coverage__` when `VITE_COVERAGE=true`
- Raw JSON files written to `client/.test/playwright-coverage/`
- Root `package.json` has `lcov-result-merger` for merging lcov reports

**Coverage target:** None enforced (no threshold configuration detected).

## Test Types

**Unit Tests (Vitest):**
- Scope: individual classes, functions, and React hooks/components in isolation
- All dependencies mocked (no real DB, no real Docker, no real HTTP)
- Location: `server/test/unit/` and `client/test/unit/`
- Timeout: default (no custom timeout configured)

**Integration Tests — Server (Vitest + Testcontainers):**
- Scope: full HTTP request → route → service → repository → real PostgreSQL
- Uses `@testcontainers/postgresql` to spin up a real `postgres:17` container per suite
- Uses Fastify's `app.inject()` for HTTP without opening a real TCP socket
- Each test suite: one container shared across all tests; DB cleaned between tests via `cleanDatabase()`
- Location: `server/test/integration/`
- Timeout: `testTimeout: 30_000`, `hookTimeout: 30_000`; `beforeAll` timeout passed as second arg: `60_000`

**Integration Tests — Client (Playwright + Chromium):**
- Scope: full browser rendering against the live Vite dev server with API routes mocked at network level
- Runs in headless Chromium only
- CI: `workers: 1`, `retries: 2`, `forbidOnly: true`
- Local: parallel workers, no retries, `reuseExistingServer: true`
- Location: `client/test/integration/`

## Common Patterns

**Async testing (Vitest):**
```typescript
// Waiting for state changes in hooks
await waitFor(() => expect(result.current.loading).toBe(false));

// Asserting rejected promises
await expect(service.createStack({...})).rejects.toThrow(ConflictError);

// Asserting resolved value
const result = await service.deployStack("my-app");
expect(result.success).toBe(true);
```

**Parametric tests with `it.each`:**
```typescript
it.each(ALL_ACTIONS)("returns true for all valid source statuses of %s", (action) => {
    for (const status of TRANSITIONS[action]) {
        expect(canTransition(status, action)).toBe(true);
    }
});
```

**Unreachable assertion pattern:**
```typescript
try {
    assertTransition("RUNNING", "DELETE");
    expect.unreachable("should have thrown");
} catch (err) {
    expect(err).toBeInstanceOf(TransitionError);
    // ...assert error properties
}
```

**Component rendering helper:**
```typescript
function renderLoginForm() {
    const { container } = render(
        <MemoryRouter>
            <LoginForm />
        </MemoryRouter>,
    );
    return within(container);
}
```
Wrapping render in a local helper function avoids repetition and scopes queries to the component under test.

**Error testing (Vitest):**
```typescript
// Class-based
await expect(service.createStack({...})).rejects.toThrow(ConflictError);

// Message-based
await expect(service.createStack({...})).rejects.toThrow(BadRequestError);
```

**Partial object matching:**
```typescript
expect(repo.recordDeployment).toHaveBeenCalledWith(
    expect.objectContaining({
        stackId: "my-app",
        success: true,
    }),
);
```

---

*Testing analysis: 2026-03-10*
