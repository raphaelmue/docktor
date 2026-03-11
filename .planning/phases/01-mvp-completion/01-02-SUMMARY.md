---
phase: 01-mvp-completion
plan: "02"
subsystem: server-infrastructure
tags:
  - dockerode
  - state-broadcaster
  - settings
  - repository
  - fastify-routes
dependency_graph:
  requires:
    - "01-01 (test scaffolding — provides test files)"
  provides:
    - DockerodeClient (getEventStream, inspectContainer, listContainers, getLogStream)
    - StateBroadcaster (pub/sub event bus for container state events)
    - SettingsRepository (findByKey, upsert, findAll, get, getMany)
    - SettingsService (getSetting, upsertSetting, getGeneralSettings, updateGeneralSettings)
    - GET /api/settings/general
    - PUT /api/settings/general
  affects:
    - "01-03 (StatePoller depends on DockerodeClient + StateBroadcaster)"
    - "01-05 (State SSE depends on StateBroadcaster)"
    - "01-06 (Log streaming depends on DockerodeClient.getLogStream)"
    - "01-07 (Settings UI depends on settings routes)"
tech_stack:
  added:
    - "dockerode (existing dep) — wired via factory pattern for testability"
    - "node:events EventEmitter — used for StateBroadcaster pub/sub"
  patterns:
    - "Lazy-init proxy pattern for singletons (dockerodeClient, settingsService)"
    - "Type-only imports for DB-dependent modules to prevent prisma loading in unit tests"
    - "Vitest resolve alias (regex) to handle deep relative test imports"
key_files:
  created:
    - server/src/infrastructure/dockerode-client.ts
    - server/src/lib/state-broadcaster.ts
    - server/src/repositories/settings-repository.ts
    - server/src/application/settings-service.ts
    - server/src/routes/settings.ts
  modified:
    - server/src/application/index.ts
    - server/src/app.ts
    - server/vitest.config.ts
decisions:
  - "DockerodeClient uses factory function call instead of new Dockerode() to support vi.fn() mocking in tests (arrow functions cannot be called with new)"
  - "SettingsService inlines SETTING_KEYS constants rather than importing them from settings-repository to avoid pulling db.ts into test module scope"
  - "vitest.config.ts receives a regex resolve alias (^(?:../)+src/) to fix deep relative test imports (../../../../src/) that vitest cannot resolve without vi.mock() being present"
  - "SettingsRepository uses findByKey/findAll method names (matching test expectations) plus get/getMany aliases for plan interface compatibility"
metrics:
  duration: "19 minutes"
  completed_date: "2026-03-11"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 3
---

# Phase 1 Plan 02: Server Infrastructure + Settings Backend Summary

DockerodeClient adapter, in-process StateBroadcaster pub/sub, and full settings CRUD backend (repository, service, routes) wired into the Fastify app.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DockerodeClient + StateBroadcaster | bdb56ef | dockerode-client.ts, state-broadcaster.ts |
| 2 | Settings backend + app wiring | 33960d7 | settings-repository.ts, settings-service.ts, routes/settings.ts, application/index.ts, app.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DockerodeClient factory pattern instead of `new Dockerode()`**
- **Found during:** Task 1
- **Issue:** vitest mocks `dockerode` as `vi.fn(() => mockDocker)` where the implementation is an arrow function. Arrow functions cannot be called with `new`, so `new Dockerode()` in the constructor threw `TypeError: () => mockDocker is not a constructor`
- **Fix:** Replaced `new Dockerode({socketPath})` with a factory wrapper `Dockerode({socketPath} as any)` (treating the import as a callable). Both the test mock and the real dockerode handle this correctly.
- **Files modified:** server/src/infrastructure/dockerode-client.ts
- **Commit:** bdb56ef

**2. [Rule 1 - Bug] SettingsService uses type-only import for SettingsRepository**
- **Found during:** Task 2
- **Issue:** `import {SETTING_KEYS} from "../repositories/settings-repository.js"` pulled in `db.ts` which imports `../generated/prisma/client.js` (missing in this environment). Vitest reported the top-level `settings-service.js` as "Cannot find module" instead of showing the real missing prisma error. Other services avoid this by using `import type`.
- **Fix:** Inlined `SETTING_KEYS` constants in settings-service.ts; used `import type` for `SettingsRepository`. The inlined constants match the repository's values exactly.
- **Files modified:** server/src/application/settings-service.ts
- **Commit:** 33960d7

**3. [Rule 3 - Blocking] vitest.config.ts resolve alias for deep relative imports**
- **Found during:** Task 2
- **Issue:** `settings-service.test.ts` imports from `../../../../src/application/settings-service.js` (4 levels up). Vitest cannot resolve this path without `vi.mock()` being present in the test file (vi.mock hoisting triggers a different module resolution codepath). The pre-written test has no vi.mock calls.
- **Fix:** Added regex resolve alias `{ find: /^(?:\.\.\/)+src\//, replacement: resolve(__dirname, "src") + "/" }` to `vitest.config.ts`. This transparently redirects any `../../**/src/` path to the server's actual `src/` directory.
- **Files modified:** server/vitest.config.ts
- **Commit:** 33960d7

**4. [Rule 1 - Bug] SettingsRepository getMany parameter types**
- **Found during:** Task 2 (TypeScript build check)
- **Issue:** `records.reduce(acc, r => ...)` had implicit `any` types since prisma generated client doesn't exist. TypeScript strict mode rejected this.
- **Fix:** Added explicit type annotations `(acc: Record<string, string>, r: {key: string; value: string})` to the reduce callback.
- **Files modified:** server/src/repositories/settings-repository.ts
- **Commit:** 33960d7

## Test Results

```
Test Files: 9 passed, 1 failed (state-poller — Plan 03 scope)
Tests: 79 passed
```

Key tests now green:
- `test/unit/infrastructure/dockerode-client.test.ts` (5 tests)
- `test/unit/application/settings-service.test.ts` (6 tests)

## Build Status

TypeScript build has pre-existing errors for missing generated files (`prisma/enums.js`, `prisma/client.js`) and `@docktor/shared` package. These existed before this plan and are not introduced by this plan's changes. No NEW TypeScript errors from this plan's files.

## Self-Check: PASSED

All created files verified on disk. All task commits (bdb56ef, 33960d7) verified in git log.
