---
phase: 02-observability
plan: 05
subsystem: ui
tags: [react, fastify, sse, docker-compose, badges, update-checker]

# Dependency graph
requires:
  - phase: 02-observability/02-02
    provides: ImageUpdateCheck DB table and SSE broadcast contracts
  - phase: 02-observability/02-03
    provides: FileWatcher job broadcasting config_changed SSE events
  - phase: 02-observability/02-04
    provides: UpdateChecker job broadcasting update_available SSE events

provides:
  - POST /api/stacks/:id/update route (user-initiated pull + recreate)
  - GET /api/stacks/:id extended with updateAvailable + latestTag per service
  - updateImages() StackService method (RUNNING→UPDATING→RUNNING state machine)
  - composePull() DockerExecutor method (docker compose pull)
  - clearConfigChanged() called in restartStack() success path
  - Update Images button in stack detail page PageActions
  - Per-service update available badge (blue) in services table
  - Config changed badge (yellow) in stack-list Status column
  - SSE handlers for config_changed and update_available in use-stack/use-stacks

affects:
  - 03-backup-restore
  - any future UI phase reading stack detail

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SSE event type union extended with ConfigChangedEvent and UpdateAvailableEvent
    - API route augments DB response with external repo data (imageUpdateCheckRepository)
    - Client refetch pattern on SSE events (config_changed triggers full re-fetch)

key-files:
  created: []
  modified:
    - server/src/routes/stacks.ts
    - server/src/application/stack-service.ts
    - server/src/infrastructure/docker-executor.ts
    - client/src/lib/stacks-api.ts
    - client/src/hooks/use-container-events.ts
    - client/src/hooks/use-stack.ts
    - client/src/hooks/use-stacks.ts
    - client/src/routes/app/stacks/[id].tsx
    - client/src/components/domain/stack/stack-list.tsx

key-decisions:
  - "clearConfigChanged() added to restartStack() success path — plan specified deploy+update but restart also clears intent"
  - "GET /api/stacks/:id augments DB response inline (route-level join) rather than pushing into StackService — keeps service layer clean of cross-repo concerns"
  - "update_available SSE in use-stack triggers full refetch (not local state patch) — avoids re-implementing update logic client-side"
  - "canUpdate includes STOPPED and ERROR states — matches server-side UPDATE transition table (DRAFT excluded since no containers to pull)"

patterns-established:
  - "Route-level data augmentation: GET :id joins imageUpdateCheckRepository inline for update info"
  - "SSE config_changed/update_available triggers refetch in hooks — simple and correct"

requirements-completed: [UPD-03, UPD-04, FW-01, FW-02]

# Metrics
duration: ~25min
completed: 2026-03-15
---

# Phase 02 Plan 05: UI Observability Surfaces Summary

**Config changed + update available badges with user-initiated docker compose pull/recreate via POST /api/stacks/:id/update, wired to SSE for live badge updates**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-15T00:00:00Z
- **Completed:** 2026-03-15T00:25:00Z
- **Tasks:** 2 (Task 3 is a human-verify checkpoint)
- **Files modified:** 9

## Accomplishments
- POST /api/stacks/:id/update route: pulls images via `docker compose pull`, recreates containers via `docker compose up -d`, transitions stack RUNNING→UPDATING→RUNNING
- Stack detail page shows per-service "update available → tag" blue badge and has "Update Images" button in PageActions
- Stack list / dashboard shows "config changed" yellow badge in Status column for any stack with configChanged=true
- SSE events config_changed and update_available trigger live refetch in use-stack and use-stacks hooks — badges update without page refresh
- deployStack() already had clearConfigChanged; restartStack() now also clears it on success

## Task Commits

1. **Task 1: Server — POST /update route + stack detail update info** - `567192b` (feat)
2. **Task 2: Client — badges and Update button in [id].tsx and dashboard.tsx** - `423fc36` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `server/src/routes/stacks.ts` - Extended GET /api/stacks/:id with updateAvailable/latestTag per service; added POST /api/stacks/:id/update
- `server/src/application/stack-service.ts` - Added updateImages() method; added clearConfigChanged to restartStack(); extended guardTransition to accept UPDATE action
- `server/src/infrastructure/docker-executor.ts` - Added composePull(stackId) method
- `client/src/lib/stacks-api.ts` - Added updateAvailable/latestTag to Service type; added updateImages() API function
- `client/src/hooks/use-container-events.ts` - Added ConfigChangedEvent and UpdateAvailableEvent types to StateEvent union
- `client/src/hooks/use-stack.ts` - Handle config_changed and update_available SSE events with refetch
- `client/src/hooks/use-stacks.ts` - Handle config_changed SSE events with refetch
- `client/src/routes/app/stacks/[id].tsx` - Update Images button; per-service update available badge; RefreshCw icon import
- `client/src/components/domain/stack/stack-list.tsx` - Config changed yellow badge in Status column

## Decisions Made
- `clearConfigChanged()` added to `restartStack()` success path — plan specified deploy and update, but a restart also applies current state, so clearing the flag is correct behaviour
- Route-level augmentation for update info: `GET /api/stacks/:id` handler fetches `imageUpdateCheckRepository.findByImageRefs()` inline rather than in StackService, keeping service layer free of cross-repo joins
- `update_available` SSE triggers a full `refetch()` rather than a local state patch — avoids duplicating comparison logic client-side and is consistent with `config_changed` handling
- `canUpdate` set includes STOPPED and ERROR (matching the server-side UPDATE transition table); DRAFT excluded since no containers exist to pull

## Deviations from Plan

None — plan executed exactly as written. The `restartStack()` clearConfigChanged addition was listed as a required check-and-add in Task 1, not a deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 observability features are fully implemented end-to-end: FileWatcher, UpdateChecker, and UI surfaces all wired together
- Human verification checkpoint (Task 3) pending — user must confirm live badge behaviour in browser before phase is closed
- Phase 3 (backup/restore) can begin after checkpoint approval

---
*Phase: 02-observability*
*Completed: 2026-03-15*
