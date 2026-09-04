---
phase: 06-proxy-configuration
plan: 02
subsystem: proxy-configuration
tags: [nginx-proxy, compose-editing, yaml, keyed-mutex, concurrency, idempotency, prisma]
requires:
  - phase: 06-proxy-configuration
    provides: "setServiceProxyEnv/readServiceProxyEnv/removeServiceProxyEnv scaffolding, ProxyRepository, ProxyService.assignDomain tracer slice, DELETE route stub (06-01)"
provides:
  - "removeServiceProxyEnv now clears the docktor_proxy network entry (and empty environment/networks keys) in addition to the proxy env vars"
  - "ProxyService.removeDomain — deletes a row, re-renders the remaining domain set or clears proxy env entirely, redeploys, 404s cleanly on repeat"
  - "ProxyService.assignDomain adopts hand-written VIRTUAL_HOST domains with no ProxyConfig row, skipping cross-service collisions with a warning"
  - "ProxyService.assignDomain idempotent re-assign: same-service domain updates internalPort/tlsEnabled in place instead of erroring or duplicating"
  - "server/src/lib/keyed-mutex.ts — withKeyedLock, a dependency-free per-key async serialization primitive"
  - "assignDomain and removeDomain both serialized per stack id via withKeyedLock (T-06-09)"
  - "live DELETE /api/proxy-configs/:proxyConfigId handler (204/404), replacing the 501 stub"
affects: [06-03, 06-04, 06-05, 06-06]
actuals:
  tokens: 12074
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "renderProxyEnvForService + syncServiceComposeProxy: the single render-then-write choke point both assignDomain and removeDomain call — exactly one fs.writeCompose call site in proxy-service.ts, enforced by a grep verify gate"
    - "withKeyedLock(stackId, ...) wraps the entire body of both assignDomain and removeDomain — a stack's compose read-modify-write cycle can never interleave across two requests"
    - "hasIn-guarded deleteIn: yaml's deleteIn throws when an intermediate path segment is missing entirely (not just the leaf key) — every conditional env-key deletion in compose-proxy-editor.ts now checks hasIn first"
key-files:
  created:
    - server/src/lib/keyed-mutex.ts
    - server/test/unit/lib/keyed-mutex.test.ts
    - server/test/unit/application/proxy-service.test.ts
  modified:
    - server/src/lib/compose-proxy-editor.ts
    - server/src/application/proxy-service.ts
    - server/src/routes/proxy.ts
    - server/test/unit/lib/compose-proxy-editor.test.ts
    - server/test/integration/proxy.test.ts
key-decisions:
  - "[Rule 1 - bug] removeServiceProxyEnv's deleteIn calls threw 'Expected YAML collection' when a service had no environment block at all yet (not just a missing individual key) — every env-key deletion now goes through a hasIn-guarded helper before deleteIn, restoring the plan's required true no-op behavior."
  - "[Rule 2 - quality] removeServiceProxyEnv also deletes the service's environment key entirely once it becomes empty (mirroring the existing networks-key cleanup), instead of leaving a bare 'environment: {}' behind — not explicitly required by the plan's <behavior> bullets but consistent with the networks cleanup already specified and with the 'byte-identical elsewhere' intent of the compose-editor family."
  - "assignDomain and removeDomain wrap their ENTIRE body (including the initial stack/proxy-stack existence checks) inside withKeyedLock, not just the write step — matches the plan's 'wrap the whole body' instruction literally and means adoption + the idempotent-domain check both run inside the same lock as the write."
  - "The idempotent-domain check runs AFTER adoptUnmanagedDomains, querying findByStackAndService once and reusing that same result for both the idempotency check and the port-conflict check — an adopted domain that happens to equal the requested domain is transparently picked up by the idempotent branch on the same call, rather than needing a second round trip."
patterns-established:
  - "keyed-mutex.ts: a promise-chain-per-key primitive (tail stored in a Map, identity-checked cleanup in a finally) for serializing any per-resource read-modify-write cycle — reusable beyond proxy configuration wherever two requests could race on the same on-disk resource."
