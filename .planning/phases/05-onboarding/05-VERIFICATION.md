---
phase: 05-onboarding
verified: 2026-08-31T18:35:00Z
status: human_needed
score: 5/5 roadmap truths verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5 roadmap truths verified (plus 1 present-behavior-unverified)
  gaps_closed:
    - "Roadmap truth #1 / WIZ-01 — client-side first-run gate now wired at /, /login, and /signup"
    - "Roadmap truth #5 / BF-05 — migration rollback invariant now proven by an executed failure-path test"
  gaps_remaining: []
  regressions: []
behavior_unverified_items: []
coincidental_reliance_items: []
human_verification:
  - test: "Trigger two concurrent POST /api/setup/step1 requests (double-submit or two tabs) against a real Postgres instance and confirm only one admin account is created."
    expected: "The losing request receives a 400 'Setup already complete' response; exactly one User row exists afterward."
    why_human: "WR-07's fix relies on a Postgres unique-constraint race (Setting.key as a one-time lock row). The executed test for this (server/test/integration/setup-concurrency.test.ts, added in 05-10) is well-constructed and type-checks clean, but this verifier independently reproduced the exact same failure the 05-10-SUMMARY.md reported: the testcontainers postgres:17 container's mapped port completes a TCP handshake but Prisma/pg protocol traffic never flows (`prisma db push` → P1001: Can't reach database server). The pre-existing, byte-for-byte-unmodified server/test/integration/stacks.test.ts fails identically in this same run, confirming this is a Docker-outside-of-Docker sandbox networking limitation (tracked in .planning/todos/pending/2026-08-28-fix-integration-e2e-tests.md), not a regression introduced by this plan's code or a defect in the WR-07 lock itself. Needs to be run in an environment where testcontainers' Postgres is reachable at the protocol level (CI, or a host-native dev machine)."
---

# Phase 5: Onboarding Verification Report

**Phase Goal:** New users reach a fully configured instance through a guided wizard; existing self-hosters can adopt running stacks into Docktor without downtime
**Verified:** 2026-08-31T18:35:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 05-09, 05-10, plus follow-up code-review fixes 0bdf325/a6b1eb8/bf92a3e)

## Goal Achievement

### Observable Truths (Roadmap Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On first boot with no user in the database, the browser shows a multi-step setup wizard instead of the login page | ✓ VERIFIED | `FirstRunGate` (`client/src/components/domain/auth/first-run-gate.tsx`) + `useSetupStatus` (`client/src/hooks/use-setup-status.ts`) now wrap all three unauthenticated entry points in `client/src/main.tsx`: the `/login` route element, the `/signup` route element, and `ProtectedRoute`'s `!session` fallback (which every other protected path, including `/`, funnels through). Independently re-executed this run (not taken from SUMMARY claims): `playwright test setup-wizard --grep "redirect to /setup...\|redirect /login...\|redirect /signup...\|keep /login..."` → **4/4 passed** (`/` → `/setup`, `/login` → `/setup`, `/signup` → `/setup`, and the regression guard that a configured instance still shows `/login`). Unit suite for the hook+gate (`use-setup-status.test.ts`, `first-run-gate.test.tsx`) → **11/11 passed**, covering all 5 `SetupStatusState` values, the disabled short-circuit, the fail-safe-on-error branch, the loading-shell-no-flash branch, and the WR-02 cross-mount cache (including "does not cache a failed check, so the next mount retries"). `grep` confirms zero `skip(` remaining in `setup-wizard.spec.ts` and zero `redirectTo` reads in `first-run-gate.tsx` (navigation target is the hardcoded `/setup` literal, not server-supplied). |
| 2 | After completing the wizard, a new user has an account, basic settings configured, and is redirected to the dashboard | ✓ VERIFIED | Unchanged from prior pass: `handleStep1`/`handleFinish` in `client/src/routes/setup.tsx` create the account (auto-login) and settings, then `navigate("/")`. This run's full `setup-wizard` Playwright suite (21 tests, `--workers=1`, executed on an unloaded pass) additionally exercised this end-to-end and passed: "should create admin account and auto-login on step 1 submit", "should save instance settings on step 2 submit", "should allow skipping optional steps 3-5", "should redirect to dashboard after wizard completion" — all 4 passed, resolving the prior pass's "Playwright confirmation was inconclusive" caveat. |
| 3 | User can scan the host filesystem for existing docker-compose.yml files and see a compatibility assessment for each | ✓ VERIFIED | Unchanged from prior pass; re-confirmed passing in this run's Playwright execution ("should scan directories and display discovered stacks", "should display compatibility badges", "should show skipped directories count when permission errors occur" — 3/3 passed). |
| 4 | User can adopt a discovered stack in-place with zero downtime, and it immediately appears in the dashboard with live status | ✓ VERIFIED | Unchanged from prior pass (`adoptInPlace()` — DB-row-only, no file/container ops); re-confirmed passing in this run ("should adopt green stack with zero downtime", "should navigate to the adopted stack via the success toast action" — 2/2 passed). |
| 5 | User can run the full migration wizard to move a stack into Docktor's directory structure, with automatic rollback on failure | ✓ VERIFIED | Was ⚠️ PRESENT_BEHAVIOR_UNVERIFIED — zero test coverage of the rollback branch. Now closed by `server/test/unit/application/migration-service.test.ts` (05-10), independently re-executed: **2/2 passed**. Read the test in full: it drives the *real* `MigrationService.migrate()` against a real filesystem fixture (`fs.mkdtemp`), injecting a `docker.up` rejection, and mocks only `node:child_process.spawn` (via `importOriginal` module spread, so `DockerExecutor`'s module-scope `promisify(execFile)` still works) plus the five constructor-injected collaborators. Assertions read real bytes off disk after `migrate()` returns (not a spy on `fs.cp`) and confirm: `docker-compose.yml`/`data/keep.txt` restored byte-identical, `stackFs.removeDirectory`/`stackRepo.delete` called with the slugified id, `spawn` called with `("docker", ["compose", "up", "-d"], {cwd: originalDir})`, and no `docktor-migration-backup-<id>-*` directory survives under `os.tmpdir()`. Cross-checked against the real `migration-service.ts:206-253` catch block — the test's expectations match the actual code's step order exactly (removeDirectory → delete → rm+cp restore → restart → backup cleanup). A second test proves the same backup-cleanup on the success path. This is genuine behavioral proof, not a shallow mock-of-itself. |

