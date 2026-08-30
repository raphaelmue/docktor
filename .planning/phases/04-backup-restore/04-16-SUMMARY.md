---
phase: 04-backup-restore
plan: 16
subsystem: backup
tags: [react, sse, eventsource, vitest, testing-library]

# Dependency graph
requires:
  - phase: 04-backup-restore
    provides: "runBackup()/runRestore() emit {done, status: \"COMPLETED\"|\"FAILED\"} on the live SSE \"done\" event (04-15)"
provides:
  - "BackupStreamStatus union (\"streaming\"|\"completed\"|\"failed\"|\"disconnected\") replacing the collapsed done/error pair — a done payload with no status field now maps to failed, and a dropped SSE connection is reported as disconnected, distinct from a real FAILED backup"
  - "One-shot resync effect on the backup detail page: refetches the Backup record exactly once when the stream leaves streaming for any terminal outcome, without disturbing the page's loading/error branches"
  - "FAILED-specific Output empty state (\"No log output was captured for this backup.\") distinct from the not-yet-started \"No output yet...\" message"
affects: [04-backup-restore UAT re-verification (Test 12), phase 04 completion]

actuals:
  tokens: 4780
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "loadBackup(mode, isCancelled) — a single fetch callback shared by the mount effect and the resync effect, keyed on backupId via useCallback; mode gates whether loading/error state is touched, isCancelled is a per-effect closure flag (not a shared ref) so each effect owns its own cancellation lifecycle"
    - "Resync effect guard reads [isStreaming, streamStatus, loadBackup] and only fires while isStreaming is true and streamStatus is not \"streaming\" — once the refetched record's status leaves IN_PROGRESS, isStreaming flips false and the guard short-circuits on every subsequent render, bounding the effect to exactly one extra request per stream completion"

key-files:
  created:
    - client/test/unit/hooks/use-backup-stream.test.ts
    - client/test/unit/routes/stacks/backup-detail-page.test.tsx
  modified:
    - client/src/hooks/use-backup-stream.ts
    - client/src/routes/app/stacks/backups/[backupId].tsx

key-decisions:
  - "loadBackup takes an isCancelled() closure argument rather than a shared mounted ref, so the mount effect and the resync effect each own an independent cancellation flag with no cross-talk between them"
  - "A rejected resync logs console.warn and leaves the previously rendered backup on screen — it never touches the error state, since flipping into the full-page error branch would replace a perfectly good, still-displayed record over a transient refetch failure"
  - "disconnected is treated identically to completed/failed by the resync effect: the page always re-reads the server rather than trusting a dropped SSE connection to mean anything about the backup's outcome"

requirements-completed: [BCK-03, BCK-09, BCK-11]

coverage:
  - id: D1
    description: "A backup watched from IN_PROGRESS to COMPLETED updates the status badge, without a manual reload"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > resyncs and renders the refetched status when the stream moves from streaming to completed"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > sets status to completed and closes the EventSource on done with status COMPLETED"
        status: pass
    human_judgment: false
  - id: D2
    description: "A backup watched to FAILED renders the destructive alert with the persisted error message, without a manual reload"
    requirement: "BCK-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > resyncs on failed and renders the destructive alert once the refetched record is FAILED with an error message"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > sets status to failed and closes the EventSource on done with status FAILED"
        status: pass
    human_judgment: false
  - id: D3
    description: "A FAILED backup with no captured output renders its own empty-state copy, distinct from the not-yet-started message"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > renders the failure-specific empty message for a FAILED record with no captured lines"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > renders the original empty message for a record still IN_PROGRESS with no lines yet"
        status: pass
    human_judgment: false
  - id: D4
    description: "The hook distinguishes a FAILED backup from a dropped SSE connection — a done payload with no status field maps to failed (not completed), and onerror maps to disconnected (not the same value as a failed backup)"
    requirement: "BCK-11"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > sets status to failed (not completed) on a done payload with no status field"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-backup-stream.test.ts#useBackupStream > sets status to disconnected and closes the EventSource on onerror"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > resyncs when the stream moves to disconnected"
        status: pass
    human_judgment: false
  - id: D5
    description: "The resync costs exactly one additional GET /api/backups/:id request and cannot become a request loop, and a rejected resync leaves the previously rendered record on screen"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > makes exactly two requests in total once the refetched record is terminal"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > leaves the previously rendered record on screen when a refetch rejects"
        status: pass
    human_judgment: false
  - id: D6
    description: "Once the record is terminal, rendered log lines come from the persisted record rather than the stream, and autoScroll (and its derived aria-live) switches off once the stream leaves streaming"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > renders log lines from the record, not the stream, once the record is terminal"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/backup-detail-page.test.tsx#BackupDetailPage > switches autoScroll off once the stream is no longer streaming"
        status: pass
    human_judgment: false
  - id: D7
    description: "A restore watched to completion behaves identically to a backup on this page — both are Backup rows rendered through the same component and the same stream, so the resync covers RESTORE-trigger rows without a separate code path"
    requirement: "BCK-09"
    verification: []
    human_judgment: true
    rationale: "The resync effect and loadBackup are trigger-agnostic — they operate on the BackupRecord.status field regardless of BackupRecord.trigger, and no code path in this plan branches on trigger. This is a structural (backstop) guarantee per the plan's must_haves, not something a targeted RESTORE-specific test adds coverage for beyond what D1/D2 already prove for MANUAL/SCHEDULED rows. A live UAT re-run watching an actual restore to completion is the recommended verification, per the plan's own assumptions_unresolved note that UAT Tests 14-17/23 remain blocked on having a snapshot to restore from."

