---
phase: 04-backup-restore
plan: 01
subsystem: database
tags: [prisma, zod, restic, backup, testing, tdd]

# Dependency graph
requires:
  - phase: 03-notifications
    provides: NotificationService.notify() used in BackupService tests (NOTF-05)
provides:
  - Updated Prisma Backup model with RESTORE trigger and logLines field
  - Shared Zod validation schemas for all backup API inputs (backupSettingsSchema, triggerBackupSchema, restoreSnapshotSchema, stackBackupConfigSchema, backupDefaultsSchema, retentionPolicySchema)
  - RED test scaffolds for ResticExecutor, BackupService, BackupScheduler
affects: [04-02, 04-03, 04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED test scaffolds import from not-yet-existing implementation modules — tests fail at module resolution"
    - "createMock*() factory pattern for dependency injection in unit tests"
    - "vi.mock('node:child_process') for spawn-based infrastructure tests"
    - "vi.mock('node-cron') for cron scheduler tests"

key-files:
  created:
    - shared/src/validation/backups.ts
    - server/test/unit/infrastructure/restic-executor.test.ts
    - server/test/unit/application/backup-service.test.ts
    - server/test/unit/jobs/backup-scheduler.test.ts
  modified:
    - server/prisma/schema/backup.prisma
    - shared/src/validation/index.ts

key-decisions:
  - "RESTORE added to BackupTrigger enum to record restore operations as Backup records"
  - "logLines String[] field stores restic stdout output per-backup for detail page display"
  - "backupSettingsSchema uses superRefine for conditional field validation based on repoType"
  - "retentionPolicySchema uses z.coerce.number() to handle string-to-number conversion from settings storage"

patterns-established:
  - "ResticExecutor test: mock spawn process with emitter pattern simulating stdout data + close events"
  - "BackupService test: createMock*() factories with vi.fn() stubs for all 6 constructor dependencies"
  - "BackupScheduler test: vi.mock('node-cron') at module level, mock task with stop/start methods"

requirements-completed: [BCK-01, BCK-02, BCK-03, BCK-04, BCK-05, BCK-06, BCK-07, BCK-08, BCK-09, BCK-10, BCK-11]

# Metrics
duration: 10min
completed: 2026-03-18
---

# Phase 4 Plan 01: Backup Foundation Summary

**Prisma Backup model extended with RESTORE trigger and logLines[], shared Zod validation schemas for all backup API inputs, and RED test scaffolds for ResticExecutor, BackupService, BackupScheduler covering BCK-01 through BCK-11**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-18T09:06:14Z
- **Completed:** 2026-03-18T09:16:14Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Prisma Backup model updated with RESTORE enum value and logLines String[] field; Prisma client regenerated successfully
- Six shared Zod validation schemas exported from @docktor/shared covering backup repository config, retention policy, stack-level overrides, manual trigger, and restore inputs
- Three RED-state unit test scaffolds created with 44 total concrete it() blocks covering all BCK requirements and NOTF-05

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Prisma schema and create shared Zod validation schemas** - `1afe75e` (feat)
2. **Task 2: Create RED test scaffolds for ResticExecutor, BackupService, and BackupScheduler** - `2178840` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `server/prisma/schema/backup.prisma` - Added RESTORE to BackupTrigger enum, added logLines String[] field
- `shared/src/validation/backups.ts` - New file: 6 exported Zod schemas for backup API validation
- `shared/src/validation/index.ts` - Added re-export for backups.js
- `server/test/unit/infrastructure/restic-executor.test.ts` - RED scaffold: 14 it() blocks for ResticExecutor
- `server/test/unit/application/backup-service.test.ts` - RED scaffold: 22 it() blocks for BackupService
- `server/test/unit/jobs/backup-scheduler.test.ts` - RED scaffold: 8 it() blocks for BackupScheduler

## Decisions Made
- RESTORE added to BackupTrigger enum so restore operations are tracked as Backup records (same audit trail as backups)
- logLines String[] stores restic stdout output for the backup detail page without requiring a separate table
- backupSettingsSchema uses superRefine for type-conditional validation (local requires repoPath, sftp requires host+user, s3 requires bucket+keys)
- retentionPolicySchema uses z.coerce.number() to handle string values from settings key-value storage

## Deviations from Plan

None - plan executed exactly as written. Prisma generate invoked via root node_modules/.bin/prisma with --config flag pointing to server/prisma/prisma.config.ts (Prisma 7 multi-file schema config pattern).

## Issues Encountered

The `yarn workspace @docktor/server prisma generate` command was not available as a yarn script — used `node_modules/.bin/prisma generate --config prisma/prisma.config.ts` from the server directory instead. This is consistent with the Prisma 7 config file pattern already established in the project.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Prisma schema ready for migration in Plan 02
- Shared Zod schemas available for route and service use immediately
- RED test scaffolds define the full contract for ResticExecutor, BackupService, and BackupScheduler
- Plan 02 should implement ResticExecutor (infrastructure layer) to turn restic-executor tests GREEN

---
*Phase: 04-backup-restore*
*Completed: 2026-03-18*
