---
phase: 05-onboarding
verified: 2026-08-31T14:50:00Z
status: gaps_found
score: 3/5 roadmap truths verified
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "On first boot with no user in the database, the browser shows a multi-step setup wizard instead of the login page (Roadmap SC-1 / WIZ-01)"
    status: failed
    reason: >
      The server correctly gates every /api/* route with a 503 {error: "Setup required",
      redirectTo: "/setup"} response when no users exist (server/src/app.ts:63-87, confirmed
      present and correctly scoped after the WR-08 fix). However nothing on the client ever
      consumes that signal. `ProtectedRoute` in client/src/main.tsx only inspects the local
      better-auth `useSession()` result; when no session exists it unconditionally navigates to
      `/login` (main.tsx:29-31) — never to `/setup`. No global effect, router loader, or fetch
      interceptor calls `checkSetupStatus()` or reacts to a 503 anywhere outside the /setup route's
      own SetupPage component (which nothing routes the user to automatically). A fresh install
      visiting `/` therefore renders the plain login form, not the setup wizard — the literal
      behavior WIZ-01/SC-1 says must not happen. This is confirmed independently by (a) a direct
      code trace of main.tsx/ProtectedRoute/login-form.tsx showing no setup-status check exists
      anywhere in the unprotected path, and (b) the fixer's own explicit, still-skipped test:
      `client/test/integration/setup-wizard.spec.ts:114-115` — `test.skip(true, "Client has no
      handling of the 503 first-run-gate response yet (see app.ts) — not implemented")`. Neither
      05-03-PLAN.md (server-only truth: "Server redirects to /setup when no users exist in
      database") nor 05-05-PLAN.md (client truth: "/setup route is registered and accessible")
      ever actually committed to wiring automatic client-side redirection — the plan-level
      must-haves were satisfied, but the roadmap-level goal was not.
    artifacts:
      - path: "client/src/main.tsx"
        issue: "ProtectedRoute redirects unauthenticated visitors straight to /login; never checks setup status or handles a 503 redirectTo before doing so"
      - path: "client/src/routes/setup.tsx"
        issue: "Only reachable if the user manually types /setup in the address bar — no path in the app ever navigates them there automatically"
    missing:
      - "A root-level check (in App(), a router loader, or ProtectedRoute) that calls GET /api/setup/status — or a global fetch/response interceptor that reacts to any 503 {redirectTo} — before falling back to /login, and redirects to /setup when setup is incomplete"
      - "Un-skip client/test/integration/setup-wizard.spec.ts:114 ('should redirect to /setup when no users exist') once implemented"
behavior_unverified_items:
  - truth: "User can run the full migration wizard to move a stack into Docktor's directory structure, with automatic rollback on failure (Roadmap SC-5 / BF-05)"
    test: "Force a failure partway through MigrationService.migrate() (e.g. make docker.up() reject after the new stack directory/record are created) and assert: (1) the incomplete stack directory and DB record are removed, (2) the original stack directory is restored byte-for-byte from the pre-migration backup, (3) containers are restarted at the original location, (4) the temp backup directory is cleaned up either way."
    expected: "Original stack ends up running again exactly as before the migration attempt; no orphaned Stack DB record or half-written directory remains."
    why_human: "This is a cleanup/rollback invariant across multiple filesystem and Docker operations (migration-service.ts:206-253). No unit or integration test exercises this path — server/test has no migration-service.test.ts or volume-migrator.test.ts at all (self-acknowledged as a 'Test coverage gap' in 05-04-SUMMARY.md). Code reading confirms the rollback logic is present and plausible, but presence and wiring cannot prove the invariant holds at runtime; only an executed failure-path test can."
coincidental_reliance_items: []
human_verification:
  - test: "Re-run the Playwright integration suite for the setup wizard on a machine that is not under memory/CPU pressure: `yarn workspace @docktor/client exec playwright test setup-wizard --reporter=list`."
    expected: "A high pass rate confirming the wizard step-progression, brownfield scan, adopt-in-place, and migration-wizard UI flows work end-to-end."
    why_human: "Independently re-running this suite in this environment (per the task's request) produced 2 passed / 15 failed / 1 skipped out of 18 tests — a sharp contradiction of the 05-REVIEW-FIX.md claim that this is now real, trustworthy coverage. The host was concurrently under severe resource contention during the run (497Mi/15Gi RAM free, swap exhausted, load average 11.74 on a 6-core machine), which is a very plausible confound for the numerous 30s page.goto/click timeouts observed — but several failures (e.g. the WizardStepper's aria-current attribute never advancing to 'step 2' after a successful step-1 submit) look like they could also be a genuine step-progression race rather than pure infra slowness. This verification cannot distinguish the two causes from a single confounded run and did not have access to an unloaded machine to re-run it cleanly."
  - test: "Trigger two concurrent POST /api/setup/step1 requests (double-submit or two tabs) against a real Postgres instance and confirm only one admin account is created."
    expected: "The losing request receives a 400 'Setup already complete' response; exactly one User row exists afterward."
    why_human: "WR-07's fix relies on a Postgres unique-constraint race (Setting.key as a one-time lock row) that static analysis and the existing non-concurrent test suite cannot prove closes the race — explicitly flagged by the fixer as requiring human/integration verification (05-REVIEW-FIX.md)."
---

# Phase 5: Onboarding Verification Report

**Phase Goal:** New users reach a fully configured instance through a guided wizard; existing self-hosters can adopt running stacks into Docktor without downtime
**Verified:** 2026-08-31T14:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On first boot with no user in the database, the browser shows a multi-step setup wizard instead of the login page | ✗ FAILED | Server-side 503 gate exists and is correct (`server/src/app.ts:63-87`), but nothing on the client consumes it. `ProtectedRoute` (`client/src/main.tsx:18-34`) redirects any session-less visitor straight to `/login`; no code path ever navigates to `/setup` automatically. Confirmed by direct trace and by the still-skipped Playwright test with the fixer's own admission comment (`client/test/integration/setup-wizard.spec.ts:114-115`). |
| 2 | After completing the wizard, a new user has an account, basic settings configured, and is redirected to the dashboard | ✓ VERIFIED | `client/src/routes/setup.tsx` `handleStep1` calls `submitStep1` then `signIn.email(...)` (auto-login) before advancing; `handleFinish` calls `navigate("/")`. Server handlers persist account (`onboarding-service.ts:36-59`) and settings (`:64-68`). Playwright confirmation of this exact flow was inconclusive this run — see Human Verification. |
| 3 | User can scan the host filesystem for existing docker-compose.yml files and see a compatibility assessment for each | ✓ VERIFIED | `BrownfieldStep` → `scanDirectories()` → `POST /api/setup/scan` → `brownfieldScanner.scan()` (recognizes `docker-compose.yml/.yaml`, `compose.yaml/.yml`, excludes `/proc`,`/sys`,`/dev`, gracefully skips `EACCES`/`EPERM`) → `composeAnalyzer.analyzeCompatibility()` returns green/yellow/red → rendered via `CompatibilityBadge` with tooltip. |
| 4 | User can adopt a discovered stack in-place with zero downtime, and it immediately appears in the dashboard with live status | ✓ VERIFIED | `adoptInPlace()` (`onboarding-service.ts:140-177`) performs no filesystem writes and no container operations — it only reads the compose file and creates a `Stack` DB row pointing at the existing `hostPath`. Pre-existing StatePoller (Phase 1/2 infra) reconciles all DB-registered stacks, so the adopted stack is picked up without any Phase-5-specific wiring needed. |
| 5 | User can run the full migration wizard to move a stack into Docktor's directory structure, with automatic rollback on failure | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The happy path (stop → backup → copy → rewrite → deploy) and the UI (`MigrationWizard` two-step volume-selection + diff preview, wired to `POST /api/setup/migrate{,/preview}`) are present and correctly wired. The rollback-on-failure branch (`migration-service.ts:206-253`) is also present and plausible on inspection, but it is a cleanup/rollback invariant with **zero automated test coverage** (no `migration-service.test.ts` or `volume-migrator.test.ts` exists anywhere in the repo — self-acknowledged gap in `05-04-SUMMARY.md`). Presence + wiring cannot prove this invariant holds at runtime. |

**Score:** 3/5 truths verified (1 present, behavior-unverified; 1 failed)

### Requirements Coverage (WIZ-*, BF-*)

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WIZ-01 | 05-03, 05-05 | Setup wizard shown instead of login on first boot | ✗ BLOCKED | Server gate correct; client never wires the redirect (see Gap #1 above). Plan-level must-haves ("server redirects", "/setup route is accessible") were satisfied but never actually required *automatic* client navigation, so the requirement's real intent slipped through. |
| WIZ-02 | 05-01, 05-03, 05-07 | Step 1: create admin account | ✓ SATISFIED | `AccountStep` (react-hook-form + `wizardStep1Schema`) → `handleWizardStep1` → better-auth `signUpEmail`. Unit-tested (`onboarding-service.test.ts`). |
| WIZ-03 | 05-01, 05-03, 05-07 | Step 2: instance name/base URL/timezone | ✓ SATISFIED | `SettingsStep` (IANA-validated timezone combobox) → `handleWizardStep2` → `SettingsRepository.upsert`. |
| WIZ-04 | 05-01, 05-03, 05-07 | Step 3 (optional): backup repository config | ✓ SATISFIED | `BackupStep` (now react-hook-form + Zod per WR-02 fix) → `handleWizardStep3`, S3 secret/restic password AES-encrypted via `cryptoLib.encrypt`. |
| WIZ-05 | 05-01, 05-03, 05-07 | Step 4 (optional): SMTP config | ✓ SATISFIED | `NotificationsStep` (react-hook-form + Zod per WR-02 fix) → `handleWizardStep4`, SMTP password encrypted. |
| WIZ-06 | 05-01, 05-02, 05-06 | Step 5: brownfield scan trigger | ✓ SATISFIED | `BrownfieldStep` directory input + `scanDirectories()`. |
| WIZ-07 | 05-03, 05-05 | Redirect to dashboard after completion | ✓ SATISFIED (code) | `handleFinish` → `navigate("/")`; session already established via auto-login in step 1. Not independently confirmed behaviorally this run (Playwright suite mostly failed — see Human Verification). |
| BF-01 | 05-01, 05-02, 05-06 | Scan host filesystem for compose files | ✓ SATISFIED | `BrownfieldScanner.scan()`, 15 passing unit tests. |
| BF-02 | 05-01, 05-02, 05-08 | Compatibility assessment (green/yellow/red) | ✓ SATISFIED | `ComposeAnalyzer.analyzeCompatibility()`, 21 passing unit tests; `CompatibilityBadge` UI. |
| BF-03 | 05-01, 05-03, 05-06 | Adopt stack in-place, zero downtime | ✓ SATISFIED | `adoptInPlace()` — no file moves, no container restarts. |
| BF-04 | 05-04, 05-06 | Full migration wizard (stop→copy→convert→rewrite→restart) | ✓ SATISFIED | `MigrationService.migrate()` + `MigrationWizard` UI; long-form volume entries fixed (CR-03); path-traversal-hardened (CR-02). |
| BF-05 | 05-04, 05-06 | Rollback on failure + user cleanup | ⚠️ NEEDS HUMAN | See truth #5 above — code present, behaviorally unverified (no test exercises the failure path). |

**Orphaned requirements:** None — all 12 IDs mapped to phase 5 in REQUIREMENTS.md are claimed by at least one plan's `requirements` field.

### Required Artifacts

All artifacts declared across the 8 plans' `must_haves.artifacts` exist, are substantive (well above stated `min_lines`), and export the declared symbols. Spot-checked in full:

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `shared/src/validation/wizard.ts` | 5 wizard-step Zod schemas | ✓ VERIFIED | All 5 `wizardStepNSchema` exports present; barrel-exported via `shared/src/validation/index.ts` → `shared/src/index.ts`. |
| `server/src/infrastructure/brownfield-scanner.ts` | Filesystem scanner | ✓ VERIFIED | `BrownfieldScanner`, `ScanResult`, `DiscoveredStack` exported; 125 lines. |
| `server/src/infrastructure/compose-analyzer.ts` | Compatibility engine | ✓ VERIFIED | `ComposeAnalyzer`, `CompatibilityLevel`, `AnalysisResult` exported; 175 lines. |
| `server/src/infrastructure/compose-rewriter.ts` | YAML rewriter | ✓ VERIFIED | `ComposeRewriter`, `RewriteResult` exported; long-form volume handling confirmed present (CR-03 fix). |
| `server/src/infrastructure/volume-migrator.ts` | Volume→bind-mount copy | ✓ VERIFIED | `VolumeMigrator` exported; 53 lines. |
| `server/src/application/onboarding-service.ts` | Wizard step handlers, adopt-in-place | ✓ VERIFIED | `OnboardingService`, `onboardingService` exported; typed-error hierarchy used (WR-03 fix confirmed). |
| `server/src/application/migration-service.ts` | Migration orchestration + rollback | ✓ VERIFIED (present); rollback behaviorally unproven | `MigrationService`, `migrationService` exported; path-traversal guard (`assertWithin`) and volume-name charset check (CR-02) confirmed present; backup cleanup on success (CR-04) confirmed present. |
| `server/src/routes/setup.ts` | Public wizard API routes | ✓ VERIFIED | Plugin-level `preHandler` guard (CR-01) confirmed closing the post-setup auth gap; TOCTOU lock (WR-07) confirmed present. |
| `server/src/app.ts` | First-run redirect middleware | ✓ VERIFIED (server-side only) | 503 gate present and correctly scoped (WR-08 exact-prefix fix confirmed) — but see Gap #1: nothing on the client consumes it. |
| `client/src/lib/setup-api.ts` | Setup API client | ✓ VERIFIED | All 9 declared functions exported (`checkSetupStatus`, `submitStep1-4`, `scanDirectories`, `adoptStack`, plus `previewMigration`/`executeMigration`). |
| `client/src/routes/setup/components/wizard-stepper.tsx` | 5-step indicator | ✓ VERIFIED | Correct `aria-current`/`aria-label` logic on inspection. |
| `client/src/routes/setup.tsx` | Wizard page shell | ✓ VERIFIED | 227 lines; manages all 5 steps, WR-06 retry-on-status-error fix confirmed present. |
| `client/src/routes/setup/components/{account,settings,backup,notifications}-step.tsx` | Step forms | ✓ VERIFIED | All use react-hook-form + `standardSchemaResolver` (WR-02 fix confirmed for backup/notifications). |
| `client/src/routes/setup/components/brownfield-step.tsx` | Scan/adopt/migrate UI | ✓ VERIFIED | 266 lines; WR-09 fix confirmed (migration execution moved to this parent component). |
| `client/src/routes/setup/components/migration-wizard.tsx` | Migration modal | ✓ VERIFIED | 248 lines; synchronous `handleMigrate` handing off to parent (WR-09 fix confirmed). |
| `client/src/routes/setup/components/compatibility-badge.tsx`, `diff-viewer.tsx` | Badges + diff preview | ✓ VERIFIED | Both present and correctly implemented. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `shared/src/index.ts` | `shared/src/validation/wizard.ts` | barrel export | ✓ WIRED |
| `server/src/app.ts` | `server/src/routes/setup.ts` | `app.register(setupRoutes)` | ✓ WIRED |
| `server/src/routes/setup.ts` | `server/src/application/onboarding-service.ts` | import + call | ✓ WIRED |
| `server/src/application/migration-service.ts` | `compose-rewriter.ts`, `volume-migrator.ts` | import + call | ✓ WIRED |
| `client/src/main.tsx` | `client/src/routes/setup.tsx` | `<Route path="/setup">` | ✓ WIRED (reachable), ✗ but never auto-navigated to (see Gap #1) |
| `client/src/routes/setup.tsx` | `client/src/lib/setup-api.ts` | direct calls | ✓ WIRED |
| `client/src/routes/setup/components/brownfield-step.tsx` | `client/src/lib/setup-api.ts` | scan/adopt/migrate calls | ✓ WIRED |
| `client/src/routes/setup/components/migration-wizard.tsx` | `diff-viewer.tsx` | import + render | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Server type-checks clean | `yarn workspace @docktor/server exec tsc --noEmit` | no output (0 errors) | ✓ PASS |
| Client type-checks clean | `yarn workspace @docktor/client exec tsc --noEmit` | no output (0 errors) | ✓ PASS |
| Phase-05 server unit tests pass | `vitest run test/unit/application/onboarding-service.test.ts test/unit/infrastructure/{brownfield-scanner,compose-analyzer,compose-rewriter}.test.ts` | 4 files, **52/52 tests passed** | ✓ PASS |
| Duplicate test suites removed (WR-04) | `ls server/test/unit/{onboarding-service,brownfield-scanner,compose-analyzer}.test.ts` | all three: no such file | ✓ PASS |
| Playwright setup-wizard integration suite | `yarn workspace @docktor/client exec playwright test setup-wizard --reporter=list` | **2 passed, 15 failed, 1 skipped** (of 18) | ✗ FAIL (see Human Verification — host was under severe resource contention during this run: 497Mi/15Gi RAM free, swap exhausted, load 11.74/6 cores) |

### Anti-Patterns Found

Scanned every file created/modified by phase 05 plans for `TBD`/`FIXME`/`XXX`, `TODO`/`HACK`/`PLACEHOLDER`, "not yet implemented"/"coming soon", empty-return stubs, and hardcoded-empty-props patterns.

**None found.** All `return null` / `return []` occurrences in touched files are legitimate parse-failure/not-found branches in pre-existing infrastructure (`registry-client.ts`, `docker-executor.ts`, `compose-analyzer.ts`'s volume-entry parser), not stubs hiding missing functionality. No debt markers of any kind in the phase-05-owned files.

**Additional quality gap (not a code smell, a coverage gap):** No client-side unit tests exist for any of the 9 new wizard/brownfield components (`account-step`, `settings-step`, `backup-step`, `notifications-step`, `wizard-stepper`, `brownfield-step`, `migration-wizard`, `compatibility-badge`, `diff-viewer`) — only the Playwright integration spec covers them, and that suite is currently failing the majority of its assertions in this environment. This is a CLAUDE.md testing-philosophy gap (`client/test/unit/ ← Component, hook, and lib unit tests`) worth addressing, though not itself a blocking gap for this verification.

## Gaps Summary

One blocking gap: **the phase's headline success criterion (SC-1 / WIZ-01 — "first boot shows the wizard instead of the login page") is not actually wired on the client.** The server-side first-run gate (`app.ts`) is correct and was hardened by the code-review fixes (CR-01, WR-08), but no client code ever consumes it — `ProtectedRoute` sends every session-less visitor to `/login`, and the setup wizard is only reachable by someone who already knows to type `/setup` manually. This was a known, explicitly-documented gap left out of scope by the review-fixer (visible as a `test.skip()` with a code comment in the Playwright spec) rather than something newly discovered — worth surfacing prominently since neither the phase's own `05-VERIFICATION-CHECKLIST.md` nor `05-PHASE-SUMMARY.md` flagged it, and REQUIREMENTS.md currently marks WIZ-01 "Complete."

Two additional items are present-and-wired but behaviorally unverified and require human/integration-test follow-up rather than a fix: automatic rollback on migration failure (BF-05, zero test coverage of the failure path) and the WR-07 TOCTOU concurrency fix (inherently unprovable by static analysis). Neither blocks the phase goal on its own, but both should be closed out with real tests before the phase is fully trusted.

The Playwright suite, independently re-run for this verification, produced 15/18 failures — a significant contradiction of the "all fixed, ready to trust" framing in `05-REVIEW-FIX.md`, though the host's severe resource contention during the run (swap exhausted, load 2x core count) makes it impossible to cleanly separate genuine step-progression bugs from environmental timeouts from this single run alone.

---

_Verified: 2026-08-31T14:50:00Z_
_Verifier: Claude (gsd-verifier)_