**Score:** 5/5 truths verified

### Requirements Coverage (WIZ-*, BF-*)

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WIZ-01 | 05-03, 05-05, 05-09 (gap closure), CR-01/WR-01/WR-02 fixes | Setup wizard shown instead of login on first boot | ✓ SATISFIED | See truth #1. All three unauthenticated entry points (`/`, `/login`, `/signup`) gated; regression-tested that a configured instance is unaffected. |
| WIZ-02 | 05-01, 05-03, 05-07 | Step 1: create admin account | ✓ SATISFIED | Unchanged; `onboarding-service.test.ts` unit coverage; concurrency-hardening (WR-07 lock) present and code-reviewed, execution-blocked in this sandbox — see Human Verification. |
| WIZ-03 | 05-01, 05-03, 05-07 | Step 2: instance name/base URL/timezone | ✓ SATISFIED | Unchanged from prior pass. |
| WIZ-04 | 05-01, 05-03, 05-07 | Step 3 (optional): backup repository config | ✓ SATISFIED | Unchanged from prior pass. |
| WIZ-05 | 05-01, 05-03, 05-07 | Step 4 (optional): SMTP config | ✓ SATISFIED | Unchanged from prior pass. |
| WIZ-06 | 05-01, 05-02, 05-06 | Step 5: brownfield scan trigger | ✓ SATISFIED | Unchanged from prior pass. |
| WIZ-07 | 05-03, 05-05 | Redirect to dashboard after completion | ✓ SATISFIED | Now behaviorally confirmed — "should redirect to dashboard after wizard completion" passed in this run's unloaded Playwright execution (previously inconclusive due to host contention). |
| BF-01 | 05-01, 05-02, 05-06 | Scan host filesystem for compose files | ✓ SATISFIED | Unchanged from prior pass. |
| BF-02 | 05-01, 05-02, 05-08 | Compatibility assessment (green/yellow/red) | ✓ SATISFIED | Unchanged from prior pass. |
| BF-03 | 05-01, 05-03, 05-06 | Adopt stack in-place, zero downtime | ✓ SATISFIED | Unchanged from prior pass. |
| BF-04 | 05-04, 05-06 | Full migration wizard (stop→copy→convert→rewrite→restart) | ✓ SATISFIED | Unchanged from prior pass; happy path re-confirmed in this run's Playwright execution. |
| BF-05 | 05-04, 05-06, 05-10 (gap closure) | Rollback on failure + user cleanup | ✓ SATISFIED | Was ⚠️ NEEDS HUMAN. Now proven by an executed unit test — see truth #5. |

**Orphaned requirements:** None — all 12 IDs mapped to phase 5 in REQUIREMENTS.md are claimed by at least one plan's `requirements` field (05-01 through 05-10).

**Note on REQUIREMENTS.md staleness:** The `.planning/REQUIREMENTS.md` checkbox/status table still shows most WIZ-*/BF-* rows as "Gaps Found" from the prior verification pass and hasn't been updated to reflect this closure. That file is not owned by this verifier (it's updated by the orchestrator on gap-closure), flagging here so it gets synced.

