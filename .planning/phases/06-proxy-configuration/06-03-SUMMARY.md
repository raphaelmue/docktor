---
phase: 06-proxy-configuration
plan: 03
subsystem: proxy-configuration
tags: [nginx-proxy, acme-companion, protected-stack, settings, prisma, fastify, docker-port-preflight, tdd]
requires:
  - phase: 06-proxy-configuration
    provides: "ProxyService structure, PROXY_STACK_ID, withKeyedLock, syncServiceComposeProxy (06-01/06-02)"
provides:
  - "StackService.assertNotProtected — server-side D-12 guard on stopStack/restartStack/deleteStack"
  - "StackService.listStacks — dashboard visibility filtered by proxy.showInDashboard"
  - "StackRepository.create(isProtected)"
  - "SettingsService.getProxySettings/updateProxySettings over proxy.acmeEmail/proxy.showInDashboard"
  - "renderProxyStackCompose — nginx-proxy + acme-companion compose skeleton renderer"
  - "ProxyService.deployProxyStack/getProxyStackState/updateProxySettingsAndSync, assertHostPortsFree (D-11)"
  - "GET/PUT/POST /api/settings/proxy* authenticated endpoints"
affects: [06-04, 06-05, 06-06]
actuals:
  tokens: 14594
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns:
    - "assertNotProtected(stack, action) — private guard called between findByIdOrThrow and guardTransition in stopStack/restartStack/deleteStack, deliberately absent from deployStack/updateImages"
    - "deployProxyStack serialized on PROXY_STACK_ID via withKeyedLock; first-deploy vs redeploy branches share rewriteAndRedeployProxyStack/deployAndSurfaceFailure as the single write+deploy choke point"
    - "assertHostPortsFree inspects DockerodeClient.listContainers() only — no in-process TCP bind test (Pitfall 3: DooD makes a container-local bind prove nothing about the host)"
key-files:
  created:
    - server/src/lib/proxy-stack-compose.ts
    - server/test/unit/lib/proxy-stack-compose.test.ts
  modified:
    - server/src/application/stack-service.ts
    - server/src/repositories/stack-repository.ts
    - server/src/application/settings-service.ts
    - server/src/application/proxy-service.ts
    - server/src/application/index.ts
    - server/src/routes/proxy.ts
    - server/test/unit/application/stack-service.test.ts
    - server/test/unit/application/settings-service.test.ts
    - server/test/unit/application/proxy-service.test.ts
    - server/test/integration/proxy.test.ts
key-decisions:
  - "renderProxyStackCompose is a template literal, not a yaml Document API edit — this file is Docktor-authored with no prior on-disk content to preserve, unlike every other compose-editing module in this codebase"
  - "docker manifest inspect re-verified both pinned tags (nginxproxy/nginx-proxy:1.11-alpine, nginxproxy/acme-companion:2.6.3) this session — both resolved, no substitution needed"
  - "deployAndSurfaceFailure relays StackService.deployStack's real errorMessage verbatim inside BadRequestError rather than paraphrasing it, satisfying D-11's fail-loudly requirement on the residual non-Docker-process port case"
patterns-established:
  - "proxy-stack-compose.ts: template-literal renderer pattern for Docktor-authored (not user-authored) compose files — sibling to, but structurally different from, the compose-editor.ts/compose-proxy-editor.ts surgical-mutation family"
