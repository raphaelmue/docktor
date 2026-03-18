---
phase: 04-backup-restore
plan: 02
subsystem: infra
tags: [restic, child_process, spawn, prisma, bigint, repository]

# Dependency graph
requires:
  - phase: 04-backup-restore plan 01
    provides: Backup prisma schema, BackupTrigger/BackupStatus enums, restic-executor test scaffold

provides:
  - ResticExecutor: spawn-based restic CLI wrapper with line streaming and env-var credential injection
  - BackupRepository: full CRUD for Backup model with BigInt serialization safety
  - resticExecutor singleton (server/src/infrastructure/restic-executor.ts)
  - backupRepository singleton (server/src/repositories/backup-repository.ts)

affects: [04-03, 04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ResticExecutor: child_process.spawn with line-buffer, partial-line flush on close"
    - "Repository: unified update() method so test mocks need only one mock fn"
    - "BigInt safety: toDto() spreads record and converts sizeBytes to string"

key-files:
  created:
    - server/src/infrastructure/restic-executor.ts
    - server/src/repositories/backup-repository.ts
  modified: []

key-decisions:
  - "buildBackupArgs omits 'backup' subcommand from returned array — test scaffold expects stackPath at args[0]; callers prepend the subcommand when building the full spawn args list"
  - "ResticExecutor.run() signature is (args, env, onLine?) — three positional params matching test scaffold, not a single ResticRunOptions object as in plan spec"
  - "ResticExecutor.snapshots() accepts (env, tag) with raw env Record not BackupRepoConfig — matches test scaffold; callers build env via buildEnv() before calling"
  - "BackupRepository exposes both update() (unified, matches test mock) and named updateStatus()/updateLogLines() helpers for clarity in production code"

patterns-established:
  - "ResticExecutor line-buffering: split on newline, keep partial tail, flush tail on close event"
  - "Credential injection: RESTIC_REPOSITORY + RESTIC_PASSWORD always in env; AWS keys added only for s3 repoType"
  - "Exit code 10 = repo not found: snapshots() returns [] rather than throwing; callers handle init"

requirements-completed: [BCK-05, BCK-06, BCK-08, BCK-10]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 04 Plan 02: Infrastructure & Repository Layer Summary

**ResticExecutor wraps child_process.spawn with stdout line-streaming and env-var credential injection; BackupRepository provides full Backup CRUD with BigInt-safe DTO serialization**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T09:11:59Z
- **Completed:** 2026-03-18T09:14:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- ResticExecutor: spawn-based wrapper that streams restic stdout line-by-line, flushes partial lines on close, injects credentials only via env vars (never CLI args)
- buildBackupArgs/buildForgetArgs/buildRestoreArgs/buildInitArgs helpers covering all restic subcommands
- snapshots(): parses JSON output, returns [] on exit 10 (uninitialized repo), throws on other errors
- buildEnv()/buildRepoUrl() supporting local, SFTP, and S3-compatible backends
- checkVersion() for binary availability check
- BackupRepository with create/findById/findByIdOrThrow/findByStackId/update/updateStatus/updateLogLines/findInProgress
- toDto() converting BigInt sizeBytes to string to prevent JSON.stringify failures
- All 14 ResticExecutor unit tests pass GREEN; TypeScript compiles cleanly with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement ResticExecutor** - `1ac8076` (feat)
2. **Task 2: Implement BackupRepository** - `f975833` (feat)

## Files Created/Modified
- `server/src/infrastructure/restic-executor.ts` - ResticExecutor class + singleton export; all restic CLI wrappers
- `server/src/repositories/backup-repository.ts` - BackupRepository class + singleton export; Backup model CRUD

## Decisions Made
- **buildBackupArgs omits "backup" subcommand**: The test scaffold asserts `args[0] === stackPath`. The plan spec included "backup" at index 0, but the tests are the source of truth in TDD. Callers prepend the subcommand when building full spawn args.
- **run() is (args, env, onLine?) not (options)**: Test scaffold calls `executor.run(["backup"], {})` with positional args, not a ResticRunOptions object. Matched test signature.
- **snapshots() accepts (env, tag) not (repoConfig, tag)**: Test scaffold passes a raw env Record. The BackupRepoConfig type is used by buildEnv() separately; callers call buildEnv() then pass the result to snapshots().
- **BackupRepository.update() is unified**: Test mock uses a single `update` fn. Named helpers (updateStatus/updateLogLines) are also provided for production code clarity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adjusted run()/snapshots()/buildBackupArgs() signatures to match test scaffold**
- **Found during:** Task 1 (ResticExecutor TDD RED phase)
- **Issue:** Plan spec defined `run(options: ResticRunOptions)` and `snapshots(repoConfig, tag)` but the existing test scaffold calls `run(args, env, onLine?)` and `snapshots(env, tag)`. The plan spec also showed `buildBackupArgs` returning `["backup", stackPath, ...]` but test asserts `args[0] === stackPath`.
- **Fix:** Implemented the signatures the tests expect. The semantics are identical; only the calling convention differs.
- **Files modified:** server/src/infrastructure/restic-executor.ts
- **Verification:** All 14 restic-executor tests pass
- **Committed in:** 1ac8076

---

**Total deviations:** 1 auto-fixed (Rule 1 — test scaffold API mismatch)
**Impact on plan:** No scope change. Same functionality delivered, aligned to the test contract.

## Issues Encountered
- Pre-existing test failures in notification-service.test.ts (DATABASE_URL + nodemailer mock) and backup-service.test.ts/backup-scheduler.test.ts (implementation files not yet created — those are Plan 03 work). None caused by this plan's changes.

## Next Phase Readiness
- ResticExecutor and BackupRepository are ready to be injected into BackupService (Plan 03)
- All restic-executor tests pass; TypeScript compiles cleanly
- BackupService test scaffold already exists and mocks both components via the interfaces implemented here

---
*Phase: 04-backup-restore*
*Completed: 2026-03-18*
