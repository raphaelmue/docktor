---
phase: 02-observability
plan: 15
subsystem: api
tags: [stack-events, audit-trail, fastify, repository-pattern, gap-closure]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "StackEventRepository (createEvent/findRecentByStack) built in plan 02-02, and the StackEvent Prisma model with its [stackId, createdAt] index — both existed but were never wired to a caller until this plan"
provides:
  - "GET /api/stacks/:id/events — authenticated, paginated (limit 1-100, default 20) read path for a stack's StackEvent audit trail, backed by StackService.getStackEvents()"
  - "createFileWatcherRepo(stacks, events) — the single typed adapter factory FileWatcher uses to reach both StackRepository and StackEventRepository"
affects: [stack-service, file-watcher, stack-events-ui, uat-gap-closure]

actuals:
  tokens: 4017
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Application-layer read port (StackEventReadRepo) declared next to the service that consumes it, mirroring the constructor-injection style already used for StackRepository/StackFilesystem/DockerExecutor — keeps the service unit-testable with a plain object and the dependency arrow pointing inward"
    - "Structural adapter factory (createFileWatcherRepo) built from two narrow local interfaces rather than importing the concrete repository classes — satisfies the interface by construction so a signature drift is a compile error, not a runtime cast failure"

key-files:
  created: []
  modified:
    - server/src/application/stack-service.ts
    - server/src/application/index.ts
    - server/src/routes/stacks.ts
    - server/src/jobs/file-watcher.ts
    - server/src/repositories/stack-repository.ts
    - server/test/unit/application/stack-service.test.ts
    - server/test/unit/jobs/file-watcher.test.ts

key-decisions:
  - "getStackEvents() forwards an absent limit through unchanged rather than inventing a service-level default of 20 — the route schema owns the HTTP-facing default (coerced int, 1-100, default 20), and StackEventRepository.findRecentByStack()'s own default (20) is the fallback if the service is ever called without going through the route; two defaults for the same concept would drift"
  - "createFileWatcherRepo's two parameters (FileWatcherStackRepo, FileWatcherEventRepo) are narrow structural interfaces declared in file-watcher.ts itself, not imported from repositories/ — this is what keeps getRepo()'s lazy-import pattern meaningful; importing the concrete classes at the top of the file would defeat the whole reason that pattern exists (keeping db.ts out of the unit-test module graph)"
  - "The ad-hoc createStackEvent() method on StackRepository is deleted outright rather than deprecated — FileWatcher was its only caller (confirmed via grep across server/src before deletion), so keeping it around would recreate the exact two-write-paths problem this plan closes"

patterns-established:
  - "Read port declared in the application layer, concrete repository injected at the composition root (application/index.ts) — the same shape as the existing StackRepository/StackFilesystem/DockerExecutor dependencies, now applied to a fourth collaborator"

requirements-completed: [FW-02, UPD-03]

coverage:
  - id: D1
    description: "A stack's recorded config_changed, config_error and update_available events can be read back over HTTP, per stack, newest first, each with its type and timestamp"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#StackService > getStackEvents > resolves the rows the event repository returns for that stack"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#StackService > getStackEvents > asks the event repository for that stack id and no other"
        status: pass
    human_judgment: false
  - id: D2
    description: "Requesting events for a stack that does not exist returns a not-found response rather than an empty list"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#StackService > getStackEvents > rejects with NotFoundError when the stack does not exist, and does not touch the event repository"
        status: pass
    human_judgment: false
  - id: D3
    description: "The events endpoint requires authentication like every other stack route (no new auth wiring needed — the plugin's existing onRequest hook covers it)"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "grep verification: GET /api/stacks/:id/events is registered inside the same stackRoutes plugin whose app.addHook(\"onRequest\", requireAuth) covers every route in it — see Task 1 acceptance criteria"
        status: pass
    human_judgment: false
  - id: D4
    description: "StackEvent rows are written through the one repository that owns that table (StackEventRepository), not through an ad-hoc method on StackRepository"
    requirement: "UPD-03"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/file-watcher.test.ts#createFileWatcherRepo > forwards a stack-event write to the injected event repository's createEvent, passing stack id, type, message and payload through unchanged"
        status: pass
      - kind: other
        ref: "grep verification: createStackEvent and prisma.stackEvent both absent from server/src/repositories/stack-repository.ts — see Task 2 acceptance criteria"
        status: pass
    human_judgment: false
  - id: D5
    description: "The StackEvent type is enforced by the compiler at the write call sites rather than defeated by a cast"
    requirement: "UPD-03"
    verification:
      - kind: other
        ref: "grep verification: 'as unknown as' absent from server/src/jobs/file-watcher.ts, and 'type: string' absent — the event type is the generated StackEventType union at both FileWatcherRepo and FileWatcherEventRepo"
        status: pass
      - kind: unit
        ref: "yarn workspace @docktor/server build (tsc --build) exits 0"
        status: pass
    human_judgment: false

duration: 19min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 15: StackEvent Read Path + Single Write Path Summary

