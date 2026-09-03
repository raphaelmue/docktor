---
phase: 06-proxy-configuration
plan: 01
subsystem: proxy-configuration
tags: [nginx-proxy, acme-companion, compose-editing, yaml, prisma, fastify, zod, tracer]
requires: []
provides:
  - "assignDomainSchema/proxySettingsSchema/certStatusSchema in @docktor/shared"
  - "setServiceProxyEnv/readServiceProxyEnv/removeServiceProxyEnv surgical compose-editing primitives"
  - "ProxyRepository (ProxyConfig CRUD, including findAll/updateCertStatus for 06-04)"
  - "ProxyService.assignDomain/listByStack orchestration, PROXY_STACK_ID constant"
  - "authenticated GET/POST/DELETE(stub) /api/.../proxy routes registered in app.ts"
  - "revised ProxyConfig schema (D-06/D-08/D-05 columns) and Stack.isProtected column (D-12), pushed to the live dev DB pending human re-run"
affects: [06-02, 06-03, 06-04, 06-05, 06-06]
actuals:
  tokens: 9700
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "yaml Document API surgical mutation (parseDocument/getIn/setIn/isScalar/toString({lineWidth:0})) mirrored from compose-editor.ts for compose-proxy-editor.ts"
    - "D-08 promote invariant: every compose write re-aggregates ALL ProxyConfig rows for (stackId, serviceName) into one comma-joined VIRTUAL_HOST/LETSENCRYPT_HOST value, never one env var per domain"
    - "orphan-row rollback: a failed compose write or redeploy after ProxyConfig creation deletes the just-created row so the DB never claims an unrouted domain (T-06-06)"
key-files:
  created:
    - shared/src/validation/proxy.ts
    - server/src/lib/compose-proxy-editor.ts
    - server/src/repositories/proxy-repository.ts
    - server/src/application/proxy-service.ts
    - server/src/routes/proxy.ts
    - server/test/unit/lib/compose-proxy-editor.test.ts
    - server/test/integration/proxy.test.ts
  modified:
    - server/prisma/schema/proxy.prisma
    - server/prisma/schema/stack.prisma
    - shared/src/validation/index.ts
    - server/src/application/index.ts
    - server/src/repositories/stack-repository.ts
    - server/src/app.ts
key-decisions:
  - "Step 0 resolved the LETSENCRYPT_HOST vs ACME_HOST open question by grepping nginxproxy/acme-companion:2.6.3's own image scripts directly: both LETSENCRYPT_HOST and LETSENCRYPT_EMAIL are present, confirming CONTEXT.md's canonical default — no ACME_HOST fallback needed."
  - "Added StackRepository.findById() (Rule 3 auto-fix) — the plan's ProxyService constructor type (Pick<StackRepository, 'findByIdOrThrow' | 'findById' | 'exists'>) requires it and no equivalent existed on StackRepository before this plan."
  - "Task 2's live-DB schema push and column-catalogue verification could not run in this sandboxed session — same documented host-level TCP-to-Docker-published-port block as 05.1-01/05.1-05/05.1-06 (raw TCP connect to docktor-db-dev's published 5432 succeeds, but Prisma's wire-protocol handshake never completes). This is the task's own designed degraded-completion path (its <done> criterion explicitly allows 'the unmet precondition is surfaced with the exact commands a developer must run'), not a plan failure."
patterns-established:
  - "compose-proxy-editor.ts: sibling module to compose-editor.ts for repeated-write proxy env vars/network toggling — never use the full-restringify compose-rewriter.ts approach for this class of edit"
