---
phase: 02-observability
plan: 10
subsystem: infra
tags: [docker, registry, update-checker, semver, tag-listing]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "UpdateChecker.checkImage() digest comparison, splitImageRef()/buildImageRefFromService() (02-09)"
provides:
  - "RegistryClient.listTags() — Registry v2 tag listing with WWW-Authenticate bearer-token negotiation for Docker Hub, ghcr.io, and generic v2 registries"
  - "selectUpgradeCandidates()/selectLatestTag() — pure tag-ranking functions reused by checkImage()"
  - "availableTags persistence on ImageUpdateCheck, decoded by GET /api/stacks/:id/services/:serviceName/tags"
  - "The previously-dead latestTag/semver comparison branch in checkImage() is now reachable in production"
affects: ["02-12 (version-selection dialog consumes GET /api/stacks/:id/services/:serviceName/tags)"]

# Actuals (#2632)
actuals:
  tokens: 9422
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RegistryClient duplicates a small local tag-stripping helper instead of importing splitImageRef from jobs/update-checker.ts, avoiding a circular module dependency between the two files' bottom-of-file singletons (registryClient / updateChecker)"
    - "checkImage() wraps the registry call in a locally-scoped try/catch so a RegistryUnavailableError never discards the already-computed digest verdict — only the outer manifestInspect failure path aborts the whole check"

key-files:
  created:
    - server/src/infrastructure/registry-client.ts
    - server/test/unit/infrastructure/registry-client.test.ts
  modified:
    - server/prisma/schema/image-update-check.prisma
    - server/src/repositories/image-update-check-repository.ts
    - server/src/jobs/update-checker.ts
    - server/src/routes/stacks.ts
    - server/test/unit/jobs/update-checker.test.ts
    - shared/src/validation/stacks.ts

key-decisions:
  - "RegistryClient derives host/repository from a locally-duplicated tag-stripping helper rather than importing splitImageRef from jobs/update-checker.ts — the plan's action text called for reuse, but jobs/update-checker.ts already needs a value import of registryClient (for the constructor default) and registry-client.ts importing splitImageRef back would create a circular module dependency between two files that both instantiate a singleton at the foot of the file (`export const x = new X()`); depending on which module a caller imports first, the singleton not yet reached in the still-evaluating module hits the const TDZ and crashes. Duplicating ~5 lines of the same disambiguation logic (with a comment explaining why) avoids the fragile cycle entirely"
  - "db push could not be applied to a live database in this execution environment — see Deviations. Schema change and `prisma generate` were completed; the actual migration must be applied via `yarn db:push` before deploying"
  - "checkImage() locally catches RegistryUnavailableError around only the listTags() call (not the whole try body) so a registry failure records a checkError without discarding the digest verdict already computed from manifestInspect + imageDigest — matches the plan's explicit prohibition against a registry failure clobbering the digest branch"

patterns-established:
  - "Constructor DI for a new external adapter follows the existing docker/broadcaster convention exactly: an optional Pick<T, methods> parameter defaulting to the production singleton, injectable in tests"

requirements-completed: [UPD-01, UPD-03]

