---
created: 2026-09-01T00:00:00Z
title: Adopt prisma migrate once MVP is complete
area: deployment
severity: major
files:
  - server/prisma/schema/
  - Dockerfile
  - docker-compose.yml
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
