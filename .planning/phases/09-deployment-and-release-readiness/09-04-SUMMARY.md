---
phase: 09-deployment-and-release-readiness
plan: 04
subsystem: deployment-docs
tags: [prisma, migrations, docker, deployment-docs, schema-sync]

# Dependency graph
requires:
  - phase: 09-deployment-and-release-readiness
    provides: "schema-sync.ts cut over to `prisma migrate deploy` with D-05 auto-baseline, DOCKTOR_DB_AUTO_MIGRATE opt-out, and the generated 0_init baseline migration (plan 09-03)"
provides:
  - "Dockerfile ENV DOCKTOR_DB_AUTO_MIGRATE=true, DOCKTOR_DB_AUTO_PUSH retained as a deprecated alias, comment rewritten to describe migrations + auto-baseline"
  - "Positive, build-verified evidence that server/prisma/migrations/0_init/migration.sql reaches the built image via the existing COPY --from=server-build /app/server/prisma ./server/prisma line"
  - "server/src/index.ts startup log strings naming DOCKTOR_DB_AUTO_MIGRATE for the skipped/failed cases, with applied/already-current still surfacing schemaSyncResult.detail unchanged"
  - ".env.example documents DOCKTOR_DB_AUTO_MIGRATE and re-labels DOCKTOR_DB_AUTO_PUSH as a deprecated alias"
  - "docs/deployment.md's Database schema section rewritten for the migration mechanism, including the honest Branch-B live-verification note"
  - "Item-2 todo (.planning/todos/completed/2026-09-01-adopt-prisma-migrate-post-mvp.md) closed with a Resolution naming D-02/D-04/D-05 and the live-verification status"
affects: [docs, deployment, 09-05, 09-06, 09-07, 09-08]

# Actuals (#2632)
actuals:
  tokens: 6059
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deprecated-env-var documentation pattern: the new variable's doc entry states what it does; the deprecated alias's doc entry states only that it is deprecated and points at the new variable — applied identically across Dockerfile comment, .env.example, and docs/deployment.md's variable table"

key-files:
  created: []
  modified:
    - Dockerfile
    - server/src/index.ts
    - .env.example
    - docs/deployment.md
    - .planning/todos/completed/2026-09-01-adopt-prisma-migrate-post-mvp.md

key-decisions:
  - "Verified migrations-in-image by actually building the server-build Docker stage and running `ls` inside the resulting image, rather than relying only on static .dockerignore/COPY analysis — the plan's <read_first> named this as the preferred verification path when a build is available, and Docker was reachable in this session"
  - "Left the unreachable/lock-not-acquired log strings' semantics unchanged per the plan's own instruction, but reworded 'applying the schema'/'apply the schema' to 'applying migrations'/'apply migrations' for terminology consistency with the rest of the rewritten log strings — a same-scope wording tidy, not a new behavior"

patterns-established: []

requirements-completed: []  # n/a — phase scoped by todo files, not REQUIREMENTS.md IDs (see plan frontmatter)

