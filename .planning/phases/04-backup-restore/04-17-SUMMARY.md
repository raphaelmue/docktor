---
phase: 04-backup-restore
plan: 17
subsystem: backup
tags: [sse, eventsource, eventemitter, react, vitest, fastify]

# Dependency graph
requires:
  - phase: 04-backup-restore
    provides: "useBackupStream's four-outcome status union and the backup detail page's one-shot resync effect (04-16)"
provides:
  - "ensureBackupBroadcaster()/disposeBackupBroadcaster() as the sole writer/remover of the module-level backupBroadcasters map, with registration moved to backup-creation time (initiateBackup/runRestore) instead of restic-start time (runBackup) — closes the CR-02 race where a client subscribing in that window was told the backup already finished while it was still IN_PROGRESS"
  - "abortBackup() emits a terminal done frame (from a finally block, so it fires even if the notification send rejects) — a backup aborted before restic ever runs now reaches an already-subscribed SSE client with a real FAILED verdict instead of leaving the stream open forever"
  - "The SSE route's missing-broadcaster branch re-reads the record and replays its stored log lines instead of reporting the pre-check status"
  - "useBackupStream reconnects with bounded backoff (BACKUP_STREAM_RECONNECT_DELAYS_MS: 1/2/4/8/15s, 5 attempts) once the browser's native EventSource retry gives up, and maps a done frame carrying a present-but-non-terminal status (e.g. IN_PROGRESS) to disconnected instead of failed"
  - "The backup detail page polls the record every 5s (capped at 60 polls / 5 minutes) while the stream is disconnected and the backup is still IN_PROGRESS, terminating the moment the record leaves IN_PROGRESS, the stream reconnects, or the ceiling is hit"
  - "The page's shortId fallback is empty-string-safe ((backup?.resticSnapshotId || backupId).slice(0, 8)), so the title and breadcrumb name the backup even while IN_PROGRESS (when resticSnapshotId is still the empty string initiateBackup persists)"