**`GET /api/stacks/:id/events` now serves the StackEvent audit trail through `StackService.getStackEvents()`, and every StackEvent write — from `FileWatcher` or anywhere else — goes through `StackEventRepository.createEvent()` via a new typed `createFileWatcherRepo()` adapter, replacing the ad-hoc cast-defeating method that used to live on `StackRepository`.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-08-28T20:02:00Z
- **Completed:** 2026-08-28T20:21:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- `StackEventReadRepo` port declared in `stack-service.ts`; `StackService.getStackEvents(id, limit?)` guards the stack exists (`NotFoundError` via `findByIdOrThrow`) then reads through the port, forwarding an absent limit unchanged so `StackEventRepository.findRecentByStack()`'s own default (20) is the single definition
- `stackEventRepository` wired as `StackService`'s fourth constructor argument in `application/index.ts`
- `GET /api/stacks/:id/events` registered in `routes/stacks.ts` with a validated `limit` querystring (coerced int, 1-100, default 20 at the route level); the handler is a one-line delegation to the service and needs no new auth wiring since the plugin's `onRequest` hook already covers every route it registers
- `createFileWatcherRepo(stacks, events)` exported from `file-watcher.ts`: a structural adapter factory built from two narrow local interfaces (`FileWatcherStackRepo`, `FileWatcherEventRepo`) that forwards stack reads/writes to `StackRepository` and the event write to `StackEventRepository.createEvent()`, satisfying `FileWatcherRepo` by construction
- `getRepo()` now lazily imports both repository singletons and returns `createFileWatcherRepo(stackRepository, stackEventRepository)` — the `as unknown as FileWatcherRepo` double cast is gone
- `FileWatcherRepo.createStackEvent`'s `type` is now the generated `StackEventType` union (type-only import, erased at build) instead of a bare `string`, so a fourth spelling fails to compile at the call site
- Deleted the ad-hoc `createStackEvent()` method and its `as any` enum cast from `StackRepository` — confirmed via grep that `FileWatcher` was its only caller before removing it; `server/src/repositories/stack-repository.ts` no longer references the `StackEvent` table at all
- Full test coverage for both the read path (`getStackEvents` describe block: resolves rows, scopes to the right stack id, not-found rejects without touching the event repo, explicit-limit passthrough, absent-limit passthrough) and the write path (`createFileWatcherRepo` describe block: event-write delegation with unchanged args, write resolving to `undefined`, each stack member forwarding correctly)

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end read path for one stack's events** - `fab275f` (feat)
2. **Task 2: One write path for StackEvent rows** - `616aec4` (refactor)

**Plan metadata:** committed together with this SUMMARY (see final commit below)

## Files Created/Modified
- `server/src/application/stack-service.ts` — `StackEventReadRepo` port, `getStackEvents()`, fourth constructor parameter
- `server/src/application/index.ts` — `stackEventRepository` imported and injected as `StackService`'s fourth argument
- `server/src/routes/stacks.ts` — `GET /api/stacks/:id/events` with validated `limit` querystring
- `server/src/jobs/file-watcher.ts` — `StackEventType` typed `createStackEvent`, `createFileWatcherRepo()` factory, `getRepo()` rewritten to use it
- `server/src/repositories/stack-repository.ts` — ad-hoc `createStackEvent()` method removed
- `server/test/unit/application/stack-service.test.ts` — `createMockStackEvents()` factory, `getStackEvents` describe block
- `server/test/unit/jobs/file-watcher.test.ts` — `createFileWatcherRepo` describe block

## Decisions Made
- `getStackEvents()` never invents its own default limit — an absent limit is forwarded to the repository unchanged, so the repository's default (20) is the single source of truth for "what happens if no limit is given at the service layer," while the route schema separately owns the HTTP-facing default of 20 for the same value.
- `createFileWatcherRepo`'s parameter types are narrow structural interfaces declared locally in `file-watcher.ts`, not the concrete repository classes — preserves the reason `getRepo()`'s lazy-import pattern exists (keeping `db.ts` out of the unit-test module graph) while still getting compiler-enforced shape checking instead of a cast.
- The ad-hoc `StackRepository.createStackEvent()` method was deleted rather than deprecated, since keeping a second, unused write path around would silently reintroduce the exact defect (two ways to write the same table) this plan exists to close.

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria grep checks and both `yarn workspace @docktor/server test:unit` / `build` runs passed on the first attempt for both tasks.

## Issues Encountered

None. `yarn` is not directly on PATH in this environment; `corepack yarn <...>` was used in its place (same binary, same lockfile — `git diff --stat yarn.lock` stayed empty throughout).

## User Setup Required

None - no external service configuration, schema change, or new dependency was introduced.

## Next Phase Readiness

- UAT gap G-02-16 (FW-02, UPD-03) is closed: the StackEvent audit trail is now readable per stack over HTTP, and `findRecentByStack()` — dead code since plan 02-02 — is reachable production code.
- `StackEventRepository.createEvent()` is now the only writer to the `StackEvent` table anywhere in `server/src/`, confirmed by grep.
- No blockers for subsequent work. This plan added no client-side consumer of the new endpoint — the pending todo "config_error has no client-side handling or UI badge" (`.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md`) remains open and is the natural next step to make this audit trail visible in the UI.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