coverage:
  - id: D1
    description: "Dockerfile declares DOCKTOR_DB_AUTO_MIGRATE=true, retains DOCKTOR_DB_AUTO_PUSH as a deprecated alias, and its comment describes applying migrations and auto-baselining rather than the removed schemaless push"
    verification:
      - kind: other
        ref: "grep -c 'ENV DOCKTOR_DB_AUTO_MIGRATE=true' Dockerfile -> 1; grep -c DOCKTOR_DB_AUTO_PUSH Dockerfile -> 1; grep -rc 'todos/pending/2026-09-01-adopt-prisma-migrate' Dockerfile server/src/index.ts -> 0/0"
        status: pass
    human_judgment: false
  - id: D2
    description: "server/prisma/migrations/0_init/migration.sql reaches the built image as a sibling of schema/, with no explicit COPY needed"
    verification:
      - kind: other
        ref: "docker build --target server-build, then `docker run --rm <image> ls -la /app/server/prisma/migrations/0_init/` — confirmed migration.sql (9936 bytes / 324 lines) present alongside schema/"
        status: pass
    human_judgment: false
  - id: D3
    description: "server/src/index.ts's skipped/failed log strings name DOCKTOR_DB_AUTO_MIGRATE; applied/already-current still interpolate schemaSyncResult.detail; no control-flow or SchemaSyncOutcome switch-shape change; yarn typecheck exits 0"
    verification:
      - kind: other
        ref: "grep -c schemaSyncResult.detail server/src/index.ts -> 4; git diff --stat server/src/lib/schema-sync.ts -> empty; git diff server/src/index.ts shows only string content changed inside existing case labels; yarn typecheck exits 0 with no output"
        status: pass
    human_judgment: false
  - id: D4
    description: ".env.example documents DOCKTOR_DB_AUTO_MIGRATE and re-labels DOCKTOR_DB_AUTO_PUSH as a deprecated alias, with no existing variable's value changed"
    verification:
      - kind: other
        ref: "grep -c DOCKTOR_DB_AUTO_MIGRATE .env.example -> 3; git diff .env.example confined to the one variable block"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/deployment.md's Database schema section, variable table, first-boot log expectation, and troubleshooting row all describe the migration mechanism; the section states the automatic baseline has not yet been live-verified, matching 09-03's Branch B"
    verification:
      - kind: other
        ref: "grep -c DOCKTOR_DB_AUTO_MIGRATE docs/deployment.md -> 6; grep -c 0_init docs/deployment.md -> 3; grep -c db:migrate docs/deployment.md -> 1; grep -rc 'todos/pending/2026-09-01-adopt-prisma-migrate' docs/deployment.md -> 0; git diff docs/deployment.md shows exactly 4 hunks (first-boot expectation, variable table, Database schema section, troubleshooting row 3)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Item-2 todo closed via gsd_run query todo complete, living only under completed/, with a Resolution section naming D-02/D-04/D-05 and the live-verification status; pending count dropped by exactly 1"
    verification:
      - kind: other
        ref: "test -f .planning/todos/completed/2026-09-01-adopt-prisma-migrate-post-mvp.md && test ! -f .planning/todos/pending/2026-09-01-adopt-prisma-migrate-post-mvp.md; grep -oE 'D-0[2-5]' on the moved file -> D-02, D-04, D-05; pending count 18 -> 17"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-09-17
status: complete
---

# Phase 9 Plan 4: Deployment Docs and Image Cutover to Match Plan 09-03 Summary

**Aligned the Dockerfile's `ENV` block, `server/src/index.ts`'s startup logs, `.env.example`, and `docs/deployment.md` with the `prisma migrate deploy` mechanism plan 09-03 already shipped, closing scope item 2's todo with an honest record that the automatic upgrade baseline is unit-tested but not yet exercised against a live database.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-17T07:55:00Z (approximate — required-reading phase preceded the first commit)
- **Completed:** 2026-09-17T08:24:00Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- `Dockerfile` now declares `ENV DOCKTOR_DB_AUTO_MIGRATE=true`, keeps `ENV DOCKTOR_DB_AUTO_PUSH=true` as a retained deprecated alias, and its comment describes applying migrations and auto-baselining an upgrading install instead of the removed schemaless-push promise (which had pointed at the now-closed todo).
- Actually built the `server-build` Docker stage and inspected the resulting image to confirm `server/prisma/migrations/0_init/migration.sql` reaches it as a sibling of `schema/` — no explicit `COPY` was needed; the existing `COPY --from=server-build /app/server/prisma ./server/prisma` line already carries it, and `.dockerignore` excludes nothing under `server/prisma/`.
- `server/src/index.ts`'s `skipped` and `failed` log strings now name `DOCKTOR_DB_AUTO_MIGRATE` (and mention the deprecated alias); `applied`/`already-current` still surface `schemaSyncResult.detail` unchanged (the only channel that reveals a baseline occurred); no case label was added or removed and no control-flow reordering occurred — `yarn typecheck` confirms the exhaustive `SchemaSyncOutcome` switch still compiles.
- `.env.example` documents `DOCKTOR_DB_AUTO_MIGRATE` and re-labels `DOCKTOR_DB_AUTO_PUSH` as a deprecated alias, with no existing variable's value changed.
- `docs/deployment.md`'s `## Database schema` section was rewritten in full: migration-based apply, the four unchanged startup guards, the D-05 auto-baseline branch and its zero-touch precondition, the post-baseline drift report with three concrete recovery options, the opt-out variable pair, how to author a schema change now (`yarn db:migrate`), and — because plan 09-03's SUMMARY records Branch B — an explicit live-verification note naming the outstanding gap. The environment-variable table, the first-boot log expectation, and the one relevant troubleshooting row were also updated; nothing else in the file was touched (confirmed via `git diff` hunk count).
- Closed `.planning/todos/pending/2026-09-01-adopt-prisma-migrate-post-mvp.md` via `gsd_run query todo complete`, with a Resolution section naming D-02, D-04, D-05, and the exact live-verification status carried forward from `09-03-SUMMARY.md`/`WINDOWS.md` entry #10.

## Task Commits

