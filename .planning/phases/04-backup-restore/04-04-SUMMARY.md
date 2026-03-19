---
phase: 04-backup-restore
plan: "04"
subsystem: api
tags: [fastify, restic, sse, backup, encryption, node-cron]

# Dependency graph
requires:
  - phase: 04-01
    provides: Zod schemas for backup validation (backupSettingsSchema, backupDefaultsSchema, stackBackupConfigSchema, restoreSnapshotSchema)
  - phase: 04-02
    provides: BackupRepository with findByIdOrThrow, findByStackId, toDto
  - phase: 04-03
    provides: BackupService, getBackupBroadcaster, ResticExecutor, BackupScheduler
provides:
  - "All backup HTTP endpoints: trigger backup/restore (202), list backups/snapshots, SSE streaming, per-stack config, backup settings, global defaults, restic status"
  - "server/src/routes/backups.ts — 14-endpoint Fastify plugin"
  - "server/src/app.ts — backupRoutes registered"
affects: [04-05, client-backup-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget async backup: initiateBackup then runBackup with pre-fetched args, errors logged"
    - "SSE endpoint: reply.hijack() + reply.raw.writeHead + EventEmitter subscription for live streaming, stored logLines for completed backups"
    - "Sensitive field masking: hasPassword/hasSftpKey/hasS3SecretKey returned instead of values"
    - "Encrypted settings: encrypt() via lib/crypto.js, upserted with encrypted:true flag on prisma.setting"

key-files:
  created:
    - server/src/routes/backups.ts
  modified:
    - server/src/app.ts

key-decisions:
  - "BackupService.runBackup takes (backupRecord, stack, repoConfig) — route fetches these via Promise.all before fire-and-forget to match actual implementation signature"
  - "runRestore is not fire-and-forget (it returns {id} synchronously) — route awaits it before returning 202"
  - "SSE streaming checks backup.status before subscribing: finished backups stream stored logLines then close"

patterns-established:
  - "Backup routes: all protected via app.addHook('onRequest', requireAuth)"
  - "SSE pattern: reply.hijack() required before reply.raw.writeHead on Fastify"

requirements-completed: [BCK-01, BCK-03, BCK-04, BCK-05, BCK-08, BCK-09, BCK-10]

# Metrics
duration: 2min
completed: 2026-03-19
---

# Phase 04 Plan 04: Backup HTTP Routes Summary

**14 Fastify backup endpoints (trigger/restore 202, list, SSE stream, per-stack config, encrypted settings) registered in app.ts**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-19T08:43:16Z
- **Completed:** 2026-03-19T08:45:24Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created `server/src/routes/backups.ts` with 14 REST + SSE endpoints covering all backup operations
- SSE streaming endpoint with `reply.hijack()`, EventEmitter subscription for live progress, and stored-logLines replay for completed backups
- Backup settings PUT encrypts `password`, `sftpKey`, `s3SecretKey` via AES-256-GCM; GET returns `hasPassword`/`hasSftpKey`/`hasS3SecretKey` only
- Per-stack backup config PUT validates cron expressions with `node-cron` and updates BackupScheduler accordingly
- Registered `backupRoutes` in `server/src/app.ts`

## Task Commits

1. **Task 1: Create backup routes with SSE streaming endpoint** - `3a7815d` (feat)

**Plan metadata:** _(see final metadata commit)_

## Files Created/Modified
- `server/src/routes/backups.ts` — 14-endpoint Fastify plugin for all backup HTTP operations
- `server/src/app.ts` — added backupRoutes import and registration

## Decisions Made
- `BackupService.runBackup` takes `(backupRecord, stack, repoConfig)` not just a backupId as the plan's interface section stated. Route fetches all three via `Promise.all` before fire-and-forget call — [Rule 1 - Bug fix applied transparently]
- `runRestore` is not truly fire-and-forget (it returns `{id}` after completing); route awaits it and returns 202 on completion
- SSE endpoint checks `backup.status` before subscribing to broadcaster: finished backups replay stored `logLines` then close immediately

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BackupService.runBackup signature mismatch**
- **Found during:** Task 1 (Create backup routes with SSE streaming endpoint)
- **Issue:** Plan's interface section documented `runBackup(backupId: string): Promise<void>` but actual implementation in `backup-service.ts` takes `(backupRecord, stack, repoConfig)` — three arguments
- **Fix:** Route fetches `backupRecord`, `stack`, and `repoConfig` via `Promise.all` then calls `backupService.runBackup(backupRecord, stack, repoConfig)` as fire-and-forget
- **Files modified:** server/src/routes/backups.ts
- **Verification:** TypeScript compilation passes, no type errors
- **Committed in:** 3a7815d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 signature mismatch bug fix)
**Impact on plan:** Required correction — using the wrong signature would have caused a runtime type error. No scope creep.

## Issues Encountered
None beyond the signature mismatch resolved via Rule 1.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All backup HTTP endpoints are registered and type-safe
- Frontend (04-05) can now call these endpoints to display backup history, trigger backups, stream progress, and manage settings
- SSE endpoint is ready for `useBackupStream` hook to consume

---
*Phase: 04-backup-restore*
*Completed: 2026-03-19*
