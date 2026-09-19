---
created: 2026-08-27T14:29:09.949Z
title: Document deployment config: clean .env and docker-compose.yml
area: docs
severity: major
files:

  - Dockerfile
  - docker-compose.yml
  - docker-compose.dev.yml

completed: 2026-09-16
status: completed
---

## Problem

Docktor is a self-hosting management platform — a clean, documented deployment path
(`.env`/`.env.example` + `docker-compose.yml`) is core to the product's value
proposition, not an afterthought. The user called this out explicitly as "the main
task" while manually verifying Phase 02 gap-closure plans via `docker compose up`.

During that verification session, three deployment-path defects surfaced and were
found by trial and error rather than caught by documentation or tooling:

1. **Dockerfile bug** — referenced a root-level `prisma/` directory that never
   existed (schema lives at `server/prisma/`); broke every Docker build. Fixed in
   commit `b7a91fe`.
2. **Dockerfile bug** — final stage copied compiled shared output to `./dist/shared`,
   but the yarn `node-modules` linker's `@docktor/shared` symlink (created during the
   `server-build` stage) points at `../../shared` (i.e. `/app/shared`), which never
   existed in the final image. Any server import of `@docktor/shared` crashed at boot
   with `ERR_MODULE_NOT_FOUND`. Fixed in commit `0819d40`.
3. **Missing schema-sync step** — nothing in the image or compose startup runs
   `prisma db push` (project uses schemaless `db push`, no `server/prisma/migrations/`
   directory exists) before the server starts, so a fresh `docker compose up` fails
   at runtime with `The table 'public.Backup' does not exist in the current
   database`. Not fixed — logged in
   `.planning/phases/02-observability/deferred-items.md`; needs a real decision once
   the project adopts `prisma migrate` (a `db push` baked into container startup
   needs guards against running unintentionally against prod / racing multiple
   replicas).
4. Also observed: `BETTER_AUTH_SECRET` / `BETTER_AUTH_BASE_URL` are required at boot
   with no documented default or `.env.example` entry — the app crashes with an
   unhelpful stack trace (`BetterAuthError`) rather than pointing at what's missing.
5. Also observed: user hit a false "only backend exposed, no frontend" symptom that
   turned out to be caused by loading the wrong env file with the wrong `NODE_ENV`
   (the SPA static-file serving in `server/src/app.ts` is gated on
   `NODE_ENV === "production"`) — not a code bug, confirmed by reproducing the same
   image/build with the correct env and getting the SPA `index.html` back on `GET /`.
   Another case a documented `.env.example` (spelling out what `NODE_ENV=production`
   controls) would have prevented.
6. **Real bug, fixed** — the tracked `docker-compose.yml` never set `BETTER_AUTH_URL`
   or `BETTER_AUTH_SECRET` at all. `server/src/lib/auth.ts` reads `BETTER_AUTH_URL`
   for both `baseURL` and `trustedOrigins`; without it, `trustedOrigins` silently fell
   back to the dev-only `http://localhost:5173` default, so login failed with
   "invalid origin" for any real deployment. Missing `BETTER_AUTH_SECRET` crashes the
   server at boot (confirmed earlier in this same session). Fixed in `6c9e69e`
   (explicit `baseURL` wiring in `auth.ts` + both vars added to
   `docker-compose.yml`). Also note: `docker-compose.yml` sets `DOCKTOR_BASE_URL`,
   which nothing in `server/src` actually reads (confirmed by grep) — it's dead
   config that looks load-bearing; `BETTER_AUTH_URL` is the one that matters. The
   documented `.env.example` should make this relationship explicit rather than
   have two same-looking "base URL" vars where only one does anything.
