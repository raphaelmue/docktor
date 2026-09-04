---
phase: 06-proxy-configuration
plan: 04
subsystem: proxy-configuration
tags: [nginx-proxy, acme-companion, dockerode, sse, state-broadcaster, cron-poller, react-hooks, tdd]
requires:
  - phase: 06-proxy-configuration
    provides: "PROXY_CERTS_SUBPATH/ACME_COMPANION_CONTAINER_NAME exports, ProxyRepository.updateCertStatus, ProxyConfig.certStatus/certMessage/certCheckedAt schema (06-01/06-03)"
provides:
  - "ProxyCertStatusEvent — server StateEvent union member (server/src/lib/state-broadcaster.ts)"
  - "ProxyCertStatusEvent — client StateEvent union member (client/src/hooks/use-container-events.ts)"
  - "DockerodeClient.getLogTail(containerId, tail) — bounded, non-following log tail primitive"
  - "ProxyCertPoller / proxyCertPoller — 60s cron reconcile of certificate state into ProxyConfig rows and SSE"
  - "\"ProxyCertPoller\" registered in jobs/index.ts through startJob/stopJobs"
  - "useProxyStatus(stackId) — client hook subscribing to proxy_cert_status over the existing /api/events SSE stream"
affects: [06-05, 06-06]
actuals:
  tokens: 8181
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns:
    - "ProxyCertPoller mirrors StatePoller/FileWatcher's constructor-DI shape exactly — optional docker/repo/broadcaster/fs params, each defaulting to the production singleton, repo resolved via a lazy dynamic import to keep db.ts out of the unit-test module graph"
    - "PROXY_STACK_ID is redeclared locally in jobs/proxy-cert-poller.ts rather than imported from application/proxy-service.ts — keeps this job's test module graph free of the Prisma-namespace/compose-editor import chain that proxy-service.ts pulls in"
    - "useProxyStatus builds on the existing useContainerEvents(onEvent) hook instead of opening a second EventSource — one /api/events connection per browser tab, not one per SSE consumer"
key-files:
  created:
    - server/src/jobs/proxy-cert-poller.ts
    - server/test/unit/jobs/proxy-cert-poller.test.ts
    - client/src/hooks/use-proxy-status.ts
    - client/test/unit/hooks/use-proxy-status.test.ts
  modified:
    - server/src/lib/state-broadcaster.ts
    - server/src/infrastructure/dockerode-client.ts
    - server/src/jobs/index.ts
    - server/test/unit/jobs/index.test.ts
    - client/src/hooks/use-container-events.ts
key-decisions:
  - "PROXY_STACK_ID redeclared as a local literal in proxy-cert-poller.ts (not imported from proxy-service.ts) — a plain-string duplication traded deliberately against pulling proxy-service.ts's Prisma/compose-editor/StackService import chain into a job module whose whole design point (matching state-poller.ts/file-watcher.ts) is testability with plain objects and no database client in the graph"
  - "reconcile() bails out of the entire pass (no writes, no publishes, one console.error) on a certs-directory read failure rather than per-row — matches the plan's explicit truth that an unreadable directory must never flip healthy rows to failed"
  - "The acme-companion log tail is fetched at most once per reconcile and only when at least one TLS-enabled row still lacks a certificate file — a single shared fetch classifies every missing-cert row in that pass, avoiding N log-tail calls for N pending domains"
patterns-established:
  - "jobs/proxy-cert-poller.ts: cron-reconcile-into-DB-and-SSE job shape, sibling to state-poller.ts and file-watcher.ts, now the third instance of this pattern in the codebase"
