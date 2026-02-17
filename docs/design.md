# Docktor – Technical Design Document (v2)

## Overview

Docktor is a self-hosting management platform that provides a UI-driven experience for deploying, updating, and managing
Docker-based applications using `docker-compose`. It targets end users who run a single VPS or local server and want to
self-host applications like Nextcloud, Vaultwarden, etc. without deep Docker expertise.

**Core principles:**

- **Data sovereignty & privacy first** — replaces reliance on third-party cloud services.
- **Single-host by design** — not a clustering tool. One server, one Docktor instance.
- **YAML-first** — the compose file is the source of truth, not the database.
- **User empowerment** — the tool should never restrict what Docker itself allows. It makes things easier, not more
  locked down.

---

## Progress

### Done

- **Auth**: better-auth with email + password, session management
- **Database schema**: All Prisma models defined (multi-file schema under `server/prisma/schema/`)
- **Shared types & validation**: Zod schemas and TypeScript types in `shared/`
- **Client shell**: React + React Router + shadcn/ui + Tailwind CSS, Vite build
- **Dev/prod config**: Docker Compose files for dev and production, environment configs

### MVP — Up Next

- [ ] Stack CRUD API (create, read, update, delete stacks via REST)
- [ ] Docker service layer (dockerode + compose CLI wrapper)
- [ ] Stack operations: deploy, stop, restart, update
- [ ] Container state poller (15s interval via docker inspect)
- [ ] Live log streaming (SSE via dockerode log streams)
- [ ] Dashboard UI (stack list, host disk usage, status overview)
- [ ] Stack detail page (services, logs, state, compose editor)
- [ ] Create stack page (paste/upload YAML, configure .env)
- [ ] Basic settings page (instance name, base URL, timezone)

### Post-MVP

- First-run wizard (account creation, backup config, notification config)
- Brownfield import & scanning (scan, adopt-in-place, full migration)
- Backup & restore (restic engine, scheduling, retention)
- Proxy configuration (Nginx Proxy Manager integration)
- Marketplace (bundled templates + remote index)
- Notifications (SMTP alerts for errors, disk, backups)
- Disk space monitoring & warnings
- File watcher (chokidar + polling reconciliation)
- Update checker (registry polling, version/digest comparison)

---

## Goals

- Simplify service deployment and updates via a web UI.
- Store service configuration in `docker-compose.yml` files on disk.
- Provide a marketplace for community-contributed templates.
- Support email notifications on errors or failures.
- Allow volume and environment file backups per service (stack).
- Monitor container health and uptime.

---

## First-Run Experience

The first-run wizard is **post-MVP**. For MVP, the admin account is created via seed or a minimal registration endpoint.

The planned wizard covers:

1. **Account creation** — email + password for the single admin user.
2. **Base configuration** — instance name, base URL, timezone.
3. **Backup configuration** (optional) — restic repo location and password.
4. **Notification configuration** (optional) — SMTP settings.
5. **Existing stack discovery** (optional) — brownfield scan.

After the wizard, the user lands on the dashboard. All settings are editable later via the Settings page.

---

## Core Concepts

### Stack

A "Stack" represents a single `docker-compose` file with one or more Docker services (e.g., app + database). Physically
stored in a directory.

```
/stacks/<stack-id>/
├── docker-compose.yml
├── .env
├── volumes/           # All service data — bind-mounted, never named Docker volumes
│   ├── app-data/
│   ├── db-data/
│   └── ...
└── logs/              # Docktor operational logs (deploy output, backup output, migration output)
```

**Stack ID:** User-provided name, slugified (lowercase, alphanumeric + hyphens, max 63 chars to stay compatible with
Docker Compose project names and DNS labels). Example: user enters "My Nextcloud" → stack ID becomes `my-nextcloud`.
Must be unique. Validated on creation.

### Template

A reusable blueprint for deploying a new stack. Includes a versioned `docker-compose.yml` and optional metadata. Stored
centrally and publicly browsable via the Marketplace.

### Volume Strategy: Bind Mounts Only

**Requirement:** All persistent data must be bind-mounted into the stack's `volumes/` directory. Named Docker volumes
are not used.

**Rationale:** Backup simplicity (one directory = one stack), transparency (data on filesystem, not hidden in
`/var/lib/docker/volumes/`), portability (directory copy to migrate), and restic-friendly (direct backup, no
pre-processing).

