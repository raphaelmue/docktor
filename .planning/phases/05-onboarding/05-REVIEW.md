---
phase: 05-onboarding
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - client/src/components/domain/auth/first-run-gate.tsx
  - client/src/hooks/use-setup-status.ts
  - client/src/main.tsx
  - client/test/integration/auth.spec.ts
  - client/test/integration/setup-wizard.spec.ts
  - client/test/unit/components/domain/auth/first-run-gate.test.tsx
  - client/test/unit/hooks/use-setup-status.test.ts
  - server/test/integration/setup-concurrency.test.ts
  - server/test/integration/setup.ts
  - server/test/unit/application/migration-service.test.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 05: Code Review Report (re-review — 05-09/05-10 gap closure)

**Reviewed:** 2026-08-31T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

This is a re-review scoped to the two gap-closure plans (05-09: wire `FirstRunGate` into the client router; 05-10: add missing rollback and TOCTOU-lock test coverage). The 05-09 change correctly closes the gap that the prior verification flagged — `/` (via `ProtectedRoute`) and `/login` both now consult `GET /api/setup/status` through `useSetupStatus`/`FirstRunGate` and redirect a first-boot visitor to `/setup`, with a documented fail-safe-to-`/login` behavior on a failed status check and a hardcoded (non-server-controlled) redirect target. The 05-10 tests are well-constructed: the WR-07 concurrency test correctly races two identical `POST /api/setup/step1` requests against a real Postgres container and asserts exactly one admin is created, and the BF-05 `MigrationService.migrate` unit test verifies the rollback path restores the original directory byte-for-byte, deletes the incomplete stack, and leaves no backup snapshot behind.

However, the client-side fix has a hole of the same shape as the bug it was closing: the `/signup` route is not wrapped in `FirstRunGate`, so an anonymous visitor who navigates directly to `/signup` on a zero-user instance can still create an account through better-auth's generic sign-up endpoint, bypassing both the wizard and the WR-07 single-admin concurrency lock (which only guards `POST /api/setup/step1`). This is called out as a deliberate non-goal in `05-09-PLAN.md`, but the underlying access-control gap is real and meets the bar for a security finding regardless of how it was scoped, so it is reported here as a blocker for the human reviewer to explicitly accept or close. Two lower-severity issues (a UX regression from re-fetching setup status on every unauthenticated navigation, and duplicated loading-shell markup) round out the findings.

## Critical Issues

### CR-01: `/signup` is unreachable-gated — bypasses the wizard and the WR-07 admin-creation lock

**File:** `client/src/main.tsx:54` (route definition), with root cause in `client/src/routes/auth/components/signup-form.tsx:30` and `server/src/routes/auth.ts:15` (context, not in review scope)

**Issue:** Every other unauthenticated entry point into the app (`/`, `/login`) was wired through `FirstRunGate` in this phase so that a zero-user instance redirects to `/setup`. `/signup` was left out:

```tsx
// client/src/main.tsx
<Route path="/signup" element={<SignupPage />} />   {/* not wrapped in FirstRunGate */}
```

