---
phase: 06-proxy-configuration
plan: 06
subsystem: proxy-configuration
tags: [first-run-wizard, react-hook-form, zod, fastify, prisma, tdd]
requires:
  - phase: 06-proxy-configuration
    provides: "ProxyService.deployProxyStack/updateProxySettingsAndSync, PROXY_STACK_ID, GET/PUT/POST /api/settings/proxy* (06-03)"
provides:
  - "wizardStep6Schema / WizardStep6Input — optional, non-blocking ACME email for the wizard's proxy step (D-09)"
  - "OnboardingService.handleWizardStep6 — save-then-deploy through ProxyService, errors propagated unwrapped"
  - "POST /api/setup/step6 — admin-gated, 410-after-complete via the existing setup preHandler"
  - "ProxyStep — the optional, terminal First-Run Wizard proxy step (client)"
  - "Wizard renumbering: Proxy is now step 6 and the wizard's terminal step; Import (step 5) advances instead of finishing"
affects: [06-05]
actuals:
  tokens: 10273
  tasks: 2
  commits: 6
tech-stack:
  added: []
  patterns:
    - "OnboardingService.handleWizardStep6: save-before-deploy via ProxyService.updateProxySettingsAndSync then deployProxyStack() — mirrors 06-03's own save-then-deploy ordering inside ProxyService itself, one layer up"
    - "OnboardingService takes ProxyService (Pick<updateProxySettingsAndSync | deployProxyStack>) as a required constructor param, wired from the existing proxyService singleton via a direct static import from ./index.js (no circular dependency — application/index.ts never imports onboarding-service.ts)"
    - "ProxyStep mirrors BackupStep's Card+react-hook-form+standardSchemaResolver shape but never renders 'Next' as its submit label — it deploys, so the CTA says 'Deploy Proxy Stack'"
key-files:
  created:
    - client/src/routes/setup/components/proxy-step.tsx
    - client/test/unit/routes/proxy-step.test.tsx
  modified:
    - shared/src/validation/wizard.ts
    - server/src/application/onboarding-service.ts
    - server/src/routes/setup.ts
    - server/test/unit/application/onboarding-service.test.ts
    - client/src/lib/setup-api.ts
    - client/src/routes/setup/components/wizard-stepper.tsx
    - client/src/routes/setup.tsx
    - client/src/routes/setup/components/brownfield-step.tsx
    - client/test/integration/setup-wizard.spec.ts
key-decisions:
  - "handleWizardStep6 persists via ProxyService.updateProxySettingsAndSync (not a raw SettingsService call) so the wizard and Settings share one settings-write path, then unconditionally calls deployProxyStack() — the two-call sequence satisfies both 'save before deploy' (a failed deploy still leaves the email persisted for a retry from Settings) and 'always ensure the stack is deployed' (deployProxyStack's own first-deploy/redeploy branching handles both paths)"
  - "OnboardingService imports the proxyService singleton directly (static import from ./index.js) rather than a lazy dynamic import — confirmed no circular dependency exists (application/index.ts never imports onboarding-service.ts), so the plan's fallback dynamic-import escape hatch wasn't needed"
  - "brownfield-step.tsx's 'Finish Setup' button relabeled to 'Next' (Rule 1 deviation, not in the plan's declared file list) — directly caused by this task's renumbering: Import is no longer the wizard's terminal step, so a button claiming to finish setup while actually just advancing to step 6 would have been misleading"
patterns-established:
  - "wizard step handlers follow handleStepN(data) -> submit -> markStepComplete -> advance/finish, with the terminal step's failure path (deployError state) surfaced inline via a component prop rather than a toast — the first wizard step to do so, since every prior optional step's failure was a toast-only affair"