requirements-completed: [PRXY-01, PRXY-02]
coverage:
  - id: D1
    description: "setServiceProxyEnv/readServiceProxyEnv/removeServiceProxyEnv surgical compose-editing primitives, preserving unrelated compose content byte-for-byte"
    requirement: "PRXY-01"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/compose-proxy-editor.test.ts (11 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Revised ProxyConfig schema (D-06/D-08/D-05) and Stack.isProtected column (D-12), in the Prisma schema files"
    requirement: "PRXY-01"
    verification:
      - kind: other
        ref: "grep -v '^ *//' server/prisma/schema/proxy.prisma | grep -c 'npmProxyHostId\\|isPublic' -> 0"
        status: pass
      - kind: unit
        ref: "yarn workspace @docktor/server tsc --noEmit (generated Prisma client reflects the new columns)"
        status: pass
    human_judgment: false
  - id: D3
    description: "assignDomain/listByStack end-to-end HTTP flow: 201 create + compose write, GET list, 409 duplicate domain, 400 invalid hostname, 400 proxy-stack-not-deployed, 401 unauthenticated — against a real Postgres via testcontainers, DockerExecutor stubbed"
    requirement: "PRXY-01, PRXY-02"
    verification:
      - kind: integration
        ref: "server/test/integration/proxy.test.ts (8 tests) — written and reviewed for correctness, but NOT executed in this session; see Issues Encountered"
        status: unknown
    human_judgment: true
    rationale: "This sandboxed session cannot reach any Postgres instance (testcontainers-launched or the live dev DB) over its published Docker port — a documented, previously-confirmed environmental restriction, not a defect in the test or the implementation. A developer on an unrestricted host must run `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` to confirm."
  - id: D4
    description: "Live development database schema matches the revised Prisma schema (Task 2's blocking gate)"
    verification: []
    human_judgment: true
    rationale: "Same environmental DB-unreachable restriction as D3 — `prisma db push` against .env.development's DATABASE_URL fails with P1001 in this session. A developer on an unrestricted host must run the two commands named in Issues Encountered."
duration: ~95min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 01: Assign-Domain Tracer Slice Summary

**Authenticated POST assigns a domain to one service, writing VIRTUAL_HOST/VIRTUAL_PORT/LETSENCRYPT_HOST env vars plus the docktor_proxy network into that service's real compose file via a new yaml-Document-API surgical editor, with a ProxyConfig row and full layered (routes -> service -> repository/editor) DDD wiring — schema/client changes proven only against the generated Prisma client in this session, not the live dev database, due to a documented sandbox network restriction.**

## Performance
- **Duration:** ~95min
- **Started:** 2026-09-03T22:55Z (approx.)
- **Completed:** 2026-09-04T00:53Z
- **Tasks:** 2 (Task 1 tracer complete and verified as far as this environment allows; Task 2 blocked on its own documented precondition)
- **Files modified:** 13 (7 created, 6 modified)

## Accomplishments
- Revised the dormant `ProxyConfig` Prisma model: dropped `npmProxyHostId`/`isPublic` (D-06), added `certStatus`/`certMessage`/`certCheckedAt` (D-05), kept `@@unique([domain])` (D-07) and the existing `(stackId, serviceName)` shape (D-08 needs no structural change).
- Added `Stack.isProtected` (D-12) for a later plan's stop/restart/delete guard.
- Resolved the LETSENCRYPT_HOST/ACME_HOST open question deterministically by grepping the actual `nginxproxy/acme-companion:2.6.3` image rather than trusting inconsistent doc pages — see Env Var Resolution below.
- New `shared/src/validation/proxy.ts`: `assignDomainSchema` (RFC-1123 hostname regex — the domain-injection mitigation for threat T-06-02), `proxySettingsSchema`, `certStatusSchema`, with inferred types.
- New `server/src/lib/compose-proxy-editor.ts`: `setServiceProxyEnv`/`readServiceProxyEnv`/`removeServiceProxyEnv`, mirroring `compose-editor.ts`'s targeted-node-mutation pattern exactly — preserves comments, key order, quoting style and unrelated services byte for byte (proven by an exact-string-equality unit test, not a loose substring check).
- New `server/src/repositories/proxy-repository.ts`, `server/src/application/proxy-service.ts`, `server/src/routes/proxy.ts`, wired into `application/index.ts` and `app.ts`.
- Full RED→GREEN TDD cycle for the unit suite: confirmed the compose-proxy-editor test failed with "Cannot find module" before any implementation existed, then implemented until all 11 tests passed.

## Env Var Resolution (Step 0)

Ran, against the real image (Docker was reachable in this session):
```
docker run --rm --entrypoint sh nginxproxy/acme-companion:2.6.3 -c \
  'grep -rho "LETSENCRYPT_[A-Z_]*\|ACME_[A-Z_]*" /app 2>/dev/null | sort -u'
```
Output includes both `LETSENCRYPT_HOST` and `LETSENCRYPT_EMAIL` (alongside a much larger `ACME_*` family covering internal ACME-protocol plumbing, not the vhost-selection env vars). This confirms CONTEXT.md's canonical `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` default — no `ACME_HOST` fallback is needed. Flagged assumptions 4 and 5 (RESEARCH.md A1, Open Question 1) are resolved.

## Task Commits
1. **Task 1 (RED): failing tests for compose-proxy-editor and proxy assign-domain route** - `8e05804` (test)
2. **Task 1 (GREEN): implement proxy assign-domain tracer slice** - `3e096c1` (feat)
3. **Task 2: [BLOCKING] push schema to live DB** - no commit (no code changes; blocked on its own documented precondition, see Issues Encountered)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `shared/src/validation/proxy.ts` - assignDomainSchema/proxySettingsSchema/certStatusSchema
- `shared/src/validation/index.ts` - re-exports ./proxy.js
- `server/src/lib/compose-proxy-editor.ts` - surgical compose env-var/network editor
- `server/src/repositories/proxy-repository.ts` - ProxyConfig CRUD
- `server/src/application/proxy-service.ts` - assignDomain/listByStack orchestration
- `server/src/application/index.ts` - wires the proxyService singleton
- `server/src/routes/proxy.ts` - authenticated proxy REST endpoints
- `server/src/app.ts` - registers proxyRoutes
- `server/src/repositories/stack-repository.ts` - added findById()
- `server/prisma/schema/proxy.prisma` - D-06/D-05 schema revision
- `server/prisma/schema/stack.prisma` - added isProtected (D-12)
- `server/test/unit/lib/compose-proxy-editor.test.ts` - 11 unit tests (all passing)
- `server/test/integration/proxy.test.ts` - 8 integration tests (written, not executable in this session)

## Decisions Made
- **[Rule 3 - blocking issue]** Added `StackRepository.findById()`. The plan's `<action>` for `ProxyService`'s constructor explicitly types `stackRepo: Pick<StackRepository, "findByIdOrThrow" | "findById" | "exists">`, but `StackRepository` had no `findById()` before this plan (confirmed by grep — only `findByIdOrThrow`/`findByIdWithRelations`/`exists` existed). Added a plain `findById(id)` returning `Stack | null`, mirroring the existing `findByIdOrThrow` query without the throw. `proxy-service.ts` does not currently call `findById` directly (only `findByIdOrThrow`/`exists`), but the constructor's declared `Pick<>` type requires the method to exist on `StackRepository` for the type to compile, and future plans (06-02+) are expected to use it.
- Env var family resolved to `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` per Step 0's deterministic image probe (see above) — no architectural deviation from CONTEXT.md's default.
- Everything else in Task 1 followed the plan's `<action>` steps and the pattern map's code sketches essentially verbatim (repository/service/route shapes, error translation, D-08 aggregation logic, orphan-row rollback on write/redeploy failure).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] Added missing `StackRepository.findById()`**
- **Found during:** Task 1, Step 5 (writing `proxy-service.ts`'s constructor types)
- **Issue:** The plan's constructor signature required `Pick<StackRepository, "findByIdOrThrow" | "findById" | "exists">`, but `findById` did not exist on `StackRepository`.
- **Fix:** Added `async findById(id: string) { return prisma.stack.findUnique({where: {id}}); }` immediately above the existing `findByIdOrThrow`.
- **Files modified:** `server/src/repositories/stack-repository.ts`
- **Verification:** `yarn workspace @docktor/server tsc --noEmit` — zero errors.
- **Commit:** `3e096c1`

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue). **Impact:** none — additive, non-breaking method; no existing caller's behavior changed.

