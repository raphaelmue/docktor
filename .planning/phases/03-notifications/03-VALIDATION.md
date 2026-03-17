---
phase: 3
slug: notifications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `cd server && npm run test:unit` |
| **Full suite command** | `cd server && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd server && npm run test:unit`
- **After every plan wave:** Run `cd server && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 0 | NOTF-02 | unit | `cd server && npm run test:unit` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 0 | NOTF-01 | unit | `cd server && npm run test:unit` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 0 | NOTF-03 | unit | `cd server && npm run test:unit` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 0 | NOTF-04 | unit | `cd server && npm run test:unit` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 0 | NOTF-06 | unit | `cd server && npm run test:unit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/test/unit/lib/crypto.test.ts` — AES-256-GCM encrypt/decrypt round-trip + tamper detection (NOTF-02)
- [ ] `server/test/unit/application/notification-service.test.ts` — SMTP settings save/retrieve, toggle check, DB log, email send mock (NOTF-01, NOTF-06)
- [ ] `server/test/unit/jobs/notification-watcher.test.ts` — state transitions, deduplication, UNHEALTHY 2-min grace, recovery suppression (NOTF-03)
- [ ] `server/test/unit/jobs/disk-checker.test.ts` — statfs mock, both thresholds, suppression until recovery (NOTF-04)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email actually received in inbox | NOTF-01, NOTF-03, NOTF-04 | Requires live SMTP server | Configure SMTP in Settings, use Test Send button, verify email received |
| Settings UI renders tabbed navigation | NOTF-01, NOTF-06 | Frontend rendering | Open Settings page, verify General and Notifications tabs, verify SMTP card and Triggers card |
| Disk warning toast/email fires at threshold | NOTF-04 | Requires controlled disk state | Mock `statfs` return below threshold, verify notification log entry appears in UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