```yaml
# Correct — bind mount into the stack's volumes/ directory
services:
  db:
    image: postgres:16
    volumes:
      - ./volumes/db-data:/var/lib/postgresql/data
  app:
    image: nextcloud:28
    volumes:
      - ./volumes/app-data:/var/www/html
```

```yaml
# Rejected — named Docker volumes
services:
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

**Enforcement rules:**

- **Relative bind mounts into `./volumes/`**: Accepted.
- **Named Docker volumes**: Rejected with auto-convert offer.
- **Absolute paths outside the stack directory**: Accepted with warning (not included in backups).
- **Marketplace templates**: Must follow bind-mount convention (hard requirement, enforced by linter).
- **Directory creation**: On deploy, Docktor ensures all `./volumes/<subdir>` directories exist before running
  `docker compose up`.
- **Shared volumes across stacks**: Not supported; users must use absolute paths. Volume drivers/remote volumes not
  supported. Ownership/permissions documented per template.

---

## Stack Import: Greenfield vs. Brownfield

> **Status: Post-MVP.** This section describes planned functionality.

Docktor's early adopters likely already self-host via Docker Compose. Their setups won't match Docktor's conventions
(directory structure, volume strategy, env var layout). If Docktor only supports greenfield deployment, adoption requires
users to rebuild every existing stack manually.

Import is **guided, transparent, and non-destructive** — the user sees exactly what will change, approves each step, and
can abort without data loss.

### Import Modes

1. **Scan & Discover** — Search the host filesystem for `docker-compose.yml` files. For each, show: directory path,
   service names, images, container state, and a compatibility assessment flagging what needs to change (named volumes,
   inline env vars, non-standard paths).

2. **Adopt in Place** (lightweight) — Register an existing directory as a stack in the DB without moving anything.
   Docktor monitors and manages it where it lives. Trade-off: no volume convention enforcement, incomplete backup
   coverage. Zero downtime, zero risk. Users can upgrade to full migration later.

3. **Full Migration** (recommended) — A guided wizard that stops the stack, copies data into `/stacks/<stack-id>/`,
   converts named volumes to bind mounts, extracts inline env vars to `.env`, rewrites compose paths, and restarts.
   Includes rollback on failure and user-initiated cleanup of old volumes/directories.

---

## Implementation Stack

### Architecture: Single Process

Docktor runs as a **single Fastify server** that handles everything: API, background jobs, SSE streams, and serving the
frontend. There is no separate frontend server.

**Why not Next.js for everything?** Docktor needs persistent background processes running continuously — file watcher,
container state poller (every 15s), cron jobs for backups and update checks, SSE streams for live logs. Next.js is built
around request/response and doesn't support long-lived server processes alongside route handling without fighting the
framework.

**Why not Next.js as the frontend?** Docktor is a private dashboard behind auth — no SEO, no public pages, no crawlers.
SSR provides zero benefit but adds hydration complexity and larger bundles. A simple SPA is the right tool.

**Why Fastify + Vite React SPA?** Fastify natively handles everything Docktor's backend needs (HTTP, SSE, background
processes, static file serving). Vite builds the React SPA into static files at compile time. Fastify serves these files
via `@fastify/static`. In development, Vite's dev server provides HMR. In production, it's a single process serving a
single port.

### Technology Choices

| Layer                 | Technology                            | Rationale                                                                                               |
|-----------------------|---------------------------------------|---------------------------------------------------------------------------------------------------------|
| Runtime               | **Node.js (LTS) with TypeScript**     | Strong Docker SDK support, async I/O for log streaming, type safety throughout                          |
| Server framework      | **Fastify**                           | Schema-based validation, high performance, plugin ecosystem, native SSE support, serves static frontend |
| Frontend              | **React + Vite** (SPA)                | Fast builds, HMR in dev, outputs static bundle. No SSR overhead.                                       |
| UI library            | **shadcn/ui + Tailwind CSS**          | Accessible, composable components without heavy dependencies                                            |
| YAML editor           | **CodeMirror 6**                      | Mature, extensible, good YAML mode support                                                              |
| Client-side routing   | **React Router**                      | Lightweight, standard SPA routing                                                                       |
| Real-time logs        | **SSE (Server-Sent Events)**          | Simpler than WebSockets for unidirectional log streaming                                                |
| ORM / DB              | **Prisma + PostgreSQL**               | Prisma multi-file schema, PostgreSQL for robust production use                                          |
| Docker interaction    | **dockerode**                         | Mature Node.js Docker client for inspect, log streaming, events                                         |
| Compose orchestration | Shell out to `docker compose` CLI     | Wrapped in a typed service layer; dockerode doesn't handle compose natively                              |
| Job scheduler         | **node-cron** (MVP)                   | File-watch reconciliation, update checks, backup scheduling. All runs in the same process.              |
| Auth                  | **better-auth**                       | Lightweight, session-based; sufficient for single-user MVP                                              |

### Infrastructure / System-Level

| Concern           | Technology                                                                    |
|-------------------|-------------------------------------------------------------------------------|
| Reverse proxy     | **Nginx** (with optional Nginx Proxy Manager integration — see Proxy section) |
| Backup engine     | **Restic** invoked via CLI from the backend                                   |
| Container runtime | **Docker Engine + Docker Compose v2** (plugin)                                |
| Packaging         | Docktor ships as a Docker Compose stack itself (dogfooding)                   |
| OS target         | Debian/Ubuntu LTS primarily; install script provided                          |

### Project Structure

```
docktor/
├── server/                    # Fastify backend (TypeScript)
│   ├── src/
│   │   ├── index.ts           # Server entry point, plugin registration
│   │   ├── generated/         # Prisma client (generated)
│   │   ├── routes/            # API routes (stacks, backups, settings, auth, etc.)
│   │   ├── services/          # Business logic (docker, backup, proxy, scanner)
│   │   ├── jobs/              # Background jobs (file watcher, state poller, cron)
│   │   └── lib/               # Utilities (path resolver, compose parser, etc.)
│   ├── prisma/
│   │   ├── prisma.config.ts   # Prisma configuration (PostgreSQL, multi-file schema)
│   │   └── schema/            # Multi-file Prisma schema
│   │       ├── base.prisma    # datasource + generator
│   │       ├── auth.prisma    # User, Session, Account, Verification
│   │       ├── stack.prisma   # Stack, StackStatus enum
│   │       ├── service.prisma # Service (parsed compose metadata + runtime state)
│   │       ├── proxy.prisma   # ProxyConfig
│   │       ├── backup.prisma  # Backup, BackupTrigger, BackupStatus enums
│   │       ├── status-log.prisma   # StatusLog
│   │       ├── deployment.prisma   # Deployment
│   │       ├── setting.prisma      # Setting (key-value)
│   │       └── registry.prisma     # Registry
│   ├── package.json
│   └── tsconfig.json
├── client/                    # React SPA (Vite)
│   ├── src/
│   │   ├── main.tsx           # SPA entry point
│   │   ├── routes/            # Page components (dashboard, stack detail, settings, etc.)
│   │   ├── components/        # Reusable UI components (shadcn/ui based)
│   │   ├── hooks/             # Custom hooks (useSSE, useStack, etc.)
│   │   └── lib/               # API client, types, utilities
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── shared/                    # Shared TypeScript types and validation schemas
│   ├── src/
│   │   ├── types/             # Stack, Service, Backup, etc. type definitions
│   │   └── validation/        # Zod schemas used by both server and client
│   └── package.json
├── Dockerfile                 # Multi-stage: build client → bundle with server
├── docker-compose.yml         # Docktor's own production deployment
├── docker-compose.dev.yml     # Development (PostgreSQL, hot-reload)
└── tsconfig.json              # Root TypeScript config (project references)
```

### Build & Deployment

The Dockerfile uses a multi-stage build:

1. **Stage 1 — Build client:** `npm run build` in `client/` → produces static files in `client/dist/`.
2. **Stage 2 — Build server:** Compile TypeScript in `server/`, run `prisma generate`.
3. **Stage 3 — Runtime:** Copies compiled server, built client, and Prisma client into a slim Node.js image. Installs
   `docker compose` CLI and `restic`. Fastify serves `client/dist/` via `@fastify/static` and API routes under `/api/`.

```dockerfile
# Simplified — actual Dockerfile will be more detailed
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/ .
RUN npm ci && npm run build

