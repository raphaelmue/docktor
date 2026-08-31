---
phase: 05-onboarding
plan: 09
subsystem: auth
tags: [react, react-router, first-run, wizard, playwright, vitest]

# Dependency graph
requires:
  - phase: 05-onboarding
    provides: "GET /api/setup/status server endpoint and checkSetupStatus() client (05-03)"
provides:
  - "useSetupStatus hook owning first-run setup-status server state"
  - "FirstRunGate component diverting session-less visitors to /setup"
  - "Client-side wiring so a first-boot visitor lands on the wizard at both / and /login"
affects: [onboarding, auth]

# Actuals (#2632)
actuals:
  tokens: 3368
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data-owning hook + presentational gate component (useSetupStatus + FirstRunGate), not an inline useEffect in the route component"
    - "Fail-safe-to-existing-behavior on transient error: a rejected setup-status check falls through to the caller's normal unauthenticated handling instead of exposing the account-creation wizard"

key-files:
  created:
    - client/src/hooks/use-setup-status.ts
    - client/src/components/domain/auth/first-run-gate.tsx
    - client/test/unit/hooks/use-setup-status.test.ts
    - client/test/unit/components/domain/auth/first-run-gate.test.tsx
  modified:
    - client/src/main.tsx
    - client/test/integration/setup-wizard.spec.ts
    - client/test/integration/auth.spec.ts

key-decisions:
  - "Client-side gate (not a server-side 302) — Fastify only serves the SPA in production, so a document-level redirect would be a no-op under Vite dev / Playwright, the exact environment WIZ-01 is tested in"
  - "useSetupStatus + FirstRunGate split, not an inline useEffect in ProtectedRoute — CLAUDE.md forbids fetching data directly in components; the split also makes the gate unit-testable since main.tsx can't be imported by Vitest"
  - "ProtectedRoute left inline (not extracted to its own file) — once FirstRunGate owns the decision, ProtectedRoute is four lines of session branching with no additional testable surface"
  - "/signup is deliberately NOT wrapped in FirstRunGate — recorded as a known pre-existing gap outside this plan's scope, not silently dropped"

patterns-established:
  - "SetupStatusState state machine: idle | loading | incomplete | complete | error, with error always falling back to the caller's normal (non-wizard) behavior"

requirements-completed: [WIZ-01]

coverage:
  - id: D1
    description: "Unauthenticated visitor opening / on a zero-user instance is redirected to /setup with the wizard's step-1 marked current"
    requirement: WIZ-01
    verification:
      - kind: e2e
        ref: "client/test/integration/setup-wizard.spec.ts#should redirect to /setup when no users exist"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unauthenticated visitor opening /login directly on a zero-user instance is also redirected to /setup"
    requirement: WIZ-01
    verification:
      - kind: e2e
        ref: "client/test/integration/setup-wizard.spec.ts#should redirect /login to /setup when no users exist"
        status: pass
    human_judgment: false
  - id: D3
    description: "A configured instance (setup already complete) still shows /login normally to a session-less visitor"
    verification:
      - kind: e2e
        ref: "client/test/integration/setup-wizard.spec.ts#should keep /login on an instance that already has users"
        status: pass
      - kind: e2e
        ref: "client/test/integration/auth.spec.ts (full Authentication describe block, 6 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "useSetupStatus covers all four resolved states plus the disabled short-circuit, and does not update state after unmount"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-setup-status.test.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "FirstRunGate covers all four render branches, including the fail-safe error branch that must never surface /setup"
    verification:
      - kind: unit
        ref: "client/test/unit/components/domain/auth/first-run-gate.test.tsx (4 tests)"
        status: pass
    human_judgment: false

duration: 92min
completed: 2026-08-31
status: complete
---

# Phase 05 Plan 09: Client-side first-run gate Summary

**FirstRunGate component + useSetupStatus hook divert a session-less visitor to /setup on a zero-user instance, at both `/` and `/login`, failing safe to the existing login flow on any status-check error**

## Performance

- **Duration:** ~92 min (includes root-causing a stale cross-worktree dev-server process that was silently serving the wrong source tree to Playwright)
- **Started:** 2026-08-31T15:51:30+02:00 (Task 1 commit)
- **Completed:** 2026-08-31T17:23:08+02:00 (Task 3 commit)
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- `useSetupStatus(enabled)` hook owns the `GET /api/setup/status` server state as a `SetupStatusState` machine (`idle | loading | incomplete | complete | error`), guarding against setting state after unmount
- `FirstRunGate` component renders a loading shell while pending, `<Navigate to="/setup" replace />` when the instance has no users, and passes through children (fail-safe) on `complete` or `error`
- `ProtectedRoute`'s unauthenticated branch and the `/login` route element are both wrapped in `FirstRunGate`, closing both unauthenticated entry points named in WIZ-01's acceptance text
- The previously-skipped WIZ-01 Playwright test now runs real assertions and passes; two new `/login`-specific E2E tests were added (redirect-when-incomplete, stay-on-login-when-configured)
- The pre-existing `auth.spec.ts` suite is made deterministic against the new status call via a `beforeEach` that stubs `/api/setup/status` as complete
- 9 new unit tests (5 for the hook, 4 for the gate) cover every state transition, including the fail-safe error branch

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "first boot lands on the wizard" — the `/` path only** - `6d0ab55` (feat)
2. **Task 2: Unit coverage for the four status states and the fail-safe branch** - `4206acc` (test)
3. **Task 3: Extend the gate to the `/login` entry point** - `ffb8891` (feat)

