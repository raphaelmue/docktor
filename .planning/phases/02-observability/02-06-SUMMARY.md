---
phase: 02-observability
plan: 06
subsystem: api
tags: [chokidar, file-watcher, compose-parser, yaml, database, sse]

# Dependency graph
requires:
  - phase: 02-observability
    provides: FileWatcher infrastructure, parseComposeContent, replaceServices in StackRepository
provides:
  - parseComposeContent throws descriptive errors for invalid compose structure
  - FileWatcher syncs service metadata to database on config changes via replaceServices
  - config_error SSE events now triggered for missing/empty services key in compose files
affects: [uat-test4, uat-test5, stack-repository, file-watcher-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Parser throws instead of silently returning empty array — callers can distinguish valid-empty from invalid
    - replaceServices called before updateStackHash — if services sync fails, hash stays stale and reconcile retries

key-files:
  created: []
  modified:
    - server/src/lib/compose-parser.ts
    - server/src/jobs/file-watcher.ts

key-decisions:
  - "parseComposeContent throws Error('Compose file missing services key') and Error('Compose file has empty services section') instead of returning [] — enables FileWatcher catch block to broadcast config_error"
  - "replaceServices called before updateStackHash in FileWatcher — ensures DB service metadata is consistent; if replaceServices fails, hash stays old and reconcile will retry"
  - "createComposeConfig called once in FileWatcher valid-compose path — reuses parse result for replaceServices, avoids parsing twice"

patterns-established:
  - "Parse-then-throw: validation errors thrown by parser, not by callers — single source of truth for what constitutes invalid compose"

requirements-completed: [FW-01, FW-02]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 02 Plan 06: Gap Closure — FileWatcher Metadata Sync and Config Error Detection Summary

**FileWatcher now syncs service metadata (image, ports, volumes) to database on compose changes and throws descriptive errors for missing/empty services key, closing UAT Tests 4 and 5**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T14:34:00Z
- **Completed:** 2026-03-16T14:35:55Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `parseComposeContent` throws `Error("Compose file missing 'services' key")` instead of returning `[]` silently
- `parseComposeContent` throws `Error("Compose file has empty services section")` for `services: {}`
- FileWatcher imports `createComposeConfig` and calls `repo.replaceServices` before `updateStackHash`
- `replaceServices` added to `FileWatcherRepo` interface with correct signature
- UAT Gap 1 (Test 4) closed: modified docker-compose metadata syncs to database
- UAT Gap 2 (Test 5) closed: invalid YAML/missing services triggers `config_error` SSE event

## Task Commits

Each task was committed atomically:

1. **Task 1: Parser throws errors for invalid compose structure** - `c034ef7` (fix)
2. **Task 2: FileWatcher updates service metadata on config changes** - `2d63718` (feat)

## Files Created/Modified
- `server/src/lib/compose-parser.ts` - Added validation: throws for missing/empty services key
- `server/src/jobs/file-watcher.ts` - Added createComposeConfig import, replaceServices to interface, calls replaceServices before updateStackHash

## Decisions Made
- `parseComposeContent` throws instead of returning `[]` — this enables the existing catch block in FileWatcher to trigger `config_error` SSE events for invalid compose files
- `replaceServices` called before `updateStackHash` — if service sync fails, hash stays stale so reconcile loop will retry; data consistency guaranteed
- `createComposeConfig` called once after validation passes — parse result shared with replaceServices, no double-parsing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - both changes applied cleanly, TypeScript compiled without errors on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FileWatcher now provides complete service metadata sync on compose file changes
- UAT Tests 4 and 5 should now pass with updated FileWatcher behavior
- StackRepository.replaceServices already existed with correct signature — no changes needed there

---
*Phase: 02-observability*
*Completed: 2026-03-16*