FROM node:22-slim AS server-build
WORKDIR /app
COPY server/ server/
COPY shared/ shared/
RUN cd server && npm ci && npm run build && npx prisma generate --schema=prisma/schema

FROM node:22-slim
# Install docker-compose-plugin and restic
RUN apt-get update && apt-get install -y docker-compose-plugin restic && rm -rf /var/lib/apt/lists/*
COPY --from=server-build /app/dist ./dist
COPY --from=client-build /app/client/dist ./client-dist
COPY server/prisma/ ./prisma/
ENV CLIENT_DIST_PATH=./client-dist
CMD ["node", "dist/server/src/index.js"]
```

### Development Workflow

In development, both the Vite dev server and Fastify run simultaneously:

- **Vite dev server** (`localhost:5173`): Serves the React SPA with HMR. API requests are proxied to Fastify via
  `vite.config.ts`:
  ```typescript
  // client/vite.config.ts
  export default defineConfig({
    server: {
      proxy: { '/api': 'http://localhost:3000' }
    }
  });
  ```
- **Fastify** (`localhost:3000`): Handles API routes, background jobs, SSE streams. In dev mode, it does **not** serve
  static files (Vite handles that).
- **Shared types** are imported directly via TypeScript path aliases — changes to shared types are picked up by both
  Vite and the server without a build step.

A single `npm run dev` command in the root starts both via `concurrently`.

---

## Docktor Deployment

### Architecture: Docker Managing Docker

Docktor itself runs as a Docker Compose stack. This creates a recursive situation: a container that manages other
containers and needs access to both the Docker daemon and the host filesystem. This is solved entirely through bind
mounts and the Docker socket — no Docker-in-Docker (DinD) required.

```
┌─── Host Filesystem ─────────────────────────────────┐
│                                                      │
│  /var/run/docker.sock          (Docker daemon)       │
│  /opt/docktor/stacks/          (all managed stacks)  │
│  /opt/docktor/data/            (Docktor's own DB)    │
│  /opt/docktor/backups/         (restic repository)   │
│                                                      │
│  ┌─── Docktor Container ─────────────────────────┐   │
│  │                                                │   │
│  │  Mounts:                                       │   │
│  │    /var/run/docker.sock → Docker API access     │   │
│  │    /opt/docktor/stacks  → read/write stacks     │   │
│  │    /opt/docktor/data    → DB + config           │   │
│  │    /opt/docktor/backups → restic repo           │   │
│  │                                                │   │
│  │  Runs: Fastify (API + React SPA + background jobs) │   │
│  │  Tools: docker compose CLI, restic             │   │
│  │                                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌─── Stack: Nextcloud ──────────────────────────┐   │
│  │  /opt/docktor/stacks/nextcloud/                │   │
│  │    ├── docker-compose.yml                      │   │
│  │    ├── .env                                    │   │
│  │    └── volumes/                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Docktor's Own Compose File

```yaml
# docker-compose.yml — Docktor itself
services:
  docktor:
    image: docktor/docktor:latest
    container_name: docktor
    restart: unless-stopped
    ports:
      - "8443:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/docktor/stacks:/stacks
      - /opt/docktor/data:/data
      - /opt/docktor/backups:/backups
    environment:
      - DOCKTOR_BASE_URL=https://docktor.example.com
      - DOCKTOR_STACKS_DIR=/stacks
      - DOCKTOR_DATA_DIR=/data
      - DOCKTOR_BACKUP_DIR=/backups
```

### Key Design Decisions

- **Docker socket, not DinD**: Docktor mounts the host's Docker socket. Managed containers are siblings on the host, not
  nested children. Same pattern as Portainer and Traefik. Docker socket access is effectively root — documented clearly.
- **`/stacks/` is a host bind mount**: Maps to `/opt/docktor/stacks/` on the host. Stack compose files use relative
  `./volumes/` paths which resolve correctly on the host via the Docker daemon.
- **Path translation**: Compose commands use relative paths, so no explicit translation is needed for stack operations.
  For brownfield scanning (post-MVP), a read-only host mount (`/:/host:ro`) and a `PathResolver` utility handle
  container-vs-host path mapping.
- **Not self-managed**: Docktor does not appear in its own UI. Updates are handled via `docker compose pull && up -d`
  from the host.

### Install Script

The install experience should be a single command:

```bash
curl -fsSL https://get.docktor.io | bash
```

The script checks prerequisites (Docker Engine, Compose v2), creates directory structure
(`/opt/docktor/{stacks,data,backups}`), writes a `docker-compose.yml`, prompts for base URL, and runs
`docker compose up -d`.

---

## Database Schema

The source of truth for the schema is `server/prisma/schema/*.prisma` (multi-file Prisma schema with PostgreSQL).

### Model Summary

| Model        | Purpose                                      | Key Fields                                                            |
|--------------|----------------------------------------------|-----------------------------------------------------------------------|
| User         | Admin account (better-auth managed)          | id, email, name, createdAt                                            |
| Session      | Auth sessions (better-auth managed)          | id, userId, token, expiresAt                                          |
| Account      | Auth provider accounts (better-auth managed) | id, userId, providerId, accountId                                     |
| Verification | Auth verification tokens                     | id, identifier, value, expiresAt                                      |
| Stack        | A managed docker-compose stack               | id (slug), displayName, hostPath, status, lastKnownHash, configChanged |
| Service      | Parsed service from a stack's compose file   | stackId, serviceName, image, containerId, containerState, healthStatus |
| ProxyConfig  | Reverse proxy mapping for a service          | stackId, serviceName, domain, internalPort, tlsEnabled                |
| Backup       | A restic backup snapshot record              | stackId, resticSnapshotId, sizeBytes, trigger, status                 |
| StatusLog    | Append-only audit trail of state transitions | stackId, fromStatus, toStatus, message, output                       |
| Deployment   | Record of each deploy/update                 | stackId, templateId, composeHash, success, errorMessage               |
| Setting      | Global key-value configuration               | key, value, encrypted                                                 |
| Registry     | Docker registry credentials                  | name, url, username, password (encrypted), isDefault                  |

### Key Design Decisions

- **Stack ID is the primary key** — it's the slugified name and also the directory name. No surrogate key needed.
- **Service model stores parsed data** — extracted from compose file on parse. Also stores runtime container state
  updated by the poller.
- **JSON fields for complex data** — Ports and volumes are stored as JSON strings. This avoids many-to-many join tables
  for data that's always read/written as a unit.
- **Setting model is key-value** — flexible for adding new settings without migrations. Encrypted flag marks values that
  need decryption before use (SMTP password, restic password, registry credentials).
- **StatusLog is append-only** — never updated or deleted (except via retention cleanup). Provides a complete audit
  trail.

---

## Compose File Parsing & File Watching

### Source of Truth Principle

The `docker-compose.yml` on disk is always authoritative. The database stores derived metadata only. This means external
edits (e.g., via SSH) are a supported workflow, not a bug.

### File Watcher (Required)

A background process using **chokidar** (Node.js) monitors `/stacks/*/docker-compose.yml` for changes:

- On change detection: re-hash file (SHA256), compare to `lastKnownHash` in DB.
- If hash differs: re-parse, update DB metadata, flag stack as "config changed" in the UI.
- Polling interval as fallback: every 60 seconds, reconciliation loop hashes all compose files to catch any events
  missed by the filesystem watcher (e.g., NFS mounts where inotify is unreliable).

### What to Extract on Parse

- Service names
- Image names and tags
- Published ports
- Environment variables
- Volume mounts — **validated against bind-mount convention** (see Volume Strategy)
- Health check definitions (if present)

### Cache Strategy

- Store `lastParsedAt` and `lastKnownHash` per stack.
- Re-parse only if hash changes.

---

## UI & User Interaction

### Stack Management

- Create a stack by uploading or pasting YAML.
- View/edit compose file in CodeMirror with syntax highlighting and validation.
- Deploy stack (creates directory, writes files, runs `docker compose up -d`).
- Visual indicator when on-disk config differs from last-deployed state.

### Logs

Live streaming via SSE: dockerode's container log stream pushes lines to the frontend. Each service gets its own stream;
the UI shows a combined view with service-name prefixes and per-service filtering. Docker's `json-file` logging driver
with rotation (`max-size: 10m`, `max-file: 5`) handles persistence. The `logs/` directory in the stack is reserved for
Docktor's operational logs (deploy output, backup output), not container logs.

### Status & Health Checks

Status is derived from container state (`docker inspect`) and Docker's native `HEALTHCHECK`. The StatusLog records
transitions with timestamps for uptime tracking.

### Stack Lifecycle State Machine

**States:**

| State        | Meaning                                                                             |
|--------------|-------------------------------------------------------------------------------------|
| `DRAFT`      | Stack created in DB, compose file written, but never deployed.                      |
| `DEPLOYING`  | `docker compose up -d` is currently running.                                        |
| `RUNNING`    | All containers are up. No healthcheck defined, or healthcheck not yet evaluated.    |
| `HEALTHY`    | All containers are up and all healthchecks pass.                                    |
| `UNHEALTHY`  | One or more containers report unhealthy via Docker HEALTHCHECK.                     |
| `STOPPED`    | All containers are stopped (user-initiated via `docker compose stop`).              |
| `ERROR`      | Deploy failed, or one or more containers are in a crash loop / exited unexpectedly. |
| `UPDATING`   | Pulling new images and recreating containers.                                       |
| `BACKING_UP` | Backup in progress (containers may be stopped during this operation).               |
| `RESTORING`  | Restore from backup in progress.                                                    |
| `MIGRATING`  | Brownfield full migration in progress.                                              |

**Transitions:**

```
                    ┌──────────────────────────────────────┐
                    │                                      │
  ┌───────┐   deploy   ┌───────────┐   success   ┌─────────┐
  │ DRAFT │──────────►│ DEPLOYING │────────────►│ RUNNING │
  └───────┘           └───────────┘              └────┬────┘
                           │                          │
                        failure                  healthcheck
                           │                      passes
                           ▼                          │
                      ┌───────┐                  ┌────▼─────┐
                      │ ERROR │◄─── unhealthy ──│ HEALTHY  │
                      └───┬───┘                  └────┬─────┘
                          │                           │
                       deploy                    healthcheck
                       (retry)                     fails
                          │                           │
                          ▼                      ┌────▼──────┐
                    ┌───────────┐                │ UNHEALTHY │
                    │ DEPLOYING │                └───────────┘
                    └───────────┘

  From RUNNING/HEALTHY/UNHEALTHY:
    ── stop ────────► STOPPED
    ── update ──────► UPDATING ──► RUNNING/HEALTHY or ERROR
    ── backup ──────► BACKING_UP ──► (previous state)
    ── restore ─────► RESTORING ──► DEPLOYING ──► RUNNING/HEALTHY or ERROR

  From STOPPED:
    ── deploy ──────► DEPLOYING ──► RUNNING/HEALTHY or ERROR

  From ERROR:
    ── deploy ──────► DEPLOYING (user retries after fixing the issue)
    ── stop ────────► STOPPED
