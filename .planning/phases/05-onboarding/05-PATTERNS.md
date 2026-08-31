# Phase 5 (Gap Closure): First-Run Redirect Wiring - Pattern Map

**Mapped:** 2026-08-31
**Scope:** Gap closure for 05-VERIFICATION.md Gap #1 — client never redirects an unauthenticated first-boot visitor to `/setup`
**Files analyzed:** 3 (1 modified, 0-2 optional new files)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `client/src/main.tsx` (`ProtectedRoute` component) | component (route guard) | request-response (calls setup-status endpoint before render decision) | `client/src/routes/setup.tsx` (`loadSetupStatus` + `statusError`/`loading` state machine) | role-match (both are "check server state before deciding what to render") |
| `client/test/integration/setup-wizard.spec.ts` (un-skip test at line ~114) | test | request-response (Playwright E2E) | same file, other passing tests in `Setup Wizard` describe block (e.g. "should show 5-step stepper...") | exact (same file, same describe block, same mocking helpers) |

No new files are required — this gap is closed entirely inside `client/src/main.tsx` (plus un-skipping the existing test). `client/src/lib/setup-api.ts` already exports `checkSetupStatus()`; no API client changes needed.

## Pattern Assignments

### `client/src/main.tsx` — `ProtectedRoute` (component, request-response)

**Analog:** `client/src/routes/setup.tsx` (status-check-before-render pattern) + `client/src/lib/api.ts` (`ApiError` shape) + `server/src/app.ts` (503 response contract)

**Current buggy code** (`client/src/main.tsx:18-34`):
```typescript
function ProtectedRoute({children}: Readonly<{children: React.ReactNode}>) {
    const {data: session, isPending} = useSession();

    if (isPending) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
```
This falls back to `/login` unconditionally when there is no session — it never asks the server whether setup is complete.

**Server contract to consume** (`server/src/app.ts:62-86`):
```typescript
app.addHook("onRequest", async (request, reply) => {
    if (
        request.url.startsWith("/api/setup/") ||
        request.url === "/api/setup" ||
        request.url.startsWith("/api/auth/") ||
        request.url === "/setup" ||
        !request.url.startsWith("/api/")
    ) {
        return;
    }
    const userCount = await prisma.user.count();
    if (userCount === 0) {
        return reply.status(503).send({
            error: "Setup required",
            redirectTo: "/setup",
        });
    }
});
```
Every unmatched `/api/*` route returns `503 {error, redirectTo: "/setup"}` when zero users exist. `GET /api/setup/status` itself is explicitly exempted from this gate (it lives under `/api/setup/`) and returns `{setupComplete: boolean}` unconditionally — this is the correct endpoint for `ProtectedRoute` to call directly, rather than parsing a 503 off some other request.

**Existing client-side status-check pattern to copy** (`client/src/routes/setup.tsx:31-47`):
```typescript
const [loading, setLoading] = useState(true);
const [setupComplete, setSetupComplete] = useState(false);
const [statusError, setStatusError] = useState(false);

const loadSetupStatus = () => {
    setLoading(true);
    setStatusError(false);
    checkSetupStatus()
        .then((status) => {
            setSetupComplete(status.setupComplete);
            setLoading(false);
        })
        .catch(() => {
            setStatusError(true);
            setLoading(false);
        });
};

useEffect(() => {
    loadSetupStatus();
}, []);
```
Note the WR-06 lesson embedded in this pattern (comment at `setup.tsx:21-25`): a failed status check must **not** silently fall through to "treat as incomplete" or "treat as complete" — that produces wrong redirects on transient network blips. `ProtectedRoute` must preserve this distinction (loading / error / complete / incomplete are four distinct states, not two).

**setup-api.ts client already exported** (`client/src/lib/setup-api.ts:9-11,52-54`):
```typescript
export interface SetupStatus {
  setupComplete: boolean;
}

export function checkSetupStatus() {
  return apiFetch<SetupStatus>("/api/setup/status");
}
```
`ProtectedRoute` should import and call this directly — no new API client function needed.

