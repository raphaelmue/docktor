---
phase: 5
slug: onboarding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.0.6 (server), @testing-library/react 16.1.0 (client), playwright 1.48.0 (E2E) |
| **Config file** | `server/vitest.config.ts`, `client/vitest.config.ts`, `client/playwright.config.ts` |
| **Quick run command** | `yarn workspace @docktor/server test && yarn workspace @docktor/client test` |
| **Full suite command** | `yarn test` (all workspaces + Playwright E2E) |
| **Estimated runtime** | ~45 seconds (unit/integration), ~90 seconds (with E2E) |

---

## Sampling Rate

- **After every task commit:** Run `yarn workspace @docktor/server test && yarn workspace @docktor/client test`
- **After every plan wave:** Run `yarn test` (includes E2E)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | WIZ-01-07, BF-01-05 | T-05-01-04 | Path traversal blocked, session replay blocked, volume migration permissions verified, wizard state XSS-safe | unit+integration | `yarn test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/test/unit/application/onboarding-service.test.ts` — stubs for WIZ-01 through WIZ-07
- [ ] `server/test/unit/infrastructure/brownfield-scanner.test.ts` — stubs for BF-01 through BF-03
- [ ] `server/test/unit/infrastructure/volume-migrator.test.ts` — stubs for BF-04, BF-05
- [ ] `server/test/integration/routes/onboarding.test.ts` — integration tests for wizard flow
- [ ] `server/test/integration/routes/brownfield.test.ts` — integration tests for scan + migrate endpoints
- [ ] `client/test/unit/components/wizard-stepper.test.tsx` — wizard stepper UI tests
- [ ] `client/test/integration/onboarding-wizard.spec.ts` — Playwright E2E for full wizard flow

*Testing strategy:*
- Server unit tests mock repositories + Docker client (established pattern from Phase 1-4)
- Server integration tests use real database (no mocked DB per CLAUDE.md Phase 02 decision)
- Client unit tests mock API calls via fetch (established pattern from Phase 3-4)
- Playwright E2E tests full user journey: first boot → wizard → dashboard

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Named volume detection displays correct warning | BF-02 | Visual inspection of badge color and icon | 1. Scan directory with named volumes, 2. Verify yellow badge with alert icon appears |
| Diff preview renders side-by-side correctly | BF-05 | Layout verification across viewport sizes | 1. Open migration wizard with volume changes, 2. Verify diff panels are equal width, 3. Resize browser, verify responsive behavior |
| Migration rollback preserves original volume data | BF-05 | Data integrity check requiring manual file inspection | 1. Trigger migration, 2. Force failure mid-copy, 3. SSH to host, verify original /volumes/stackname unchanged |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