_This is a worktree-isolated executor run; the plan-metadata commit (SUMMARY.md) is committed separately per the parallel-execution contract — STATE.md/ROADMAP.md are owned by the orchestrator._

## Files Created/Modified
- `client/src/hooks/use-setup-status.ts` - Owns the setup-status server state; exports `useSetupStatus` and `SetupStatusState`
- `client/src/components/domain/auth/first-run-gate.tsx` - Route guard exporting `FirstRunGate` and `FirstRunGateProps`
- `client/src/main.tsx` - `ProtectedRoute`'s `!session` branch and the `/login` route element both wrapped in `FirstRunGate`
- `client/test/integration/setup-wizard.spec.ts` - `mockNoSession` helper added; WIZ-01 test un-skipped with real assertions; two new `/login` gate tests
- `client/test/integration/auth.spec.ts` - `mockSetupComplete` helper registered via a describe-level `beforeEach`
- `client/test/unit/hooks/use-setup-status.test.ts` - 5 tests covering all resolved states plus the disabled short-circuit
- `client/test/unit/components/domain/auth/first-run-gate.test.tsx` - 4 tests covering all four render branches

## Decisions Made
- Client-side gate chosen over a server-side 302 — Fastify only serves the SPA in production, and Playwright/dev run against Vite on :5173, so a document-level redirect would be a no-op in the exact environment the acceptance test runs in. The server's 503 first-run gate stays as defense-in-depth; no client code reads its `redirectTo` field (enforced by a grep-based acceptance criterion and a STRIDE tampering mitigation in the plan's threat model).
- Hook + gate component split (not an inline `useEffect` in `ProtectedRoute`) to comply with CLAUDE.md's "custom hooks are the single source of truth for server state" rule, and because `main.tsx` calls `createRoot(...).render(...)` at module scope and cannot be imported by a Vitest unit test — the gate needed to be a separate, testable file.
- `/signup` intentionally left unwrapped — a pre-existing hole (it still creates a user via better-auth on a zero-user instance) that is outside WIZ-01's text and this gap's `missing` list; recorded here per the plan's rationale rather than silently expanded into scope.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<action>` blocks were implemented as specified; no Rule 1-4 fixes were needed in the shipped code.

## Issues Encountered

**Stale cross-worktree Vite dev server bound to port 5173.** During Task 1 verification, the WIZ-01 E2E test consistently landed on `/login` instead of `/setup` despite correct application code. Root-caused via live debug instrumentation (temporary `console.log` calls plus a throwaway diagnostic Playwright test capturing browser console/network events) to a `vite` process already listening on `:5173`, started from `/home/raphael/workspace/docktor` (the main repo checkout, not this worktree) — Playwright's `reuseExistingServer: true` config reused that stale server, which was silently serving `/api/setup/status`-unaware source from a different working tree. Killed the stale process; a fresh Vite instance started from within the worktree resolved the issue immediately. No application code was at fault — this was purely a pre-existing environment/process-management artifact of running as a parallel worktree agent, documented here per Rule 3 scope (blocking issue, not a plan deviation) since no plan file changed as a result.

**Playwright flakiness under `>1` parallel worker in this sandboxed environment.** Full-suite / multi-worker Playwright runs (`--workers` unset, i.e. auto) intermittently failed individual tests with timeouts unrelated to the code under test (resource contention). All required `<verify>` commands from the plan were confirmed passing when run with `--workers=1`, which is the deterministic, reproducible configuration used for all task verification in this summary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- WIZ-01 / Roadmap SC-1 is now behaviorally true: a fresh install shows the setup wizard, not the login form, at both `/` and `/login`.
- `05-VERIFICATION.md`'s blocking gap item ("Un-skip client/test/integration/setup-wizard.spec.ts:114") is closed.
- Remaining gap-closure work in this phase (BF-05/WR-07 coverage per the original gap-closure plan) is out of this plan's scope — see phase-level planning artifacts for what plan(s) cover it.

---
*Phase: 05-onboarding*
*Completed: 2026-08-31*