coverage:
  - id: D1
    description: "listTags() lists tags over the Registry v2 API for Docker Hub (with library/ prefix), ghcr.io, and a generic v2 registry with a port, through one WWW-Authenticate-driven token-negotiation code path"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/infrastructure/registry-client.test.ts#listTags() (UPD-01) — Docker Hub / ghcr.io / port-qualified host cases, plus the bearer-token challenge/retry case"
        status: pass
    human_judgment: false
  - id: D2
    description: "A retried 401 or a 429 throws RegistryUnavailableError naming the image reference; a 404 or an unparsable body returns null without throwing"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/infrastructure/registry-client.test.ts#listTags() (UPD-01) — 401-then-401, 429, 404, non-JSON body, and missing-tags-array cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "selectUpgradeCandidates()/selectLatestTag() rank only shape-compatible, genuinely-newer candidate tags newest-first, dropping moving tags and non-version tags, so a service on 1.25 is never told to upgrade to a non-version tag"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#selectUpgradeCandidates() (UPD-01) and #selectLatestTag() (UPD-01) — semver, date-tag, empty-result, and moving-currentTag cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "checkImage() feeds a real latestTag into the previously-unreachable `if (latestTag && tag !== 'latest')` branch: a genuinely newer tag sets hasUpdate=true and publishes update_available; no newer tag leaves latestTag null and falls back to the digest verdict"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() tag-based upgrade detection (UPD-01) — newer-tag and nothing-newer cases"
        status: pass
    human_judgment: false
  - id: D5
    description: "A RegistryUnavailableError from listTags() is recorded as checkError without discarding the digest verdict, and the cron tick completes normally without throwing out"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() tag-based upgrade detection (UPD-01) — 'records a checkError...' and 'does not abort the cron tick...' cases"
        status: pass
    human_judgment: false
  - id: D6
    description: "The tag fetch runs strictly inside the existing staggered checkImage() — never per page load and never for every image in checkNextImage() — and repeated checks against unchanged registry state persist the same candidate list under the same imageRef key"
    requirement: "UPD-02 (referenced by this plan's must_haves, not in this plan's own requirements list)"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() tag-based upgrade detection (UPD-01) — 'persists the same candidate list...' and 'does not call listTags for a service on a moving tag' cases; grep acceptance criterion confirms no listTags call site in routes/"
        status: pass
    human_judgment: false
  - id: D7
    description: "GET /api/stacks/:id/services/:serviceName/tags returns the persisted candidates newest-first (empty array when nothing is known yet), resolves the service from the addressed stack's own service list only, and never calls the registry"
    requirement: "UPD-03"
    verification:
      - kind: unit
        ref: "server/test/unit/*.test.ts full suite (333 tests) + build pass after the stacks.ts route change — no dedicated route-level unit test exists for this handler in this codebase (matches the precedent set by 02-09's badge-lookup fix, which had the same gap)"
        status: pass
      - kind: other
        ref: "Manual trace: buildImageRefFromService(svc.image, svc.imageTag) reconstructs the same key checkImage() persists; stack.services.find() scopes resolution to the addressed stack only, so a serviceName from a different stack falls through to NotFoundError; grep confirms no registryClient/listTags reference in routes/stacks.ts"
        status: pass
    human_judgment: true
    rationale: "No existing unit test harness covers Fastify route handlers directly in this codebase (no route test file for stacks.ts exists for any endpoint, including the ones 02-09 fixed). Correctness of the 404 scoping and the empty-candidate-array default was verified by manual trace and grep, not by an integration test exercising a real HTTP request."
  - id: D8
    description: "availableTags is persisted as a JSON-encoded array on the ImageUpdateCheck row, threaded through the repository's upsert, ready for the version-selection UI in plan 02-12"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() tag-based upgrade detection (UPD-01) — availableTags assertions in the newer-tag and nothing-newer cases"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 10: Registry Tag Listing + Upgrade-Candidate Persistence Summary

**Added a RegistryClient with Registry v2 tag listing and bearer-token negotiation, wired it into UpdateChecker so the previously-dead `latestTag`/semver comparison branch finally executes in production, and exposed the persisted upgrade candidates through a new stack-scoped route.**

## Performance

