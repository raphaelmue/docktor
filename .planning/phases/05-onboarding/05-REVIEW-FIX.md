---
phase: 05-onboarding
fixed_at: 2026-08-31T10:55:00Z
review_path: .planning/phases/05-onboarding/05-REVIEW.md
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-08-31T10:55:00Z
**Source review:** .planning/phases/05-onboarding/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 15 (5 Critical, 10 Warning — `fix_scope: critical_warning`, Info findings excluded)
- Fixed: 15
- Skipped: 0

**Verification environment:** all fixes were made and verified inside an isolated git worktree at
`.claude/worktrees/rf-05-3296409-1788171396` (branch `gsd-reviewfix/05-3296409`, per
`workflow.use_worktrees` defaulting to `true`). TypeScript type-checking (`tsc --noEmit`) ran clean
with **zero errors** across both `server` and `client` workspaces after all fixes. All **434 server
unit tests pass** (`server/test/unit`, 2 pre-existing `.todo` tests unrelated to this phase). The
worktree had no `node_modules` of its own (by design — see the fixer's isolation rules), so it
resolved `tsc`/`vitest` binaries and node_modules from the main checkout's install via the worktree's
nested path; the Prisma-generated client (gitignored, deterministic from `server/prisma/schema/`,
identical between the main checkout and this worktree) was copied in locally purely to unblock
type-checking/testing — no source files were affected. The client's Playwright suite (CR-05) could
**not** be executed in this environment (the worktree has no Yarn install state, so `vite`/webServer
could not start); it was verified via careful manual reads plus a scoped `tsc` type-check (ad-hoc
tsconfig including the spec file) that reported zero errors in the new/changed test file. **The
Playwright suite should be run for real** (`yarn workspace @docktor/client test:integration`) in a
normal checkout before this phase is considered fully verified.

## Fixed Issues

### CR-01: `/api/setup/*` endpoints beyond step 1 reachable without authentication

**Files modified:** `server/src/routes/setup.ts`
**Commit:** `3217887`
**Applied fix:** Added a plugin-level `preHandler` hook to `setupRoutes` that re-checks
`prisma.user.count() > 0` and returns `410 Setup already complete` for every route except
`GET /api/setup/status` and `POST /api/setup/step1`. This closes the gap where the global
first-run gate in `app.ts` unconditionally exempted the whole `/api/setup` prefix regardless of
whether setup was already complete.

### CR-02: Unauthenticated arbitrary file/directory write (path traversal) via migration

**Files modified:** `server/src/application/migration-service.ts`
**Commit:** `6ab11a9`
**Applied fix:** Added an `assertWithin(base, target)` helper that resolves the target against the
base directory and throws `BadRequestError` unless the resolved path is a strict descendant of the
base. Applied it to both the named-volume bind-mount destination (`volumesDir`) and the
bind-mount-conversion destination (`newStackPath`). Also added a `VOLUME_NAME_PATTERN` charset check
(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`) on Docker volume names before they are passed to `docker run -v`,
since an unvalidated name containing `/` would be interpreted by Docker as a host bind path rather
than a named volume.

### CR-03: `ComposeRewriter` silently skips long-form bind mounts

**Files modified:** `server/src/infrastructure/compose-rewriter.ts`,
`server/test/unit/infrastructure/compose-rewriter.test.ts` (new)
**Commit:** `42e0b6a`
**Applied fix:** Extended the `svc.volumes.map()` rewrite loop to also handle long-form
`{type: "bind", source, target}` entries (rewriting `source` when selected for conversion) and
long-form `{type: "volume", source, target}` named-volume entries (converting to a bind mount the
same way the short-form case does). Added a 4-test regression suite covering both entry types,
selected/unselected.

### CR-04: Migration backup snapshot left permanently in shared OS temp directory

**Files modified:** `server/src/application/migration-service.ts`
**Commit:** `4aa9ec6`
**Applied fix:** Uncommented and implemented the backup cleanup on the success path — `fs.rm(backupDir, {recursive: true, force: true})` now runs immediately after `docker.up(stackId)` confirms the new stack is healthy, wrapped in its own try/catch so a cleanup failure doesn't fail the overall migration (only logged).

### CR-05: Entire Playwright integration suite for the setup wizard was skipped

**Files modified:** `client/test/integration/setup-wizard.spec.ts`
**Commit:** `f37bab9`
**Applied fix:** Replaced all 20 `test.skip()` placeholders with real assertions using the
`page.route()` mocking pattern already established in `auth.spec.ts` (no real backend runs in this
Playwright config — only Vite). Implemented 21 real tests covering: wizard stepper rendering, step
1/2 submission and progression, skip-through-optional-steps, post-wizard redirect, re-visit
prevention, brownfield scan + compatibility badges + skipped-directory reporting, adopt-in-place
(including the toast "View stack" navigation), and the full migration wizard flow (open, volume
selection, diff preview, background execution, success toast, error toast). One test —
"should redirect to /setup when no users exist" — is left as an explicit, documented `test.skip()`
with a code comment explaining that the client has **no actual handling** of the server's 503
first-run-gate response anywhere in `main.tsx`/`ProtectedRoute` (a genuine, pre-existing feature gap
uncovered while writing this test, out of scope for a fixer to silently implement as a new feature).
**Status flag: `fixed: requires human verification`** — this Playwright suite could not be executed
in the isolated worktree (see verification environment note above); it should be run for real before
being trusted.

### WR-01: Explicit `any` typing throughout the setup flow

**Files modified:** `client/src/routes/setup.tsx`, `server/src/application/migration-service.ts`,
`server/src/infrastructure/brownfield-scanner.ts`, `server/src/app.ts`
**Commit:** `aa9a77d`
**Applied fix:** Replaced every `catch (err: any)` with `catch (err: unknown)` plus
`instanceof Error` narrowing. Replaced `const issues: any[] = (error as any).validation` in the
global error handler with a documented, safely-typed cast to a local `ValidationIssue` interface
(`FastifyError & {validation?: ValidationIssue[]}`) — `as` usage is commented explaining why it's
safe. Replaced the brownfield-scanner's `err.code` access with a documented `NodeJS.ErrnoException`
narrowing cast.

### WR-02: `BackupStep`/`NotificationsStep` bypassed react-hook-form + Zod resolver

**Files modified:** `client/src/routes/setup/components/backup-step.tsx`,
`client/src/routes/setup/components/notifications-step.tsx`
**Commit:** `8f805ec`
**Applied fix:** Rewrote both components to use `useForm` + `standardSchemaResolver`, matching
`AccountStep`/`SettingsStep`. `BackupStep` uses `wizardStep3Schema` with `repoType` defaulted to
`"local"` and conditional field rendering driven by `form.watch("repoType")`; the explicit "Skip"
button (type="button") bypasses validation entirely for the optional-step-skip UX, while "Next"
(type="submit") now runs full Zod validation with inline `FormMessage` field errors.
`NotificationsStep` uses `wizardStep4Schema`; because that schema's `port` field uses
`z.coerce.number()` (creating a structural input/output type mismatch for the resolver), the
resolver is cast to `Resolver<WizardStep4Input>` with a comment explaining why this is safe (the
resolver still coerces correctly at runtime — only the pre-coercion TS input type differs from the
post-coercion output type).

### WR-03: `onboarding-service.ts` threw raw `Error` instead of the typed hierarchy

**Files modified:** `server/src/application/onboarding-service.ts`
**Commit:** `3b750cc`
**Applied fix:** `"Display name produces an empty slug"` now throws `BadRequestError` (400 — a client
input problem). `"Signup succeeded but no session returned"` now throws the base `AppError` (still
500 — an unexpected upstream auth-provider state, not a client input problem, but now part of the
typed hierarchy per CLAUDE.md's "never throw raw Error in business code" rule).

### WR-04: Duplicated unit test suites for `BrownfieldScanner`/`ComposeAnalyzer`

**Files modified:** `server/test/unit/infrastructure/compose-analyzer.test.ts`,
`server/test/unit/infrastructure/brownfield-scanner.test.ts` (both rewritten/consolidated);
`server/test/unit/compose-analyzer.test.ts`, `server/test/unit/brownfield-scanner.test.ts` (deleted)
**Commits:** `33981cc` (consolidated suites), `c9cd701` (the actual file deletions — see note below)
**Applied fix:** Merged the unique test cases from both duplicate locations into the canonical
`server/test/unit/infrastructure/` suites (matching CLAUDE.md's "mock the repository, filesystem,
and Docker" server-unit-test convention) and deleted the root-level duplicates. Compose-analyzer
went from 32 combined tests (with heavy overlap) to 21 deduplicated tests; brownfield-scanner went
from 18 combined tests to 15, adding integration-style tests that exercise the real `ComposeAnalyzer`
against mocked file contents (previously only covered by the real-tempdir suite that got deleted).
**Note:** commit `33981cc` initially only staged the *content* of the two consolidated files; the
`git add`/`--files` step for the two deletions did not take effect in that commit (files were
correctly removed from disk but the deletion wasn't recorded in git). This was caught during final
verification (`git status` was not clean) and corrected in a follow-up commit `c9cd701` before
writing this report — both commits are part of the WR-04 fix.

### WR-05: `POST /api/setup/adopt` performed file I/O directly in the route handler

**Files modified:** `server/src/routes/setup.ts`, `server/src/application/onboarding-service.ts`,
`server/test/unit/application/onboarding-service.test.ts`
**Commit:** `b0bcb78`
**Applied fix:** Moved `fs.readFile(composePath, "utf-8")` out of the route handler and into
`OnboardingService.adoptInPlace`, which now takes only `composePath`/`displayName` (no longer accepts
`composeContent`). Added an injectable `fsLib: {readFile: typeof fs.readFile}` constructor parameter
(defaulting to real `fs`, matching the existing DI pattern used for `cryptoLib`) so the read is
unit-testable without touching the real filesystem. Updated all three `adoptInPlace` unit tests to
mock `fsLib.readFile` and assert it's called with the right path (and *not* called when the
duplicate-stack check rejects first).

### WR-06: `checkSetupStatus()` network failure silently treated as "setup incomplete"

**Files modified:** `client/src/routes/setup.tsx`
**Commit:** `71cff17`
**Applied fix:** Added a `statusError` state that's set (instead of silently falling through) when
`checkSetupStatus()` rejects. Added a dedicated error-state render branch ("Unable to Check Setup
Status" card with a "Retry" button that re-runs the check) rendered before the `setupComplete`
branch, so a transient network failure never causes the full wizard (including account creation) to
render on an already-configured instance.

### WR-07: TOCTOU race in `POST /api/setup/step1` allows duplicate admin accounts

**Files modified:** `server/src/routes/setup.ts`
**Commit:** `72102b9`
**Applied fix:** Added an atomic "first admin" lock using `Setting.key` (the table's primary key) as
the synchronization primitive: the handler attempts `prisma.setting.create({key: "setup.step1Lock", ...})`
before calling `onboardingService.handleWizardStep1`; Postgres's primary-key uniqueness guarantees
only one of two concurrent requests can win the insert, so the loser is rejected with 400 before it
ever reaches `signUpEmail`. The lock is always released in a `finally` block regardless of success or
failure, so it only needs to survive the race window — `userCount > 0` remains the durable
"already complete" guard for all future requests once the winning request succeeds.
**Status flag: `fixed: requires human verification`** — this is a concurrency-correctness fix; static
type-checking and the existing (non-concurrent) test suite cannot prove the race is actually closed.
Recommend a dedicated concurrent-request integration test (two simultaneous `POST /api/setup/step1`
calls against the real test-container Postgres) before fully trusting this fix.

### WR-08: Imprecise prefix match for the first-run gate exemption

**Files modified:** `server/src/app.ts`
**Commit:** `533ce8f`
**Applied fix:** Changed `request.url.startsWith("/api/setup")` to
`request.url.startsWith("/api/setup/") || request.url === "/api/setup"`, exactly as suggested in the
review, so a hypothetical future `/api/setupanything` route cannot be accidentally exempted from this
security-relevant first-run gate.

### WR-09: `MigrationWizard.handleMigrate` continued updating state after unmount

**Files modified:** `client/src/routes/setup/components/migration-wizard.tsx`,
`client/src/routes/setup/components/brownfield-step.tsx`
**Commit:** `c1ef57a`
**Applied fix:** Moved the async `executeMigration` call and its toast/state-update logic out of
`MigrationWizard` (which closes/unmounts immediately on confirm) and into `BrownfieldStep` (the
parent, which stays mounted for the whole background migration). `MigrationWizard.handleMigrate` is
now a synchronous function that calls a new `onConfirmMigrate` prop and closes the dialog — it no
longer performs any `await`s or state updates after the point where it becomes eligible to unmount.
As a minor consistency improvement while moving this code, the "View stack" toast action now uses
`react-router`'s `navigate()` (matching the adjacent `handleAdopt` pattern in the same file) instead
of a full-page `window.location.href` reload.

### WR-10: `compose.yml` (no `docker-` prefix) not recognized by scanner or adopt

**Files modified:** `server/src/infrastructure/brownfield-scanner.ts`,
`server/src/application/onboarding-service.ts`,
`server/test/unit/infrastructure/brownfield-scanner.test.ts`,
`server/test/unit/application/onboarding-service.test.ts`
**Commit:** `6af6226`
**Applied fix:** Added `"**/compose.yml"` to `BrownfieldScanner.COMPOSE_FILE_PATTERNS`. Extended the
`adoptInPlace` hostPath-stripping regex from
`/[\/\\]docker-compose\.(yml|yaml)$|[\/\\]compose\.yaml$/` to
`/[\/\\](docker-compose\.(yml|yaml)|compose\.(yml|yaml))$/` to also strip a bare `compose.yml`
filename. Added a regression test for each: scanner now finds bare `compose.yml` files (asserting
the glob pattern itself includes `**/compose.yml`, not just that a mocked result is processed), and
`adoptInPlace` now correctly derives `hostPath` for a `compose.yml`-suffixed `composePath`.

## Skipped Issues

None — all 15 in-scope findings were fixed.

---

_Fixed: 2026-08-31T10:55:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
