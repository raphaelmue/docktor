---
phase: 05-onboarding
plan: 01
subsystem: onboarding
tags: [validation, testing, tdd-wave-0, schemas]
dependency_graph:
  requires: [Phase 4 crypto patterns, Phase 3 SMTP schemas, existing Zod patterns]
  provides: [wizard validation schemas, RED test contracts]
  affects: [Phase 5 Wave 1 implementation, onboarding flow]
tech_stack:
  added: [wizard.ts schemas]
  patterns: [per-step validation, RED-state TDD scaffolds, E2E test skeletons]
key_files:
  created:
    - shared/src/validation/wizard.ts
    - server/test/unit/application/onboarding-service.test.ts
    - server/test/unit/infrastructure/brownfield-scanner.test.ts
    - server/test/unit/infrastructure/compose-analyzer.test.ts
    - client/test/integration/setup-wizard.spec.ts
  modified:
    - shared/src/validation/index.ts
decisions:
  - Per-step Zod schemas (wizardStep1Schema through wizardStep5Schema) for granular validation
  - Reuse backupSettingsSchema from Phase 4 for wizard step 3 (backup config)
  - SMTP schema defined inline (not reusing from Phase 3 as structure differs)
  - E2E tests use test.skip() pattern for RED state scaffolds
  - Server unit tests use expect(true).toBe(false) for RED state assertions
metrics:
  duration_minutes: 5
  completed_date: "2026-04-08T14:52:13Z"
  tasks_completed: 3
  files_created: 5
  files_modified: 1
  tests_added: 51
  commits: 3
---

# Phase 05 Plan 01: TDD Foundation - Wizard Schemas & RED Test Scaffolds

**One-liner:** Zod validation schemas for 5-step wizard (account, settings, backup, SMTP, brownfield scan) plus RED test scaffolds defining contracts for OnboardingService, BrownfieldScanner, and ComposeAnalyzer.

## What Was Built

### Validation Schemas (shared/src/validation/wizard.ts)
- **wizardStep1Schema**: Email + password validation for account creation (WIZ-02)
- **wizardStep2Schema**: Instance name, base URL, timezone validation (WIZ-03)
- **wizardStep3Schema**: Reuses `backupSettingsSchema` for backup configuration (WIZ-04)
- **wizardStep4Schema**: SMTP host, port, encryption, credentials validation (WIZ-05)
- **wizardStep5Schema**: Directories array for brownfield scan (WIZ-06)

All schemas export TypeScript types via `z.infer` and are barrel-exported from `@docktor/shared`.

### Server Unit Test Scaffolds (RED state)
1. **onboarding-service.test.ts** (11 tests)
   - handleWizardStep1: better-auth `signUpEmail` integration + auto-login session token return
   - handleWizardStep2: save instanceName, baseUrl, timezone to Settings repository
   - handleWizardStep3: encrypt restic password before saving backup config
   - handleWizardStep4: encrypt SMTP password before saving notification config
   - adoptInPlace: create Stack record with hostPath, no file operations (zero downtime)

2. **brownfield-scanner.test.ts** (7 tests)
   - scan: find docker-compose.{yml,yaml} and compose.yaml files
   - skip system directories (/proc, /sys, /dev) with warnings
   - gracefully handle permission errors (EACCES/EPERM)
   - return skippedDirectories count in results
   - exclude node_modules and .git directories
   - return absolute paths for discovered compose files

3. **compose-analyzer.test.ts** (15 tests)
   - analyzeCompatibility: traffic light logic (green = relative bind mounts only, yellow = named volumes OR absolute paths OR inline env vars, red = configs/secrets/depends_on conditions)
   - extractNamedVolumes: parse top-level volumes section
   - extractBindMounts: categorize relative vs absolute paths
   - extractInlineEnvVars: detect object-form environment variables (not array-form `${VAR}` references)

### Client E2E Test Scaffold (18 tests, all skipped)
**setup-wizard.spec.ts** - Playwright E2E tests covering:
- First-run wizard flow (7 tests): redirect detection, stepper navigation, account creation, settings save, skip optional steps, post-wizard redirect, re-visit prevention
- Brownfield scan flow (3 tests): directory scan, compatibility badges, permission error handling
- Adopt in-place flow (2 tests): zero-downtime adoption, dashboard integration
- Migration wizard flow (6 tests): wizard dialog, volume selection, diff preview, background migration, success/failure toasts, rollback

## Deviations from Plan

None. Plan executed exactly as specified.

## Key Decisions

### 1. Reuse backupSettingsSchema for wizard step 3
**Context:** Step 3 of wizard collects backup repository configuration (same fields as Settings > Backup).

**Decision:** Import and reuse `backupSettingsSchema` from `backups.ts` instead of duplicating validation logic.

**Rationale:** DRY principle. Backup config structure is identical in both contexts. Single source of truth for validation rules (conditional required fields per repoType).

**Alternatives considered:**
- Duplicate schema in wizard.ts → rejected: maintenance burden, schema drift risk
- Create shared base schema → rejected: over-engineering for Phase 5 scope

---