requirements-completed: [PRXY-04, PRXY-05]
coverage:
  - id: D1
    description: "removeServiceProxyEnv clears VIRTUAL_HOST/VIRTUAL_PORT/LETSENCRYPT_HOST (no-op when absent) and removes only the docktor_proxy network entry, preserving other services and the top-level networks.docktor_proxy declaration"
    requirement: "PRXY-04"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/compose-proxy-editor.test.ts — removeServiceProxyEnv describe block (7 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ProxyService.removeDomain deletes the row, re-renders the remaining comma-joined domain set (or clears proxy env when none remain), redeploys, and 404s with no compose write on a repeat call for the same id"
    requirement: "PRXY-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — ProxyService.removeDomain describe block (4 tests)"
        status: pass
      - kind: integration
        ref: "server/test/integration/proxy.test.ts — DELETE /api/proxy-configs/:proxyConfigId (204 then 404) — written, NOT executed this session (see Issues Encountered)"
        status: unknown
    human_judgment: true
    rationale: "Same environmental DB-unreachable restriction documented in 06-01-SUMMARY.md (testcontainers Postgres reachable via docker ps but P1001 on the wire-protocol handshake) — reconfirmed this session. A developer on an unrestricted host must run the integration suite to close this out."
  - id: D3
    description: "assignDomain adopts hand-written VIRTUAL_HOST domains with no matching ProxyConfig row, inheriting the file's VIRTUAL_PORT/LETSENCRYPT_HOST membership, and skips (with a warning) an adopted domain that collides with a row owned by another service"
    requirement: "PRXY-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — ProxyService.assignDomain — adoption of hand-written domains (2 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Re-assigning a domain the same (stackId, serviceName) pair already owns updates internalPort/tlsEnabled in place (repointing sibling rows on a port change), never creates a duplicate row, never raises ConflictError; a domain owned by a different service still raises ConflictError; a new domain with a conflicting port still raises BadRequestError"
    requirement: "PRXY-05"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — ProxyService.assignDomain — idempotent re-assign describe block (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "withKeyedLock serializes same-key async work (proven by marker ordering, not timing), lets different keys overlap, and releases the lock for the next same-key caller even when fn rejects"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/keyed-mutex.test.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Five concurrent assignDomain calls against one service end with all five domains in the single VIRTUAL_HOST value and five ProxyConfig rows; a concurrent assignDomain + removeDomain against the same stack ends with the compose file's domain set equal to the final DB row set — and the underlying withKeyedLock serialization was empirically proven necessary, not just plausible"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — held-out backstop describe block (2 tests)"
        status: pass
      - kind: other
        ref: "manual diagnostic run with withKeyedLock temporarily bypassed — see 'RED Verification' section below"
        status: pass
    human_judgment: false
duration: ~65min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 02: Remove, Adopt, Idempotent Re-assign and Serialize Summary

**Expanded the assign-domain tracer into the full per-service proxy lifecycle — remove, hand-written-domain adoption, idempotent re-assign, and a new dependency-free keyed-mutex primitive serializing every compose read-modify-write per stack id — with the concurrency backstop's necessity empirically confirmed by a manual race reproduction, not just asserted.**

## Performance
- **Duration:** ~65min (approximate — no explicit start timestamp captured; based on git commit timestamps 08:45–08:46 CEST and prior session-read activity)
- **Started:** ~2026-09-04T05:41:00Z (approx.)
- **Completed:** 2026-09-04T06:46:28Z
- **Tasks:** 2/2
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- `removeServiceProxyEnv` in `compose-proxy-editor.ts` now removes the `docktor_proxy` entry from a service's `networks` list (preserving every other entry's order, deleting the `networks`/`environment` keys entirely once empty) on top of clearing the proxy env vars — and every deletion is a true no-op when the underlying key/block is already absent (fixed a real bug where `deleteIn` threw on a missing `environment` block).
- `ProxyService.removeDomain(proxyConfigId)`: deletes the row, re-renders the service's remaining domain set (or clears proxy routing entirely when none remain) through the same single `syncServiceComposeProxy` choke point `assignDomain` now also uses, and redeploys. A repeat call for the same id 404s before touching the compose file.
- `ProxyService.assignDomain` adopts domains a user hand-wrote into a service's `VIRTUAL_HOST` before Docktor managed it, and gained an idempotent branch: re-assigning a domain the same service already owns updates the existing row in place (repointing sibling rows on a port change) instead of erroring or duplicating — while a domain owned by a *different* service still 409s.
- New `server/src/lib/keyed-mutex.ts`: `withKeyedLock`, a ~40-line, import-free per-key async serialization primitive. `assignDomain` and `removeDomain` now wrap their entire body in `withKeyedLock(stackId, ...)`, so two requests against the same stack's compose file can never interleave (T-06-09).
- Live `DELETE /api/proxy-configs/:proxyConfigId` handler replaces the 501 stub — delegates to `proxyService.removeDomain`, returns 204.
- Full RED→GREEN TDD cycle for both tasks: 35 new/changed unit tests, all initially observed failing against the pre-existing implementation (compose-editor's old `removeServiceProxyEnv`, and `ProxyService`'s missing `removeDomain`/adoption/idempotency/lock), then implemented until green.

## RED Verification (T-06-09 concurrency backstop)

Per the plan's explicit requirement, the held-out concurrency test's necessity was verified directly rather than assumed. The straightforward "five concurrent assigns via `Promise.all`" test (kept in the suite) turned out to **pass even with `withKeyedLock` bypassed** in this specific fake-filesystem setup — because `assignDomain`'s render step always re-queries the full row set fresh from the (synchronous, microtask-only) fake repository right before the artificially-delayed file read, and Node drains the entire microtask queue (including all five calls' DB creates and renders) before any `setImmediate`-delayed read resolves. That test alone would have "proven nothing," exactly the failure mode the plan warns about.

