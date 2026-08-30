---
phase: 04-backup-restore
plan: 15
subsystem: backup
tags: [sse, eventemitter, fastify, node-cron, vitest]

# Dependency graph
requires:
  - phase: 04-backup-restore
    provides: BackupService.runBackup/runRestore orchestration, BackupScheduler cron fire-and-forget path (04-01, 04-11)
provides:
  - "runBackup()/runRestore() emit a terminal status (\"COMPLETED\"|\"FAILED\") on the \"done\" broadcaster event instead of a zero-argument event"
  - "Both catch blocks push a synthetic \"[error] <message>\" line onto logLines and the live line stream before persisting a FAILED row"
  - "routes/backups.ts SSE done payload always carries {done, status}, matching the already-finished branch's shape"
  - "BackupService.abortBackup(backupId, stackId, errorMessage) — idempotent terminal-state closer for a backup that never reached restic"
  - "Manual-trigger route and BackupScheduler.runScheduledBackup both call abortBackup instead of only logging when a fire-and-forget dependency is missing or a lookup rejects"
affects: [04-16, backup-restore UAT re-verification]

actuals:
  tokens: 6698
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "finalStatus local variable initialized to the failure value, flipped to success only after all persistence writes resolve, threaded through emitter.emit(\"done\", finalStatus) — an unforeseen exit path can never report success"
    - "abortBackup() is the single idempotent terminal-state closer shared by the manual route's fire-and-forget catch/guard and the scheduler's cron fire-and-forget catch/guard; it re-reads the row via findById() first so it never clobbers a row that runBackup already finished"

key-files:
  created: []
  modified:
    - server/src/application/backup-service.ts
    - server/src/routes/backups.ts
    - server/src/jobs/backup-scheduler.ts
    - server/test/unit/application/backup-service.test.ts
    - server/test/unit/jobs/backup-scheduler.test.ts

key-decisions:
  - "abortBackup() targets stack status ERROR (not previousStatus) to match the existing runBackup catch-block behavior and BCK-11's failure-state requirement"
  - "The missing-repository-configuration guard in both fire-and-forget blocks only needs to check getBackupRepoConfig()'s null return explicitly — findByIdOrThrow() for the backup record and stack row already throw on absence, so those two cases are covered by the surrounding catch block's abortBackup call, not a separate guard branch"
  - "UAT Test 22's reported crash (runBackup reached with a single/undefined argument) is stale re-test data predating plan 04-11: as of 04-11's Promise.all rewrite, runScheduledBackup already calls this.service.runBackup(backupRecord, stack, repoConfig) with three arguments in every code path. This plan's abortBackup hardening still closes the same failure class (a rejected dependency fetch) so a live re-run of Test 22 is expected to pass, but the specific single-argument crash cannot be reproduced against the current build."

requirements-completed: [BCK-03, BCK-04, BCK-09, BCK-11, NOTF-05]

