---
phase: 2
slug: observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `server/vitest.config.ts` (unit project), `client/vitest.config.ts` |
| **Quick run command** | `npm run test:unit -w server` |
| **Full suite command** | `npm run test -w server && npm run test -w client` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -w server`
- **After every plan wave:** Run `npm run test -w server && npm run test -w client`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | FW-01, FW-02, FW-03 | unit stub | `npm run test:unit -w server -- -t "FileWatcher"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | UPD-01, UPD-02 | unit stub | `npm run test:unit -w server -- -t "UpdateChecker"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | UPD-04 | unit stub | `npm run test:unit -w server -- -t "update"` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | FW-01 | unit | `npm run test:unit -w server -- -t "FileWatcher"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | FW-02 | unit | `npm run test:unit -w server -- -t "FileWatcher"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | FW-03 | unit | `npm run test:unit -w server -- -t "FileWatcher"` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | UPD-01, UPD-02 | unit | `npm run test:unit -w server -- -t "UpdateChecker"` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | UPD-03 | unit | `npm run test:unit -w server -- -t "update"` | ❌ W0 | ⬜ pending |
| 02-04-02 | 04 | 2 | UPD-04 | unit | `npm run test:unit -w server -- -t "update"` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 2 | FW-01, FW-02, FW-03 | manual | See manual verifications below | N/A | ⬜ pending |
| 02-05-02 | 05 | 2 | UPD-03, UPD-04 | manual | See manual verifications below | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/test/unit/jobs/file-watcher.test.ts` — stubs for FW-01, FW-02, FW-03
- [ ] `server/test/unit/jobs/update-checker.test.ts` — stubs for UPD-01, UPD-02
- [ ] `server/test/unit/application/update-service.test.ts` — stubs for UPD-04 (or extend stack-service.test.ts)

*No new framework install needed — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| "config changed" badge appears in dashboard without refresh when compose file edited via SSH | FW-01, FW-02 | Requires SSH session + running Docker environment | 1. SSH into server, edit `/stacks/<id>/docker-compose.yml` 2. Watch dashboard — badge should appear within ~2s |
| "config error" badge appears when compose file becomes invalid YAML | FW-02 | Requires SSH + running Docker | 1. Edit compose file to invalid YAML 2. Badge should appear with error message |
| 60s fallback catches changes on NFS mount | FW-03 | Requires NFS mount (env-specific) | Skip unless NFS testing environment available |
| "update available" badge on stack detail when newer image exists | UPD-03 | Requires live registry access + known older image | Use `nginx:1.24.0` (older pinned), trigger update check manually |
| Update pull + recreate from UI completes successfully | UPD-04 | Requires Docker + live registry | Click update button, verify containers restart with new image digest |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