```

**Auto-transitions** (no user action): RUNNING↔HEALTHY↔UNHEALTHY↔ERROR based on healthcheck and container state
changes. BACKING_UP returns to previous state on completion. Polling interval: 15 seconds.

### Operation Locking via State

The state machine prevents conflicting concurrent operations. The UI disables buttons accordingly:

| Current state                       | Allowed user actions                          |
|-------------------------------------|-----------------------------------------------|
| `DRAFT`                             | Deploy, Delete                                |
| `DEPLOYING`                         | (none — wait)                                 |
| `RUNNING` / `HEALTHY` / `UNHEALTHY` | Stop, Update, Backup, Restore, Edit, Delete   |
| `STOPPED`                           | Deploy (start), Backup, Restore, Edit, Delete |
| `ERROR`                             | Deploy (retry), Stop, Delete, view Logs       |
| `UPDATING`                          | (none — wait)                                 |
| `BACKING_UP`                        | (none — wait)                                 |
| `RESTORING`                         | (none — wait)                                 |
| `MIGRATING`                         | (none — wait)                                 |

### Disk Space Monitoring

Per-stack volume size (hourly via `du -sb`) and host-level disk space (via `df`). Warnings when disk drops below 10% or
2 GB, or when a stack grows >20% between checks.

### Updates

Docktor checks registries for newer images using semver comparison, date-based comparison, or digest comparison as
fallback. Updates are never automatic — always user-initiated via an "Update" button.

---

## Networking

### Current Scope (MVP)

Each stack gets its own default Docker bridge network (standard `docker compose` behavior). Services within a stack can
communicate freely.

### Inter-Stack Communication (Post-MVP)

A Docktor-managed "shared" overlay network that stacks can opt into. Only explicitly declared connections are allowed.
For MVP, users who need inter-stack communication can manually add `external: true` networks to their compose files.

---

## Proxy Configuration

### Philosophy

Rather than building a reverse proxy from scratch, Docktor integrates with existing, battle-tested solutions.

### Supported Approaches

1. **Nginx Proxy Manager (NPM) integration** (recommended for target audience):
    - NPM runs as a system-level stack managed by Docktor.
    - When a user configures proxy exposure for a stack, Docktor calls the NPM API to create/update proxy hosts.
    - TLS is handled automatically by NPM via Let's Encrypt.

2. **Raw Nginx config generation** (advanced users):
    - Docktor generates Nginx server blocks and writes them to a config directory.
    - User manages Nginx and Certbot themselves.

### Exposure Rules

Per stack, the user can define:

- **Domain name** (e.g., `cloud.example.com`)
- **Internal service and port** (e.g., `nextcloud:80`)
- **TLS:** On by default (via Let's Encrypt through NPM).
- **Public/private:** Whether the service is internet-facing or LAN-only.

Only services explicitly marked for proxy exposure are accessible. Supporting services (databases, Redis, etc.) remain
on internal Docker networks only.

---

## Secrets & Environment Variables

### Problem

`.env` files contain secrets (DB passwords, API keys) and sit in plaintext on disk. This is standard Docker practice but
is a risk if the host is compromised.

### Approach (MVP)

- `.env` files remain on disk (consistent with how Docker Compose expects them).
- File permissions are locked down: `chmod 600`, owned by the Docktor system user.
- Secrets are **not** stored in the database — the DB only stores non-sensitive metadata.
- Backups via restic are encrypted at rest, which covers the backup vector.

### Approach (Post-MVP)

- Optional integration with **Docker Secrets** for swarm-capable setups.
- Optional encryption of `.env` files at rest using a master key derived from the user's password (decrypted into memory
  on stack deploy).

> **Design note:** Storing secrets in the database was considered but rejected — it would make the DB a high-value
> target and duplicate what's already on the filesystem. Defense-in-depth via filesystem permissions + encrypted backups
> is the pragmatic MVP path.

---

## Global Settings

All global configuration is stored in the database (in a `Settings` key-value model) and editable via a Settings page in
the UI. Environment variables from Docktor's own compose file serve as initial defaults only — once the wizard
completes, the DB is authoritative.

### Settings Categories

**General:**

| Key             | Type   | Description                                                             |
|-----------------|--------|-------------------------------------------------------------------------|
| `instance_name` | string | Display name for this Docktor instance (e.g., "My Home Server")         |
| `base_url`      | string | External URL for Docktor (e.g., `https://docktor.example.com`)          |
| `timezone`      | string | IANA timezone (e.g., `Europe/Berlin`) for scheduling and log timestamps |