requirements-completed: [PRXY-02, PRXY-03]
coverage:
  - id: D1
    description: "assertNotProtected rejects stopStack/restartStack/deleteStack on isProtected stacks with BadRequestError before guardTransition/any docker call; deployStack/updateImages remain reachable"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts — protected-stack guard cases (4 tests) + deployStack reachability test"
        status: pass
      - kind: other
        ref: "grep -c 'assertNotProtected(' server/src/application/stack-service.ts -> 4"
        status: pass
    human_judgment: false
  - id: D2
    description: "listStacks omits isProtected stacks unless proxy.showInDashboard is \"true\"; never omits a non-protected stack"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts — listStacks describe block (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SettingsService.getProxySettings/updateProxySettings round-trip proxy.acmeEmail/proxy.showInDashboard, reading only those two keys, validating a non-empty acmeEmail as an email address"
    requirement: "PRXY-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/settings-service.test.ts — getProxySettings/updateProxySettings describe blocks (8 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "renderProxyStackCompose produces a pinned, comment-annotated, bind-mount-only nginx-proxy + acme-companion compose file that parses cleanly, including for adversarial ACME email input"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/proxy-stack-compose.test.ts (11 tests)"
        status: pass
      - kind: other
        ref: "docker manifest inspect nginxproxy/nginx-proxy:1.11-alpine && docker manifest inspect nginxproxy/acme-companion:2.6.3 — both exit 0 this session"
        status: pass
    human_judgment: false
  - id: D5
    description: "deployProxyStack creates the docktor-proxy Stack row (isProtected: true) on first deploy after a host-port pre-flight, skips both on redeploy, and surfaces the real deployStack errorMessage verbatim on failure"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — ProxyService.deployProxyStack describe block (6 tests)"
        status: pass
      - kind: other
        ref: "grep -c 'createServer' server/src/application/proxy-service.ts -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "assertHostPortsFree throws ConflictError naming the offending container for a running container publishing a requested port, ignores non-running containers and the proxy stack's own two container names"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — port-conflict/ignore-self cases (3 tests, exercised via deployProxyStack)"
        status: pass
    human_judgment: false
  - id: D7
    description: "getProxyStackState/updateProxySettingsAndSync: GET returns deployed/status/settings; PUT persists settings and redeploys only when acmeEmail actually changed and the stack already exists"
    requirement: "PRXY-03"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — getProxyStackState + updateProxySettingsAndSync describe blocks (5 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "GET/PUT/POST /api/settings/proxy* end-to-end: happy paths, 409 port conflict, 400 compose failure, idempotent second deploy, 401 on every route without a session cookie"
    requirement: "PRXY-02, PRXY-03"
    verification:
      - kind: integration
        ref: "server/test/integration/proxy.test.ts — GET/PUT/POST /api/settings/proxy* describe block (7 tests) — written and reviewed for correctness, NOT executed in this session (see Issues Encountered)"
        status: unknown
    human_judgment: true
    rationale: "Same environmental DB-unreachable restriction documented in 06-01-SUMMARY.md and 06-02-SUMMARY.md (testcontainers Postgres reachable via docker ps but P1001 on the wire-protocol handshake), reconfirmed this session. A developer on an unrestricted host must run the integration suite to close this out."
  - id: D-human-check
    description: "Deploy the proxy stack on a live Docker host with free host ports 80/443 through the running app, confirm docker ps shows docktor-proxy-nginx/docktor-proxy-acme running and docker network ls lists docktor_proxy (no project-name prefix), confirm the dashboard hides the stack while proxy.showInDashboard is off, and confirm curl -X POST .../api/stacks/docktor-proxy/stop returns 400"
    verification: []
    human_judgment: true
    rationale: "This session's Docker daemon is reachable (docker manifest inspect succeeded), but this host is documented in STATE.md as shared with real, unrelated production Docker workloads — a prior live docker-compose test on this same host (05.1-03) stopped and removed real running containers before the collision was noticed. Binding ports 80/443 live here risks colliding with an already-running service on this host. Deliberately not attempted; a human on a dedicated or verified-clear host must perform this check."
duration: ~30min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 03: Protected Stacks, Proxy Compose Renderer, and Deploy Summary

**Server-side D-12 protected-stack enforcement, a template-literal nginx-proxy + acme-companion compose renderer with re-verified pinned image tags, and a deployProxyStack()/getProxyStackState()/updateProxySettingsAndSync() pipeline exposed through three authenticated /api/settings/proxy* endpoints — the proxy stack now deploys as an ordinary but protected Stack row through the exact same StackService.deployStack() pipeline every user stack uses.**

## Performance
- **Duration:** ~30min
- **Started:** 2026-09-04T06:50Z (approx.)
- **Completed:** 2026-09-04T07:11Z
- **Tasks:** 3/3
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments
- `StackService.assertNotProtected()`: `stopStack`/`restartStack`/`deleteStack` now reject a protected stack with `BadRequestError` before `guardTransition` runs and before any `docker` call — a direct API call is refused exactly like a disabled UI button. `deployStack`/`updateImages` are deliberately left unguarded so `ProxyService.deployProxyStack()` can deploy/update the proxy stack itself.
- `StackService.listStacks()` now filters out `isProtected` stacks from the dashboard unless `proxy.showInDashboard` is `"true"` — filtering lives in the service, not the route.
- `StackRepository.create()` accepts an optional `isProtected` (defaults `false`); `SettingsService` gained `getProxySettings()`/`updateProxySettings()` over the `proxy.acmeEmail`/`proxy.showInDashboard` Setting keys, reading only those two keys (verified by test — never falls back to `smtp.from`/`instanceName`/`baseUrl`).
- New `server/src/lib/proxy-stack-compose.ts`: `renderProxyStackCompose()` renders the `docktor-proxy` stack's own compose file as a template literal (Docktor-authored, no prior content to preserve) — pinned images, `docktor_proxy` non-external named network, bind mounts only, `DEFAULT_EMAIL` emitted only when non-empty as a `JSON.stringify`'d scalar, both `docker.sock` mounts disclosed with the same wording as the project's own root `docker-compose.yml`.
- New `ProxyService.deployProxyStack()`/`getProxyStackState()`/`updateProxySettingsAndSync()`, plus a private `assertHostPortsFree()` pre-flight (D-11) that inspects `DockerodeClient.listContainers()` only — no in-process TCP bind test, per RESEARCH.md's Pitfall 3.
- Three new authenticated routes: `GET/PUT/POST /api/settings/proxy*`, thin delegations with no Prisma access.
- Full RED→GREEN TDD cycle across all three tasks: 12 tests added to `stack-service.test.ts`/`settings-service.test.ts` (Task 1), 11 new tests in `proxy-stack-compose.test.ts` (Task 2), 24 tests in `proxy-service.test.ts` plus 7 integration tests (Task 3) — every RED run confirmed failing for the right reason before implementation.

## Docker Manifest Verification (Task 2, Step 0)

Both pinned image tags were re-verified against the live Docker Hub registry this session, per the plan's flagged assumption A3:
```
docker manifest inspect nginxproxy/nginx-proxy:1.11-alpine   -> exit 0
docker manifest inspect nginxproxy/acme-companion:2.6.3      -> exit 0
```
Both resolve. No substitution was necessary; `NGINX_PROXY_IMAGE`/`ACME_COMPANION_IMAGE` remain exactly as RESEARCH.md's Standard Stack recommended.

## Task Commits
1. **Task 1 (RED): failing tests for protected-stack guards and proxy settings** - `9d0aba2` (test)
2. **Task 1 (GREEN): protected-stack enforcement, dashboard visibility, proxy settings** - `ad1c9f2` (feat)
3. **Task 2 (RED): failing test for the proxy stack compose renderer** - `82aefb0` (test)
4. **Task 2 (GREEN): render the nginx-proxy + acme-companion compose file** - `47a9076` (feat)
5. **Task 3 (RED): failing tests for deployProxyStack, port pre-flight, settings endpoints** - `05377b3` (test)
6. **Task 3 (GREEN): deploy the managed proxy stack, expose it in Settings** - `8008a3d` (feat)

**Plan metadata:** pending (this commit)

## TDD Gate Compliance

All three tasks (frontmatter `tdd="true"`) followed RED→GREEN. No REFACTOR commit was needed for any task — the GREEN implementation matched the plan's `<action>` shape closely enough that no follow-up cleanup pass was warranted, and `tsc --noEmit`/the full unit suite stayed green after each GREEN commit with no further changes.

## Files Created/Modified
- `server/src/lib/proxy-stack-compose.ts` - nginx-proxy + acme-companion compose skeleton renderer
- `server/test/unit/lib/proxy-stack-compose.test.ts` - 11 unit tests
- `server/src/application/stack-service.ts` - `assertNotProtected`, sixth constructor param, `listStacks` visibility filter
- `server/src/repositories/stack-repository.ts` - `create()` accepts `isProtected`
- `server/src/application/settings-service.ts` - `getProxySettings`/`updateProxySettings`
- `server/src/application/proxy-service.ts` - `deployProxyStack`/`getProxyStackState`/`updateProxySettingsAndSync`/`assertHostPortsFree`, two new constructor params
- `server/src/application/index.ts` - `settingsService` now constructed before `stackService` (passed as 6th arg); `dockerodeClient` wired into `ProxyService`
- `server/src/routes/proxy.ts` - three new `/api/settings/proxy*` routes
- `server/test/unit/application/stack-service.test.ts` - +12 tests
- `server/test/unit/application/settings-service.test.ts` - +8 tests
- `server/test/unit/application/proxy-service.test.ts` - +24 tests
- `server/test/integration/proxy.test.ts` - +7 tests (written, not executed — see Issues Encountered)

## Decisions Made
- `renderProxyStackCompose` is a template literal, not a `yaml` Document-API edit — every other compose-editing module in this codebase (`compose-editor.ts`, `compose-proxy-editor.ts`) mutates pre-existing user-authored content; this file is Docktor-authored from nothing, so there is no prior document to preserve.
- `deployAndSurfaceFailure()` is a private helper shared by both `deployProxyStack`'s first-deploy branch and `rewriteAndRedeployProxyStack` (redeploy/settings-sync path) — one place that translates `StackService.deployStack`'s `{success, errorMessage}` into a thrown `BadRequestError` containing the real compose stderr verbatim, so D-11's "fail loudly, don't paraphrase" requirement can't drift between the two call sites.
- Everything else in Task 1-3 followed the plan's `<action>` steps and the pattern map's code sketches verbatim (guard placement, settings key shape, compose skeleton content, `assertHostPortsFree` container-name exclusion, route delegation shape).

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0. **Impact:** none.

## Issues Encountered

**Environmental: this sandboxed session still cannot reach any Postgres instance over a Docker-published port — same restriction documented for 06-01 and 06-02 (05.1-01/05.1-05/05.1-06 lineage).**

`yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` was run this session (not skipped) and failed identically to the prior two plans: `startContainer(): prisma db push failed ... P1001: Can't reach database server at localhost:32895`, despite `docker ps` showing a healthy `postgres` test container with a published port (raw TCP handshake succeeds, Prisma's wire-protocol handshake never completes). This affects only the integration suite; **all 584 unit tests pass (37 files), 0 regressions**, including this plan's 43 new/changed unit tests. `yarn workspace @docktor/server tsc --noEmit` reports zero errors.

**Task 3's `<human-check>` was NOT performed live in this session.** Docker itself is reachable here (`docker manifest inspect` succeeded twice), but STATE.md documents this execution host as shared with real, unrelated running Docker workloads, and records a prior incident (05.1-03) where a live `docker compose up` test on this same host stopped and removed real production containers before the collision was noticed. Binding host ports 80/443 for a live proxy-stack deploy carries that same class of risk. Per the plan's own guidance and the checkpoint protocol's `human_verify_mode: end-of-phase` handling, this is recorded here verbatim for the end-of-phase UAT rather than fabricated or skipped silently:

> On a host with Docker and free ports 80/443, POST /api/settings/proxy/deploy through the running app, then confirm `docker ps` shows `docktor-proxy-nginx` and `docktor-proxy-acme` running and `docker network ls` lists a network named exactly `docktor_proxy` (no project-name prefix). Then confirm the dashboard does not list the proxy stack while `proxy.showInDashboard` is off, and that its Stop/Restart/Delete actions are refused by the API (`curl -X POST .../api/stacks/docktor-proxy/stop` returns 400).

## User Setup Required
None - no external service configuration required. A developer on an unrestricted, non-shared host should complete: (1) the outstanding DB-verification steps 06-01/06-02 named, (2) this plan's integration suite run, and (3) the Task 3 human-check above, ideally together since they share reachability prerequisites.

## Next Phase Readiness
The proxy stack now deploys and is protected end-to-end at the service layer. 06-04 (cert-issuance polling) can rely on `PROXY_CERTS_SUBPATH` (from Task 2) and `getProxyStackState()`'s `deployed`/`status` shape. 06-05/06-06 (client UI: Settings card, stack-detail proxy tab, First-Run Wizard step) can build directly on the three `/api/settings/proxy*` endpoints and the existing `assignDomain`/`removeDomain` routes from 06-01/06-02 — no server-side blocker remains for the client work. The Task 3 human-check above remains outstanding for end-of-phase UAT.

## Self-Check: PASSED

- FOUND: `server/src/lib/proxy-stack-compose.ts`
- FOUND: `server/test/unit/lib/proxy-stack-compose.test.ts`
- FOUND: `server/src/application/stack-service.ts` (modified)
- FOUND: `server/src/repositories/stack-repository.ts` (modified)
- FOUND: `server/src/application/settings-service.ts` (modified)
- FOUND: `server/src/application/proxy-service.ts` (modified)
- FOUND: `server/src/application/index.ts` (modified)
- FOUND: `server/src/routes/proxy.ts` (modified)
- FOUND commit `9d0aba2` in `git log --oneline --all`
- FOUND commit `ad1c9f2` in `git log --oneline --all`
- FOUND commit `82aefb0` in `git log --oneline --all`
- FOUND commit `47a9076` in `git log --oneline --all`
- FOUND commit `05377b3` in `git log --oneline --all`
- FOUND commit `8008a3d` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
