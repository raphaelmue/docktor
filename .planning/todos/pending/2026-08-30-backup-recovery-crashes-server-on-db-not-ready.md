---
created: 2026-08-30T00:00:00Z
title: Server fails to start when DB isn't reachable yet — recoverInProgressBackups() has no fault isolation
area: backup-restore
severity: blocker
files:
  - server/src/jobs/index.ts
  - server/src/application/backup-service.ts
  - server/src/app.ts
  - server/src/index.ts
  - docker-compose.yml
---

## Problem

Reported during Phase 02 UAT (`/gsd-verify-work 02`) on a second machine: a fresh
`docker compose up` crashed the `docktor` service at startup. Server log:

```
{"level":50,...,"err":{"type":"PrismaClientKnownRequestError","message":"Invalid `prisma.backup.findMany()` invocation:\n\n\n","code":"ECONNREFUSED","meta":{"modelName":"Backup"},...},
 "msg":"Invalid `prisma.backup.findMany()` invocation:\n\n\n"}
```

Stack trace shows the chain:

```
BackupService.recoverInProgressBackups (backup-service.js:384)
  -> startJobs (jobs/index.js:10)
  -> app.js:101 (Fastify onReady hook)
```

The user confirmed the server never became usable — it did not just log a warning and continue.

## Root cause (two compounding issues)

1. **Startup-order race.** `startJobs()` (`server/src/jobs/index.ts`) calls
   `backupService.recoverInProgressBackups()` — which calls
   `backupRepo.findInProgress()` → `prisma.backup.findMany(...)` — as the very first thing it
   does, before any of the other jobs. `docker-compose.yml` already has
   `depends_on: db: condition: service_healthy` with a `pg_isready` healthcheck, but this doesn't
   fully protect against ECONNREFUSED on a genuinely fresh Postgres volume: the official
   `postgres` image runs `initdb`, briefly starts a temp instance to run init scripts, shuts it
   down, then starts the real instance — during that restart window `pg_isready` can pass against
   the temp instance moments before the real one comes up, so a dependent container can start
   into a brief window where the DB port is refused. (Needs to be confirmed against the actual
   machine/Compose version, but this is a well-known Compose/Postgres footgun and fits the
   symptom exactly.)

2. **No fault isolation.** `app.ts`'s `onReady` hook awaits `startJobs()` directly with no
   try/catch. A Fastify `onReady` hook that throws makes `app.listen()` reject
   (`server/src/index.ts`), which logs and calls `process.exit(1)`. So *any* single job's startup
   failure — even from an unrelated subsystem like backup recovery — takes down the entire
   server, including jobs that had nothing wrong with them (StatePoller, FileWatcher,
   UpdateChecker). `restart: unless-stopped` will eventually retry and likely succeed once
   Postgres is truly ready, but there's no visible retry/backoff and, in the meantime, the app is
   completely unavailable rather than degraded.

## Suggested fix

- Wrap each job's startup in `startJobs()` with its own try/catch (log and continue), so one
  job's failure doesn't prevent the others — and doesn't prevent the HTTP server from becoming
  ready at all.
- For `recoverInProgressBackups()` specifically: either retry with backoff on a transient DB
  error, or defer it slightly (it only needs to run once, eventually, not literally before the
  first request is served).
- Consider hardening the DB healthcheck/connection story more generally: a short connect-retry
  loop around the initial `prisma` connection at boot would make this whole class of "DB not
  quite ready yet" issue disappear regardless of which job happens to touch the DB first.