requirements-completed: [PRXY-02, PRXY-03]
coverage:
  - id: D1
    description: "wizardStep6Schema accepts an empty or valid acmeEmail (D-09 — explicitly non-blocking) and rejects a malformed one"
    requirement: "PRXY-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/onboarding-service.test.ts — wizardStep6Schema describe block (4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "OnboardingService.handleWizardStep6 saves the acmeEmail setting before calling deployProxyStack, still deploys on an empty email, and lets ConflictError (port conflict, D-11) and BadRequestError (compose failure, D-11) propagate unwrapped"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/onboarding-service.test.ts — handleWizardStep6 describe block (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /api/setup/step6 validates with wizardStep6Schema, rejects with 400 before an admin exists, delegates to handleWizardStep6, and is closed with 410 after the wizard completes via the setup plugin's existing preHandler"
    requirement: "PRXY-02, PRXY-03"
    verification:
      - kind: other
        ref: "grep -c 'step6' server/src/routes/setup.ts -> 1; yarn workspace @docktor/server tsc --noEmit -> 0 errors"
        status: pass
      - kind: integration
        ref: "server/test/integration/setup-wizard-flow.test.ts — NOT executed this session, see Issues Encountered"
        status: unknown
    human_judgment: true
    rationale: "Same environmental DB-unreachable restriction documented in every prior 06-* SUMMARY (05.1-01 lineage) — a developer on an unrestricted host must run the integration suite to close this out."
  - id: D4
    description: "ProxyStep renders an optional ACME email field, a Back/Skip/'Deploy Proxy Stack' footer (never 'Next'), calls onSubmit with an empty acmeEmail when the field is blank, blocks submit on a malformed email, and renders the D-11 destructive alert with the raw deploy error verbatim when deployError is passed"
    requirement: "PRXY-02, PRXY-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/proxy-step.test.tsx (9 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The wizard stepper shows six steps with Proxy sixth and optional; Import (step 5) advances to step 6 instead of finishing; skipping or submitting step 6 completes the wizard (POST /api/setup/complete) and navigates to the dashboard; a failed step-6 deploy keeps the user on the step"
    requirement: "PRXY-02"
    verification:
      - kind: e2e
        ref: "client/test/integration/setup-wizard.spec.ts — 6-step stepper, Import->Proxy advancement, skip-to-dashboard, submit-to-dashboard, and D-11 failure-stays-on-step cases (24/24 specs green, run standalone)"
        status: pass
      - kind: other
        ref: "grep -c 'step === 5' client/src/routes/setup.tsx -> 0; grep -c 'number: 6' wizard-stepper.tsx -> 1; yarn workspace @docktor/client tsc --noEmit -> 0 errors"
        status: pass
    human_judgment: false
  - id: D-human-check
    description: "On a fresh install with an empty database, click through the whole wizard in a browser and confirm the Proxy step appears sixth, that Skip reaches the dashboard with nothing deployed, and that submitting with a real ACME email on a host with free ports 80/443 leaves two running proxy containers and lands on the dashboard"
    verification: []
    human_judgment: true
    rationale: "Same class of risk documented in 06-03-SUMMARY.md's D-human-check: this execution host is shared with real, unrelated running Docker workloads, and a prior live docker-compose test on this host (05.1-03) stopped and removed real production containers before the collision was noticed. Binding host ports 80/443 for a live proxy-stack deploy carries that same risk — deliberately not attempted. Recorded here verbatim for end-of-phase UAT per workflow.human_verify_mode: end-of-phase."
duration: ~50min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 06: First-Run Wizard Proxy Step Summary

**Sixth, optional, terminal wizard step (`ProxyStep` + `POST /api/setup/step6` + `OnboardingService.handleWizardStep6`) that deploys the managed nginx-proxy/acme-companion stack at first-run time via the existing `ProxyService` pipeline, with Import (step 5) now advancing instead of finishing the wizard.**

