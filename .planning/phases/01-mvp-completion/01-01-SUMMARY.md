---
phase: 01-mvp-completion
plan: "01"
subsystem: testing
tags: [tdd, test-scaffolding, red-state, server, client, shared]
dependency_graph:
  requires: []
  provides: [test-stubs-phase1]
  affects: [01-02, 01-03, 01-04, 01-05, 01-06]
tech_stack:
  added: []
  patterns: [vitest, vi.fn mock injection, renderHook, @testing-library/react]
key_files:
  created:
    - server/test/unit/infrastructure/dockerode-client.test.ts
    - server/test/unit/jobs/state-poller.test.ts
    - server/test/unit/application/settings-service.test.ts
    - shared/test/unit/validation/settings-phase1.test.ts
    - client/test/unit/hooks/use-container-events.test.ts
    - client/test/unit/components/log-viewer.test.tsx
  modified: []
decisions:
  - StatePoller accepts DockerodeClient and StackRepository via constructor for testability (not module-level mocks)
  - log-viewer tests use it.todo() for render-level assertions that need the component to exist
  - shared/settings-phase1 imports from existing settings.ts — RED state is undefined named export not import failure
metrics:
  duration_seconds: 284
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_created: 6
  files_modified: 0
---

# Phase 1 Plan 1: TDD Test Scaffolding (RED State) Summary

**One-liner:** Six failing test stubs covering OBS-01 through SET-03 with vitest, establishing TDD RED state across server/client/shared packages.

## What Was Built

Created 6 test scaffold files that establish the RED state for all 12 Phase 1 requirements. Each test file imports implementation modules that do not yet exist, causing import-level failures or undefined-export failures. No `it.skip()` used — complex cases use `it.todo()`.

### Server Tests

- **dockerode-client.test.ts** — 4 tests covering `getEventStream` (filters), `getLogStream` (options), `inspectContainer` (delegation), `listContainers` (all flag). Mocks dockerode via `vi.mock()`.
- **state-poller.test.ts** — 6 tests: handleEvent inspects container, updates DB service row, skips all 5 transitional states via `it.each`, skips containers without compose labels. reconcile tests use `it.todo()`.
- **settings-service.test.ts** — 5 tests: getSetting null/found, upsertSetting delegation, updateGeneralSettings valid save, rejects empty name, rejects non-URL.

### Shared Tests

- **settings-phase1.test.ts** — 5 tests against `generalSettingsSchema` (not yet exported): valid input accepted, empty instanceName rejected, non-URL rejected, non-IANA timezone rejected, valid timezones (Europe/Paris, America/New_York, UTC) accepted.

### Client Tests

- **use-container-events.test.ts** — 4 tests: EventSource opens to `/api/events` with `withCredentials:true`, `onmessage` calls onEvent, unmount closes EventSource, onerror handler does not throw.
- **log-viewer.test.tsx** — 2 live tests (dark terminal class, service dropdown with "All services"), 3 `it.todo()` stubs for render assertions needing implementation.

## Verification Results

```
server: Test Files 3 failed | 7 passed (10)   Tests 68 passed
client: Test Files 3 failed | 4 passed  (7)   Tests 24 passed
shared: Test Files 1 failed | 3 passed  (4)   Tests 5 failed | 35 passed
```

All failures are due to missing implementation files — not syntax errors in the test files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect relative import path in settings-phase1.test.ts**
- **Found during:** Task 2 verification
- **Issue:** Initial path used `../../../../src/...` (4 levels up from `shared/test/unit/validation/`) which resolved outside the package root
- **Fix:** Corrected to `../../../src/...` (3 levels, matching existing `settings.test.ts` pattern)
- **Files modified:** shared/test/unit/validation/settings-phase1.test.ts
- **Commit:** 51f7283 (included in Task 2 commit after correction)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 12c9c7f | Server test stubs: dockerode-client, state-poller, settings-service |
| 2 | 51f7283 | Shared + client test stubs: settings-phase1, use-container-events, log-viewer |

## Self-Check: PASSED

All 6 test files exist on disk. Both commits (12c9c7f, 51f7283) present in git log.
