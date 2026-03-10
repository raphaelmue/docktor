# Docktor

## What This Is

Docktor is a self-hosting management platform that provides a UI-driven experience for deploying, updating, and managing
Docker-based applications using `docker-compose`. It targets end users running a single VPS or local server who want to
self-host applications (Nextcloud, Vaultwarden, Gitea, etc.) without deep Docker expertise. The entire system runs as
a single Fastify server — API, background jobs, SSE streams, and static React SPA — deployed as a Docker Compose stack.

## Core Value

Users can deploy, monitor, and manage Docker Compose stacks through a browser UI without needing SSH or Docker CLI access.

## Requirements

### Validated

<!-- Shipped and confirmed working — inferred from existing codebase. -->

- ✓ User can sign up and log in with email + password (better-auth, session-based) — existing
- ✓ User session persists across browser refresh — existing
- ✓ User can create a stack by pasting a docker-compose YAML — existing
- ✓ User can view the dashboard with stack list, status counts, and recent stacks — existing
- ✓ User can view stack detail: services table, compose/env editors, action buttons — existing
- ✓ User can deploy a stack (`docker compose up -d`) — existing
- ✓ User can stop a stack (`docker compose stop`) — existing
- ✓ User can restart a stack (`docker compose restart`) — existing
- ✓ User can delete a stack — existing
- ✓ Stack status transitions are enforced by a 10-state state machine — existing
- ✓ Stack detail shows a "config changed" alert when compose file differs from last deploy — existing
- ✓ Database schema covers all planned models (Stack, Service, Backup, Settings, etc.) — existing
- ✓ Shared Zod validation schemas used by both client and server — existing

### Active

<!-- Current scope. Building toward these. -->

**MVP Completion:**
- [ ] Container state poller runs every 15s, updating stack/service status from `docker inspect`
- [ ] Live container log streaming via SSE (per-service, combined view with service-name prefixes)
- [ ] Basic settings page: instance name, base URL, timezone — stored in DB Settings model

**Post-MVP — Reliability & Observability:**
- [ ] File watcher detects external compose edits (chokidar + 60s polling fallback), flags "config changed"
- [ ] Update checker polls registries for newer images (semver/digest comparison), exposes update button

**Post-MVP — Notifications:**
- [ ] SMTP notification for stack entering ERROR or UNHEALTHY state
- [ ] SMTP notification for disk space warnings (below 10% or 2 GB)
- [ ] SMTP notification for backup failures
- [ ] Per-trigger enable/disable in Settings

**Post-MVP — Backup & Restore:**
- [ ] User can configure restic repository (local path, SFTP, S3) and password via Settings
- [ ] User can trigger a manual backup for a stack
- [ ] Backup scheduling via per-stack cron expressions
- [ ] Configurable retention policies (daily/weekly/monthly)
- [ ] User can restore a stack from a restic snapshot

**Post-MVP — First-Run Wizard:**
- [ ] On first boot with no user, show wizard: account creation, base config, optional backup + notification config
- [ ] Optional brownfield scan step in wizard

**Post-MVP — Brownfield Import:**
- [ ] Scan host filesystem for `docker-compose.yml` files with compatibility assessment
- [ ] Adopt-in-place: register an existing directory as a stack without moving anything
- [ ] Full migration wizard: stop → copy → convert volumes → rewrite paths → restart with rollback support

**Post-MVP — Proxy Configuration:**
- [ ] Nginx Proxy Manager integration: configure domain/port exposure per service via NPM API
- [ ] Raw Nginx config generation for advanced users

### Out of Scope

- Marketplace — deferred; not in this roadmap cycle
- RBAC / multi-user access control — single-user model sufficient for personal server use case
- Inter-stack networking (Docker overlay networks) — users can use `external: true` manually
- Metrics dashboards (Prometheus/Grafana) — out of product scope
- OAuth / LDAP integration — better-auth email/password is sufficient
- Docker Secrets integration — filesystem + encrypted backups covers MVP security needs
- Plugin system — adds complexity without near-term user benefit
- Docktor self-update via UI — users run `docker compose pull && up -d` from host

## Context

Brownfield project with significant existing implementation. The foundation (auth, CRUD, state machine, dashboard, detail
page, create page) is fully built. The three remaining MVP items have partial implementations in untracked files
(`server/src/jobs/state-poller.ts`, `client/src/hooks/use-log-stream.ts`, settings routes/UI). These should be completed
before starting post-MVP phases.

Key architectural constraints:
- Single Fastify process: API + background jobs + SSE + static files (no separate frontend server in production)
- YAML-first: compose file on disk is source of truth; DB stores derived metadata only
- Bind mounts only: named Docker volumes are rejected; all data in `./volumes/` subdir
- Docker socket access: Docktor mounts host Docker socket (effectively root — documented in install guide)
- Stack ID = primary key = directory name = slugified user-provided name

## Constraints

- **Tech stack**: Node.js + TypeScript + Fastify + React + Vite + Prisma + PostgreSQL — locked
- **Docker interaction**: dockerode for inspect/log streaming; shell out to `docker compose` CLI for compose operations
- **Auth**: better-auth (email + password only for MVP) — no OAuth until post-MVP
- **Single-host**: Not a clustering tool; one server, one Docktor instance

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single Fastify process (not Next.js) | Needs persistent background jobs + SSE streams; Next.js doesn't support this well | — Pending |
| YAML-first (file = source of truth) | Supports external edits via SSH; DB is cache not master | — Pending |
| Bind mounts only (no named volumes) | Simplifies backup (one dir per stack), transparency, portability | — Pending |
| PostgreSQL via Prisma | Robust production DB, multi-file schema, type-safe queries | — Pending |
| SSE for log streaming (not WebSockets) | Simpler unidirectional streaming; sufficient for log display | — Pending |
| Restic for backups | Encrypted, deduplicated, supports local/SFTP/S3 targets | — Pending |

---
*Last updated: 2026-03-10 after initialization*