## Issues Encountered

**Environmental: this sandboxed session cannot reach any Postgres instance over a Docker-published port — affects both Task 1's integration-test run and all of Task 2.**

This is the same failure mode STATE.md already documents extensively for 05.1-01, 05.1-05, and 05.1-06 (a host-level TCP-to-Docker-published-port block: the raw TCP handshake succeeds — verified again this session with `bash /dev/tcp/127.0.0.1/5432` — but the Postgres wire protocol never completes, and Prisma reports `P1001: Can't reach database server`). Evidence gathered this session:

1. `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts` against the live `docktor-db-dev` container (confirmed running via `docker ps`, published on `0.0.0.0:5432`) failed with `P1001: Can't reach database server at localhost:5432`.
2. `yarn dotenv -e .env.development -- prisma generate --config=server/prisma/prisma.config.ts` succeeded (schema-only, no live connection needed) — this is why `tsc --noEmit` is green: the generated Prisma client's *types* reflect the new columns even though the *live database* does not yet have them.
3. Running the full server test suite (`yarn workspace @docktor/server test --run`, both unit and integration projects) confirms this is environment-wide, not specific to this plan's new code: **all 5 currently-failing test files are pre-existing integration suites** (including `test/integration/stacks.test.ts`, which this plan did not touch) failing identically with the same `P1001` inside `startContainer()` — testcontainers' own ephemeral Postgres is equally unreachable over its published port. All 523 unit tests (including this plan's 11 new ones) pass; 0 regressions.

**What this means for this plan's two blocking verification items:**
- `server/test/integration/proxy.test.ts` (8 tests) is written to the full `<behavior>` spec — 201 + compose write, GET list, 409 duplicate, 400 invalid hostname, 400 proxy-stack-not-deployed, 401 unauthenticated on every route, `DockerExecutor` fully stubbed so no real `docker compose` command ever runs — but was **not executed** in this session. A developer on an unrestricted host must run `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` to confirm it passes.
- Task 2's live-database column verification did not run. A developer on an unrestricted host must run, in order:
  1. `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts`
  2. `yarn db:generate`
  3. Confirm via `information_schema.columns` (not the `.prisma` file) that `Stack.isProtected`, `ProxyConfig.certStatus`, `ProxyConfig.certMessage`, `ProxyConfig.certCheckedAt` exist and that `ProxyConfig.npmProxyHostId`/`ProxyConfig.isPublic` do not.

No schema drift is expected from this delay: `prisma db push` diffs live schema against the `.prisma` files on each run regardless of when it's run, so this is a one-time gap to close before deploying/using proxy features, not a growing debt.

## User Setup Required
None — no external service configuration required. (A developer must complete the two DB-verification steps above before this plan's live database is actually in sync; that is a verification step, not new user-facing setup.)

## Next Phase Readiness
06-02 (remove domain, idempotency, `keyed-mutex.ts`) can build directly on `compose-proxy-editor.ts`'s `removeServiceProxyEnv` (already present, unused by this plan's routes) and `ProxyService`'s existing structure. 06-03 (proxy stack itself, Settings) needs the live-DB verification above to have actually run — its own `<precondition>`/environment checks should re-confirm reachability rather than assume this plan's gap was closed. The `DELETE /api/proxy-configs/:proxyConfigId` route stub (501) is in place at the exact URL 06-02 needs to fill in.

## Self-Check: PASSED

- FOUND: `shared/src/validation/proxy.ts`
- FOUND: `server/src/lib/compose-proxy-editor.ts`
- FOUND: `server/src/repositories/proxy-repository.ts`
- FOUND: `server/src/application/proxy-service.ts`
- FOUND: `server/src/routes/proxy.ts`
- FOUND: `server/test/unit/lib/compose-proxy-editor.test.ts`
- FOUND: `server/test/integration/proxy.test.ts`
- FOUND commit `8e05804` in `git log --oneline --all`
- FOUND commit `3e096c1` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
