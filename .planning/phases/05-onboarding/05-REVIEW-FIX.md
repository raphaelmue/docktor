---
phase: 05-onboarding
fixed_at: 2026-08-31T15:57:22Z
review_path: .planning/phases/05-onboarding/05-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-08-31T15:57:22Z
**Source review:** .planning/phases/05-onboarding/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (critical + warning): 3
- Fixed: 3
- Skipped: 0

Scope is `critical_warning`, so IN-01 (duplicated loading-shell markup) was intentionally left out of this run — it remains open in 05-REVIEW.md for a future `--fix all` pass or manual cleanup.

## Fixed Issues

### CR-01: `/signup` is unreachable-gated — bypasses the wizard and the WR-07 admin-creation lock

**Files modified:** `client/src/main.tsx`
**Commit:** `0bdf325`
**Applied fix:** Per the user's explicit decision, wrapped the `/signup` route in `FirstRunGate`, the same pattern already used for `/` and `/login`. A zero-user instance now redirects `/signup` to `/setup`, closing the bypass of the wizard and the WR-07 single-admin concurrency lock. Public self-registration continues to work normally once setup is complete — the route itself was not removed, and `sign-up/email` is unaffected on an already-configured instance.

### WR-01: No test coverage proves `/signup` does (or does not) honor the first-run gate

**Files modified:** `client/test/integration/setup-wizard.spec.ts`
**Commit:** `a6b1eb8`
**Applied fix:** Added `"should redirect /signup to /setup when no users exist"`, mirroring the existing `"/"` and `"/login"` first-run redirect tests in the same `describe` block (same `mockNoSession` + `mockSetupIncomplete` + `toHaveURL(/\/setup$/)` pattern). Verified with `playwright test setup-wizard.spec.ts -g "First-run wizard flow" --workers=1` — all 10 tests in that block pass, including the new one. Also re-ran `auth.spec.ts` in full (6 tests) to confirm the pre-existing signup tests (which run under `mockSetupComplete`) are unaffected.

### WR-02: Every unauthenticated navigation now re-fetches setup status and re-flashes a loading shell

**Files modified:** `client/src/hooks/use-setup-status.ts`, `client/test/unit/hooks/use-setup-status.test.ts`, `client/test/unit/components/domain/auth/first-run-gate.test.tsx`
**Commit:** `bf92a3e`
**Applied fix:** Added a module-level cache (in-flight promise + resolved result) inside `use-setup-status.ts`. `useSetupStatus` now initializes its state synchronously from any already-resolved cached value (avoiding the "loading" flash on repeat mounts) and reuses the in-flight/resolved request instead of calling `checkSetupStatus()` again. Failures are deliberately **not** cached, so a transient outage can still be retried on the next `FirstRunGate` mount rather than being wedged into `"error"` for the rest of the page session. The cache is module-scoped, so it resets naturally on a full page reload — the only way setup state can genuinely change (e.g. right after finishing the wizard, before the app navigates to `/`).

Exported a test-only `resetSetupStatusCacheForTests()` helper and wired it into `beforeEach` of both affected unit test files (the module cache would otherwise leak state across test cases in the same file). Added two new unit tests pinning the fix directly: one asserting a second mount reuses the cached `"complete"` result without a second `checkSetupStatus()` call, and one asserting a failed check is *not* cached so the next mount can retry. Full client unit suite (`vitest run`): 124 passed, 3 todo, 1 unrelated flaky timeout in `service-upgrade-dialog.test.tsx` (a file untouched by this fix) that passes in isolation with a longer timeout — a sandbox performance artifact, not a regression.

## Verification Summary

- `npx tsc --noEmit -p client/tsconfig.json`: no errors, run after each source-file edit.
- `npx vitest run` (client): 124 passed / 3 todo / 1 pre-existing flaky timeout unrelated to the changed files.
- `npx playwright test setup-wizard.spec.ts -g "First-run wizard flow" --workers=1`: 10/10 passed.
- `npx playwright test auth.spec.ts --workers=1`: 6/6 passed.
- All verification ran inside the isolated git worktree (`.claude/worktrees/rf-05-*`), with `node_modules` symlinked in from the main checkout for the duration of the run and removed before the worktree was fast-forwarded and torn down. This is reproducible from the main checkout at the commits above.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-08-31T15:57:22Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
