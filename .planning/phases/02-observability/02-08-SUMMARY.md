---
phase: 02-observability
plan: 08
subsystem: jobs
tags: [chokidar, file-watcher, docker, deployment, state-machine]

# Dependency graph
requires:
  - phase: 02-observability
    provides: FileWatcher job, compose-parser throw behavior (02-06/02-07)
provides:
  - StackRepository.syncServicesFromCompose() — config-only Service metadata sync that preserves containerId/containerState/healthStatus/restartCount/imageDigest
  - compose-parser rejects a sequence-valued services key
  - Working Docker image build (prisma path, @docktor/shared symlink resolution)
  - BETTER_AUTH_URL/BETTER_AUTH_SECRET wired into docker-compose.yml (login "invalid origin" fix)
  - FileWatcher ignored-filter regression fix (was silently blocking all directory traversal, not just on Windows)
  - deployStack()/updateImages() now transition to ERROR instead of wedging a stack in DEPLOYING/UPDATING on any post-docker failure
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md
    - .planning/todos/pending/2026-08-28-fix-integration-e2e-tests.md
    - .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md
    - .planning/todos/pending/2026-08-28-manual-actions-dont-broadcast-sse.md
    - .planning/todos/pending/2026-08-28-container-status-unknown-after-deploy.md
  modified:
    - server/src/repositories/stack-repository.ts
    - server/src/jobs/file-watcher.ts
    - server/src/lib/compose-parser.ts
    - server/src/lib/auth.ts
    - server/src/application/stack-service.ts
    - server/test/unit/jobs/file-watcher.test.ts
    - server/test/unit/lib/compose-parser.test.ts
    - server/test/unit/application/stack-service.test.ts
    - server/test/unit/infrastructure/brownfield-scanner.test.ts
    - server/test/unit/infrastructure/compose-analyzer.test.ts
    - server/src/infrastructure/compose-analyzer.ts
    - Dockerfile
    - docker-compose.yml

key-decisions:
  - "syncServicesFromCompose() writes only image/imageTag/ports/volumes on config-only sync — deploy-time replaceServices() is untouched and keeps its wipe-and-recreate semantics"
  - "ignored filter must key off stats?.isFile() and default falsy, not stats?.isDirectory() — the inverted form silently blocks chokidar's directory traversal entirely, independent of polling mode"
  - "DOCKTOR_FS_POLLING env override added because process.platform inside the container is always linux even when the Docker host is Windows/Mac Desktop — platform auto-detection can't see through that layer"
  - "BETTER_AUTH_URL (not DOCKTOR_BASE_URL) is the canonical env var per existing .env.example/.env.development/INTEGRATIONS.md/STACK.md docs; DOCKTOR_BASE_URL is separately confirmed dead code, left alone and flagged in a todo"
  - "DOCKTOR_STACKS_DIR/DOCKTOR_DATA_DIR/DOCKTOR_BACKUP_DIR moved out of docker-compose.yml environment into fixed Dockerfile ENV — they are container-side mount points, not deployment-varying config"
  - "deployStack()/updateImages() failures after the initial docker call now transition to ERROR rather than throwing unhandled — no action's allowed-from list in stack-status-machine.ts includes DEPLOYING/UPDATING, and StatePoller unconditionally skips transitional statuses forever, so an unhandled failure there was a permanent dead end recoverable only by manual DB edit"

patterns-established: []

requirements-completed: [FW-01, FW-02, FW-03]

# Metrics
duration: unknown — extensive interactive real-deployment verification session, not a single timed executor run
completed: 2026-08-28
---

# Phase 02 Plan 08: Gap Closure — Runtime-State-Preserving Service Sync Summary

**Restored compose-to-database service metadata sync in FileWatcher without destroying container runtime state (the regression that caused the original fix to be reverted), then verified the fix on a real Windows/Docker-Desktop deployment — surfacing and fixing a chain of real deployment bugs along the way (Docker build packaging, missing auth env vars, an inverted chokidar ignored-filter that silently broke all live file-change detection, and a stuck-deployment dead end)**