**Backup (Restic):**

| Key                        | Type               | Description                                                       |
|----------------------------|--------------------|-------------------------------------------------------------------|
| `restic_repo_path`         | string             | Repository location: local path, `sftp:...`, or `s3:...`         |
| `restic_password`          | string (encrypted) | Repository encryption password. Stored encrypted in DB.           |
| `backup_default_schedule`  | string             | Default cron expression (e.g., `0 2 * * *` for daily at 2 AM)    |
| `backup_default_retention` | JSON               | Retention policy (e.g., `{ "daily": 7, "weekly": 4, "monthly": 6 }`) |

**Notifications (SMTP):**

| Key                      | Type               | Description                     |
|--------------------------|--------------------|---------------------------------|
| `smtp_host`              | string             | SMTP server hostname            |
| `smtp_port`              | number             | SMTP port (default: 587)        |
| `smtp_username`          | string             | SMTP username                   |
| `smtp_password`          | string (encrypted) | SMTP password, stored encrypted |
| `smtp_from`              | string             | Sender email address            |
| `notification_recipient` | string             | Where to send alerts            |
| `smtp_enabled`           | boolean            | Master toggle                   |

---

## Registry Configuration

Docktor needs access to Docker registries to check for image updates and pull images.

### MVP: Public Registries Only

