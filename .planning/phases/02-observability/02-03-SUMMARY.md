---
phase: 02-observability
plan: 03
subsystem: jobs
tags: [chokidar, node-cron, file-watcher, sse, docker-compose, vitest]

# Dependency graph
requires:
  - phase: 02-02
    provides: "StackEventRepository, ConfigChangedEvent/ConfigErrorEvent SSE types, Prisma StackEvent model"
  - phase: 02-01
    provides: "Failing test scaffold for FileWatcher (FW-01/FW-02/FW-03)"
provides:
  - "FileWatcher class with chokidar watch on STACKS_ROOT + 60s cron reconcile"
  - "jobs/index.ts registry with startJobs()/stopJobs()"
  - "app.ts uses job registry instead of direct statePoller import"
affects:
  - 02-04
  - 02-05

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy dynamic import() for repo to avoid db.ts in unit test module graph"
    - "FileWatcher mirrors StatePoller constructor-injection pattern exactly"
    - "Jobs registry pattern: all background jobs started/stopped via index.ts"
    - "chokidar ignored() always returns false for directories to allow recursive traversal"

key-files:
  created:
    - server/src/jobs/file-watcher.ts
    - server/src/jobs/index.ts
  modified:
    - server/src/app.ts
    - server/test/unit/jobs/file-watcher.test.ts

key-decisions:
  - "FileWatcher.stop() is async to properly await watcher.close() Promise"
  - "FileWatcherRepo uses composeFilePath and hash fields (matching test scaffold) rather than hostPath/lastKnownHash"
  - "Test file updated with vi.mock(node:fs/promises) and vi.mock(compose-parser) — original 02-01 scaffold lacked filesystem mocking, causing ENOENT in test env"
  - "stopJobs() calls void fileWatcher.stop() since FileWatcher.stop() returns Promise but registry stop() is synchronous"

patterns-established:
  - "Jobs registry pattern: import all job singletons, expose startJobs/stopJobs, add new jobs here not in app.ts"
  - "FileWatcher test isolation: mock node:fs/promises + compose-parser to avoid filesystem dependency in unit tests"

requirements-completed:
  - FW-01
  - FW-02
  - FW-03

# Metrics
duration: 6min
completed: 2026-03-13
---

# Phase 2 Plan 3: FileWatcher Job Summary

**chokidar-based file watcher on STACKS_ROOT that detects compose file changes, updates DB hash, and broadcasts config_changed/config_error SSE events with 60s cron reconcile fallback**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-13T10:11:27Z
- **Completed:** 2026-03-13T10:17:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- FileWatcher class implements chokidar watch (depth:2, ignoreInitial, awaitWriteFinish 1s, directory-safe ignored fn)
- handleFileChange: hash compare → no-op; invalid YAML → config_error event + SSE; valid changed → updateStackHash + config_changed event + SSE
- reconcile(): loads all stacks, re-hashes every file, triggers handleFileChange if hash differs (NFS fallback)
- jobs/index.ts registry with startJobs()/stopJobs() containing statePoller + fileWatcher
- app.ts simplified: uses startJobs/stopJobs from registry instead of direct statePoller import

## Task Commits

1. **Task 1: FileWatcher implementation (TDD GREEN)** - `68e5384` (feat)
2. **Task 2: Jobs registry + app.ts wiring** - `466e1fa` (feat)

## Files Created/Modified

- `server/src/jobs/file-watcher.ts` - FileWatcher class with chokidar + cron reconcile; exports FileWatcher class and fileWatcher singleton
- `server/src/jobs/index.ts` - Job registry: startJobs()/stopJobs() for statePoller + fileWatcher
- `server/src/app.ts` - Replaced statePoller import with startJobs/stopJobs from registry
- `server/test/unit/jobs/file-watcher.test.ts` - Updated with proper filesystem and parser mocking

## Decisions Made

- `FileWatcher.stop()` made async to correctly await `watcher.close()` which returns a Promise
- `FileWatcherRepo` interface uses `composeFilePath` and `hash` field names (matching the existing test scaffold from 02-01) rather than `hostPath`/`lastKnownHash` from the initial plan spec
- `stopJobs()` calls `void fileWatcher.stop()` since the registry's stop is synchronous but FileWatcher needs async cleanup
- Placeholder comments in jobs/index.ts for updateChecker (added in 02-04)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated test file to add filesystem and parser mocking**
- **Found during:** Task 1 (TDD GREEN — running tests)
- **Issue:** The 02-01 test scaffold called `handleFileChange(fakePath)` without mocking `node:fs/promises`. Since test paths like `/stacks/my-stack/docker-compose.yml` don't exist, `readFile` threw ENOENT causing tests to skip early instead of testing the config_changed/reconcile logic.
- **Fix:** Added `vi.mock("node:fs/promises")` and `vi.mock("../../../../src/lib/compose-parser.js")` with configurable return values; updated test bodies to control hash/parse outcomes
- **Files modified:** server/test/unit/jobs/file-watcher.test.ts
- **Verification:** 9/9 FileWatcher tests pass (was 4/9 before fix)
- **Committed in:** 68e5384 (Task 1 commit)

**2. [Rule 3 - Blocking] Regenerated Prisma client before implementation**
- **Found during:** Pre-task setup
- **Issue:** Prisma schemas from 02-02 (StackEvent, ImageUpdateCheck) had been added to disk but the generated client hadn't been regenerated. `StackEventType` enum was missing from generated code.
- **Fix:** Ran `npx prisma generate --config prisma/prisma.config.ts`
- **Files modified:** server/src/generated/prisma/* (auto-generated)
- **Verification:** StackEventType enum present in enums.ts
- **Committed in:** Pre-existing (generated files not committed)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for tests to work and implementation to compile. No scope creep.

## Issues Encountered

- The 02-01 test scaffold used field names (`composeFilePath`, `hash`) that differ from what the 02-03 plan spec described (`hostPath`, `lastKnownHash`). Implemented `FileWatcherRepo` to match the test scaffold since tests are the authoritative contract.

## Next Phase Readiness

- FileWatcher fully operational; broadcasts config_changed and config_error SSE events
- jobs/index.ts ready to add updateChecker in plan 02-04
- app.ts lifecycle uses registry — 02-04 only needs to update jobs/index.ts

---
*Phase: 02-observability*
*Completed: 2026-03-13*