- **Duration:** ~25 min (includes ~15 min investigating a sandbox networking limitation that blocked `prisma db push` — see Deviations)
- **Started:** 2026-08-28T11:58:00Z (approx.)
- **Completed:** 2026-08-28T12:23:00Z
- **Tasks:** 3
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- `RegistryClient.listTags()` lists tags over the standard Registry v2 API for Docker Hub, ghcr.io, and generic v2 registries with a port, correctly deriving host and repository path in each case (including the `library/` prefix for unqualified Docker Hub names)
- Implements the standard WWW-Authenticate bearer-token challenge: parses `realm`/`service`/`scope`, fetches a token, retries once, and throws `RegistryUnavailableError` on a repeated 401 or a 429 rather than looping — all requests are HTTPS-only, redirect-refusing, 15s-timeout-bounded, and cap the response body at ~2MB
- `selectUpgradeCandidates()`/`selectLatestTag()` filter candidate tags to the same "shape" as the current tag (all dates or all semver-coercible), keep only genuinely newer ones, and rank them descending — reusing `compareVersions()`/`parseDateTag()` so the established date-precedes-semver rule keeps holding
- `checkImage()` now calls `listTags()` inside the existing 6-hour staggered check (never per request, never for every image in `checkNextImage()`), feeding a real `latestTag` into the `if (latestTag && tag !== "latest")` branch that has been structurally present but unreachable since plan 02-04 (manifestInspect always returns `latestTag: null`)
- A `RegistryUnavailableError` from `listTags()` is caught locally around just that call, recording a `checkError` without discarding the digest-based verdict already computed — the cron tick always completes normally
- `availableTags` (JSON-encoded) persists on `ImageUpdateCheck`, and `GET /api/stacks/:id/services/:serviceName/tags` serves it — scoped to the addressed stack's own service list (never a global lookup), reading only what the background check already persisted, with an empty-array/null-latestTag default for a not-yet-checked image rather than an error

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end tag listing for one Docker Hub image over the Registry v2 API** - `6ff7a64` (feat)
2. **Task 2: Select upgrade candidates and make the latestTag comparison path live** - `63d5d77` (feat)
3. **Task 3: Serve persisted upgrade candidates for a service** - `e67c011` (feat)

**Plan metadata:** committed separately by orchestrator (STATE.md/ROADMAP.md not touched by this executor)

## Files Created/Modified
- `server/src/infrastructure/registry-client.ts` - New `RegistryClient` class, `RegistryUnavailableError`, `registryClient` singleton
- `server/test/unit/infrastructure/registry-client.test.ts` - 10 test cases covering every behavior bullet in Task 1
- `server/prisma/schema/image-update-check.prisma` - Added `availableTags String?` column
- `server/src/repositories/image-update-check-repository.ts` - `upsert()` threads and JSON-encodes `availableTags`
- `server/src/jobs/update-checker.ts` - Added `selectUpgradeCandidates()`/`selectLatestTag()`; `UpdateChecker` gains an injectable `registry` dependency; `checkImage()` calls `listTags()` and feeds the tag-comparison branch
- `server/test/unit/jobs/update-checker.test.ts` - 15 new test cases (2 pure-function describe blocks + 6 new `checkImage()` cases); existing tests updated with a default-null registry mock so they keep exercising the digest-only path unchanged
- `server/src/routes/stacks.ts` - New `GET /api/stacks/:id/services/:serviceName/tags` route + `decodeUpgradeCandidates()` helper
- `shared/src/validation/stacks.ts` - New `stackServiceParamsSchema`