### Required Artifacts (gap-closure plans only — 05-01..08 artifacts unchanged from prior pass)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `client/src/hooks/use-setup-status.ts` | Hook owning first-run setup-status state | ✓ VERIFIED | Exports `useSetupStatus`, `SetupStatusState`, plus `resetSetupStatusCacheForTests` (test-only escape hatch, documented). 111 lines. Module-level cache added by the WR-02 follow-up fix, with failures deliberately not cached (retry-on-next-mount). |
| `client/src/components/domain/auth/first-run-gate.tsx` | Route guard diverting to /setup | ✓ VERIFIED | Exports `FirstRunGate`, `FirstRunGateProps`. 34 lines. Hardcoded `/setup` literal; no `redirectTo` read from any response body (grep-confirmed). |
| `client/test/unit/hooks/use-setup-status.test.ts` | Unit coverage, 4 states + disabled + cache | ✓ VERIFIED | 7 tests (5 planned + 2 WR-02 cache tests), all passing. |
| `client/test/unit/components/domain/auth/first-run-gate.test.tsx` | Unit coverage, 4 render branches | ✓ VERIFIED | 4 tests, all passing. |
| `server/test/unit/application/migration-service.test.ts` | Rollback + backup-cleanup coverage | ✓ VERIFIED | 164 lines, 2 tests, both passing, genuinely exercises real orchestration code (see truth #5). |
| `server/test/integration/setup-concurrency.test.ts` | Concurrent step-1 admin-creation coverage | ✓ VERIFIED (present, wired, correct); execution blocked in this sandbox | 58 lines, 2 tests. Code-reviewed as correct (`Promise.all`-based genuine race, asserts `[200,400]` + single `User` row). Cannot execute here — see Human Verification. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `client/src/main.tsx` (`/login` route) | `client/src/components/domain/auth/first-run-gate.tsx` | `<FirstRunGate><LoginPage/></FirstRunGate>` | ✓ WIRED |
| `client/src/main.tsx` (`/signup` route) | `client/src/components/domain/auth/first-run-gate.tsx` | `<FirstRunGate><SignupPage/></FirstRunGate>` | ✓ WIRED |
| `client/src/main.tsx` (`ProtectedRoute` `!session` branch) | `client/src/components/domain/auth/first-run-gate.tsx` | `<FirstRunGate><Navigate to="/login"/></FirstRunGate>` | ✓ WIRED |
| `client/src/components/domain/auth/first-run-gate.tsx` | `client/src/hooks/use-setup-status.ts` | `useSetupStatus(true)` | ✓ WIRED |
| `client/src/hooks/use-setup-status.ts` | `client/src/lib/setup-api.ts` | `checkSetupStatus()` | ✓ WIRED |
| `server/test/unit/application/migration-service.test.ts` | `server/src/application/migration-service.ts` | constructor-injected test doubles, real invocation of `migrate()` | ✓ WIRED |
| `server/test/integration/setup-concurrency.test.ts` | `server/test/integration/setup.ts` | `getApp`/`getPrisma`/`cleanDatabase`/`startContainer` imports | ✓ WIRED (code); execution blocked by sandbox Docker-in-Docker networking |

### Behavioral Spot-Checks (independently executed this run — not taken from SUMMARY claims)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Client type-checks clean | `yarn workspace @docktor/client exec tsc --noEmit` | no output | ✓ PASS |
| Server type-checks clean | `yarn workspace @docktor/server exec tsc --noEmit` | no output | ✓ PASS |
| WIZ-01 core redirects (`/`, `/login`, `/signup`, regression guard) | `playwright test setup-wizard --grep "redirect to /setup...\|redirect /login...\|redirect /signup...\|keep /login..." --workers=1` | 4 passed | ✓ PASS |
| Auth suite unaffected by FirstRunGate/caching change | `playwright test auth --workers=1` | 6 passed | ✓ PASS |
| Full setup-wizard Playwright suite | `playwright test setup-wizard --workers=1` | 20 passed, 1 failed | ⚠️ 1 pre-existing, out-of-scope failure — see Anti-Patterns |
| `useSetupStatus`/`FirstRunGate` unit suite | `yarn workspace @docktor/client test test/unit/hooks/use-setup-status.test.ts test/unit/components/domain/auth/first-run-gate.test.tsx` | 11 passed | ✓ PASS |
| Full client unit suite (regression check, run once) | `yarn workspace @docktor/client test` | 124 passed, 1 failed (timeout), 3 todo | ⚠️ pre-existing flaky file, confirmed isolated pass below |
| Flaky file re-run in isolation | `yarn workspace @docktor/client test test/unit/routes/stacks/service-upgrade-dialog.test.tsx` | 9/9 passed | ✓ PASS — confirms host resource contention, not a code defect (Phase 02 file, untouched by phase 05) |
| BF-05 rollback unit test | `yarn workspace @docktor/server test:unit test/unit/application/migration-service.test.ts` | 2 passed | ✓ PASS |
| Full server unit suite (regression check, run once) | `yarn workspace @docktor/server test:unit` | 436 passed, 2 todo | ✓ PASS |
| WR-07 concurrency integration test | `yarn workspace @docktor/server test:integration test/integration/setup-concurrency.test.ts` | 2 skipped (suite errored in `beforeAll`) | ✗ BLOCKED — `P1001: Can't reach database server` from `prisma db push` against the testcontainers Postgres. |
| Regression check: does the pre-existing, unmodified `stacks.test.ts` fail the same way? | `yarn workspace @docktor/server test:integration test/integration/stacks.test.ts` | same `P1001` error | Confirms sandbox Docker-in-Docker networking limitation, not a 05-10 regression |

### Anti-Patterns Found

Scanned every file created/modified by the gap-closure plans (05-09, 05-10) and the follow-up review-fix commits for `TBD`/`FIXME`/`XXX`, `TODO`/`HACK`/`PLACEHOLDER`, stub returns, and hardcoded-empty patterns.

**None found.** No debt markers in `use-setup-status.ts`, `first-run-gate.tsx`, `main.tsx`, `setup-wizard.spec.ts`, `auth.spec.ts`, the two new unit test files, `migration-service.test.ts`, `setup.ts`, or `setup-concurrency.test.ts`. No `as any` casts — all narrowing casts are `as unknown as <Type>` with an explanatory comment, per `CLAUDE.md`.

**ℹ️ INFO — pre-existing, out-of-scope test-locator bug:** `client/test/integration/setup-wizard.spec.ts:381` (`should show diff preview in step 2`) fails with a Playwright strict-mode violation: `getByText("Migrated")` matches two elements (the diff-viewer's "Migrated" column header and an unrelated `CompatibilityBadge` tooltip string also containing "Migrated"). This assertion was introduced in commit `f37bab9` (CR-05, prior to the 05-09/05-10 gap-closure plans this re-verification targets) and is unrelated to WIZ-01/BF-05/WR-07. The underlying feature is not broken — the two preceding assertions on the same line block (`"Review Changes"`, `"Original"` visible) pass, and the migration wizard's other 5 tests in the same describe block (open wizard, volume-selection UI, start migration, success toast, error toast) all pass. This is a test-precision issue (use a more specific locator, e.g. scoped to the diff-viewer container), not a functional gap. Not a blocker for this phase; worth a follow-up test fix.

### Requirements/Gap Summary

Both items the prior verification (`gaps_found`, score 3/5) flagged as blocking or unproven are now closed with independently-executed evidence:

1. **WIZ-01 (blocking gap)** — closed. `FirstRunGate` now wraps all three unauthenticated entry points (`/`, `/login`, `/signup`); confirmed with 4 freshly-executed Playwright tests plus 11 unit tests, with zero regressions to the pre-existing `auth.spec.ts` suite. The follow-up code review (`05-REVIEW.md`) caught and the team closed a same-shaped hole (`/signup` unguarded) that this verifier's first pass would otherwise have missed if it had stopped at the 05-09 plan alone — independently confirmed the fix (commit `0bdf325`) is in `main.tsx` and the regression test (`a6b1eb8`) passes.
2. **BF-05 rollback (behavior-unverified)** — closed. `migration-service.test.ts` genuinely exercises the real rollback code path with real filesystem I/O; read the test and the production code side-by-side and confirmed the assertions map exactly to the actual `catch` block's step order.

One item remains open and is correctly routed to human verification rather than either blocking the phase or being silently marked passed:

3. **WR-07 concurrency (execution-blocked, not code-unproven)** — the test exists, type-checks, and was code-reviewed as a genuine `Promise.all`-based race with correct assertions. It cannot execute in this sandbox because of a Docker-outside-of-Docker networking limitation that this verifier independently reproduced (and confirmed also breaks the pre-existing, untouched `stacks.test.ts`, ruling out a 05-10 regression). This needs to run once in CI or a native Docker host to close out.

An unrelated, pre-existing Playwright locator-strictness bug (`should show diff preview in step 2`) and the already-diagnosed `service-upgrade-dialog.test.tsx` flaky timeout are noted for completeness but do not block this verification — neither is caused by, nor within scope of, the 05-09/05-10 gap-closure work.

---

_Verified: 2026-08-31T18:35:00Z_
_Verifier: Claude (gsd-verifier)_