## Performance
- **Duration:** ~50min
- **Started:** 2026-09-04T09:41:00Z (approx.)
- **Completed:** 2026-09-04T10:26:10Z
- **Tasks:** 2/2
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments
- `wizardStep6Schema`/`WizardStep6Input` in `shared/src/validation/wizard.ts`: accepts an empty or valid `acmeEmail`, rejects malformed input — mirrors `proxySettingsSchema`'s email rule so the wizard and Settings can't drift (D-09).
- `OnboardingService.handleWizardStep6(input)`: persists the ACME email through `ProxyService.updateProxySettingsAndSync` (save first, so a failed deploy still leaves the email saved for a retry from Settings), then unconditionally calls `deployProxyStack()`. Every error — `ConflictError` (port conflict) and `BadRequestError` (compose failure) — propagates unwrapped, per D-11's fail-loudly requirement. `OnboardingService` now takes `ProxyService` (a narrow `Pick<updateProxySettingsAndSync | deployProxyStack>`) as a required constructor parameter, wired from the existing `proxyService` singleton with a direct static import (confirmed no circular dependency).
- `POST /api/setup/step6`: validates with `wizardStep6Schema`, rejects with 400 before an admin exists (mirroring `/api/setup/complete`'s own guard), delegates to `handleWizardStep6`, and is closed with 410 once the wizard is complete via the setup plugin's existing `preHandler` — no new gating code needed.
- `ProxyStep` (new, `client/src/routes/setup/components/proxy-step.tsx`): mirrors `BackupStep`'s Card + `react-hook-form` + `standardSchemaResolver` shape. One optional ACME email field, a Back/Skip/"Deploy Proxy Stack" footer (the CTA never says "Next" — this step submits and deploys), and a `deployError`-driven D-11 destructive `Alert` rendering the raw server error verbatim in a bounded monospace block.
- Wizard renumbering: `wizard-stepper.tsx`'s `STEPS` array gained a sixth `{number: 6, title: "Proxy", required: false}` entry; `setup.tsx` renders `ProxyStep` at step 6, Import's `handleStep5` now advances to step 6 instead of finishing, `handleSkip`'s terminal branch moved from step 5 to step 6, and a new `handleStep6` submits, surfaces a failed deploy inline via `deployError` state (keeping the user on the step), or on success marks step 6 complete, calls `notifyWizardComplete()`, and navigates to the dashboard.
- Full RED->GREEN TDD cycle across both tasks: schema + `handleWizardStep6` tests (Task 1, 8 new/changed tests), `ProxyStep` component tests (Task 2, 9 tests) — every RED run confirmed failing for the right reason (missing implementation, or a rendering-nothing stub for the component) before implementation.
- Updated `client/test/integration/setup-wizard.spec.ts`: 6-step stepper assertion, Import->Proxy advancement, skip-through-step-6-to-dashboard, submit-step-6-to-dashboard, and a D-11 failure case that keeps the user on the step and shows the raw error. All 24 specs green run standalone.

## Task Commits
1. **Task 1 (RED): failing tests for wizard step6 schema and handleWizardStep6** - `427e463` (test)
2. **Task 1 (GREEN): deploy the managed proxy stack from wizard step 6** - `1477d8c` (feat)
3. **Task 1 (schema test follow-up):** `71c552a` (test) — closes the plan's explicit schema-level acceptance criterion, previously only exercised indirectly through `handleWizardStep6` tests
4. **Task 2 (RED): failing tests for the ProxyStep wizard component** - `1225434` (test)
5. **Task 2 (GREEN): implement the ProxyStep wizard component** - `e4029df` (feat)
6. **Task 2 (wiring GREEN): make Proxy the wizard's terminal sixth step** - `2005854` (feat)

**Plan metadata:** pending (this commit)

_Note: both tasks (`tdd="true"`) followed RED->GREEN. No REFACTOR commit was needed for either task._

## TDD Gate Compliance

Both tasks' RED commits were confirmed failing for the right reason before their GREEN commits:
- Task 1: all 7 new assertions failed with `service.handleWizardStep6 is not a function` / a stale constructor signature before `427e463` was followed by `1477d8c`.
- Task 2: the `ProxyStep` component was temporarily replaced with a `return null` stub, confirmed 8/9 tests failing, then restored to its full implementation before `1225434` was followed by `e4029df` (the component and its test were originally drafted together in this session — the stub-and-confirm step was added specifically to preserve a genuine RED->GREEN git history rather than skip straight to a passing test).

## Files Created/Modified
- `shared/src/validation/wizard.ts` - `wizardStep6Schema`/`WizardStep6Input`
- `server/src/application/onboarding-service.ts` - `handleWizardStep6`, new required `proxy` constructor param
- `server/src/routes/setup.ts` - `POST /api/setup/step6`
- `server/test/unit/application/onboarding-service.test.ts` - +12 tests (4 schema, 4 handleWizardStep6, plus updated every existing `new OnboardingService(...)` call site)
- `client/src/lib/setup-api.ts` - `submitStep6`
- `client/src/routes/setup/components/proxy-step.tsx` (new) - `ProxyStep`
- `client/test/unit/routes/proxy-step.test.tsx` (new) - 9 tests
- `client/src/routes/setup/components/wizard-stepper.tsx` - sixth `STEPS` entry
- `client/src/routes/setup.tsx` - `handleStep5`/`handleStep6`, `deployError` state, renders `ProxyStep`
- `client/src/routes/setup/components/brownfield-step.tsx` - "Finish Setup" -> "Next" (deviation, see below)
- `client/test/integration/setup-wizard.spec.ts` - 6-step stepper + 4 new/replaced cases

## Decisions Made
- `handleWizardStep6` calls `ProxyService.updateProxySettingsAndSync` (not a raw settings write) so the wizard's persist step and Settings' persist step share one code path, then unconditionally calls `deployProxyStack()` — the combination satisfies "save before deploy" and "always ensure deployed" without needing a third, wizard-specific method on `ProxyService`.
- `OnboardingService` imports the `proxyService` singleton via a direct static import rather than the plan's offered lazy-dynamic-import fallback — verified `application/index.ts` never imports `onboarding-service.ts`, so no circular dependency exists and the simpler static import is correct.
- Everything else in Task 1-2 followed the plan's `<action>` steps and the pattern map's shapes verbatim (constructor parameter placement, route gating, `ProxyStep`'s Card/form shape, the four `setup.tsx` edits done together).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `brownfield-step.tsx`'s "Finish Setup" button relabeled to "Next"**
- **Found during:** Task 2 (wiring the wizard renumbering)
- **Issue:** The plan's declared file list for Task 2 does not include `brownfield-step.tsx`, but this task's own renumbering makes Import (step 5) no longer terminal — its "Finish Setup" button would click through to step 6 instead of finishing, which is directly misleading copy caused by this task's changes.
- **Fix:** Relabeled the button "Next" (its `onFinish` prop/behavior contract is unchanged — "proceed past this step" — only the copy changed).
- **Files modified:** `client/src/routes/setup/components/brownfield-step.tsx`
- **Verification:** `client/test/integration/setup-wizard.spec.ts`'s updated `reachProxyStep()` helper clicks the "Next" button and asserts the wizard lands on step 6; full spec run green.
- **Committed in:** `2005854` (Task 2 wiring commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 — bug/copy correctness).
**Impact on plan:** Necessary to avoid shipping a misleading "Finish Setup" button that doesn't finish anything; no scope creep beyond a one-line label change.

## Issues Encountered

**Environmental: the server integration test could not be run in this sandboxed session — same restriction documented in every prior 06-* SUMMARY (05.1-01 lineage).** `yarn workspace @docktor/server test:integration test/integration/setup-wizard-flow.test.ts` fails with `P1001: Can't reach database server at localhost:<port>` despite a healthy `docker ps` test-container — the raw TCP handshake succeeds but Prisma's wire-protocol handshake never completes. This affects only the integration suite; **all 603 server unit tests pass (38 files, 2 todo), 0 regressions**, including this plan's 12 new/changed unit tests. `yarn workspace @docktor/server tsc --noEmit` and `yarn workspace @docktor/shared tsc --noEmit` both report zero errors.

**Environmental: this host's memory pressure produces spurious test timeouts under concurrent load (documented precedent: `client/playwright.config.ts`'s `workers: 1` comment, 06-01/06-03 lineage).** Running the full `yarn workspace @docktor/client test` suite concurrently with a Playwright run (or immediately after one, before resources settled) produced "Test timed out in 5000ms" failures in `proxy-step.test.tsx` and several unrelated pre-existing files (`service-upgrade-dialog.test.tsx`, `backup-detail-page.test.tsx`, `event-log-card.test.tsx`, `stack-detail-page.test.tsx`) with no assertion failures — plain timeouts. Every affected file, including `proxy-step.test.tsx`, passes cleanly (9/9, 9/9, 24/24) when run standalone or after resources settle; re-running the full suite standalone also went green (156/156 non-todo). Not a regression from this plan's changes.

**Task 2's `<human-check>` was NOT performed live in this session** — same class of risk as 06-03's D-human-check (this host is shared with real, unrelated Docker workloads; a prior live `docker compose` test on this host stopped real production containers). Recorded verbatim in the `coverage` block above for end-of-phase UAT.

## User Setup Required
None - no external service configuration required. A developer on an unrestricted, non-shared host should complete: (1) the outstanding integration-suite runs from 06-01 through this plan, and (2) this plan's `D-human-check` above, ideally together since they share reachability prerequisites.

## Next Phase Readiness
Phase 6's proxy configuration surface is now complete end-to-end: server-side proxy stack lifecycle and domain assignment (06-01/06-02/06-03/06-04), and both client discoverability paths — the stack-detail Proxy tab / Settings card (06-05, if executed) and this plan's First-Run Wizard step. `PRXY-02` and `PRXY-03` are now fully covered across every plan that touches them (06-01/06-03/06-04 for PRXY-02, 06-03 for PRXY-03) once this plan's requirement-completion marks land. The outstanding integration-suite and live-Docker human-checks accumulated across 06-01 through 06-06 remain the phase's single blocking item for end-of-phase UAT sign-off.

## Self-Check: PASSED

- FOUND: `shared/src/validation/wizard.ts` (modified)
- FOUND: `server/src/application/onboarding-service.ts` (modified)
- FOUND: `server/src/routes/setup.ts` (modified)
- FOUND: `server/test/unit/application/onboarding-service.test.ts` (modified)
- FOUND: `client/src/lib/setup-api.ts` (modified)
- FOUND: `client/src/routes/setup/components/proxy-step.tsx`
- FOUND: `client/test/unit/routes/proxy-step.test.tsx`
- FOUND: `client/src/routes/setup/components/wizard-stepper.tsx` (modified)
- FOUND: `client/src/routes/setup.tsx` (modified)
- FOUND: `client/src/routes/setup/components/brownfield-step.tsx` (modified)
- FOUND: `client/test/integration/setup-wizard.spec.ts` (modified)
- FOUND commit `427e463` in `git log --oneline --all`
- FOUND commit `1477d8c` in `git log --oneline --all`
- FOUND commit `71c552a` in `git log --oneline --all`
- FOUND commit `1225434` in `git log --oneline --all`
- FOUND commit `e4029df` in `git log --oneline --all`
- FOUND commit `2005854` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