coverage:
  - id: D1
    description: "A live-watched successful backup ends its SSE stream with status: \"COMPLETED\"; a live-watched failed one ends with status: \"FAILED\" — neither is ever reported as the other"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runBackup() > emits done with COMPLETED status on success"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runBackup() > emits done with FAILED status on restic error"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runRestore() > emits done with COMPLETED status on success"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runRestore() > emits done with FAILED status on restore failure"
        status: pass
    human_judgment: false
  - id: D2
    description: "A FAILED backup always has at least one persisted [error] log line, even if restic never produced a line — the Output pane is never empty"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runBackup() > persists a [error] logLines entry containing the rejection message on failure"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runBackup() > persists a non-empty logLines array when restic rejects before any onLine call"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#runRestore() > persists a [error] logLines entry containing the rejection message on failure"
        status: pass
    human_judgment: false
  - id: D3
    description: "abortBackup() ends an IN_PROGRESS backup that never started restic: FAILED row with reason, stack moved to ERROR, backup_failure notification sent; idempotent no-op on unknown/terminal rows"
    requirement: "BCK-11"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > sets an IN_PROGRESS row to FAILED with completedAt, errorMessage, and a single [error] logLines entry"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > transitions the stack to ERROR"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > calls notificationService.notify with type backup_failure and the stack id"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > is a no-op on a row that is already COMPLETED"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > is a no-op on a row that is already FAILED"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#abortBackup() > is a no-op and does not throw on an unknown backup id"
        status: pass
    human_judgment: false
  - id: D4
    description: "Triggering a backup with no repository configured produces a visible FAILED backup and a backup_failure notification on both the manual route and the scheduled cron path, instead of a silent server-log line and a wedged BACKING_UP stack"
    requirement: "BCK-04, BCK-09, NOTF-05"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/backup-scheduler.test.ts#runScheduledBackup() > calls abortBackup and does not call runBackup when getBackupRepoConfig() resolves null"
        status: pass
      - kind: unit
        ref: "server/test/unit/jobs/backup-scheduler.test.ts#runScheduledBackup() > calls runBackup with three defined arguments when all three resolve"
        status: pass
      - kind: unit
        ref: "server/test/unit/jobs/backup-scheduler.test.ts#runScheduledBackup() > calls abortBackup and lets no rejection escape the cron callback when the backup-record lookup rejects"
        status: pass
    human_judgment: true
    rationale: "The manual-route guard (routes/backups.ts) is not covered by an integration/route-level test in this plan — only unit coverage of the shared abortBackup() method and the scheduler's mirrored guard. A live UAT re-run of Test 22/Gap 11 (triggering a manual backup with no repository configured) is the verification step that closes the loop end-to-end."
  - id: D5
    description: "The failure reason persisted into logLines and streamed over SSE is the Error message only — no stack trace or restic env object (RESTIC_PASSWORD, AWS secret) ever reaches a persisted or streamed line"
    verification:
      - kind: unit
        ref: "acceptance-criteria grep: `grep -v '^\\s*//' server/src/application/backup-service.ts | grep -c 'err\\.stack'` returns 0"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-08-30
status: complete
---

# Phase 04 Plan 15: Terminal backup status and abortBackup guard rail Summary

**BackupService.runBackup/runRestore now emit a real terminal status on their "done" SSE event and guarantee a synthetic `[error]` log line on every failure; a new idempotent `abortBackup()` method is now called by both the manual-trigger route and the cron scheduler whenever their fire-and-forget dependency fetch fails, closing the gap where a half-started backup wedged the stack in BACKING_UP forever.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-30T17:20:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Fixed the confirmed SSE defect (Lead 2 in 04-PATTERNS.md): the live `done` event previously carried no argument, so the client's `data.status === "COMPLETED"` check was false for every live-watched backup — successes included. `finalStatus` is now threaded through both orchestration methods and both SSE done-payload branches, so the already-finished branch and the live branch send an identical `{done, status}` shape.
- Every FAILED backup — including one that dies before restic writes a byte (bad pre-hook, missing binary, unreachable repository) — now persists at least one `[error] <message>` log line and emits it live on the `line` event, so the Output pane is never empty (UAT Test 12).
- Added `BackupService.abortBackup(backupId, stackId, errorMessage)`: idempotent (re-reads the row first, no-ops on missing/terminal rows), moves the Backup row to FAILED and the stack to ERROR, and sends a `backup_failure` notification.
- Both the manual route's and the scheduler's fire-and-forget blocks now call `abortBackup` — via an explicit guard when `getBackupRepoConfig()` resolves null, and via their outer catch block for any other dependency-fetch rejection — instead of only logging to the console. A stack can no longer be permanently wedged in BACKING_UP by a failed dependency fetch.
- `BackupSchedulerService` interface gained `abortBackup` so the scheduler can reach it through its existing DI seam; plan 04-11's `Promise.all` dependency fetch was left untouched.

## Task Commits

1. **Task 1: Tell the client the real terminal status, and never persist an empty failure** - `84f6a43` (feat)
2. **Task 2: End a backup that never started, instead of wedging the stack** - `90d8a8e` (feat)