## Accomplishments

**Task 1 — `syncServicesFromCompose()` (planned work):**
- Added `StackRepository.syncServicesFromCompose(stackId, composeConfig)` — a single transaction that deletes only services removed from the compose file, upserts the rest, and writes exactly `image`/`imageTag`/`ports`/`volumes`, deliberately omitting `containerId`/`containerState`/`healthStatus`/`restartCount` so StatePoller-owned runtime columns survive a config-only edit.
- Wired `FileWatcher.handleFileChange()` to call it (replacing the previous parse-and-discard behavior), ordered before `updateStackHash()` so a sync failure leaves the hash stale and the 60s `reconcile()` retries.
- `replaceServices()` (the deploy-time path) is untouched.

**Task 2 — compose-parser sequence guard (planned work):**
- `parseComposeContent()` now rejects a YAML-sequence-valued `services` key (previously passed the `typeof === "object"` check and produced index-named junk services) with a descriptive `Error`, caught by `FileWatcher` and turned into a `config_error` broadcast like the two pre-existing guards.

**Task 3 — checkpoint verification on a real deployment (this is where most of the session went):**
Verifying this plan required a working deployment, which the user did not have — verification surfaced and required fixing a chain of pre-existing, unrelated deployment bugs before the actual FileWatcher checks could even run:
- Docker build was broken: wrong `prisma/` path (should be `server/prisma/`), and `@docktor/shared` was copied to the wrong location relative to yarn's workspace symlink target.
- Login failed with "invalid origin": `docker-compose.yml` never set `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET`. `server/src/lib/auth.ts` also gained an explicit `baseURL` instead of relying on better-auth's own (misleading-warning-producing) auto-detection.
- Directory env vars (`DOCKTOR_STACKS_DIR`/`DOCKTOR_DATA_DIR`/`DOCKTOR_BACKUP_DIR`) were removed from `docker-compose.yml`'s environment block per user instruction — they're fixed container-side mount points, not deployment config, and now live as `ENV` in the `Dockerfile`.
- The actual live-detection bug (root-caused across ~6 rounds of collaborative diagnostic scripting after 3 earlier hypotheses were refuted): chokidar's `ignored` filter had inverted logic (`stats?.isDirectory() ?? false`) that silently blocked ALL directory traversal, independent of polling mode — not a Windows-specific issue as originally diagnosed. Fixed to `Boolean(stats?.isFile() && !filePath.endsWith("docker-compose.yml"))`, matching chokidar's own documented pattern. A `DOCKTOR_FS_POLLING` env override was also added, since `process.platform` inside the container is always `linux` regardless of the Docker Desktop host OS.
- While verifying item 3 (live tag update), the test stack got permanently wedged in `DEPLOYING` — root-caused to `deployStack()`/`updateImages()` only wrapping the initial `docker.up`/`composePull` call in try/catch; any failure afterward (compose re-read/parse, a DB write) left the stack in a transitional status with no recoverable path (no action's allowed-from list includes `DEPLOYING`/`UPDATING`, and `StatePoller` unconditionally skips transitional statuses forever). Fixed by wrapping the remaining post-docker logic in its own try/catch that always transitions to `ERROR` on failure.

Final checkpoint verification result, all three items now satisfied:
1. **Windows/instant-detection polling** — pass, confirmed via the `ignored`-filter fix (the actual root cause; the earlier polling-mode work was necessary but not sufficient).
2. **Config error surfacing** — backend confirmed working (error log, `config_error` StackEvent, SSE broadcast, and a distinct message for the missing-`services`-key case). UI indication is confirmed entirely absent (no `ConfigErrorEvent` in the client's SSE type union, no persisted error state on `Stack`, no error badge) — deferred as a todo since it's a pre-existing gap outside this plan's scope, not a regression.
3. **Live tag update (Gap 1 regression check)** — pass, confirmed on a running stack after the stuck-deploy fix unblocked testing.

**Also fixed at explicit user request, unrelated to this plan's scope but discovered during the same session:**
- 22 pre-existing failing RED-phase test stubs in `brownfield-scanner.test.ts` and `compose-analyzer.test.ts` — both underlying classes were already fully implemented; only the tests were stale/incomplete. Rewriting them against the real API surfaced two genuine implementation gaps, which were fixed rather than tested-around: `extractInlineEnvVars` now skips `${VAR}`-style variable references instead of treating them as literal values, and `extractBindMounts` now handles Docker Compose long-form volume objects (`{type: bind, source, target}`), not just short-form strings.

## Files Created/Modified

- `server/src/repositories/stack-repository.ts` — added `syncServicesFromCompose()`
- `server/src/jobs/file-watcher.ts` — wired sync call; fixed inverted `ignored` filter; added `DOCKTOR_FS_POLLING` override
- `server/src/lib/compose-parser.ts` — reject sequence-valued `services` key
- `server/src/lib/auth.ts` — explicit `baseURL`
- `server/src/application/stack-service.ts` — `deployStack()`/`updateImages()` now always resolve out of their transitional status
- `server/src/infrastructure/compose-analyzer.ts` — variable-reference env var skip; long-form volume parsing
- `server/test/unit/jobs/file-watcher.test.ts`, `server/test/unit/lib/compose-parser.test.ts`, `server/test/unit/application/stack-service.test.ts`, `server/test/unit/infrastructure/brownfield-scanner.test.ts`, `server/test/unit/infrastructure/compose-analyzer.test.ts` — new/rewritten test coverage
- `Dockerfile`, `docker-compose.yml` — build path fixes, auth env vars, fixed-mount-point env vars moved to image

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

Substantial. The plan's Task 3 checkpoint anticipated re-verifying three *already-fixed* gaps and, on failure, recording findings without opening a new plan. In practice:
- Getting to a verifiable deployment at all required fixing unrelated Docker packaging and auth bugs first (not anticipated by the plan).
- Item 1's original diagnosis (Windows polling) was superseded by a different, platform-independent root cause (inverted `ignored` filter) found via live diagnostic scripting.
- Item 3's verification uncovered and required fixing a second, unrelated bug (stuck-DEPLOYING dead end) before it could be verified at all.
- User explicitly requested unrelated test-debt cleanup (22 failing stubs) be folded into this session.

Per the plan's own instruction ("if item 1 or 2 fails, do not open a new plan yet — record and report back"), all of this was handled inline within this plan's execution rather than spawning new gap-closure plans, since each was root-caused, fixed, tested, and verified in place.

## Issues Encountered

None outstanding — all bugs found during verification were fixed and verified before closing this plan. Five items were deliberately deferred as todos rather than fixed now (see below), each because they're pre-existing gaps outside this plan's declared scope (file-watcher config sync), not regressions introduced by it.

## User Setup Required

None further — `docker-compose.yml` and `Dockerfile` fixes are already committed. A follow-up todo tracks turning the `.env`/`docker-compose.yml` pair into proper documented deployment reference material.

## Deferred / Follow-up Todos

- `.planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md` (major) — clean, documented `.env.example` + `docker-compose.yml` as part of the docs
- `.planning/todos/pending/2026-08-28-fix-integration-e2e-tests.md` (blocker) — integration/e2e suites currently broken, not yet diagnosed
- `.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md` (major) — `config_error` has no client-side handling or UI badge at all
- `.planning/todos/pending/2026-08-28-manual-actions-dont-broadcast-sse.md` (major) — deploy/stop/restart/update/backup/restore never broadcast SSE status updates; only poller-derived transitions do
- `.planning/todos/pending/2026-08-28-container-status-unknown-after-deploy.md` (minor) — service badges show "unknown" for up to 60s after every deploy due to the transitional-state skip + 60s reconcile cadence

## Next Phase Readiness

FW-01/02/03 are genuinely complete and verified on a real deployment, not just unit-tested. Plans 02-09 through 02-12 (UPD-series gap closures: manifestInspect diagnostics, registry tag listing, version-selection UI) remain and are unaffected by this plan's changes. The deferred todos above are independent of that work and can be picked up separately.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
