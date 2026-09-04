---
phase: 04-backup-restore
plan: 18
subsystem: backup-restore
tags: [sse, event-emitter, fastify, react-hooks, vitest]

# Dependency graph
requires:
  - phase: 04-backup-restore
    provides: BackupService.runBackup/runRestore, backupBroadcasters EventEmitter map, GET /api/backups/:id/stream SSE route, useBackupStream hook (04-06, 04-08, 04-17)
provides:
  - "In-memory backupLogBuffers accumulator (ensureBackupLogBuffer/getBackupLogBuffer) parallel to backupBroadcasters, freed by disposeBackupBroadcaster"
  - "server/src/lib/sse-backup-log.ts — HTTP-agnostic streamLiveBackupLog helper with replay-then-live ordering guarantee"
  - "GET /api/backups/:id/stream live branch now replays the accumulated log before streaming further lines"
  - "useBackupStream's clear-on-connect documented as a deliberate consequence of the server's always-replay-on-subscribe invariant"
affects: [04-backup-restore, backup-detail-page]

actuals:
  tokens: 5700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Companion module-level Map pattern: backupLogBuffers mirrors backupBroadcasters' lifecycle (register on create, free on dispose) rather than introducing a separate cleanup path"
    - "HTTP-agnostic port seam (BackupLogStreamPort) for unit-testing SSE writer logic without a Fastify socket"

key-files:
  created:
    - server/src/lib/sse-backup-log.ts
    - server/test/unit/lib/sse-backup-log.test.ts
  modified:
    - server/src/application/backup-service.ts
    - server/src/application/index.ts
    - server/src/routes/backups.ts
    - server/test/unit/application/backup-service.test.ts
    - client/src/hooks/use-backup-stream.ts
    - client/test/unit/hooks/use-backup-stream.test.ts

key-decisions:
  - "Server-side replay (not client-side clear-gating) closes WR-01 — the alternative (only clear on first connect) would trade WR-01 for a duplication bug when the backup finishes during the disconnect window; recorded in the plan objective, not re-litigated here"
  - "backupLogBuffers reuses the same array runBackup/runRestore already allocate and persist as logLines — zero-delta on peak memory, freed by the existing disposeBackupBroadcaster call in both finally blocks"
  - "streamLiveBackupLog's replay snapshot, replay writes, and listener attachment happen in one synchronous block with no await, so Node cannot interleave an emit across the replay/live boundary"

patterns-established:
  - "BackupLogStreamPort interface as the seam between an HTTP-agnostic SSE helper and Fastify's reply.raw/request.raw, matching state-broadcaster.ts's precedent of keeping broadcast logic outside route handlers"

requirements-completed: [BCK-03]

coverage:
  - id: D1
    description: "Live in-memory log accumulator (ensureBackupLogBuffer/getBackupLogBuffer) exposes lines already emitted by a still-IN_PROGRESS backup, freed on terminal state"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/backup-service.test.ts#log buffer (WR-01 — live SSE replay)"
        status: pass
    human_judgment: false
  - id: D2
    description: "streamLiveBackupLog replays buffered lines before attaching the live listener, in one synchronous block, so no line is lost or duplicated across the boundary"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/sse-backup-log.test.ts#streamLiveBackupLog()"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/backups/:id/stream live branch wired to streamLiveBackupLog, passing getBackupLogBuffer(id) as the replay source; terminal and missing-broadcaster branches unchanged"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "server/test/unit --reporter=dot (443 passed, 2 pre-existing todo)"
        status: pass
    human_judgment: false
  - id: D4
    description: "useBackupStream's reconnect ends with the complete, non-duplicated log — client-visible outcome of the server replay fix, replacing the test that encoded the log wipe as intended behavior"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#repopulates the full log from the server replay after a reconnect, with every line present exactly once"
        status: pass
    human_judgment: true
    rationale: "The unit test proves the reconnect assembles the log correctly against a mocked EventSource; a live end-to-end disconnect/reconnect against a running backup (real network drop) is unverified by automation and was explicitly excluded from this plan's scope (04-VERIFICATION.md's open human_verification items)."

duration: 14min
completed: 2026-08-31
status: complete
---

# Phase 04 Plan 18: Gap-closure for WR-01 — live SSE log replay on reconnect Summary