To get a real, deterministic reproduction, a temporary diagnostic test manually orchestrated two `assignDomain` calls (`a.example.com`, `b.example.com`) against a gated fake filesystem, controlling exactly when each call's compose read resolved:
1. Call A ran to the point of rendering with only its own row (`a.example.com`), then blocked on its compose read.
2. Call B started, created its own row, rendered seeing **both** rows (`a.example.com`, `b.example.com`), then blocked on its compose read.
3. B's read was released first — its write landed, `VIRTUAL_HOST` became `a.example.com,b.example.com`.
4. A's read was released last — its **stale** single-row render then overwrote the file, leaving `VIRTUAL_HOST: a.example.com` only.

**Observed failure with `withKeyedLock` bypassed:** the database ended up with both `ProxyConfig` rows (`a.example.com`, `b.example.com`), but the compose file's `VIRTUAL_HOST` contained only `a.example.com` — **`b.example.com`'s row silently claimed a domain the compose file no longer routed**, exactly the DB/file inconsistency T-06-09 exists to prevent.

`withKeyedLock` was then restored, the diagnostic test removed from the permanent suite (its manual gate-release orchestration is incompatible with the locked implementation's true serialization — released gates would never appear two-at-a-time once the lock is in place, so the script isn't meaningful to keep running), and the full unit suite (547 tests, 36 files) re-run green, including the kept `Promise.all`-based five-domain and assign/remove-race tests.

## Task Commits
1. **RED — failing tests for domain removal, adoption, idempotent re-assign, keyed-mutex** - `ec08815` (test)
2. **GREEN — implement domain removal, adoption, idempotent re-assign, keyed serialization** - `3ea4f72` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `server/src/lib/keyed-mutex.ts` - new `withKeyedLock` per-key async serialization primitive
- `server/src/lib/compose-proxy-editor.ts` - `removeServiceProxyEnv` now clears the network entry and empty blocks, hasIn-guarded deletions
- `server/src/application/proxy-service.ts` - `removeDomain`, `adoptUnmanagedDomains`, idempotent `assignDomain`, `renderProxyEnvForService`/`syncServiceComposeProxy`, both public methods wrapped in `withKeyedLock`
- `server/src/routes/proxy.ts` - live DELETE handler (204), 501 stub removed
- `server/test/unit/lib/compose-proxy-editor.test.ts` - 7 new `removeServiceProxyEnv` tests
- `server/test/unit/lib/keyed-mutex.test.ts` - new file, 5 tests
- `server/test/unit/application/proxy-service.test.ts` - new file, 13 tests
- `server/test/integration/proxy.test.ts` - DELETE 204-then-404 test added