Works with publicly accessible images from Docker Hub, GHCR, and Quay.io. Update checks use the registry's HTTP API
(v2 manifest endpoint) to compare digests and list tags.

### Post-MVP: Authenticated Registries

A Registry management page in Settings allows adding multiple registries with credentials (stored encrypted). Used for
pulling images, querying tags during update checks, and accessing private marketplace template images.

---

## YAML Validation & Safety

Docktor should never prevent users from doing what Docker itself allows, but ensures dangerous choices are made
*knowingly*.

**Validation layers:**

1. **Syntax validation:** YAML parse errors shown inline in CodeMirror before deployment.
2. **Volume convention enforcement:** Named volumes rejected with auto-convert offer. Absolute paths outside the stack
   directory trigger a backup warning.
3. **Warning system:** `privileged: true`, host mounts outside `/stacks/`, `network_mode: host`, sensitive `cap_add`
   capabilities — all trigger a visible (yellow, non-blocking) warning banner.
4. **Confirmation dialog:** If warnings are present, deployment requires an explicit "I understand the risks" confirmation.

---

## Notifications

Notifications are sent via SMTP to the configured recipient email. Triggers:

- **Stack enters `ERROR` or `UNHEALTHY` state** — includes stack name, state, timestamp, last few log lines.
- **Backup failure** — includes stack name, error message, timestamp.
- **Disk space warning** — triggered when available disk drops below 10% or 2 GB.
- **Backup completed successfully** (optional, off by default).