**Recommended fix shape for `ProtectedRoute`** (combining the session check with the analog's status-check pattern; only `!session` branch changes):
```typescript
function ProtectedRoute({children}: Readonly<{children: React.ReactNode}>) {
    const {data: session, isPending} = useSession();
    const [setupStatus, setSetupStatus] = useState<"loading" | "incomplete" | "complete" | "error">("loading");

    useEffect(() => {
        if (session || isPending) return; // only need to check when we're about to send the user to /login
        checkSetupStatus()
            .then((status) => setSetupStatus(status.setupComplete ? "complete" : "incomplete"))
            .catch(() => setSetupStatus("error"));
    }, [session, isPending]);

    if (isPending) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    if (!session) {
        if (setupStatus === "loading") {
            return (
                <div className="flex min-h-screen items-center justify-center">
                    <p className="text-gray-500">Loading...</p>
                </div>
            );
        }
        if (setupStatus === "incomplete") {
            return <Navigate to="/setup" replace />;
        }
        // "complete" or "error" (fail safe to existing /login behavior)
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
```
Rationale for the `"error"` branch falling back to `/login` rather than `/setup`: `checkSetupStatus()` failing (network blip, server down) must not risk exposing the account-creation wizard on an already-configured instance — this mirrors the WR-06 rationale already codified in `setup.tsx`.

---

**Error handling pattern** (from `client/src/lib/api.ts:1-10, 32-39`):
```typescript
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public fields?: Record<string, string>,
    ) {
        super(message);
        this.name = "ApiError";
    }
}
// apiFetch throws ApiError on !res.ok — checkSetupStatus()'s .catch() in the
// analog pattern above catches this generically without inspecting status,
// which is correct here since /api/setup/status is exempted from the 503
// gate and only fails on genuine network/server errors.
```

---

### `client/test/integration/setup-wizard.spec.ts` (test, request-response / E2E)

**Analog:** same file, sibling test `"should show 5-step stepper with Account as first step"` (lines ~120-129) — for the `mockSetupIncomplete(page)` helper pattern and `page.goto` + assertion structure.

**Current skipped test** (lines 104-115):
```typescript
test("should redirect to /setup when no users exist", async ({page}) => {
    test.skip(true, "Client has no handling of the 503 first-run-gate response yet (see app.ts) — not implemented");
});
```
Once `ProtectedRoute` is fixed, replace this body with a real assertion: mock `/api/setup/status` to return `{setupComplete: false}` (via whatever `mockSetupIncomplete`/route-mocking helper the file already defines above this test — grep the file for `mockSetupIncomplete` definition), navigate to `/` (or another protected route) as an unauthenticated visitor, and assert the browser ends up at `/setup` (e.g. `await expect(page).toHaveURL(/\/setup/)`).

## Shared Patterns

### Status-check-before-navigate (loading/error/complete/incomplete state machine)
**Source:** `client/src/routes/setup.tsx:18-47` (WR-06 fix)
**Apply to:** `client/src/main.tsx` `ProtectedRoute`
Never collapse a failed status check into either "treat as done" or "treat as not done" — always give errors their own branch, with a fail-safe default (here: fall back to existing `/login` behavior rather than risk exposing `/setup`'s account-creation step on a configured instance).

### apiFetch / ApiError
**Source:** `client/src/lib/api.ts:1-46`
**Apply to:** Any new fetch call added to `main.tsx` — use `checkSetupStatus()` (already wraps `apiFetch`), do not call `fetch` directly per CLAUDE.md "Frontend API Clients" rules.

### Server 503 gate contract (reference only, not to be re-implemented client-side)
**Source:** `server/src/app.ts:62-86`
`GET /api/setup/status` is exempted from the gate and always returns `200 {setupComplete: boolean}` — this is the single correct signal to poll from the client; do not attempt to parse the `redirectTo` field off a generic 503 caught elsewhere, since that 503 shape is only guaranteed for `/api/*` routes other than `/api/setup/*` and `/api/auth/*`.

## No Analog Found

None — the gap is narrowly scoped to one component in one file, with a directly applicable analog already in the same codebase.

## Metadata

**Analog search scope:** `client/src/main.tsx`, `client/src/routes/setup.tsx`, `client/src/lib/setup-api.ts`, `client/src/lib/api.ts`, `server/src/app.ts`, `client/test/integration/setup-wizard.spec.ts`
**Files scanned:** 6
**Pattern extraction date:** 2026-08-31
