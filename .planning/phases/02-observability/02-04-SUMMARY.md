---
phase: 02-observability
plan: 04
subsystem: jobs
tags: [node-cron, semver, docker-registry, background-jobs, update-checker, docker-executor]

# Dependency graph
requires:
  - phase: 02-observability
    plan: 02
    provides: ImageUpdateCheckRepository with upsert/findByImageRef/findDueForCheck
  - phase: 02-observability
    plan: 03
    provides: FileWatcher job pattern for background job registration in jobs/index.ts
provides:
  - UpdateChecker class with staggered 6-hour polling via node-cron every 5 minutes
  - compareVersions() pure exported function with date-first → semver → digest fallback
  - normalizeImageRef(), detectRegistry(), parseDateTag() pure exported functions
  - getNextImageToCheck() pure exported function for stagger window logic
  - DockerExecutor.manifestInspect() shelling out to docker manifest inspect --verbose
  - DockerExecutor.pull() shelling out to docker pull
  - DockerExecutor singleton export
  - updateChecker registered in jobs/index.ts startJobs/stopJobs
affects: [03-updates, 04-backup, api-routes, ui-badges]

# Tech tracking
tech-stack:
  added: ["@types/semver (devDependency for TypeScript semver types)"]
  patterns: [lazy-dynamic-import-for-repo, pure-exported-functions-for-testability, singleton-export-pattern]

key-files:
  created:
    - server/src/jobs/update-checker.ts
  modified:
    - server/src/infrastructure/docker-executor.ts
    - server/src/jobs/index.ts
    - server/package.json
    - yarn.lock

key-decisions:
  - "Date tag parsing runs before semver coerce — semver.coerce('2024-01-01') yields '2024.0.0' losing month/day, causing false equality"
  - "getNextImageToCheck() exported as pure function (not class method) matching 02-01 test scaffold expectations"
  - "UpdateCheckerRepo interface uses getImageUpdateCheck/upsertImageUpdateCheck method names matching test mock — adapter maps to ImageUpdateCheckRepository's findByImageRef/upsert internally"
  - "DockerExecutor singleton export added (dockerExecutor) — existing code uses new DockerExecutor() per service, singleton only for UpdateChecker injection"
  - "triggerUpdate() broadcasts update_error event type via type cast — StateBroadcaster extended via any cast, not in StateEvent union (out of scope for this plan)"

patterns-established:
  - "Pure exported functions for unit-testable comparison/utility logic (compareVersions, getNextImageToCheck, normalizeImageRef)"
  - "Lazy dynamic import for production repos in background jobs — avoids db.ts in test module graph"
  - "Repository interface in job file matches test mock method names — production adapter in createProductionRepo()"

requirements-completed: [UPD-01, UPD-02, UPD-04]

# Metrics
duration: 6min
completed: 2026-03-13
---

# Phase 02 Plan 04: UpdateChecker Summary

**Staggered image update checker with date-first/semver/digest comparison, DockerExecutor.manifestInspect() registry query, and full job registration**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-13T10:19:53Z
- **Completed:** 2026-03-13T10:25:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- UpdateChecker background job: cron every 5 min, processes one image per tick, respects 6h/N stagger window
- compareVersions() with correct date-first parsing (date strings like "2024-01-01" would be miscoerced to "2024.0.0" by semver)
- DockerExecutor extended with manifestInspect() (parses multi-arch and single-arch manifest digests) and pull()
- All 12 UpdateChecker unit tests from scaffold 02-01 now GREEN; full suite 125/125 passing

## Task Commits

1. **Task 1: Implement compareVersions, normalizeImageRef, and UpdateChecker** - `558d0f6` (feat)
2. **Task 2: DockerExecutor.manifestInspect() + jobs/index.ts update** - `31ae1c4` (feat)

## Files Created/Modified

- `server/src/jobs/update-checker.ts` - UpdateChecker class + compareVersions + getNextImageToCheck + pure utility functions
- `server/src/infrastructure/docker-executor.ts` - Added pull(), manifestInspect(), dockerExecutor singleton export
- `server/src/jobs/index.ts` - Wired updateChecker into startJobs/stopJobs
- `server/package.json` - Added @types/semver devDependency
- `yarn.lock` - Updated with @types/semver

## Decisions Made

- **Date-first comparison order:** semver.coerce("2024-01-01") extracts only the first integer producing "2024.0.0", so both "2024-01-01" and "2024-06-01" would be treated as equal semver. Date parsing must run first.
- **getNextImageToCheck as pure export:** The 02-01 test scaffold imports it as a named export. Implemented as a standalone function with the stagger math inline.
- **UpdateCheckerRepo interface method names:** Test mock uses `getImageUpdateCheck`/`upsertImageUpdateCheck`; production adapter in `createProductionRepo()` maps these to the ImageUpdateCheckRepository's `findByImageRef`/`upsert`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Date-first comparison order in compareVersions()**
- **Found during:** Task 1 (test run)
- **Issue:** Plan spec said "semver → date → digest" but semver.coerce("2024-01-01") = "2024.0.0" making all same-year date tags appear equal
- **Fix:** Reversed order to date-first → semver → digest; added explanatory comment
- **Files modified:** server/src/jobs/update-checker.ts
- **Verification:** compareVersions("2024-01-01", "2024-06-01") now returns "newer" (was "same")
- **Committed in:** 558d0f6 (Task 1 commit)

**2. [Rule 3 - Blocking] Missing @types/semver causing TypeScript compilation failure**
- **Found during:** Task 2 (TypeScript build check)
- **Issue:** semver package has no bundled types; server tsconfig requires declaration files
- **Fix:** `yarn workspace @docktor/server add --dev @types/semver`
- **Files modified:** server/package.json, yarn.lock
- **Verification:** `npm run build -w server` exits 0
- **Committed in:** 31ae1c4 (Task 2 commit)

**3. [Rule 1 - Bug] Prisma image field filter used wrong type**
- **Found during:** Task 2 (TypeScript build check)
- **Issue:** `where: {image: {not: null}}` fails because Service.image is non-nullable String; Prisma rejected null filter
- **Fix:** Removed the where clause (image is always non-null)
- **Files modified:** server/src/jobs/update-checker.ts
- **Verification:** TypeScript build passes
- **Committed in:** 31ae1c4 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 logic bug, 2 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UpdateChecker is operational; all three planned background jobs (StatePoller, FileWatcher, UpdateChecker) are registered and running
- DockerExecutor.pull() is available for the pull-and-recreate route in UPD-04
- Phase 02 plan 05 (UI badges for update_available) can consume the ImageUpdateCheck table directly
- No blockers

---
*Phase: 02-observability*
*Completed: 2026-03-13*
