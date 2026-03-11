---
phase: 01-mvp-completion
plan: "03"
subsystem: server-infrastructure
tags:
  - state-poller
  - dockerode
  - sse
  - cron
  - container-state
  - event-stream

dependency_graph:
  requires:
    - "01-02 (DockerodeClient.getEventStream/inspectContainer/listContainers + StateBroadcaster.publish)"
  provides:
    - StatePoller class (start/stop, handleEvent, reconcile, startEventStream)
    - statePoller singleton (lazy-loaded repo, exported from state-poller.ts)
    - Docker event stream subscription with 2000ms auto-reconnect
    - 60-second cron reconciliation loop for full state sync
    - Container state update writes to DB via StackRepository.updateServiceState
    - SSE broadcast via stateEventBroadcaster.publish after each state change
  affects:
    - "01-05 (State SSE depends on stateEventBroadcaster events from StatePoller)"
    - "01-04+ (Any plan depending on real-time container state in DB)"

tech-stack:
  added:
    - "node-cron (already in deps) — 60s reconcile schedule"
  patterns:
    - "Lazy dynamic import for repo dependency (avoids pulling db.ts into test module graph)"
    - "AbortController for clean Docker event stream teardown on server close"
    - "Constructor injection for full testability (docker, repo, broadcaster overridable)"
    - "NODE_ENV !== test guard in app.ts lifecycle hooks to prevent Docker socket in unit tests"

key-files:
  created:
    - server/src/jobs/state-poller.ts
  modified:
    - server/src/app.ts
    - server/src/lib/state-broadcaster.ts
    - server/src/repositories/stack-repository.ts

key-decisions:
  - "StatePoller uses constructor injection (docker, repo, broadcaster) matching test mock pattern — not module-level mocks"
  - "Default repo loaded via dynamic import() inside getRepo() to prevent db.ts from entering module graph during unit test runs"
  - "TRANSITIONAL_STATES guard uses Set<string> (not StackStatus enum) to avoid importing prisma enums that don't exist in test env"
  - "statePoller singleton stores repo=null at construction; lazy-loads on first getRepo() call"

patterns-established:
  - "Lazy dynamic import pattern: use import() inside async method to avoid polluting module graph in tests"
  - "AbortController pattern: always check signal.aborted before scheduling reconnect setTimeout"

requirements-completed:
  - OBS-01
  - OBS-02
  - OBS-03
  - OBS-04

duration: 15min
completed: 2026-03-11
---

# Phase 1 Plan 03: StatePoller Background Job Summary

**Event-driven container state engine: Docker event stream subscriber + 60s reconciliation cron, wired into Fastify app lifecycle with transitional state guard and SSE broadcast**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-11T13:20:00Z
- **Completed:** 2026-03-11T13:37:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- StatePoller subscribes to Docker container events (start/stop/die/kill/health_status) with automatic 2000ms reconnect on stream end
- handleEvent() inspects container, updates Service row in DB, derives aggregate stack status, and publishes ContainerStateEvent to SSE clients — all skipped for TRANSITIONAL_STATES
- reconcile() performs full state sync by listing all containers and bulk-updating services, skipping stacks in transitional states
- StatePoller wired into Fastify onReady/onClose hooks with NODE_ENV guard preventing Docker socket connections in test runs
- All 87 unit tests pass including 10 state-poller tests (8 active + 2 todo)

## Task Commits

1. **Task 1: StatePoller event stream handler + reconciliation loop** - `5ad07be` (feat)
2. **Task 2: Wire StatePoller into app.ts lifecycle hooks** - `32961ac` (feat)

## Files Created/Modified

- `server/src/jobs/state-poller.ts` - StatePoller class with start/stop, handleEvent, reconcile, startEventStream; statePoller singleton
- `server/src/app.ts` - Import + onReady/onClose lifecycle hooks with NODE_ENV guard
- `server/src/lib/state-broadcaster.ts` - Exported StateBroadcaster class (was unexported)
- `server/src/repositories/stack-repository.ts` - Added findByComposeProject() and updateServiceState() methods + stackRepository singleton export