Each trigger type can be individually enabled/disabled in Settings.

---

## Backup & Restore

**What gets backed up:** The entire stack directory (`docker-compose.yml`, `.env`, `volumes/`), excluding `logs/`.
Absolute-path volumes outside the stack are not included (warned at edit and backup time).

**Engine:** Restic — encrypted, deduplicated, versioned snapshots. Targets: local directory, SFTP, S3-compatible
storage. Snapshot metadata stored in the database.

**Consistency:** Stop-and-backup is the default (brief downtime). Templates can define optional pre/post-backup hooks
for application-aware backups (e.g., `pg_dump` before backup) to avoid stopping containers.

**Restore:** Select snapshot → stop stack → restic restore to temp location → move into place → redeploy → health check.

**Scheduling:** Per-stack cron expressions via node-cron. Configurable retention policies (daily/weekly/monthly).

---

## Marketplace

> **Status: Post-MVP.** Starts simple and grows.

The Marketplace provides reusable templates for deploying common self-hosting apps. **MVP approach:** ~20 bundled
templates (Nextcloud, Vaultwarden, Gitea, Immich, etc.) ship with the Docker image, plus a remote index fetched from
`marketplace.docktor.io` for publishing new templates without updating Docktor.

All templates must follow Docktor conventions (bind-mount volumes, `.env`-based config). Community templates display a
review warning before deployment. The full SaaS marketplace (user accounts, publishing, ratings, reviews) is a separate
future project.