duration: ~10min
completed: 2026-08-30
status: complete
---

# Phase 04 Plan 16: Backup detail page resync on stream completion Summary

**The backup detail page now refetches its Backup record exactly once when the SSE stream reaches any terminal state (completed, failed, or disconnected), and the stream hook itself distinguishes a real FAILED backup from a merely dropped connection — closing UAT Test 12's stale-page-after-stream-ends defect.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-08-30T19:28:15+02:00
- **Tasks:** 2
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments
- `useBackupStream` now reports four distinct outcomes instead of three: `streaming`, `completed`, `failed`, `disconnected`. A `done` payload with no `status` field (defensive/malformed) now maps to `failed` rather than silently being treated as success by omission; `onerror` now reports `disconnected`, no longer sharing a value with an actual FAILED backup.
- The backup detail page no longer goes stale after the stream ends: a new one-shot resync effect refetches the record exactly once per stream completion — covering `completed`, `failed`, and `disconnected` alike — so the status badge, the destructive alert (FAILED + errorMessage), and the log source (persisted `logLines` instead of streamed lines) all update without a manual reload.
- A FAILED backup that captured no log output now says "No log output was captured for this backup." instead of the generic not-yet-started "No output yet..." message.
- `autoScroll` (and the `aria-live` attribute `LogOutput` derives from it) switches off as soon as the stream leaves `streaming`, satisfying the accessibility contract from 04-UI-SPEC.md.
- `useBackupStream` and `BackupDetailPage` both gained their first unit test coverage (10 tests each, 20 new tests total).

## Task Commits

1. **Task 1: Give the stream four outcomes instead of three** - `44c342e` (feat)
2. **Task 2: Resync the record once the stream stops, and say when a failure captured nothing** - `fb9a4e7` (feat)

## Files Created/Modified
- `client/src/hooks/use-backup-stream.ts` - exported `BackupStreamStatus` union; `done` branch maps missing/non-COMPLETED status to `failed`; `onerror` sets `disconnected`
- `client/src/routes/app/stacks/backups/[backupId].tsx` - extracted `loadBackup(mode, isCancelled)`; added the resync `useEffect`; conditional FAILED-specific `emptyMessage` for `LogOutput`
- `client/test/unit/hooks/use-backup-stream.test.ts` (new) - 10 tests covering every case in the plan's behavior list, using the `createMockEventSource` pattern copied from `use-container-events.test.ts`
- `client/test/unit/routes/stacks/backup-detail-page.test.tsx` (new) - 10 tests covering the resync effect, log-source switch, empty-state copy, the exactly-twice request bound, rejected-resync resilience, and the `aria-live`/`autoScroll` transition

