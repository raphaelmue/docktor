---
created: 2026-08-28T00:00:00Z
title: No schema sync step on container startup
area: deployment
severity: blocker
files:
  - Dockerfile
  - docker-compose.yml
---

## Problem

Discovered during plan 02-08 Task 3 Docker verification. A fresh
`docker compose up` fails at runtime with `The table 'public.Backup' does
not exist in the current database` — nothing in the Docker image or
compose startup runs `prisma db push` (the project uses schemaless
`db push`, not `prisma migrate`; no `server/prisma/migrations/` directory
exists) against the database before the server starts serving requests.

See `.planning/phases/02-observability/deferred-items.md` for the original
write-up.

## Solution

User confirmed a local workaround exists and explicitly asked that a real
fix wait until the project adopts a formal migration schema
(`prisma migrate`) rather than `db push`, since a `db push` step baked into
container startup needs conditional guards (never run against prod without
confirmation, don't race multiple replicas) — a bigger design decision than
a quick patch. Revisit once migration strategy is decided.
