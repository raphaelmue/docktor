---
phase: 02-observability
plan: 07
subsystem: testing
tags: [vitest, docker-compose, update-checker, toast, ux]

# Dependency graph
requires:
  - phase: 02-observability
    provides: FileWatcher with replaceServices, parseComposeContent throw behavior, updateImages route
provides:
  - All 127 unit tests pass (125 passed + 2 todo)
  - manifestInspect full stderr logging on non-404 errors
  - composePull returns stdout string for pull output analysis
  - updateImages returns noUpdates boolean indicating whether images changed
  - Update Images UI shows contextual toast distinguishing up-to-date vs updated
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - server/test/unit/jobs/file-watcher.test.ts
    - server/test/unit/lib/compose-parser.test.ts
    - server/test/unit/domain/compose-config.test.ts
    - server/src/infrastructure/docker-executor.ts
    - server/src/application/stack-service.ts
    - server/src/routes/stacks.ts
    - client/src/lib/stacks-api.ts
    - client/src/routes/app/stacks/[id].tsx

key-decisions:
  - "Update Images button uses inline async onClick instead of handleAction — handleAction discards return value, noUpdates detection requires reading the response"
  - "noUpdates detection: pullOutput.toLowerCase().includes('up to date') OR empty stdout — covers both docker compose pull messages and edge cases"

patterns-established: []

requirements-completed: [FW-01, FW-02, FW-03, UPD-01, UPD-02, UPD-03, UPD-04]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 02 Plan 07: Gap Closure — Test Fixes and Update Images UX Summary

**All 127 unit tests pass after fixing mock divergence and stale assertions; Update Images now shows contextual toast distinguishing "already up to date" from "images updated successfully"**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-16T14:55:13Z
- **Completed:** 2026-03-16T14:58:33Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Fixed three unit test files with broken mocks and stale assertions — all 13 test files now pass with 125/127 tests (2 todo)
- Added `replaceServices` and `createComposeConfig` mocks to file-watcher tests matching updated FileWatcherRepo interface
- Updated compose-parser and compose-config tests to assert throws instead of empty-array returns
- Improved `manifestInspect` error logging to include full Docker stderr on non-404 failures
- Changed `composePull` to return stdout string, enabling pull output analysis in `updateImages`
- `updateImages` now returns `{noUpdates: boolean}` and the route passes it to the client
- Update Images button shows "Images are already up to date" (toast.info) or "Images updated successfully" (toast.success)

## Task Commits

1. **Task 1: Fix broken unit tests — mock divergence and outdated assertions** - `243be50` (fix)
2. **Task 2: Improve manifestInspect diagnostic logging and Update Images UX feedback** - `2872480` (feat)

**Plan metadata:** [docs commit hash — added after state update]

## Files Created/Modified

- `server/test/unit/jobs/file-watcher.test.ts` - Added replaceServices mock and createComposeConfig vi.mock
- `server/test/unit/lib/compose-parser.test.ts` - Changed 2 tests to assert toThrow instead of empty arrays
- `server/test/unit/domain/compose-config.test.ts` - Changed 2 tests to assert toThrow instead of empty arrays
- `server/src/infrastructure/docker-executor.ts` - composePull returns stdout; manifestInspect logs err.stderr on rethrow
- `server/src/application/stack-service.ts` - updateImages captures pullOutput, returns {noUpdates: boolean}
- `server/src/routes/stacks.ts` - POST /update returns {success, noUpdates}
- `client/src/lib/stacks-api.ts` - updateImages return type includes noUpdates boolean
- `client/src/routes/app/stacks/[id].tsx` - Update Images uses inline handler to show contextual toast

## Decisions Made

- Update Images button replaced `handleAction(() => updateImages(id), "Update images")` with an inline async onClick because `handleAction` wraps the action in `toast.promise` and discards the return value — reading `noUpdates` from the response requires the inline pattern.
- `noUpdates` detection checks for "up to date" in lowercase stdout or empty stdout — covers `docker compose pull` messages like "Image is up to date" and "Already exists" as well as edge cases where pull emits nothing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 02-observability is now complete. All unit tests pass, TypeScript build is clean, and the Update Images UX delivers clear feedback to the user. Ready for Phase 03 or UAT verification.

---
*Phase: 02-observability*
*Completed: 2026-03-16*