7. **Real bug, fixed** — `DOCKTOR_STACKS_DIR`/`DOCKTOR_DATA_DIR`/`DOCKTOR_BACKUP_DIR`
   were set in `docker-compose.yml`'s `environment:`, but these name
   container-internal paths that must match the volume mount targets and never vary
   per deployment — they belong in the image, not per-deployment config (user
   feedback: "it is only relevant for the volumes on host side"). Moved
   `DOCKTOR_STACKS_DIR=/stacks` to a Dockerfile `ENV` default in `19817b2`, since
   `server/src/lib/stacks-dir.ts` actually reads it (default `./stacks`, which
   would've resolved to the wrong `/app/stacks` without this). `DOCKTOR_DATA_DIR`
   and `DOCKTOR_BACKUP_DIR` were dropped outright — neither is read anywhere in
   `server/src` — meaning **the `/data` and `/backups` volume mounts in
   `docker-compose.yml` aren't wired to any app code yet**. The restic backup path
   (`server/src/application/backup-service.ts`) resolves its repo path from a
   DB-stored setting (`repoConfig.repoPath`), not from these volumes at all. Worth
   deciding, as part of this todo: either wire local/backup storage to read these
   fixed container paths, or drop the `/data` and `/backups` volume mounts from the
   documented compose file until something actually uses them.

8. **Real bug, confirmed (2026-08-28), functional not just documentation** — the
   `docker-compose.yml` `./dev-data/docktor/stacks:/stacks` mount (host path remapped
   to a different container path) breaks every relative bind-mount volume in every
   managed stack, because Docktor runs Docker-outside-of-Docker: `docker compose`
   inside the Docktor container resolves relative paths against its own view
   (`/stacks/...`) and sends that absolute string to the *host's* daemon, which has no
   matching `/stacks` directory. See
   [[2026-08-28-dood-bind-mount-path-mismatch]] for the full mechanism — likely also
   silently breaks backups. The documented compose file needs to mount the host
   stacks directory at the **same absolute path** on both sides, not remap it.

Each of these is the kind of thing a documented, known-good `.env.example` +
`docker-compose.yml` (with inline comments explaining each variable, and either a
startup migration step or a clearly documented one-time setup command) would have
caught before a user ever hit it.

## Solution

TBD — likely scope:

- Write a `.env.example` at the repo root covering every env var the server reads
  (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_BASE_URL`, etc.), each with a
  one-line comment on what it does and whether it's required.
- Clean up `docker-compose.yml` (and reconcile with `docker-compose.dev.yml`) into a
  documented, copy-pasteable self-host quickstart — likely including a Postgres
  service, volume mounts, and either a startup schema-sync step or a documented
  `docker compose exec ... yarn db:push` one-time command.
- Land this as part of the project's actual docs (README or a docs/deployment.md),
  not just inline compose comments — the user framed this as "part of the
  documentation."
- Coordinate with the deferred migration-strategy decision above; the documented
  compose file's schema-sync story depends on which way that resolves.

## Resolution

Closed by Phase 09 plan 09-01 (`09-01-SUMMARY.md`), per Phase 09's D-01 decision:
every defect this todo originally listed had already been fixed and documented
across earlier phases before this plan ran; 09-01's own work was a drift check
that found and fixed one remaining stale reference, then closed this todo with
the trace below.

| # | Defect (Problem section) | Fixed by |
|---|---------------------------|----------|
| 1 | Dockerfile referenced a non-existent root-level `prisma/` directory | Commit `b7a91fe` (already fixed before this todo was filed; the todo's own Problem text records it) |
| 2 | Dockerfile's final stage copied `@docktor/shared` to the wrong path, causing `ERR_MODULE_NOT_FOUND` at boot | Commit `0819d40` (already fixed before this todo was filed) |
| 3 | Missing schema-sync step — fresh `docker compose up` crashed on a missing table | Phase 05.1 plan **05.1-05** (`syncDatabaseSchema()`/`schema-sync.ts` guarded `prisma db push` step wired into startup), hardened by a live-discovered bugfix in Phase 05.1 plan **05.1-08** (`--skip-generate` was an invalid flag, silently no-op'ing the push) |
| 4 | Undocumented `BETTER_AUTH_*` — no `.env.example` entry, unhelpful crash | Phase 05.1 plan **05.1-08** (created `.env.example`/`.env.production` with `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` documented as REQUIRED) |
| 5 | Wrong env file / wrong `NODE_ENV` produced a false "no frontend" symptom | Phase 05.1 plan **05.1-08** (`.env.example` documents `NODE_ENV=production` as required with an explanation of what it gates), plus Phase 05.1 plan **05.1-10** (renamed the loaded env file from `.env.local` to `.env` so the documented copy command actually takes effect) |
| 6 | `docker-compose.yml` never set `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET`; dead `DOCKTOR_BASE_URL` looked load-bearing | Commit `6c9e69e` (already fixed before this todo was filed); `DOCKTOR_BASE_URL`'s dead-code status independently reconfirmed in Phase 02-observability plan **02-08** |
| 7 | `DOCKTOR_STACKS_DIR`/`DOCKTOR_DATA_DIR`/`DOCKTOR_BACKUP_DIR` set per-deployment when they're fixed container paths; `/data`/`/backups` mounts wired to no app code | Phase 02-observability plan **02-08** (moved `DOCKTOR_STACKS_DIR` to a fixed Dockerfile `ENV`); Phase 05.1 plan **05.1-08** (dropped the decorative `/data`/`/backups` mounts and the two dead env vars entirely, and stopped publishing Postgres `5432`) |
| 8 | Docker-outside-of-Docker bind-mount path mismatch — relative volumes in managed stacks silently misplaced data | Phase 05.1 plan **05.1-03** (canonical `/opt/docktor/stacks` path + `DOCKTOR_STACKS_HOST_DIR`/`DOCKTOR_STACKS_DIR` pairing + `assertStacksDirMatchesHost()`), Phase 05.1 plan **05.1-10** (renamed `docker-compose.yml`'s `env_file:` target from `.env.local` to `.env` so Compose's top-level `${VAR}` interpolation actually sees the pairing), Phase **07-01** (`assertStacksDirIsMounted()` mountinfo-based detection catching a never-attached stacks volume) |

**Drift found and fixed by this plan (09-01), not by an earlier phase:** `.env.example` line 3's header comment still instructed operators to copy the template to `.env.local` — a leftover from before Phase 05.1-10's `docker-compose.yml` rename (05.1-10 fixed `docker-compose.yml`, `docs/deployment.md`, and `README.md`, but its own Task 3 for the env templates' header comments was blocked by a workspace permission restriction denying `.env*` access, per `05.1-10-SUMMARY.md`). 09-01 Task 1 fixed `.env.example`'s header; `.env.production`'s equivalent header line (~line 12) remained blocked by the identical permission restriction in this session too — see `09-01-SUMMARY.md`'s remaining-gap entry for the exact edit a developer with access must apply. 09-01 Task 2 additionally found and fixed a second, previously-undocumented drift: `docs/deployment.md`'s environment-variable table stated `DOCKTOR_FS_POLLING`'s default as "auto-detected," but the shipped `Dockerfile` bakes it to `true` unconditionally — the table now states the actual shipped default.