## Decisions Made
- `RegistryClient` duplicates a small local tag-stripping helper (`stripTag`) instead of importing `splitImageRef` from `jobs/update-checker.ts`, to avoid a circular module dependency risk between the two files' bottom-of-file singleton instantiations (see key-decisions in frontmatter for the full TDZ-crash mechanism)
- `checkImage()`'s registry call is wrapped in a nested try/catch scoped to just `listTags()`, not the whole function body, so a `RegistryUnavailableError` never discards the digest verdict already computed from `manifestInspect`/`imageDigest` — this matches the plan's explicit prohibition
- The route decodes `availableTags` defensively (missing row, null column, or unparsable JSON all yield an empty array) rather than ever surfacing a 500 for a not-yet-checked image

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a circular-import risk between registry-client.ts and jobs/update-checker.ts**
- **Found during:** Task 1, while wiring `RegistryClient.listTags()` to reuse tag-splitting per the plan's action text ("call splitImageRef ... to drop the tag")
- **Issue:** The plan directs `registry-client.ts` to import `splitImageRef` from `jobs/update-checker.ts`. Since Task 2 also has `jobs/update-checker.ts` import the `registryClient` singleton value from `infrastructure/registry-client.ts` (for the constructor default), this creates a genuine circular module dependency. Both files instantiate a singleton via `export const x = new X()` at the foot of the file; depending on which module a caller imports first, the singleton in the module that hasn't finished evaluating yet is still in its `const` temporal dead zone when the other module's singleton constructor tries to read it — a `ReferenceError` at import time, not caught by any test that always imports the same module first
- **Fix:** `registry-client.ts` duplicates a small private `stripTag()` helper (same disambiguation rule: a colon followed later by a slash is a registry port, not a tag separator) instead of importing `splitImageRef`. The dependency direction is now one-way (`jobs` → `infrastructure`), matching the project's layering (infrastructure sits below jobs)
- **Files modified:** `server/src/infrastructure/registry-client.ts`
- **Verification:** `yarn workspace @docktor/server build` passes; both test files pass; manually traced both import orders (jobs-first and infrastructure-first) to confirm no remaining cross-reference at module scope
- **Committed in:** `6ff7a64` (Task 1 commit — the fix was made before Task 1's own commit, so no separate commit was needed) and `63d5d77` (Task 2, which added the corresponding one-way import in `update-checker.ts`)

---

**Total deviations:** 1 auto-fixed (1 bug — circular import risk)
**Impact on plan:** Necessary for correctness; the plan's literal instruction to import `splitImageRef` would have introduced a fragile, order-dependent runtime crash. No scope creep — the fix is a 15-line private helper in the same file the plan already scoped for Task 1.

## Issues Encountered

**`prisma db push` could not reach the dev database in this execution environment.** A fresh `docktor-db-dev` Postgres 17 container was started via `docker compose -f docker-compose.dev.yml up -d` and confirmed listening (`pg_isready` succeeded, `docker port` showed the mapping). However, both the Prisma CLI (`prisma db push`, all variants tried: `localhost`, `127.0.0.1`, with/without `dangerouslyDisableSandbox`) and a direct `pg` client connection from Node consistently failed or hung far past any reasonable timeout (`pg` gave up after 60s+; a raw Node `net.connect` eventually succeeded but only after 120+ seconds, suggesting the sandbox's network layer intercepts and proxies plain Node socket connections with high first-use latency, while Prisma's native query-engine binary bypasses that layer and gets an immediate refusal). This is an execution-environment networking limitation, not a code or schema defect.

**What was completed instead:** the schema change (`availableTags String?`) is in place and committed, and `prisma generate` (which only reads the schema files — no DB connectivity required) was run successfully, regenerating `server/src/generated/prisma` with the new column so `tsc --build` and all unit tests pass against the up-to-date types.

**What remains:** `yarn db:push` must be run against a real, reachable dev/prod database before this branch is deployed, to actually add the `availableTags` column to the live table. This is flagged below under User Setup Required.

## User Setup Required

**Database schema push required before deploy.** Run `yarn db:push` (or the project's normal `prisma db push` invocation) against a real, network-reachable PostgreSQL instance to add the `availableTags` column to the `ImageUpdateCheck` table. This could not be executed in this plan's sandboxed execution environment — see Issues Encountered. No other external service configuration is required; `RegistryClient` uses the global `fetch` and needs no credentials for public registries (anonymous bearer tokens are negotiated automatically per the WWW-Authenticate challenge).

## Next Phase Readiness
- Plan 02-12's version-selection dialog can now call `GET /api/stacks/:id/services/:serviceName/tags` to read persisted upgrade candidates — no registry traffic on page load
- The `latestTag`/semver comparison branch in `checkImage()` is live end-to-end for the first time since the phase began; UAT gap 4's last behavioral cause is closed
- Blocker: the `availableTags` column exists in `schema.prisma` and the generated Prisma Client, but has **not** been pushed to any live database in this session — `yarn db:push` must run before the next deploy or the app will boot against a table missing the column (Prisma's runtime will surface this as a query error on first `upsert` call, not a boot-time failure, since Prisma Client doesn't validate the live schema at startup)

---
*Phase: 02-observability*
*Completed: 2026-08-28*