## Decisions Made

- **Lazy dynamic import for repo:** `getRepo()` uses `await import(...)` to load stack-repository.ts only on first call. This prevents db.ts (which requires DATABASE_URL and prisma client) from being pulled into the module graph during unit test runs. Same pattern motivation as Plan 02's `import type` approach.
- **Constructor injection (not module mocks):** StatePoller accepts docker, repo, and broadcaster via constructor, matching the existing test mock pattern established in the decisions from Plan 02. The test file uses `new StatePoller(mockDockerClient, mockStackRepo)`.
- **TRANSITIONAL_STATES as Set<string>:** Using `Set<StackStatus>` would require importing from `../generated/prisma/enums.js` which doesn't exist in test env. Using `Set<string>` achieves the same runtime behavior.
- **Export StateBroadcaster class:** StatePoller needs `Pick<StateBroadcaster, "publish">` type for constructor typing. Made the class export public (was only the instance before).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added findByComposeProject() and updateServiceState() to StackRepository**
- **Found during:** Task 1 (test file analysis)
- **Issue:** The test uses `mockStackRepo.findByComposeProject` and `mockStackRepo.updateServiceState` but these methods didn't exist in StackRepository. The plan described using prisma directly but the pre-written test expects a repository abstraction.
- **Fix:** Added `findByComposeProject(composeProject: string)` and `updateServiceState(data: {...})` to StackRepository, plus exported a `stackRepository` singleton.
- **Files modified:** server/src/repositories/stack-repository.ts
- **Verification:** TypeScript build shows no new errors for repository; all tests pass
- **Committed in:** 5ad07be (Task 1 commit)

**2. [Rule 2 - Missing Critical] Exported StateBroadcaster class from state-broadcaster.ts**
- **Found during:** Task 1 (TypeScript type checking)
- **Issue:** StatePoller constructor type signature needs `Pick<StateBroadcaster, "publish">` but StateBroadcaster was not exported — only the singleton instance was.
- **Fix:** Added `export` keyword to the StateBroadcaster class declaration.
- **Files modified:** server/src/lib/state-broadcaster.ts
- **Verification:** TypeScript import compiles without error
- **Committed in:** 5ad07be (Task 1 commit)

**3. [Rule 1 - Bug] Used lazy dynamic import instead of static import for StackRepository default**
- **Found during:** Task 1 (test run — Cannot find module '../generated/prisma/client.js')
- **Issue:** Initial implementation imported `stackRepository` at the top of state-poller.ts. This caused vitest to pull in stack-repository.ts → db.ts → prisma/client.js (missing in test env), failing all tests.
- **Fix:** Moved repo loading to a `getRepo()` async method using `await import(...)` (dynamic import). The singleton `new StatePoller()` stores `repo=null` and lazy-loads on first use. Tests pass their own mock so getRepo() is never called from tests.
- **Files modified:** server/src/jobs/state-poller.ts
- **Verification:** All 10 test files (87 tests) pass; state-poller tests pass GREEN
- **Committed in:** 5ad07be (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 missing critical, 1 bug)
**Impact on plan:** All auto-fixes necessary for testability and correctness. No scope creep.

## Issues Encountered

None beyond the deviations above.

## Next Phase Readiness

- StatePoller is live: Docker event stream drives real-time DB updates
- stateEventBroadcaster now receives live container state events — Plan 05 (State SSE) can subscribe immediately
- StackRepository has the two new methods needed for state management
- All 87 unit tests green; TypeScript has only pre-existing generated-file errors (prisma, @docktor/shared)

## Self-Check: PASSED

- `/home/coder/docktor/server/src/jobs/state-poller.ts` — FOUND
- `/home/coder/docktor/server/src/app.ts` — FOUND (contains statePoller.start)
- Commits 5ad07be and 32961ac — VERIFIED in git log

---
*Phase: 01-mvp-completion*
*Completed: 2026-03-11*