_Both tasks were `tdd="true"`; tests were added alongside each implementation change in the same commit rather than as separate RED/GREEN commits, following this plan's `<action>` instructions (extend the existing spec files) rather than the strict RED-then-GREEN commit sequence._

## Files Created/Modified
- `server/src/application/backup-service.ts` - `finalStatus` tracking + synthetic `[error]` line in both catch blocks of `runBackup()`/`runRestore()`; new `abortBackup()` public method
- `server/src/routes/backups.ts` - live SSE `onDone` handler now sends `{done, status}`; manual-trigger fire-and-forget block calls `abortBackup` instead of only logging
- `server/src/jobs/backup-scheduler.ts` - `abortBackup` added to `BackupSchedulerService` interface; scheduled fire-and-forget block calls `abortBackup` instead of only logging
- `server/test/unit/application/backup-service.test.ts` - done-status, `[error]`-line, and `abortBackup()` test coverage (22 new cases)
- `server/test/unit/jobs/backup-scheduler.test.ts` - `runScheduledBackup()` coverage; `BackupScheduler` construction extended to the fourth (`backupRepo`) argument the file previously omitted

## Decisions Made
- `abortBackup()` targets stack status `ERROR`, matching `runBackup`'s existing catch-block behavior and BCK-11.
- The fire-and-forget guard in both the route and the scheduler checks only `getBackupRepoConfig()`'s null case explicitly; the backup-record and stack-row lookups already throw via `findByIdOrThrow`, so those are covered by the surrounding `catch` block's `abortBackup` call rather than a second guard branch.
- **UAT Test 22 determination:** the reported crash shape (`runBackup` reached with a single/undefined argument) does not exist in `server/src/jobs/backup-scheduler.ts` as plan 04-11 left it — `runScheduledBackup` has called `this.service.runBackup(backupRecord, stack, repoConfig)` with three arguments via `Promise.all` since 04-11. This plan's `abortBackup` hardening still converts the underlying failure class (a rejected dependency fetch) into a recorded FAILED backup rather than an unhandled rejection, but the specific single-argument TypeError Test 22 named is judged **stale re-test data predating plan 04-11**, not a live defect in the current build. A live re-run of Test 22 is still the correct way to confirm this closes the gap.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` sections, `<behavior>` lists, and acceptance-criteria greps were followed as specified; all acceptance-criteria commands were re-run after implementation and passed (see below).

## Issues Encountered
- The plan's suggested test technique for capturing the live broadcaster ("call `runBackup` without awaiting, then immediately call `getBackupBroadcaster`") works as written for `runBackup()`, which registers its `EventEmitter` synchronously before any `await`. `runRestore()` does not — it awaits `stackRepo.findByIdOrThrow` and `backupRepo.create` first — so the emitter isn't registered until after those (immediately-resolving, mock-driven) promises settle, and by then the whole call had already raced to completion in a first attempt using `vi.waitFor` alone. Fixed by gating the "restore started" notification behind a manually-released promise for the two new `runRestore()` done-status tests only, giving the test a real suspension point to attach the "done" listener before releasing it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All Phase 04 gap-closure requirements this plan claims (BCK-03, BCK-04, BCK-09, BCK-11, NOTF-05) are code-complete and unit-tested; `yarn workspace @docktor/server test:unit` is green (422 passed, 2 pre-existing todo, 0 failed) and both `yarn workspace @docktor/server build` and `yarn typecheck` exit 0.
- D4 above is flagged `human_judgment: true` — a live UAT re-run of Test 12 and Test 22/Gap 11 (trigger a manual backup with no repository configured; watch a backup live to both success and failure) is the recommended verification step before closing those UAT gaps definitively.
- Plan 04-16 (per the requirement-coverage table) is expected to pick up any remaining client-side work on `client/src/hooks/use-backup-stream.ts`, which this plan deliberately left untouched.

---
*Phase: 04-backup-restore*
*Completed: 2026-08-30*