requirements-completed: [PRXY-02]
coverage:
  - id: D1
    description: "getLogTail(containerId, tail) resolves the last N lines of combined stdout/stderr as a single string with follow:false, and resolves \"\" (not a throw) for a missing container"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/proxy-cert-poller.test.ts — exercised indirectly via the poller's fetchAcmeCompanionLogTail path (failed/pending-with-log-tail cases)"
        status: pass
      - kind: other
        ref: "grep -n 'follow' server/src/infrastructure/dockerode-client.ts -> follow: false present on getLogTail's logs() call"
        status: pass
    human_judgment: false
  - id: D2
    description: "ProxyCertStatusEvent added to the server StateEvent discriminated union, mirroring ConfigChangedEvent's shape"
    requirement: "PRXY-02"
    verification:
      - kind: other
        ref: "grep -c 'proxy_cert_status' server/src/lib/state-broadcaster.ts -> 1"
        status: pass
      - kind: other
        ref: "yarn workspace @docktor/server tsc --noEmit -> zero errors"
        status: pass
    human_judgment: false
  - id: D3
    description: "ProxyCertPoller.reconcile() classifies every TLS-enabled ProxyConfig row into issued/failed/pending per the certificate-file-presence-first, log-tail-only-for-failed-vs-pending rule, persists via updateCertStatus, and publishes proxy_cert_status only when the computed status differs from the stored one"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/proxy-cert-poller.test.ts — 11 tests: tlsEnabled:false ignored, issued via .crt path, issued via fullchain.pem path, no-op-on-unchanged, unreadable-certs-dir leaves every row untouched + logs once, pending-not-failed with no error line, failed with matching log line stored as certMessage, log tail fetched zero times when all rows have certs, log tail fetched at most once across multiple missing rows, no path ever ends in .key, stop() called twice does not throw"
        status: pass
    human_judgment: false
  - id: D4
    description: "\"ProxyCertPoller\" is registered in jobs/index.ts through startJob (isolated from other job start failures) and stopped in stopJobs"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/index.test.ts — proxyCertPoller.start/stop assertions added to all four existing startJobs/stopJobs cases"
        status: pass
      - kind: other
        ref: "grep -c 'proxyCertPoller' server/src/jobs/index.ts -> 3"
        status: pass
    human_judgment: false
  - id: D5
    description: "Client ProxyCertStatusEvent mirrors the server interface byte-for-byte and is added to the client StateEvent union without breaking any existing exhaustive switch"
    requirement: "PRXY-02"
    verification:
      - kind: other
        ref: "grep -c 'proxy_cert_status' client/src/hooks/use-container-events.ts client/src/hooks/use-proxy-status.ts -> 1 and 2 respectively"
        status: pass
      - kind: other
        ref: "yarn workspace @docktor/client tsc --noEmit -> zero errors"
        status: pass
    human_judgment: false
  - id: D6
    description: "useProxyStatus(stackId) returns {statuses}, a proxyConfigId -> {status, message} map that merges on a matching proxy_cert_status event, ignores other stackIds/event types, keeps independent domains' entries, and resets to empty on a stackId change — built on useContainerEvents, no second EventSource"
    requirement: "PRXY-02"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-proxy-status.test.ts — 7 tests: empty initial map, merges on match, includes message, ignores different stackId, ignores other event types, two domains coexist, stackId change resets map"
        status: pass
    human_judgment: false
  - id: D-human-check
    description: "After the proxy stack has been deployed on a real host with a domain assigned and TLS on, confirm the Docktor process can actually read the acme-companion-written cert files (RESEARCH.md assumption A4), that a domain whose DNS does not point at the host shows \"Cert failed\" with a real acme-companion line, and one that does point at the host reaches \"Secured\""
    verification: []
    human_judgment: true
    rationale: "No real Docker host with a deployed proxy stack and an assigned TLS domain was available in this sandboxed session — the proxy stack itself has never been live-deployed in this environment (06-03-SUMMARY.md's own human-check for the deploy step is also still outstanding). Recorded verbatim below for end-of-phase UAT per workflow.human_verify_mode: end-of-phase."
duration: ~25min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 04: Certificate Status Reconciliation (Server Poller + Client SSE Hook) Summary

**A `StatePoller`-shaped `ProxyCertPoller` reconciles every TLS-enabled domain's certificate state (issued/pending/failed) into the database and the SSE stream every 60 seconds by probing the proxy stack's certs bind mount and, only when needed, tailing acme-companion's own log — closing D-05's feedback loop so a stuck or failed certificate is now observable instead of silently invisible, with a matching `useProxyStatus` client hook ready to consume it.**

## Performance