1. **Task 1: Make the image and the startup log describe the migration step that actually runs** - `d4e6ff8` (feat)
2. **Task 2: Rewrite the deployment guide's schema section and close the item-2 todo** - `b97e910` (docs)

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `Dockerfile` - `ENV DOCKTOR_DB_AUTO_MIGRATE=true` added; `ENV DOCKTOR_DB_AUTO_PUSH=true` retained with a new deprecated-alias comment; surrounding comment block rewritten to describe migrations/auto-baseline instead of the schemaless push and its now-closed-todo pointer.
- `server/src/index.ts` - Comment above `syncDatabaseSchema()` rewritten; `skipped` and `failed` case log strings rewritten to name `DOCKTOR_DB_AUTO_MIGRATE`; `unreachable`/`lock-not-acquired` strings reworded from "the schema" to "migrations" for terminology consistency; `applied`/`already-current` unchanged.
- `.env.example` - `DOCKTOR_DB_AUTO_MIGRATE` entry added in the Database section; `DOCKTOR_DB_AUTO_PUSH` re-labeled as a deprecated alias, same commented-out `false` value retained.
- `docs/deployment.md` - `## Database schema` section rewritten; environment-variable table gains a `DOCKTOR_DB_AUTO_MIGRATE` row and re-labels `DOCKTOR_DB_AUTO_PUSH`; first-boot log expectation sentence updated; troubleshooting row 3's Fix column updated. No other section touched.
- `.planning/todos/completed/2026-09-01-adopt-prisma-migrate-post-mvp.md` (moved from `pending/`) - Resolution section appended naming D-02/D-04/D-05 and the live-verification status.

## Decisions Made

- Verified the migrations-in-image claim by actually building the Docker `server-build` stage (Docker daemon and network access were both available this session) and inspecting the resulting image's filesystem, rather than relying solely on the `.dockerignore`/`COPY`-line static analysis the plan offered as a fallback. This is stronger evidence than the fallback and matches the plan's own preference ("Verify by building the image (or, if a build is unavailable, by inspecting...)").
- Reworded the `unreachable`/`lock-not-acquired` log strings' generic "the schema"/"applying the schema" phrasing to "migrations"/"applying migrations" for terminology consistency, even though the plan only required their *semantics* stay unchanged (their prior wording already contained no literal "push" reference). This is a same-scope wording tidy within the plan's own stated file (`server/src/index.ts`), not new behavior.

## Deviations from Plan

None - plan executed exactly as written, including the explicit build-based verification path for the migrations-in-image evidence.

## Issues Encountered

None. Docker was reachable in this sandboxed session (unlike the Postgres wire-protocol block documented repeatedly elsewhere in this phase's prior plans) — `docker build --target server-build` and a throwaway `docker run --rm ... ls` completed normally, and the temporary image was removed afterward.

## User Setup Required

None - no external service configuration required. The live-verification gap this plan documents (automatic upgrade baseline not yet exercised against a real database) is unchanged from plan 09-03's recorded state and remains a developer task on an unrestricted host — see `.planning/WINDOWS.md` entry #10 and `09-03-SUMMARY.md`'s command sequence, both of which `docs/deployment.md`'s new note now points to.

## Next Phase Readiness

- Every surface that configures or describes Docktor's schema management — the image, the startup log, the env templates, and the deployment guide — now tells the same true story as the code plan 09-03 shipped, including the honest state of live verification.
- Scope item 2 (Prisma migrate cutover) is fully closed: the todo lives only under `.planning/todos/completed/`, and its Resolution ties D-02/D-04/D-05 to the plans that shipped them.
- No blockers introduced for 09-05 through 09-08. The one carried-forward gap (live baseline verification) remains tracked in `WINDOWS.md` entry #10, unaffected by this plan's documentation-only scope.

## Self-Check: PASSED

- FOUND: `Dockerfile` (contains `ENV DOCKTOR_DB_AUTO_MIGRATE=true`)
- FOUND: `server/src/index.ts` (contains `DOCKTOR_DB_AUTO_MIGRATE` in skipped/failed cases)
- FOUND: `.env.example` (contains `DOCKTOR_DB_AUTO_MIGRATE`)
- FOUND: `docs/deployment.md` (rewritten Database schema section)
- FOUND: `.planning/todos/completed/2026-09-01-adopt-prisma-migrate-post-mvp.md`
- MISSING (expected): `.planning/todos/pending/2026-09-01-adopt-prisma-migrate-post-mvp.md`
- FOUND commit: `d4e6ff8` (feat)
- FOUND commit: `b97e910` (docs)

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-17*