`SignupPage` renders `SignupForm`, which calls `signUp.email(...)` (better-auth client) directly against `POST /api/auth/sign-up/email`. That route is registered generically in `server/src/routes/auth.ts` via `toNodeHandler(auth)` and is never gated by `prisma.user.count()` the way `/api/setup/*` is (see `server/src/routes/setup.ts`'s `preHandler` hook and the WR-07 `Setting`-row lock in the `step1` handler). The practical consequence:

- On a freshly deployed, zero-user instance, any network-reachable anonymous actor who requests `GET /signup` (a static SPA route, trivially discoverable) can create the very first account before the legitimate operator completes the wizard — without going through account-creation validation/side-effects the wizard performs and, more importantly, entirely outside the WR-07 unique-lock protection this same gap-closure phase just added and tested (`server/test/integration/setup-concurrency.test.ts`). Two attackers racing `/signup` with different emails are not serialized by anything — each is an independent, uncontended `sign-up/email` call, so both succeed, defeating the "exactly one first admin" invariant the phase's own tests assert for `/api/setup/step1`.
- This is the exact defect class (an entry point that fails to redirect a first-boot visitor to `/setup`) that WIZ-01/05-09 exists to fix, just left on one more route.

`05-09-PLAN.md` records this explicitly as a "deliberate non-goal" scoped out of WIZ-01's literal text ("instead of the login page"). That is a project-management decision, not evidence the gap is safe — the underlying authorization bypass is real and reachable by an unauthenticated, unauthorized actor, which is the textbook definition of a blocker-class finding. Flagging it here so it is an explicit, visible decision rather than one that stays buried in a plan file while `REQUIREMENTS.md` risks being marked "Complete" for WIZ-01.

**Fix:** Either (a) wrap `/signup` in `FirstRunGate` the same way `/login` is, so a zero-user instance redirects there to `/setup` too:

```tsx
<Route
    path="/signup"
    element={
        <FirstRunGate>
            <SignupPage />
        </FirstRunGate>
    }
/>
```

or (b) if public self-registration is not an intended feature of a single-tenant self-hosted app, remove the `/signup` route and the better-auth `sign-up` capability entirely and require all new users to go through an authenticated invite flow. Either way, the current state — a client-only gate that can be bypassed by one un-redirected route plus a completely ungated server endpoint — should not ship silently as "WIZ-01: Complete."

## Warnings

### WR-01: No test coverage proves `/signup` does (or does not) honor the first-run gate

**File:** `client/test/integration/setup-wizard.spec.ts`, `client/test/integration/auth.spec.ts`

**Issue:** `setup-wizard.spec.ts` added "should redirect to /setup when no users exist" (root) and "should redirect /login to /setup when no users exist" as part of this gap closure, but there is no equivalent assertion for `/signup`. `auth.spec.ts`'s two signup tests (`"signup page renders with form elements"`, `"sign up creates account and redirects to dashboard"`) both run with `mockSetupComplete(page)` set unconditionally in `beforeEach` (line 29), so they never exercise — and would not fail on — the zero-user case described in CR-01. Given this phase's entire purpose was closing exactly this kind of untested entry point, the absence of a `/signup`-specific test is a coverage gap of the same shape as the one this phase fixed.

**Fix:** Once CR-01 is resolved one way or the other, add a test that pins the chosen behavior, e.g.:

```ts
test("should redirect /signup to /setup when no users exist", async ({page}) => {
    await mockNoSession(page);
    await mockSetupIncomplete(page);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/setup$/);
});
```

### WR-02: Every unauthenticated navigation now re-fetches setup status and re-flashes a loading shell

**File:** `client/src/main.tsx:30-36`, `client/src/hooks/use-setup-status.ts:13-45`

**Issue:** Before this change, `ProtectedRoute`'s unauthenticated branch was a single synchronous `<Navigate to="/login" replace />`. It is now `<FirstRunGate><Navigate to="/login" replace /></FirstRunGate>`, and `FirstRunGate` unconditionally calls `useSetupStatus(true)`, which fires a fresh `GET /api/setup/status` and passes through `"idle"`/`"loading"` on every mount — there is no caching across mounts (module-level, context, or query-cache). Concretely: a user whose session expires while browsing between several protected pages, or who is repeatedly redirected in and out of protected routes, sees a second "Loading..." shell flash on top of `ProtectedRoute`'s own `isPending` loading shell on every single redirect-to-login, and issues a redundant network request each time, even though the instance is obviously already fully configured (it just had an authenticated session). This is a new, observable UX regression introduced by this change, not merely a style nit — no test in the reviewed files exercises repeated navigation to catch the double-flicker.

**Fix:** Lift the setup-status check to a coarser scope that is fetched once per app load (e.g., a small context/provider populated once at the router root, or a `staleTime`/cache-forever query if the app has a query client elsewhere) rather than re-deriving it inside every `FirstRunGate` mount:

```tsx
// e.g. compute once at the App root and pass down, or cache in a module-level
// promise/context so subsequent FirstRunGate mounts reuse the resolved value
// instead of re-fetching and re-entering the "loading" state.
```

## Info

### IN-01: Duplicated loading-shell markup between `ProtectedRoute` and `FirstRunGate`

**File:** `client/src/main.tsx:23-27`, `client/src/components/domain/auth/first-run-gate.tsx:18-22`

**Issue:** The exact same loading markup is now defined twice:

```tsx
<div className="flex min-h-screen items-center justify-center">
    <p className="text-gray-500">Loading...</p>
</div>
```

Per `CLAUDE.md`'s `components/common/` guidance ("generic empty states, loading skeletons" belong there), this is a good candidate for a shared `FullscreenLoading`/`LoadingScreen` component now that a second call site exists.

**Fix:**

```tsx
// components/common/loading-screen.tsx
export function LoadingScreen(): React.JSX.Element {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <p className="text-gray-500">Loading...</p>
        </div>
    );
}
```

Use it from both `ProtectedRoute` and `FirstRunGate`.

---

_Reviewed: 2026-08-31T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
