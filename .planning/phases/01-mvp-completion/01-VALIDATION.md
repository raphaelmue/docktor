---
phase: 1
slug: mvp-completion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (server unit + jsdom client unit), Playwright (integration) |
| **Config file** | `server/vitest.config.ts`, `client/vitest.config.ts` |
| **Quick run command** | `yarn workspace @docktor/server test:unit && yarn workspace @docktor/client test` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `yarn workspace @docktor/server test:unit && yarn workspace @docktor/client test`
- **After every plan wave:** Run `yarn test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD-OBS-01 | TBD | 0 | OBS-01 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-02 | TBD | 0 | OBS-02 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-03 | TBD | 0 | OBS-03 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-04 | TBD | 0 | OBS-04 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-05 | TBD | 0 | OBS-05 | integration | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-06 | TBD | 0 | OBS-06 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-OBS-07 | TBD | 0 | OBS-07 | unit (RTL) | `yarn workspace @docktor/client test` | ❌ W0 | ⬜ pending |
| TBD-OBS-08 | TBD | 0 | OBS-08 | unit | `yarn workspace @docktor/client test` | ❌ W0 | ⬜ pending |
| TBD-OBS-09 | TBD | 0 | OBS-09 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-SET-01 | TBD | 0 | SET-01 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-SET-02 | TBD | 0 | SET-02 | unit | `yarn workspace @docktor/server test:unit` | ❌ W0 | ⬜ pending |
| TBD-SET-03 | TBD | 0 | SET-03 | unit | `yarn workspace @docktor/shared test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs will be updated once PLAN.md files are written.*

---

## Wave 0 Requirements

- [ ] `server/test/unit/infrastructure/dockerode-client.test.ts` — stubs for OBS-01, OBS-06
- [ ] `server/test/unit/jobs/state-poller.test.ts` — stubs for OBS-02, OBS-03, OBS-04
- [ ] `server/test/unit/application/settings-service.test.ts` — stubs for SET-01, SET-02
- [ ] `shared/test/unit/validation/settings-phase1.test.ts` — stubs for SET-03 (timezone + URL validation)
- [ ] `client/test/unit/hooks/use-container-events.test.ts` — stubs for OBS-08
- [ ] `client/test/unit/components/log-viewer.test.tsx` — stubs for OBS-07, OBS-09

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser reconnects to SSE on drop | OBS-08 | Network interruption hard to simulate in unit tests | Kill server mid-stream, verify reconnect within 3s |
| ANSI colors render correctly in browser | OBS-07 | Visual rendering requires human inspection | Open log viewer for a service with colored output, confirm colors visible |
| Log stream cleanup on nav away | OBS-02 | Docker daemon leak only detectable via `docker events` monitoring | Navigate away from Logs tab, run `docker events` for 10s, confirm no orphan event streams |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