affects: [04-backup-restore UAT re-verification (Test 12), phase 04 completion, ROADMAP Success Criterion #2]

actuals:
  tokens: 10500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "ensureBackupBroadcaster()/disposeBackupBroadcaster() as the only writer/remover pair for a module-level Map — every call site (initiateBackup, runBackup, runRestore, abortBackup) goes through the pair, never touching backupBroadcasters directly, so lifecycle correctness is enforced structurally rather than by convention"
    - "useBackupStream's onerror branches on EventSource.readyState: CONNECTING defers to the browser's own native retry (does nothing); CLOSED means the browser gave up, so the hook takes over with its own bounded exponential-backoff schedule"
    - "Two mutually-exclusive effects on the backup detail page divide terminal-vs-transient stream outcomes: the one-shot resync owns completed/failed (fires once, guarded by isStreaming going false), the bounded poll owns disconnected (fires on an interval, guarded by three independent stop conditions) — they can never both fetch for the same transition"

key-files:
  created: []
  modified:
    - server/src/application/backup-service.ts
    - server/src/routes/backups.ts
    - server/test/unit/application/backup-service.test.ts
    - client/src/hooks/use-backup-stream.ts
    - client/test/unit/hooks/use-backup-stream.test.ts
    - client/src/routes/app/stacks/backups/[backupId].tsx
    - client/test/unit/routes/stacks/backup-detail-page.test.tsx

key-decisions:
  - "abortBackup's entire post-guard body (repo update, stack transition, notify) runs inside a try/finally whose finally emits the terminal done and disposes the broadcaster — a rejected notify() still surfaces to the caller as a rejection (test asserts this), but the SSE client is never stranded regardless"
  - "The EventSource.CLOSED readyState constant (2) is inlined in use-backup-stream.ts rather than read off the global, because the hook's own unit test substitutes a mock EventSource with no static members"
  - "BACKUP_RESYNC_POLL_INTERVAL_MS/BACKUP_RESYNC_MAX_POLLS and BACKUP_STREAM_RECONNECT_DELAYS_MS are each a single source of truth for both the interval/delay value and the bound — no separate max-attempts constant"
  - "The mock EventSource's default readyState in use-backup-stream.test.ts was changed from 0 to 2 (CLOSED) to preserve the pre-existing 'onerror always closes' test's behavior, since that test fires onerror without explicitly setting readyState; new tests that care about the CONNECTING-vs-CLOSED branch set it explicitly"

requirements-completed: [BCK-03, BCK-09, BCK-11]

coverage:
  - id: D1
    description: "A client that opens the SSE stream at any point after POST /api/stacks/:id/backup returns — including before runBackup starts — is subscribed to the emitter that backup will actually use and receives its real terminal status (CR-02)"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > initiateBackup() > registers a broadcaster for the new backup before initiateBackup returns"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > initiateBackup() > a listener attached between initiateBackup and runBackup still receives runBackup's done event (CR-02 regression)"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > sets status to disconnected on a done payload with status IN_PROGRESS, not failed, and schedules no reconnect"
        status: pass
    human_judgment: false
  - id: D2
    description: "A backup aborted before restic ever runs still delivers a terminal FAILED verdict to an already-subscribed SSE client, even if the notification send rejects (CR-02/BCK-11)"
    requirement: "BCK-11"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > abortBackup() > on a still-IN_PROGRESS row, emits done with FAILED on the registered emitter, then removes it"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > abortBackup() > emits done even when the notification send rejects"
        status: pass
    human_judgment: false
  - id: D3
    description: "A transient SSE disconnect while a backup is IN_PROGRESS no longer freezes the page: the hook reconnects with bounded backoff, and returns to streaming once a connection opens (CR-01)"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > an onerror fired while readyState is CLOSED closes the EventSource and reconnects after the first backoff delay"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > a replacement connection that opens sets status back to streaming"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > resets the attempt counter on open, so the next CLOSED error reconnects at the first delay again"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > stops manual reconnection after BACKUP_STREAM_RECONNECT_DELAYS_MS.length attempts"
        status: pass
    human_judgment: false
  - id: D4
    description: "While the stream is disconnected and the backup is still IN_PROGRESS, the page keeps re-reading the record until it leaves IN_PROGRESS, the stream reconnects, or a hard poll ceiling is hit (CR-01)"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-01: bounded poll while disconnected > requests the record immediately on moving to disconnected, then again on every poll interval"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-01: bounded poll while disconnected > stops polling once a refetched record is no longer IN_PROGRESS"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-01: bounded poll while disconnected > stops polling once the stream returns to streaming"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-01: bounded poll while disconnected > stops after the configured maximum number of intervals even if the record never leaves IN_PROGRESS"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-01: bounded poll while disconnected > a completed stream still costs exactly two requests in total after several poll intervals have elapsed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The backup detail page's title and breadcrumb name the backup on every IN_PROGRESS view instead of rendering an empty short id (CR-03)"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-03: non-blank title/breadcrumb > renders a page title built from the first eight characters of the route's backupId when resticSnapshotId is empty"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-03: non-blank title/breadcrumb > renders the same fallback behind the Restore prefix for a RESTORE-trigger record with an empty resticSnapshotId"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > CR-03: non-blank title/breadcrumb > still renders the first eight characters of a real resticSnapshotId, unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "A restore watched live behaves identically to a backup — runRestore registers and disposes its broadcaster through the same ensureBackupBroadcaster/disposeBackupBroadcaster pair as runBackup, so the race fix and disposal guarantee cover RESTORE-trigger rows with no separate code path (BCK-09)"
    requirement: "BCK-09"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > runRestore() > registers its emitter through ensureBackupBroadcaster and removes it through disposeBackupBroadcaster, same as runBackup (BCK-09)"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#BackupService > runRestore() > emits done with COMPLETED status on success"
        status: pass
    human_judgment: true
    rationale: "The registration/disposal path is structurally identical to runBackup's (same two helper functions, no branch on trigger) and unit-tested directly, but per this plan's assumptions_unresolved, POST /api/stacks/:id/restore fully awaits runRestore before its 202 reply, so no client has ever watched a restore live end-to-end in the browser — that observation is out of scope for unit coverage and remains a live-UAT item, same as 04-16's D7."

duration: ~35min
completed: 2026-08-30
status: complete
---

# Phase 04 Plan 17: Close CR-01/CR-02/CR-03 gap-closure Summary

**Backup broadcaster registration moved from restic-start time to backup-creation time (closing the CR-02 race and giving abortBackup a terminal done frame), the SSE stream hook now reconnects with bounded backoff and never renders a non-verdict as a verdict (CR-01/CR-02 client half), and the detail page polls the record while disconnected and never renders a blank title for an IN_PROGRESS backup (CR-01/CR-03).**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-30T18:32:37Z
- **Tasks:** 3
- **Files modified:** 7 (4 source files, 3 test files)

## Accomplishments

- **CR-02 closed (server):** `ensureBackupBroadcaster()` / `disposeBackupBroadcaster()` are now the only writer/remover of the module-level `backupBroadcasters` map. `initiateBackup` registers the emitter before returning — before the route can send its `202 {backupId}` reply — so a client that opens `/stream` in the window between the 202 and `runBackup` actually starting always finds a live emitter instead of being told the backup already finished while it was still `IN_PROGRESS`. `runRestore` registers/disposes through the identical pair (BCK-09), and `abortBackup` now emits a terminal `done` from a `finally` block, so a backup aborted before restic ever runs still reaches a subscribed client — even if the notification send rejects.
- **CR-02 closed (SSE route):** the missing-broadcaster branch of `GET /api/backups/:id/stream` now re-reads the record and replays its stored log lines, instead of reporting the pre-broadcaster-check status (which could be stale `IN_PROGRESS` for a backup that finished in between).
- **CR-01 closed (client hook):** `useBackupStream`'s `onerror` now defers to the browser's native EventSource retry while `readyState` is not `CLOSED`, and takes over with its own bounded backoff (`BACKUP_STREAM_RECONNECT_DELAYS_MS`: 1s/2s/4s/8s/15s, 5 attempts) once the browser gives up. A successful reconnect resets the attempt counter and restores `"streaming"`.
- **CR-02 closed (client hook):** a `done` frame carrying a present-but-non-terminal status (e.g. `IN_PROGRESS`) now maps to `"disconnected"`, not `"failed"` — the client never renders a non-verdict as a verdict. A `done` frame with no status field keeps 04-16's `"failed"` mapping.
- **CR-01 closed (page):** a new bounded poll effect re-reads the backup record every 5s while the stream is `"disconnected"` and the backup is still `IN_PROGRESS`, capped at 60 polls (5 minutes). It terminates the moment the record leaves `IN_PROGRESS`, the stream returns to `"streaming"`, or the ceiling is hit. The pre-existing one-shot resync effect was narrowed to fire only on `"completed"`/`"failed"`, so the two effects can never both fetch for the same transition.
- **CR-03 closed (page):** the `shortId` fallback changed from `??` to `||`, since `initiateBackup` persists `resticSnapshotId: ""` (empty string, not null/undefined) on every new row — exactly the state a backup is in for its entire `IN_PROGRESS` lifetime, which is also the state a user most often opens this page in.

## Task Commits

1. **Task 1: Register the backup broadcaster when the backup row is created, not when restic starts** - `90cb0be` (feat)
2. **Task 2: Make the stream hook reconnect instead of dying, and stop reading a non-terminal status as a verdict** - `527cd29` (feat)
3. **Task 3: Keep re-reading the record while the stream is down, and never render a nameless backup** - `4473742` (fix)

## Files Created/Modified

- `server/src/application/backup-service.ts` - added `ensureBackupBroadcaster()`/`disposeBackupBroadcaster()` as sole map writer/remover; `initiateBackup` registers before returning; `runBackup`/`runRestore` reuse the same pair; `abortBackup` emits a terminal `done` from `finally`
- `server/src/routes/backups.ts` - the SSE route's missing-broadcaster branch re-reads the record via `backupRepository.findByIdOrThrow` and replays stored log lines
- `server/test/unit/application/backup-service.test.ts` - added broadcaster lifecycle coverage (registration, reuse across the CR-02 race window, disposal after `runBackup`, terminal-done cases in `abortBackup()`, restore parity case)
- `client/src/hooks/use-backup-stream.ts` - added `BACKUP_STREAM_RECONNECT_DELAYS_MS`, `EVENT_SOURCE_CLOSED`, `onopen`/bounded-backoff `onerror` handling, and the three-way `done`-status mapping
- `client/test/unit/hooks/use-backup-stream.test.ts` - added reconnect backoff, attempt-bound, attempt-counter-reset, and non-terminal `done` mapping coverage (8 new cases, 18 total)
- `client/src/routes/app/stacks/backups/[backupId].tsx` - fixed `shortId` fallback; narrowed the one-shot resync guard to `completed`/`failed`; added the bounded poll effect for `disconnected`
- `client/test/unit/routes/stacks/backup-detail-page.test.tsx` - added CR-03 title/breadcrumb cases and CR-01 poll-bound cases (9 new cases, 19 total)

## Decisions Made

- `abortBackup`'s post-guard body runs inside `try { ... } finally { emit done; dispose }` rather than `try/catch` — a rejected `notify()` still propagates as a rejected promise to the caller (matching existing fire-and-forget error handling in `routes/backups.ts`/`backup-scheduler.ts`), but the SSE client is never left with an open stream regardless of that outcome.
- `EVENT_SOURCE_CLOSED` (numeric `2`) is inlined in `use-backup-stream.ts` rather than read off `EventSource.CLOSED`, because the hook's own unit test substitutes a mock `EventSource` with no static members.
- The client test's `createMockEventSource()` default `readyState` was changed from `0` to `2` (CLOSED) to preserve the pre-existing "onerror always closes" test, which fires `onerror` without setting `readyState` explicitly. New tests that need the CONNECTING-vs-CLOSED branch set `readyState` explicitly via a `fireError(readyState, instance)` helper.
- `BACKUP_RESYNC_POLL_INTERVAL_MS`/`BACKUP_RESYNC_MAX_POLLS` are module-private (not exported) — the plan specifies them as private constants, so the new test cases hardcode the mirrored literal values (5000ms / 60) with a comment rather than importing them.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' acceptance-criteria greps, the full server/client test suites, both `tsc --noEmit` runs, and `yarn workspace @docktor/client build` all passed on first attempt per task.

## Regression Verification (required by this plan's `<output>` section)

For each of CR-01, CR-02, CR-03, the regression assertion was reproduced against the pre-change source (via a temporary source-file swap, run, then restore — confirmed no diff remained afterward) and observed to fail, then re-run against the current code and observed to pass:

- **CR-02 (server):** a scratch probe calling `service.initiateBackup("stack-1")` then asserting `getBackupBroadcaster("backup-1")` is defined — **failed** against `server/src/application/backup-service.ts` as of commit `00821d6` (broadcaster only existed inside `runBackup`), **passed** against the current file.
- **CR-02 (client):** `useBackupStream`'s mapping of a `{done: true, status: "IN_PROGRESS"}` frame — **failed** (mapped to `"failed"`) against `client/src/hooks/use-backup-stream.ts` as of commit `527cd29^`, **passed** (maps to `"disconnected"`) against the current file.
- **CR-03:** the backup detail page's title-rendering test for an empty `resticSnapshotId` with a long route `backupId` — **failed** (rendered a blank short id) against `client/src/routes/app/stacks/backups/[backupId].tsx` as of commit `4473742^`, **passed** against the current file.

## Issues Encountered

None beyond the regression-verification exercise above, which was expected work per the plan's acceptance criteria (not an issue).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three gap_ids this plan claims (CR-01, CR-02, CR-03) are code-complete and unit-tested. `yarn workspace @docktor/server test` (435 passed, 2 todo), `yarn workspace @docktor/client test` (114 passed, 3 todo), both `tsc --noEmit` runs, and `yarn workspace @docktor/client build` all exit 0.
- Per this plan's frontmatter, the four `human_verification` items recorded in `04-VERIFICATION.md` still need a live run — this plan adds unit coverage of the fix, not a live restic observation of a real backup surviving a dropped connection, a race-window subscribe, or an aborted-before-restic backup.
- D6 above (RESTORE broadcaster parity) is flagged `human_judgment: true` for the same reason 04-16's D7 was: `POST /api/stacks/:id/restore` fully awaits `runRestore` before its `202` reply, so this plan's own `assumptions_unresolved` notes no client has ever watched a restore live — the fix is structurally proven (same two helpers, no trigger branch) but not observable end-to-end without a snapshot to restore from (UAT Tests 14-17/23, per 04-16-SUMMARY.md, remain blocked on that same precondition).
- This closes Phase 04's re-planned gap-closure work (04-15, 04-16, 04-17). Phase 04 is ready for `/gsd-execute-phase`'s aggregate/verify flow to re-run `04-VERIFICATION.md` against the three closed gaps and re-evaluate ROADMAP Success Criterion #2.

---
*Phase: 04-backup-restore*
*Completed: 2026-08-30*

## Self-Check: PASSED

- FOUND: server/src/application/backup-service.ts
- FOUND: server/src/routes/backups.ts
- FOUND: server/test/unit/application/backup-service.test.ts
- FOUND: client/src/hooks/use-backup-stream.ts
- FOUND: client/test/unit/hooks/use-backup-stream.test.ts
- FOUND: client/src/routes/app/stacks/backups/[backupId].tsx
- FOUND: client/test/unit/routes/stacks/backup-detail-page.test.tsx
- FOUND commit: 90cb0be
- FOUND commit: 527cd29
- FOUND commit: 4473742