### 2. Inline SMTP schema (not reusing from Phase 3)
**Context:** Phase 3 SMTP settings likely stored as individual Setting rows. Wizard step 4 validates form as single object.

**Decision:** Define `wizardStep4Schema` inline with all SMTP fields (host, port, encryption, username, password, from).

**Rationale:** Wizard validation is form-centric (one submit action, all fields validated together). Phase 3 settings validation may be field-by-field. Decoupling schemas allows future refactoring without breaking wizard.

**Alternatives considered:**
- Reuse Phase 3 SMTP schema if it exists → rejected: unknown structure, may not match wizard form shape
- Wait for Phase 3 refactor → rejected: blocks Phase 5 progress

---

### 3. RED state test patterns
**Context:** Wave 0 tests must fail predictably to guide implementation.

**Decision:** 
- Server unit tests: `expect(true).toBe(false)` with implementation code commented out
- E2E tests: `test.skip()` with TODO comments

**Rationale:** Server tests need actual assertions to drive TDD (implementation removes RED assertions). E2E tests are scaffolds only — actual assertions added during UI implementation.

**Alternatives considered:**
- All tests use `test.skip()` → rejected: loses TDD value for server-side logic
- No commented implementation hints → rejected: harder for Wave 1 implementers to understand test intent

## Test Coverage

| Requirement | Test File | Test Count | Status |
|-------------|-----------|------------|--------|
| WIZ-02 | onboarding-service.test.ts | 2 | RED |
| WIZ-03 | onboarding-service.test.ts | 2 | RED |
| WIZ-04 | onboarding-service.test.ts | 2 | RED |
| WIZ-05 | onboarding-service.test.ts | 2 | RED |
| WIZ-06 | brownfield-scanner.test.ts | 1 | RED |
| WIZ-07 | setup-wizard.spec.ts | 5 | SKIPPED |
| BF-01 | brownfield-scanner.test.ts | 6 | RED |
| BF-02 | compose-analyzer.test.ts | 15 | RED |
| BF-03 | onboarding-service.test.ts | 3 | RED |
| BF-04 | setup-wizard.spec.ts | 5 | SKIPPED |
| BF-05 | setup-wizard.spec.ts | 1 | SKIPPED |

**Total:** 51 tests (33 RED server unit tests, 18 skipped E2E tests)

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| e1a1ce9 | feat(05-01): add wizard validation schemas | wizard.ts, index.ts |
| 466b979 | test(05-01): add RED test scaffolds for onboarding service and brownfield | onboarding-service.test.ts, brownfield-scanner.test.ts, compose-analyzer.test.ts |
| ccd2944 | test(05-01): add E2E test scaffold for setup wizard | setup-wizard.spec.ts |

## Next Steps (Wave 1)

1. Implement `OnboardingService` in `server/src/application/onboarding-service.ts`
   - Wire better-auth `signUpEmail` for step 1
   - Use existing SettingsRepository for steps 2-4
   - Use existing crypto.encrypt for password encryption
   - Implement `adoptInPlace()` for BF-03

2. Implement `BrownfieldScanner` in `server/src/infrastructure/brownfield-scanner.ts`
   - Use fast-glob for recursive search
   - Add system directory exclusion (/proc, /sys, /dev)
   - Handle permission errors gracefully
   - Return skippedDirectories count

3. Implement `ComposeAnalyzer` in `server/src/infrastructure/compose-analyzer.ts`
   - Parse compose with existing yaml library
   - Detect named volumes (top-level volumes key)
   - Detect absolute paths (volume host path starts with /)
   - Detect inline env vars (object-form environment)
   - Detect unsupported features (configs, secrets, depends_on conditions)

4. Create setup wizard UI in `client/src/routes/setup.tsx`
   - 5-step stepper with numbered navigation
   - Per-step forms using wizardStep schemas
   - Skip buttons for optional steps (3-5)
   - Post-wizard redirect to dashboard

5. Create middleware redirect in `server/src/app.ts`
   - Check User count on every request
   - Redirect to /setup if count === 0
   - Exclude /setup and /api/auth/* from redirect

## Self-Check: PASSED

### Created Files Exist
- [x] shared/src/validation/wizard.ts — FOUND
- [x] server/test/unit/application/onboarding-service.test.ts — FOUND
- [x] server/test/unit/infrastructure/brownfield-scanner.test.ts — FOUND
- [x] server/test/unit/infrastructure/compose-analyzer.test.ts — FOUND
- [x] client/test/integration/setup-wizard.spec.ts — FOUND

### Modified Files Updated
- [x] shared/src/validation/index.ts — export * from "./wizard.js" present

### Commits Exist
- [x] e1a1ce9 — FOUND
- [x] 466b979 — FOUND
- [x] ccd2944 — FOUND

### TypeScript Compilation
- [x] `yarn workspace @docktor/shared tsc --noEmit` — passed
- [x] `yarn workspace @docktor/client tsc --noEmit` — passed

### Tests in RED State
- [x] Server unit tests fail with "expected true to be false" — 33 failing tests confirmed
- [x] E2E tests skipped — 18 skipped tests confirmed