## Decisions Made
- **[Rule 1 - bug]** `removeServiceProxyEnv`'s unconditional `deleteIn` calls threw `Error: Expected YAML collection at environment. Remaining path: VIRTUAL_HOST` when a service had no `environment` block at all (not just a missing individual key) — this directly contradicted the plan's required "no-op for any of them that is already absent" behavior and was caught by the RED run, not assumed. Fixed with a `hasIn`-guarded `deleteEnvKeyIfPresent` helper. Verified: `server/test/unit/lib/compose-proxy-editor.test.ts`'s "is a no-op when the env keys are already absent" test. Commit `3ea4f72`.
- **[Rule 2 - quality]** `removeServiceProxyEnv` also deletes the service's `environment` key entirely once empty, mirroring the existing `networks` cleanup — not explicitly listed in the plan's `<behavior>` bullets, but consistent with the plan's own networks-cleanup requirement and prevents a stray `environment: {}` from appearing in a file a user will read. Verified: the "leaves a second service... intact" exact-byte-match test. Commit `3ea4f72`.
- Both public `ProxyService` methods wrap their **entire** body (including the pre-existing stack/proxy-stack-deployed guards) inside `withKeyedLock`, per the plan's literal "wrap the whole body" instruction — not just the compose-write tail.
- The idempotent-domain branch queries `findByStackAndService` once, after adoption, and reuses that same result set for both the idempotency check and the port-conflict check, so an adopted domain that happens to match the requested domain is picked up by the idempotent branch transparently on the same call (no second query needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `removeServiceProxyEnv` throwing on a service with no `environment` block**
- **Found during:** Task 1, initial RED test run (`is a no-op when the env keys are already absent`)
- **Issue:** `doc.deleteIn(["services", serviceName, "environment", "VIRTUAL_HOST"])` throws `Expected YAML collection at environment` when the `environment` map itself doesn't exist yet — `deleteIn` requires every intermediate path segment to already be a collection, unlike a plain "delete if present" semantic.
- **Fix:** Added a `hasIn`-guarded `deleteEnvKeyIfPresent` helper; every env-key deletion now checks existence first.
- **Files modified:** `server/src/lib/compose-proxy-editor.ts`
- **Verification:** `server/test/unit/lib/compose-proxy-editor.test.ts` — 17/17 pass.
- **Commit:** `3ea4f72`

**2. [Rule 2 - Missing quality/consistency] `removeServiceProxyEnv` also deletes an emptied `environment` key**
- **Found during:** Task 1, RED test run (`leaves a second service's VIRTUAL_HOST... intact`) — the exact-byte-match assertion failed because a bare `environment: {}` was left behind.
- **Issue:** The plan's `<behavior>` bullets specify deleting the `networks` key when it becomes empty but don't explicitly say the same for `environment`; leaving `environment: {}` in the file is inconsistent with that already-specified cleanup and with keeping the file tidy for a value the user will read.
- **Fix:** Delete the `environment` key when it has zero remaining items, using the same pattern as the `networks` cleanup.
- **Files modified:** `server/src/lib/compose-proxy-editor.ts`
- **Verification:** exact-byte-match unit test, `tsc --noEmit` clean.
- **Commit:** `3ea4f72`

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 2 quality/consistency). **Impact:** both are additive correctness fixes scoped entirely to `removeServiceProxyEnv`, caught by the plan's own TDD RED step rather than discovered later; no behavior outside this function changed.

## Issues Encountered

**Environmental: this sandboxed session still cannot reach any Postgres instance over a Docker-published port — same restriction documented for 06-01 and multiple prior plans (05.1-01/05.1-05/05.1-06).**

Reconfirmed this session: `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` fails all 8 tests (all skipped, suite errors) with `startContainer(): prisma db push failed ... P1001: Can't reach database server at localhost:<port>`, despite `docker ps` showing multiple healthy `postgres:17` containers with published ports (the raw TCP handshake succeeds but Prisma's wire-protocol handshake never completes — the same failure signature as every prior occurrence of this restriction). This affects only the integration suite; **all 547 unit tests pass (36 files, 0 regressions)**, including this plan's 35 new/changed tests.

**What this means for this plan's verification items:**
- `server/test/integration/proxy.test.ts`'s new DELETE 204-then-404 test (and the full 8-test file) is written and reviewed for correctness but **not executed** in this session. A developer on an unrestricted host must run `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` to confirm it passes.
- This is a continuation of the SAME environmental gap 06-01-SUMMARY.md documented — it does not compound (the schema itself was not touched by this plan), but the DB-verification steps 06-01 named (live `prisma db push` + column-catalogue check) still have not been run by a human, and now the integration suite has one more test waiting on the same unblock.

## User Setup Required
None — no external service configuration required. A developer on an unrestricted host should complete both 06-01's outstanding DB-verification steps and this plan's integration test run together, since they share the same root cause.

## Next Phase Readiness
06-03 (the proxy stack itself — deployProxyStack, Settings, First-Run Wizard step) can build directly on this plan's `ProxyService` structure: `syncServiceComposeProxy`/`renderProxyEnvForService` are the single choke point any future proxy-config mutation should route through, and `withKeyedLock` is available as a reusable per-resource serialization primitive beyond just proxy configuration. `PROXY_STACK_ID` (from 06-01) is still the fixed id 06-03's `deployProxyStack()` is expected to create a `Stack` row for.

## Self-Check: PASSED

- FOUND: `server/src/lib/keyed-mutex.ts`
- FOUND: `server/test/unit/lib/keyed-mutex.test.ts`
- FOUND: `server/test/unit/application/proxy-service.test.ts`
- FOUND: `server/src/lib/compose-proxy-editor.ts` (modified)
- FOUND: `server/src/application/proxy-service.ts` (modified)
- FOUND: `server/src/routes/proxy.ts` (modified)
- FOUND: `server/test/integration/proxy.test.ts` (modified)
- FOUND commit `ec08815` in `git log --oneline --all`
- FOUND commit `3ea4f72` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
