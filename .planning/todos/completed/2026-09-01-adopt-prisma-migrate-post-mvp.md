---
created: 2026-09-01T00:00:00Z
title: Adopt prisma migrate once MVP is complete
area: deployment
severity: major
files:

  - server/prisma/schema/
  - Dockerfile
  - docker-compose.yml

completed: 2026-09-17
status: completed
---

## Problem

The project currently uses schemaless `prisma db push` (no
`server/prisma/migrations/` directory exists) because the schema is still
changing shape frequently during active MVP development. `db push` has no
migration history, no rollback path, and no safe multi-replica story.

Phase 05.1 adds a guarded `prisma db push` step on container startup as an
interim fix for the "fresh `docker compose up` crashes with missing table"
bug — that is a pragmatic patch, not a replacement for real migrations.

## Solution

Once the MVP milestone is complete and the schema has stabilized, switch to
`prisma migrate` (formal migration files under `server/prisma/migrations/`)
and replace the interim guarded `db push` startup step with
`prisma migrate deploy`. Deliberately deferred until the schema stops
changing shape frequently — adopting migrations too early would produce a
proliferating pile of throwaway migration files during active development.

User decision (2026-09-01, during `/gsd-plan-phase 05.1`): use `prisma
migrate` eventually, but create the first migration as late as possible.

## Resolution

The baseline migration (`server/prisma/migrations/0_init/migration.sql`) was
generated with Prisma's own diff command from the current 12-file modular
schema directory (`prisma migrate diff --from-empty --to-schema
server/prisma/schema --script`) rather than hand-written, so it is guaranteed
to match the shipped schema exactly (plan `09-03-PLAN.md`).

The guarded startup step now applies real migrations (`prisma migrate
deploy`) before the HTTP server starts listening; the schemaless `prisma db
push` path was removed both from the runtime (`server/src/lib/schema-sync.ts`)
and from the root `package.json` scripts (`db:push` deleted, `db:migrate` is
now the only dev-time schema-authoring command) — **D-04**.

An existing install upgrading into this version — schema already applied via
`db push`, no `_prisma_migrations` table yet — is auto-detected and
baselined at boot with zero operator action, immediately followed by a
post-baseline drift probe (`prisma migrate diff --exit-code`) that reports
any residual divergence loudly under the `[schema-sync]` log prefix — **D-05**.

The original "adopt `prisma migrate` eventually, but as late as possible"
decision (2026-09-01) was superseded by **D-02** (`09-CONTEXT.md`): the
v1.0.0 release itself is the stated trigger for cutting over now, not
"whenever the schema stabilizes."

**Live-verification status:** the auto-baseline branch above is fully
unit-tested (17/17 in `server/test/unit/lib/schema-sync.test.ts`, covering
the fresh/previously-`db push`-synced/already-migrated branches and the
drift probe), but it has **not** been exercised against a real,
previously-`db push`-synced live database in any session to date — the
session that implemented it (plan `09-03`) could not reach the dev database
from its sandboxed execution host (TCP connected, but the Postgres
wire-protocol handshake never completed). This is recorded as an open,
tracked gap in `.planning/WINDOWS.md` entry #10, with the exact 4-command
verification sequence a developer on an unrestricted host must run recorded
in `09-03-SUMMARY.md`. `docs/deployment.md`'s Database schema section
carries the same honest note.

Closed by plans `09-03` (the cutover itself) and `09-04` (image, startup
logs, env templates, and deployment guide brought into agreement with it).
