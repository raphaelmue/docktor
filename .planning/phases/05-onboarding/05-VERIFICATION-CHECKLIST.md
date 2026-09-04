# Phase 5 Verification Checklist

**Phase:** 05-onboarding  
**Status:** Ready for verification  
**Date:** 2026-04-08

## Success Criteria (from ROADMAP.md)

- [ ] **SC-1:** On first boot with no user in the database, the browser shows a multi-step setup wizard instead of the login page
- [ ] **SC-2:** After completing the wizard, a new user has an account, basic settings configured, and is redirected to the dashboard
- [ ] **SC-3:** User can scan the host filesystem for existing docker-compose.yml files and see a compatibility assessment for each
- [ ] **SC-4:** User can adopt a discovered stack in-place with zero downtime, and it immediately appears in the dashboard with live status
- [ ] **SC-5:** User can run the full migration wizard to move a stack into Docktor's directory structure, with automatic rollback on failure

## Requirements Coverage

### Wizard Requirements (WIZ-*)
- [ ] **WIZ-01:** Multi-step setup wizard appears on first boot
- [ ] **WIZ-02:** Step 1 creates admin account with email/password
- [ ] **WIZ-03:** Step 2 configures instance settings (name, URL, timezone)
- [ ] **WIZ-04:** Step 3 configures optional backup repository
- [ ] **WIZ-05:** Step 4 configures optional SMTP notifications
- [ ] **WIZ-06:** Step 5 presents brownfield scan and import options
- [ ] **WIZ-07:** After completion, user is authenticated and redirected to dashboard

### Brownfield Import Requirements (BF-*)
- [ ] **BF-01:** User can scan directories for existing docker-compose.yml files
- [ ] **BF-02:** Each discovered stack shows compatibility assessment (green/yellow/red)
- [ ] **BF-03:** User can adopt stacks in-place with zero downtime
- [ ] **BF-04:** Full migration wizard moves stacks into Docktor directory structure
- [ ] **BF-05:** Migration has automatic rollback on failure

## Test Verification

### Unit Tests
- [ ] All onboarding-service.test.ts tests pass (11 tests)
- [ ] All brownfield-scanner.test.ts tests pass (7 tests)
- [ ] All compose-analyzer.test.ts tests pass (15 tests)
- [ ] **Total:** 33/33 server unit tests passing

### E2E Tests
- [ ] Setup wizard flow (setup-wizard.spec.ts)
- [ ] Brownfield scan and adopt-in-place
- [ ] Full migration wizard flow

### Manual Testing Scenarios

#### Scenario 1: First-Run Wizard (WIZ-01 through WIZ-07)
1. [ ] Start server with empty database
2. [ ] Visit root URL, verify redirect to /setup
3. [ ] Complete Step 1: Create account
4. [ ] Complete Step 2: Configure instance settings
5. [ ] Skip Step 3: Backup configuration
6. [ ] Skip Step 4: SMTP notifications
7. [ ] Skip Step 5: Brownfield import
8. [ ] Verify redirect to dashboard with authenticated session

#### Scenario 2: Brownfield Scan (BF-01, BF-02)
1. [ ] Create test compose files in various directories
2. [ ] Enter scan directories in Step 5
3. [ ] Verify scan completes successfully
4. [ ] Verify compatibility badges appear (green/yellow/red)

#### Scenario 3: Adopt In-Place (BF-03)
1. [ ] Click "Adopt" on a green-compatibility stack
2. [ ] Verify stack appears in dashboard immediately
3. [ ] Verify containers show correct status
4. [ ] Verify no files were moved or modified

#### Scenario 4: Full Migration (BF-04, BF-05)
1. [ ] Click "Migrate" on a yellow-compatibility stack
2. [ ] Select volumes to migrate in wizard step 1
3. [ ] Review diff preview in wizard step 2
4. [ ] Execute migration
5. [ ] Verify stack appears in Docktor directory structure
6. [ ] Verify containers restart successfully
7. [ ] Test rollback: trigger failure and verify automatic rollback

## Files Created/Modified

### Server (Backend)
- [ ] `shared/src/validation/wizard.ts` — Wizard schemas (5 steps)
- [ ] `server/src/infrastructure/brownfield-scanner.ts` — Filesystem scanner
- [ ] `server/src/infrastructure/compose-analyzer.ts` — Compatibility assessment
- [ ] `server/src/infrastructure/compose-rewriter.ts` — YAML transformation
- [ ] `server/src/infrastructure/volume-migrator.ts` — Volume data copy
- [ ] `server/src/application/onboarding-service.ts` — Wizard handlers
- [ ] `server/src/application/migration-service.ts` — Migration orchestration
- [ ] `server/src/routes/setup.ts` — Setup API endpoints
- [ ] `server/src/app.ts` — First-run middleware

### Client (Frontend)
- [ ] `client/src/lib/setup-api.ts` — Setup API client
- [ ] `client/src/routes/setup.tsx` — Main wizard page
- [ ] `client/src/routes/setup/components/wizard-stepper.tsx` — Step indicator
- [ ] `client/src/routes/setup/components/account-step.tsx` — Step 1 form
- [ ] `client/src/routes/setup/components/settings-step.tsx` — Step 2 form
- [ ] `client/src/routes/setup/components/backup-step.tsx` — Step 3 form
- [ ] `client/src/routes/setup/components/notifications-step.tsx` — Step 4 form
- [ ] `client/src/routes/setup/components/brownfield-step.tsx` — Step 5 scan UI
- [ ] `client/src/routes/setup/components/migration-wizard.tsx` — Migration modal
- [ ] `client/src/routes/setup/components/compatibility-badge.tsx` — Badge component
- [ ] `client/src/routes/setup/components/diff-viewer.tsx` — Diff preview

### Tests
- [ ] `server/test/unit/onboarding-service.test.ts` — 11 tests
- [ ] `server/test/unit/brownfield-scanner.test.ts` — 7 tests
- [ ] `server/test/unit/compose-analyzer.test.ts` — 15 tests
- [ ] `client/test/e2e/setup-wizard.spec.ts` — E2E scaffolds

## Compilation Checks

- [ ] Server TypeScript compiles without errors (`yarn workspace @docktor/server tsc --noEmit`)
- [ ] Client TypeScript compiles without errors (`yarn workspace @docktor/client tsc --noEmit`)
- [ ] No ESLint errors in modified files
- [ ] All imports resolve correctly

## Documentation

- [ ] All plan SUMMARY.md files created (8 summaries)
- [ ] STATE.md updated with phase completion
- [ ] ROADMAP.md progress updated
- [ ] Key decisions logged in STATE.md

## Sign-Off

- [ ] All automated tests passing
- [ ] Manual testing scenarios completed
- [ ] No regressions in existing features
- [ ] Ready for Phase 6

**Verified by:** _________________  
**Date:** _________________