**Server-side replay of the in-memory backup log accumulator on every SSE subscription, closing the reconnect-blanks-the-log defect via a new `streamLiveBackupLog` helper and a parallel `backupLogBuffers` map.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-31T07:34:40Z
- **Completed:** 2026-08-31T07:47:54Z
- **Tasks:** 3
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- `backup-service.ts` gained `ensureBackupLogBuffer`/`getBackupLogBuffer`, a module-level `Map<string, string[]>` companion to `backupBroadcasters`, so lines already emitted by a still-`IN_PROGRESS` backup are readable from outside the service — freed by the existing `disposeBackupBroadcaster` call, at zero memory delta since it reuses the array `runBackup`/`runRestore` already persist as `logLines`.
- New `server/src/lib/sse-backup-log.ts` exports `streamLiveBackupLog`, `formatLogLineFrame`, `formatDoneFrame`, and the `BackupLogStreamPort` seam — replaying every buffered line to a new subscriber before attaching the live listener, all in one synchronous block so no line can be lost or duplicated.
- `GET /api/backups/:id/stream`'s live branch now delegates to `streamLiveBackupLog`, passing `getBackupLogBuffer(id) ?? []` as the replay source; the two terminal branches are byte-for-byte unchanged.
- `useBackupStream`'s `setLines([])` on connect is now documented as correct-because-the-server-always-replays, and the test that encoded the pre-fix log wipe as intended behavior is replaced with one asserting the real outcome: after a reconnect, the pane holds the complete log with each line exactly once.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end replay path for a live backup — expose the accumulator and prove it fills mid-run** - `e4dce89` (feat)
2. **Task 2: Replay the accumulated log to every new subscriber on the live SSE branch** - `b00d90d` (feat)
3. **Task 3: Document the always-replay invariant in the hook and replace the test that encodes WR-01 as intended behavior** - `31231be` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `server/src/application/backup-service.ts` - `backupLogBuffers` map, `ensureBackupLogBuffer`/`getBackupLogBuffer`, `runBackup`/`runRestore` now source `lines` from the buffer, `disposeBackupBroadcaster` frees it
- `server/src/application/index.ts` - re-exports `getBackupLogBuffer` alongside `getBackupBroadcaster`
- `server/src/lib/sse-backup-log.ts` - new HTTP-agnostic SSE replay helper (`streamLiveBackupLog`, formatters, `BackupLogStreamPort`)
- `server/src/routes/backups.ts` - live-emitter branch delegates to `streamLiveBackupLog`; terminal/missing-broadcaster branches untouched
- `server/test/unit/application/backup-service.test.ts` - 5 new tests covering buffer creation, mid-run visibility (both `runBackup` and `runRestore`), and terminal-state cleanup
- `server/test/unit/lib/sse-backup-log.test.ts` - new file, 9 tests covering formatters, replay ordering, no-duplication, done-frame fallback, and client-close cleanup
- `client/src/hooks/use-backup-stream.ts` - doc comment above `setLines([])` recording the always-replay invariant (WR-01, BCK-03); no executable statement changed
- `client/test/unit/hooks/use-backup-stream.test.ts` - replaces "clears lines received before a reconnect..." with "repopulates the full log from the server replay after a reconnect, with every line present exactly once"

## Decisions Made

- Server-side replay was the chosen fix direction, recorded in the plan objective before execution began — not re-litigated during execution.
- The mid-run visibility tests assert `getBackupLogBuffer` from inside the mocked restic executor's `onLine` callback (via `expect()` called synchronously inside the callback) rather than after `runBackup`/`runRestore` resolves, so the assertion is against the running state, not inferred from the terminal state.
- No new database reads were introduced on the live branch — the buffer read and the `streamLiveBackupLog` call sit in the same synchronous stretch as the existing `getBackupBroadcaster(id)` lookup.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `client/test/unit/routes/stacks/service-upgrade-dialog.test.tsx` timed out once under full-suite parallel load (`Test timed out in 5000ms`), unrelated to any file this plan touches. Confirmed as a pre-existing timing flake: passed 9/9 in isolation and passed on a clean re-run of the full `test/unit` suite (114 passed, 3 todo, 0 failed). No fix applied — out of scope per the plan's explicit scope boundary, and not a regression introduced by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap WR-01 is closed: all three SSE branches (terminal, missing-broadcaster, live) now begin every subscription with a full replay, so `useBackupStream`'s clear-on-connect can never lose lines, and a reconnect during a running backup shows the complete log with each line exactly once.
- The two `human_verification` items already open in `04-VERIFICATION.md` (live re-run of the no-repository-configured guard; live end-to-end restore observation) remain open — this plan did not address them, matching its explicitly out-of-scope declaration.
- Both server and client workspaces typecheck clean; the full server unit suite (443 passed, 2 pre-existing todo) and client unit suite (114 passed, 3 pre-existing todo) pass with no regressions.

---
*Phase: 04-backup-restore*
*Completed: 2026-08-31*

## Self-Check: PASSED

- FOUND: server/src/lib/sse-backup-log.ts
- FOUND: server/test/unit/lib/sse-backup-log.test.ts
- FOUND: .planning/phases/04-backup-restore/04-18-SUMMARY.md
- FOUND commit: e4dce89 (Task 1)
- FOUND commit: b00d90d (Task 2)
- FOUND commit: 31231be (Task 3)
