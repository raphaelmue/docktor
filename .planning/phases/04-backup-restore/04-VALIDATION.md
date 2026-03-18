---
phase: 4
slug: backup-restore
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `yarn workspace @docktor/server test:unit` |
| **Full suite command** | `yarn workspace @docktor/server test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `yarn workspace @docktor/server test:unit`
- **After every plan wave:** Run `yarn workspace @docktor/server test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-W0-01 | 01 | 0 | BCK-05, BCK-06, BCK-08, BCK-10 | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose restic-executor` | ❌ W0 | ⬜ pending |
| 4-W0-02 | 01 | 0 | BCK-01, BCK-02, BCK-03, BCK-07, BCK-09, BCK-11, NOTF-05 | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ W0 | ⬜ pending |
| 4-W0-03 | 01 | 0 | BCK-04 | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-scheduler` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/test/unit/infrastructure/restic-executor.test.ts` — stubs for BCK-05, BCK-06, BCK-08, BCK-10 (mock child_process.spawn)
- [ ] `server/test/unit/application/backup-service.test.ts` — stubs for BCK-01, BCK-02, BCK-03, BCK-07, BCK-09, BCK-11, NOTF-05 (mock ResticExecutor + BackupRepository)
- [ ] `server/test/unit/jobs/backup-scheduler.test.ts` — stubs for BCK-04 (mock node-cron + BackupService)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Streaming backup progress visible in UI | BCK-03 | Requires live SSE connection and restic binary | Start backup, watch SSE stream in browser DevTools Network tab |
| S3 backup/restore round-trip | BCK-01, BCK-08, BCK-09 | Requires real S3 credentials | Configure S3 repo in Settings, run backup, list snapshots, restore |
| SFTP host key verification | BCK-01 | SSH handshake behavior requires real SFTP host | Configure SFTP repo, verify accept-new behavior on first connect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