- **Duration:** ~25min
- **Started:** 2026-09-04T07:14Z (approx., continuing directly from 06-03)
- **Completed:** 2026-09-04T07:38Z
- **Tasks:** 2/2
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- `server/src/lib/state-broadcaster.ts` gains `ProxyCertStatusEvent` (`type: "proxy_cert_status"`, `proxyConfigId`, `stackId`, `domain`, `status`, optional `message`) as a new `StateEvent` union member — the existing `/api/events` route forwards it to every subscribed client with no route-level change needed.
- `DockerodeClient.getLogTail(containerId, tail = 200)`: a new bounded, non-following log-tail primitive (`follow: false`) that resolves a joined string of de-multiplexed log lines (reusing `docker-log-parser.ts`'s existing frame parser rather than writing a second one) and resolves `""` — not a throw — for a missing container.
- New `server/src/jobs/proxy-cert-poller.ts`: `ProxyCertPoller` class + `proxyCertPoller` singleton. `reconcile()` reads every `ProxyConfig` row, drops `tlsEnabled: false` rows, probes the certs directory once (aborting the whole pass untouched on a read failure), probes both candidate certificate paths per row (`{domain}.crt` and `{domain}/fullchain.pem`), fetches the acme-companion log tail at most once per reconcile (only when at least one row still lacks a cert), classifies each row as `issued`/`failed`/`pending`, and writes+publishes only when a row's computed status differs from its stored one. Never opens a `.key` file anywhere in the code path.
- `server/src/jobs/index.ts` now starts `ProxyCertPoller` through the existing `startJob` isolation wrapper and stops it in `stopJobs` — a poller failure to start cannot take down the HTTP server or any other job.
- Client `client/src/hooks/use-container-events.ts` gains the byte-identical mirror `ProxyCertStatusEvent` interface and union member (a hand-maintained mirror of the server file per existing convention).
- New `client/src/hooks/use-proxy-status.ts`: `useProxyStatus(stackId)` returns `{statuses}`, a `proxyConfigId -> {status, message?}` map built on top of the existing `useContainerEvents(onEvent)` hook — no second `EventSource`, cleanup inherited from that hook's existing close-on-unmount effect.
- Full RED→GREEN TDD cycle on both tasks, proven by temporarily removing each new implementation module and re-running its test file to confirm the exact expected RED failure (import-resolution error) before restoring the implementation and confirming GREEN: 11 new server tests (`proxy-cert-poller.test.ts`) plus 3 new/updated assertion lines in the existing `jobs/index.test.ts`, and 7 new client tests (`use-proxy-status.test.ts`).

## Task Commits

Each task was committed atomically as a RED/GREEN pair:

1. **Task 1 (RED): failing tests for ProxyCertPoller reconcile** - `19bab45` (test)
2. **Task 1 (GREEN): reconcile certificate state into DB and SSE** - `656fe55` (feat)
3. **Task 2 (RED): failing tests for useProxyStatus SSE subscriber** - `8b51c3d` (test)
4. **Task 2 (GREEN): subscribe the client to live certificate status** - `2fe32ff` (feat)

**Plan metadata:** pending (this commit)

## TDD Gate Compliance

Both tasks (frontmatter `tdd="true"`) followed RED→GREEN. RED was verified concretely, not assumed: for Task 1 the new `proxy-cert-poller.ts` file was moved out of the tree and the test run re-confirmed to fail on module resolution before being restored; for Task 2 the equivalent check was run against `use-proxy-status.ts` before it existed. No REFACTOR commit was needed for either task — two small test-authoring bugs (a missing certs-directory-probe mock case in two Task 1 "issued" tests, and missing `act()` wrappers around synchronous state-updating handler calls in Task 2) were caught and fixed *during* the RED→GREEN cycle itself, before the GREEN commit, not as a follow-up cleanup pass.

## Files Created/Modified

- `server/src/lib/state-broadcaster.ts` - `ProxyCertStatusEvent` interface + `StateEvent` union member
- `server/src/infrastructure/dockerode-client.ts` - `getLogTail(containerId, tail)`
- `server/src/jobs/proxy-cert-poller.ts` - `ProxyCertPoller` class, `proxyCertPoller` singleton
- `server/test/unit/jobs/proxy-cert-poller.test.ts` - 11 unit tests
- `server/src/jobs/index.ts` - `startJob("ProxyCertPoller", ...)` + `proxyCertPoller.stop()`
- `server/test/unit/jobs/index.test.ts` - mock + assertions for the new job, added to all 4 existing test cases
- `client/src/hooks/use-container-events.ts` - `ProxyCertStatusEvent` interface + client `StateEvent` union member
- `client/src/hooks/use-proxy-status.ts` - `useProxyStatus(stackId)` hook
- `client/test/unit/hooks/use-proxy-status.test.ts` - 7 unit tests

## Decisions Made

- `PROXY_STACK_ID` is redeclared as a local `"docktor-proxy"` literal inside `proxy-cert-poller.ts` rather than imported from `application/proxy-service.ts`. Importing the canonical export would pull `proxy-service.ts`'s full dependency chain (the generated Prisma namespace, `compose-proxy-editor.ts`, `StackService`/`SettingsService` types) into a job module whose entire design point — matching `state-poller.ts` and `file-watcher.ts` — is staying testable with plain objects and no database client anywhere in the unit-test module graph. A one-line string duplication was judged the lesser cost.
- `reconcile()` treats a certs-directory read failure as an all-or-nothing abort (no writes, no publishes, a single `console.error`) rather than trying to partially recover — this is the literal shape of the plan's truth ("an unreadable directory never flips healthy rows to failed") and RESEARCH.md's Pitfall 5/assumption A4 concern about acme-companion writing cert files with a UID/mode the Docktor process might not be able to stat.
- The acme-companion log tail is fetched once per reconcile pass (not once per missing-cert row) and only when at least one TLS-enabled row still lacks a certificate — satisfies acceptance criteria on both "zero fetches when nothing is missing" and "at most one fetch regardless of how many rows are missing," and keeps the poller's Docker API footprint constant regardless of domain count (T-06-22).
- Everything else in Task 1-2 followed the plan's `<action>`/`<behavior>` sections and the pattern map's `state-poller.ts`/`file-watcher.ts` constructor-DI shape and `use-stack.test.ts`'s captured-handler SSE test convention verbatim.

## Deviations from Plan

None - plan executed exactly as written. Two test-authoring bugs (missing certs-directory-probe mocks in two Task 1 tests; missing `act()` wrappers in Task 2) were caught and corrected during the RED→GREEN cycle itself before any GREEN commit — these are normal test-development iteration, not deviations from the plan's design.

**Total deviations:** 0. **Impact:** none.

## Issues Encountered

**Two unrelated client tests (`service-upgrade-dialog.test.tsx`'s "shows a loading state..." and "renders one option per candidate...") timed out at 5000ms when the full `yarn workspace @docktor/client test` suite ran under this session's resource contention.** Re-run in isolation (`yarn workspace @docktor/client test test/unit/routes/stacks/service-upgrade-dialog.test.tsx`), all 9 tests in that file passed cleanly (up to ~3s each, well under the 5s timeout) — confirmed as full-suite parallel resource contention, not a regression introduced by this plan's changes (this plan touched no file `service-upgrade-dialog.test.tsx` depends on). `yarn workspace @docktor/client tsc --noEmit` reports zero errors.

**Server integration suite still cannot reach the test database in this sandboxed session** — same documented environmental restriction as 06-01/06-02/06-03 (`P1001: Can't reach database server at localhost:...`, testcontainers Postgres visible via `docker ps` but unreachable on the Prisma wire protocol). This plan added no new integration tests (both tasks are unit-tested per RESEARCH.md's test map), so this is unchanged from prior plans' documented state, not a new blocker. All 38 unit test files / 595 unit tests pass on the server side, 0 regressions.

**Task 1's `<human-check>` was NOT performed live in this session**, per the plan's own instruction (checkpoint protocol, `human_verify_mode: end-of-phase`) and consistent with every prior plan in this phase: no real Docker host with a deployed proxy stack and an assigned TLS domain was available (the proxy stack itself has never been live-deployed in this sandboxed session — see 06-03-SUMMARY.md's own outstanding human-check for the deploy step). Recorded here verbatim for end-of-phase UAT rather than fabricated or silently skipped:

> After the proxy stack has been deployed on a real host and a domain assigned with TLS on, confirm the Docktor process can read the certificate directory it bind-mounts (RESEARCH.md assumption A4): the acme-companion container may write cert files with an ownership or mode the Docktor process cannot stat. Confirm a domain whose DNS does not point at the host shows "Cert failed" with a real acme-companion line, and one that does point at the host reaches "Secured".

## User Setup Required

None - no external service configuration required. A developer on an unrestricted, non-shared host should complete this plan's human-check together with 06-03's outstanding proxy-stack-deploy human-check, since both require the same live proxy-stack-plus-domain prerequisite.

## Next Phase Readiness

Certificate status is now live end-to-end on the server (poller → DB → SSE) and the client has a ready-to-use `useProxyStatus` hook consuming it. 06-05/06-06 (the stack-detail proxy tab and Settings/wizard UI) can wire `useProxyStatus(stackId)` directly into a certificate status badge per domain — no server-side blocker remains. The Task 1 human-check above, together with 06-03's outstanding proxy-stack-deploy human-check, remain outstanding for end-of-phase UAT.

## Self-Check: PASSED

- FOUND: `server/src/lib/state-broadcaster.ts` (modified)
- FOUND: `server/src/infrastructure/dockerode-client.ts` (modified)
- FOUND: `server/src/jobs/proxy-cert-poller.ts`
- FOUND: `server/test/unit/jobs/proxy-cert-poller.test.ts`
- FOUND: `server/src/jobs/index.ts` (modified)
- FOUND: `server/test/unit/jobs/index.test.ts` (modified)
- FOUND: `client/src/hooks/use-container-events.ts` (modified)
- FOUND: `client/src/hooks/use-proxy-status.ts`
- FOUND: `client/test/unit/hooks/use-proxy-status.test.ts`
- FOUND commit `19bab45` in `git log --oneline --all`
- FOUND commit `656fe55` in `git log --oneline --all`
- FOUND commit `8b51c3d` in `git log --oneline --all`
- FOUND commit `2fe32ff` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