---

## Security Summary (MVP)

| Concern                      | Mitigation                                                                                        |
|------------------------------|---------------------------------------------------------------------------------------------------|
| Docker socket access         | Required for operation. Equivalent to root. Documented clearly in install guide.                  |
| Host filesystem (brownfield) | Mounted read-only (`/:/host:ro`). Restrictive alternative: mount only specific scan paths.        |
| Auth                         | Session-based auth via better-auth. Single user for MVP.                                          |
| HTTPS for UI                 | Docktor's own UI served behind the same Nginx/NPM proxy with TLS.                                |
| CSRF                         | Fastify CSRF plugin enabled by default.                                                           |
| Secrets on disk              | `.env` files with `chmod 600`. Not stored in DB.                                                  |
| Secrets in DB                | SMTP password, restic password, registry tokens stored AES-encrypted in Settings/Registry models. |
| Secrets in backups           | Restic encryption at rest.                                                                        |
| Arbitrary YAML               | Warning system + confirmation dialog. Never blocks, always informs.                               |
| Marketplace templates        | Confirmation dialog with risk summary for community templates.                                    |
| RBAC                         | Deferred to post-MVP. Single-user model sufficient for personal server use case.                  |

---

## Implementation Priority

### Phase 1 — MVP (Core Stack Management)

| Task                        | Status |
|-----------------------------|--------|
| Auth (better-auth)          | Done   |
| DB schema (Prisma models)   | Done   |
| Shared types & validation   | Done   |
| Client shell (React + routing + shadcn/ui) | Done |
| Dev/prod config             | Done   |
| Stack CRUD API              | Next   |
| Docker service layer        | Next   |
| Stack operations (deploy/stop/restart/update) | Next |
| Container state poller      | Next   |
| Live log streaming (SSE)    | Next   |
| Dashboard UI                | Next   |
| Stack detail page           | Next   |
| Create stack page           | Next   |
| Basic settings page         | Next   |

### Phase 2 — Post-MVP (in rough priority order)

1. First-run wizard
2. Brownfield import & scanning
3. Backup & restore (restic)
4. Proxy configuration (NPM integration)
5. Marketplace (bundled templates + remote index)
6. Notifications (SMTP)
7. Disk space monitoring
8. File watcher
9. Update checker

---

## Future Roadmap (Out of Scope for MVP)

- RBAC and multi-user access control per stack
- Inter-stack networking with shared Docker networks
- Marketplace SaaS platform (user accounts, publishing, ratings, reviews)
- Authenticated private registry support
- Docktor self-update via the UI
- Plugin system for extensibility
- Form-based YAML abstraction (JSON Schema rendering)
- Metrics and dashboards (Prometheus/Grafana integration)
- OAuth or LDAP integration
- Docker Secrets integration
- Application-aware backup hooks as first-class template feature
- Template signing and automated security scanning

---

## Summary

Docktor favors simplicity, file-based configuration, and user empowerment. It is designed for a single server, a single
user, and the principle that the tool should make Docker easier without making it less capable. The YAML-first approach
and bind-mount volume convention keep the system transparent and recoverable — if Docktor disappears, the user still has
working compose files and all their data in plain directories on disk.