## Decisions Made
- `loadBackup` takes an `isCancelled()` closure argument (not a shared `mounted` ref) so the mount effect and the resync effect each own an independent cancellation flag, matching the plan's instruction to "keep the existing cancelled guard."
- A rejected resync is swallowed with `console.warn` and never touches `error` state — the previously rendered record stays on screen rather than the page flipping into its full-page error branch over a transient background refetch failure, mirroring `use-stack.ts`'s initial/background split.
- `disconnected` is handled identically to `completed`/`failed` by the resync effect: a dropped SSE connection is not trusted to mean anything about the backup's outcome, so the page always re-reads the server.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a local `matchMedia` stub and a `SidebarProvider` wrapper in the new page test file**
- **Found during:** Task 2 (writing `backup-detail-page.test.tsx`)
- **Issue:** Rendering `BackupDetailPage` inside `MemoryRouter` alone threw `useSidebar must be used within a SidebarProvider` (the page renders through `Page`/`PageHeader`, which use `SidebarTrigger`), and once wrapped in `SidebarProvider`, jsdom's missing `window.matchMedia` (used by the sidebar's mobile-detection hook) threw `TypeError: globalThis.matchMedia is not a function`. This is the first test in the codebase to render a full `Page` shell.
- **Fix:** Wrapped the test's render helper in `SidebarProvider` and added a `beforeEach`-scoped `window.matchMedia` stub, local to this test file only (did not touch the shared `client/test/setup.ts`, which is out of this plan's `files_modified`).
- **Files modified:** `client/test/unit/routes/stacks/backup-detail-page.test.tsx`
- **Verification:** `yarn workspace @docktor/client test test/unit/routes/stacks/backup-detail-page.test.tsx` — 10/10 pass.
- **Committed in:** `fb9a4e7` (Task 2 commit)

**2. [Rule 3 - Blocking] Task 2's `useEffect` grep acceptance criterion is unsatisfiable as literally written**
- **Found during:** Task 2 (verifying acceptance criteria)
- **Issue:** The plan's acceptance criterion `grep -c 'useEffect' 'client/src/routes/app/stacks/backups/[backupId].tsx'` returns exactly 2` cannot be met by any implementation that both imports `useEffect` from `"react"` and adds a second effect call site, because `grep -c` counts matching *lines* and the import statement itself is always one matching line. Pre-task, this same command already returned 2 (1 import line + 1 existing effect); post-task, with the required second effect added, it necessarily returns 3 (1 import line + 2 effect call sites) — the criterion was written without accounting for the import line's own match.
- **Fix:** Verified the underlying intent instead — exactly two `useEffect(` call sites (`grep -c 'useEffect('` returns 2), confirming no accidental third effect was introduced. No code change was needed; this is a documentation-only discrepancy in the plan's grep command, not a defect in the implementation.
- **Files modified:** none (verification-only)
- **Committed in:** n/a (no code change)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking test-infrastructure/acceptance-criteria issues)
**Impact on plan:** Neither affected the shipped behavior. The first was required to make the new test file runnable at all in jsdom; the second is a documented false-negative in the plan's own verification command, not a code change.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All Phase 04 gap-closure requirements this plan claims (BCK-03, BCK-09, BCK-11) are code-complete and unit-tested. `yarn workspace @docktor/client test` is green (12 files, 97 passed, 3 pre-existing todo, 0 failed), `yarn workspace @docktor/client build` exits 0, and `yarn typecheck` at the repository root exits 0.
- This was the last plan in Phase 04 (backup-restore) gap closure. UAT Test 12 (backup detail page going stale after the stream ends) should be re-run live to close the loop: watch a MANUAL backup live to both COMPLETED and FAILED, and confirm the badge, log source, and destructive alert all update without a reload.
- D7 above is flagged `human_judgment: true` — RESTORE-row resync behavior is structurally covered (the resync effect is trigger-agnostic) but not covered by a RESTORE-specific test, since UAT Tests 14-17/23 remain blocked on having a snapshot to restore from (per this plan's `assumptions_unresolved`).
- Phase 04 is now ready for goal-backward re-verification and phase closure per the standard `/gsd-execute-phase` aggregate/verify flow.

---
*Phase: 04-backup-restore*
*Completed: 2026-08-30*

## Self-Check: PASSED

- FOUND: client/src/hooks/use-backup-stream.ts
- FOUND: client/src/routes/app/stacks/backups/[backupId].tsx
- FOUND: client/test/unit/hooks/use-backup-stream.test.ts
- FOUND: client/test/unit/routes/stacks/backup-detail-page.test.tsx
- FOUND commit: 44c342e
- FOUND commit: fb9a4e7
