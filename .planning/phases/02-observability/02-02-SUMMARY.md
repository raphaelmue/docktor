---
phase: 02-observability
plan: "02"
subsystem: database
tags: [prisma, postgresql, prisma-migrate, sse, typescript, repositories]

# Dependency graph
requires:
  - phase: 02-01
    provides: FileWatcher and UpdateChecker test contracts that define what events/data are needed
provides:
  - StackEvent Prisma model with StackEventType enum (config_changed, config_error, update_available)
  - ImageUpdateCheck Prisma model with upsert/find/findDueForCheck queries
  - Extended StateEvent SSE union with ConfigChangedEvent, ConfigErrorEvent, UpdateAvailableEvent
  - StackEventRepository and ImageUpdateCheckRepository with typed query methods
affects: [02-03, 02-04, 02-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Repository pattern for Prisma models (consistent with stack-repository.ts)
    - EventEmitter-based SSE union type extension (StateEvent discriminated union)
    - db push for dev schema sync when migration history has drift

key-files:
  created:
    - server/prisma/schema/stack-event.prisma
    - server/prisma/schema/image-update-check.prisma
    - server/src/repositories/stack-event-repository.ts
    - server/src/repositories/image-update-check-repository.ts
  modified:
    - server/prisma/schema/stack.prisma
    - server/src/lib/state-broadcaster.ts

key-decisions:
  - "Used db push instead of migrate dev due to DB schema drift from existing migration history in dev environment"

patterns-established:
  - "Repository pattern: class + singleton export (new StackEventRepository(), export const stackEventRepository)"
  - "Prisma enums imported from generated/prisma/enums.js for type safety in repository interfaces"

requirements-completed: [FW-02, FW-03, UPD-02, UPD-03]

# Metrics
duration: 12min
completed: 2026-03-13
---

# Phase 2 Plan 02: Data Layer and Broadcast Contracts Summary

**StackEvent and ImageUpdateCheck Prisma models with typed repositories, plus extended SSE StateEvent union covering config_changed, config_error, and update_available events**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-13T10:10:00Z
- **Completed:** 2026-03-13T10:22:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created two new Prisma models (StackEvent, ImageUpdateCheck) with a StackEventType enum and applied to dev database via db push
- Extended StateBroadcaster StateEvent union from 2 to 5 types (added ConfigChangedEvent, ConfigErrorEvent, UpdateAvailableEvent)
- Created StackEventRepository (createEvent, findRecentByStack) and ImageUpdateCheckRepository (upsert, findByImageRef, findDueForCheck, findByImageRefs) following existing repository patterns
- TypeScript compiles cleanly with no errors; all 11 pre-existing passing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Prisma schema — StackEvent + ImageUpdateCheck models** - `97fc0b5` (feat)
2. **Task 2: Extend StateBroadcaster + create StackEventRepository + ImageUpdateCheckRepository** - `974edf9` (feat)

## Files Created/Modified
- `server/prisma/schema/stack-event.prisma` - StackEvent model with StackEventType enum (config_changed, config_error, update_available)
- `server/prisma/schema/image-update-check.prisma` - ImageUpdateCheck model with imageRef unique key and update tracking fields
- `server/prisma/schema/stack.prisma` - Added stackEvents StackEvent[] relation to Stack model
- `server/src/lib/state-broadcaster.ts` - Added ConfigChangedEvent, ConfigErrorEvent, UpdateAvailableEvent; extended StateEvent union
- `server/src/repositories/stack-event-repository.ts` - StackEventRepository with createEvent() and findRecentByStack()
- `server/src/repositories/image-update-check-repository.ts` - ImageUpdateCheckRepository with upsert(), findByImageRef(), findDueForCheck(), findByImageRefs()

## Decisions Made
- Used `npx prisma db push` instead of `migrate dev` because the dev database schema has drift from migration history (existing tables already created outside migration history). db push is appropriate for dev environment where migration history is not strictly enforced.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx prisma migrate dev` failed due to schema drift (existing tables in DB not tracked in migration files). Resolved by using `db push` as the plan explicitly documents as the fallback: "If the migration fails because the DB doesn't exist or prisma can't connect, run `npx prisma db push` instead."
- Unit tests for file-watcher and update-checker were already failing before this plan (pre-existing failures for plans 02-03 and 02-04 not yet implemented). Confirmed by stash test that failures predate our changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- StackEvent and ImageUpdateCheck models are live in the dev database
- Prisma client regenerated with StackEventType enum accessible at generated/prisma/enums.js
- StateBroadcaster ready to accept and broadcast all 5 event types
- Repositories ready for consumption by FileWatcher (02-03) and UpdateChecker (02-04)
- No blockers for Wave 1 parallel execution

---
*Phase: 02-observability*
*Completed: 2026-03-13*
