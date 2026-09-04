---
phase: 02-observability
plan: 01
subsystem: testing
tags: [vitest, tdd, chokidar, node-cron, docker, file-watcher, update-checker]

# Dependency graph
requires: []
provides:
  - "Failing unit test contracts for FileWatcher (FW-01, FW-02, FW-03) — RED state"
  - "Failing unit test contracts for UpdateChecker (UPD-01, UPD-02, UPD-04) — RED state"
affects: [02-02, 02-03, 02-04, 02-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constructor-injectable mock pattern for background jobs (mirrors StatePoller test pattern)"
    - "vi.mock('chokidar') + vi.mock('node-cron') for background job isolation"
    - "Named pure function exports (compareVersions, getNextImageToCheck) for direct unit testability"

key-files:
  created:
    - server/test/unit/jobs/file-watcher.test.ts
    - server/test/unit/jobs/update-checker.test.ts
  modified: []

key-decisions:
  - "compareVersions and getNextImageToCheck exported as named functions (not class methods) so they can be unit-tested without an UpdateChecker instance"
  - "FileWatcher.handleFileChange accepts optional test-control options (forceInvalidYaml, simulatedHash) to enable testing error paths without real filesystem"
  - "Both test files follow state-poller.test.ts pattern: createMock*() factories + beforeEach clearAllMocks + constructor injection"

patterns-established:
  - "Wave 0 TDD: test contracts written before any implementation — RED state enforces contract-first development"
  - "Test mock factories return object literals with vi.fn() stubs matching expected interface shape"

requirements-completed: [FW-01, FW-02, FW-03, UPD-01, UPD-02, UPD-04]

# Metrics
duration: 5min
completed: 2026-03-13
---

# Phase 2 Plan 01: Observability RED Test Scaffolds Summary

**Failing vitest unit test contracts for FileWatcher (chokidar + cron) and UpdateChecker (semver/date/digest comparison + stagger scheduling) — RED state confirming module-not-found on missing implementation files**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-13T10:09:49Z
- **Completed:** 2026-03-13T10:14:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `file-watcher.test.ts` with 9 real assertions covering FW-01 (start/stop lifecycle), FW-02 (hash-based change detection + SSE broadcast), FW-03 (reconcile loop)
- Created `update-checker.test.ts` with 12 real assertions covering UPD-01 (semver/date/digest compareVersions), UPD-02 (stagger scheduling via getNextImageToCheck), UPD-04 (triggerUpdate pull+recreate transitions)
- Both files produce `ERR_MODULE_NOT_FOUND` failures (correct RED state); all previously passing tests continue to pass (no regression)

## Task Commits

Each task was committed atomically:

1. **Task 1: File watcher test scaffold (FW-01, FW-02, FW-03)** - `9113328` (test)
2. **Task 2: Update checker test scaffold (UPD-01, UPD-02, UPD-04)** - `8081645` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `server/test/unit/jobs/file-watcher.test.ts` - Failing test stubs for FileWatcher: start/stop, handleFileChange hash detection, reconcile loop
- `server/test/unit/jobs/update-checker.test.ts` - Failing test stubs for UpdateChecker: compareVersions, getNextImageToCheck stagger logic, triggerUpdate status transitions

## Decisions Made

- `compareVersions` and `getNextImageToCheck` exported as standalone named functions from `update-checker.ts` — pure functions are directly testable without instantiating UpdateChecker class; implementation plans must honor these exports
- `FileWatcher.handleFileChange` signature includes optional test-control parameter `{forceInvalidYaml, simulatedHash}` — enables testing YAML error path and hash-match no-op path without touching real filesystem
- Followed `state-poller.test.ts` constructor-injection pattern: `createMock*()` factories, `beforeEach(() => { vi.clearAllMocks(); ... })`, and passing mocks via constructor

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 complete: all 6 phase requirements have failing test contracts in RED state
- Implementation plans (02-02 FileWatcher, 02-03 UpdateChecker) can now target these test contracts for GREEN state
- Test contracts define exact interface signatures: FileWatcher constructor `(repo, broadcaster)`, UpdateChecker constructor `(repo, dockerExecutor, broadcaster)`, named exports `compareVersions(current, latest, opts?)` and `getNextImageToCheck(images, intervalMs)`

---
*Phase: 02-observability*
*Completed: 2026-03-13*

## Self-Check: PASSED

- FOUND: server/test/unit/jobs/file-watcher.test.ts
- FOUND: server/test/unit/jobs/update-checker.test.ts
- FOUND: .planning/phases/02-observability/02-01-SUMMARY.md
- FOUND commit: 9113328 (file-watcher test scaffold)
- FOUND commit: 8081645 (update-checker test scaffold)
