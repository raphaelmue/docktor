# Docktor – Technical Design Document

## Overview

Docktor is a self-hosting management platform that provides a UI-driven experience for deploying, updating, and managing Docker-based applications using `docker-compose`. It targets end users who run a single VPS or local server and want to self-host applications like Nextcloud, Vaultwarden, etc. without deep Docker expertise.

**Core principles:**

- **Data sovereignty & privacy first** — replaces reliance on third-party cloud services.
- **Single-host by design** — not a clustering tool. One server, one Docktor instance.
- **YAML-first** — the compose file is the source of truth, not the database.
- **User empowerment** — the tool should never restrict what Docker itself allows. It makes things easier, not more locked down.

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

When a user opens Docktor for the first time after installation, there is no account yet and no configuration. The UI presents a setup wizard:

### Step 1 — Account Creation

- Email and password for the admin account.
- This is the only user for MVP (no registration page, no invite flow).
- Password is hashed (bcrypt/argon2) and stored in the database.

### Step 2 — Base Configuration

- **Instance name** (e.g., "My Home Server") — displayed in the UI header and notifications.
- **Base URL** (e.g., `https://docktor.example.com`) — pre-filled from `DOCKTOR_BASE_URL` env var if set during install.
- **Time zone** — for scheduling (backups, log timestamps).

### Step 3 — Backup Configuration (Optional, Skippable)

- **Restic repository location:** Local path (default: `/backups`), SFTP, or S3-compatible endpoint.
- **Restic repository password:** Auto-generated and displayed once, or user-provided. Stored encrypted in the database.
- If skipped: backup features are disabled until configured later in settings.

### Step 4 — Notification Configuration (Optional, Skippable)

- **SMTP server, port, username, password, sender address.**
- **Notification recipient email.**
- "Send test email" button to verify.
- If skipped: notifications are disabled until configured later in settings.

### Step 5 — Existing Stack Discovery (Optional, Skippable)

- "Scan this server for existing Docker Compose stacks?"
- If yes: runs the brownfield scan (see Stack Import section) and presents results.
- If no: user lands on an empty dashboard and can create stacks manually.

### Post-Wizard

After the wizard completes, the user lands on the main dashboard. All wizard settings are editable later via the Settings page.

---

## Core Concepts

### Stack

A "Stack" represents a single `docker-compose` file with one or more Docker services (e.g., app + database). Physically stored in a directory.

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

**Stack ID:** User-provided name, slugified (lowercase, alphanumeric + hyphens, max 63 chars to stay compatible with Docker Compose project names and DNS labels). Example: user enters "My Nextcloud" → stack ID becomes `my-nextcloud`. Must be unique. Validated on creation.

### Template

A reusable blueprint for deploying a new stack. Includes a versioned `docker-compose.yml` and optional metadata. Stored centrally and publicly browsable via the Marketplace.

### Volume Strategy: Bind Mounts Only

**Requirement:** All persistent data must be bind-mounted into the stack's `volumes/` directory. Named Docker volumes are not used.

#### Rationale

- **Backup simplicity:** The entire stack — config, secrets, and data — lives under one directory tree. Backing up a stack is backing up a folder. No need to interact with the Docker volume API, run sidecar containers, or use `docker cp`.
- **Transparency:** Users can browse, inspect, and manually fix their data via the filesystem. No data is hidden inside Docker-managed paths in `/var/lib/docker/volumes/`.
- **Portability:** Moving a stack to another server is a directory copy. No `docker volume export/import` dance.
- **Restic-friendly:** Restic can back up the `volumes/` directory directly — no pre-processing or temporary containers needed.

#### Compose File Convention

All `docker-compose.yml` files managed by Docktor **must** use relative bind mounts into `./volumes/`:

```yaml
# ✅ Correct — bind mount into the stack's volumes/ directory
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
# ❌ Rejected — named Docker volumes
services:
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

```yaml
# ⚠️ Warning — absolute host path outside the stack directory
services:
  app:
    volumes:
      - /mnt/nas/photos:/data/photos
```

#### Enforcement

1. **On stack creation / edit:** Docktor parses the compose file and checks all volume definitions.
   - **Relative bind mounts into `./volumes/`**: Accepted silently.
   - **Named Docker volumes**: Rejected with an error message explaining the convention and offering to auto-convert (rewrite the compose file to use bind mounts).
   - **Absolute paths outside the stack directory**: Accepted with a warning — the user may have legitimate reasons (e.g., NAS mount), but Docktor warns that these paths will **not** be included in backups.
2. **Auto-conversion tool:** When importing a third-party compose file or deploying from the marketplace, Docktor offers a one-click "Convert volumes" action that rewrites named volumes to `./volumes/<volume-name>` bind mounts.
3. **Directory creation:** On deploy, Docktor ensures all `./volumes/<subdir>` directories exist with correct ownership before running `docker compose up`.

#### Marketplace Templates

All official and community templates **must** follow the bind-mount convention. This is a hard requirement for template acceptance. The template linter rejects named volumes.

#### Edge Cases & Limitations

- **Shared volumes across stacks:** Not supported via the `volumes/` convention. If two stacks need access to the same data, the user must use absolute paths (with the associated backup warning). This is an accepted limitation for MVP.
- **Volume drivers / remote volumes:** Not supported. Users who need NFS, CIFS, or other volume drivers can use absolute paths. Docktor is not a storage orchestrator.
- **Ownership / permissions:** Some images expect specific UID/GID on mounted directories (e.g., Postgres expects `999:999`). Docktor should document this and, where possible, set correct ownership on directory creation based on template metadata stored in the database.

---

## Stack Import: Greenfield vs. Brownfield

### The Problem

Docktor's most likely early adopters are people who already self-host applications via Docker Compose. Their existing setups will not match Docktor's conventions:

| Convention | Docktor expects | Typical existing setup |
|---|---|---|
| Directory | `/stacks/<stack-id>/` | `~/docker/nextcloud/`, `/opt/apps/bitwarden/`, etc. |
| Volumes | `./volumes/<name>` bind mounts | Named Docker volumes, absolute paths, or bind mounts scattered across the filesystem |
| Env vars | `.env` file in stack directory | Inline `environment:` blocks, `.env` in a parent directory, or multiple `.env.xyz` files |
| Logs dir | `./logs/` present | Does not exist |

If Docktor only supports greenfield deployment, adoption requires users to manually tear down and rebuild every existing stack. Nobody will do that.

### Design Principle

Import should be **guided, transparent, and non-destructive**. The user should see exactly what will change, approve each step, and be able to abort at any point without having lost anything.

### Import Modes

#### 1. Scan & Discover

Docktor offers a "Scan for existing stacks" feature that searches the filesystem for `docker-compose.yml` files:

- Default scan paths: `/home/*/`, `/opt/`, `/srv/`, `/root/` (configurable).
- For each found compose file, Docktor shows: directory path, service names, images, current container state (running/stopped), and a compatibility assessment.

The compatibility assessment flags what needs to change:

```
✅ Compose file found — parseable
⚠️ 2 named volumes detected — need conversion to bind mounts
⚠️ Environment variables inline — recommend extracting to .env
✅ Already uses bind mounts for 1 of 3 volumes
ℹ️ Directory will be restructured into /stacks/<stack-id>/
```

#### 2. Adopt in Place (Lightweight)

For users who don't want to move directories, Docktor can manage a stack **where it already lives**:

- Docktor registers the existing directory as a stack in the database and creates the `logs/` subdirectory.
- The compose file is used as-is — no restructuring.
- **Trade-off:** The stack won't fully conform to Docktor conventions. Named volumes remain named volumes. Backup coverage may be incomplete (Docktor warns about this clearly).
- **Benefit:** Zero downtime, zero risk. The user can upgrade to full migration later.

This is the "I just want Docktor to monitor and manage what I already have" path.

#### 3. Full Migration (Recommended)

A guided wizard that restructures an existing stack into Docktor's conventions. Steps:

**Step 1 — Analysis**

Docktor parses the existing compose file and presents a migration plan:

```
Stack: Nextcloud (from /home/user/docker/nextcloud/)
Target: /stacks/nextcloud/

Changes required:
 1. Copy docker-compose.yml → /stacks/nextcloud/docker-compose.yml
 2. Extract inline env vars → /stacks/nextcloud/.env
 3. Convert volume "nextcloud-db" → ./volumes/db-data (migrate 2.3 GB)
 4. Convert volume "nextcloud-app" → ./volumes/app-data (migrate 14.1 GB)
 5. Rewrite volume paths in docker-compose.yml
 6. Keep absolute mount /mnt/nas/photos as-is (⚠️ not included in backups)

Estimated downtime: ~5 minutes (stop → copy data → start)
```

**Step 2 — Confirmation**

User reviews the plan. They can:
- Adjust the target stack ID/name.
- Exclude specific volumes from migration (keep as named volumes, with backup warning).
- Adjust the `.env` extraction (choose which inline vars to externalize).

**Step 3 — Execution**

1. `docker compose stop` in the original directory.
2. Create `/stacks/<stack-id>/` directory structure.
3. Copy `docker-compose.yml` and create/extract `.env`.
4. **Migrate volume data:**
   - For **named Docker volumes**: `docker run --rm -v <volume-name>:/source -v /stacks/<stack-id>/volumes/<name>:/dest alpine cp -a /source/. /dest/` — copies data from the Docker-managed volume into the bind mount directory.
   - For **existing bind mounts at other paths**: `cp -a` or `rsync` the data into `./volumes/<name>/`, then update the compose file path.
   - For **absolute paths the user wants to keep**: Leave as-is, record in the database.
5. Rewrite `docker-compose.yml` to use `./volumes/` bind mounts.
6. Store import provenance in the database (original path, migration date, original compose hash).
7. `docker compose up -d` from the new location.
8. Health check verification — confirm containers are running and healthy.

**Step 4 — Cleanup (User-Initiated)**

After verifying the migrated stack works:
- Docktor offers to remove the old named Docker volumes (`docker volume rm`).
- Docktor offers to remove or archive the original directory.
- This is never automatic — the user must explicitly confirm deletion.

### Handling Environment Variables

Existing setups use env vars in various ways. The import wizard handles each:

| Source | Import behavior |
|---|---|
| `environment:` block in compose (key-value) | Extract to `.env`, replace with `${VAR_NAME}` references in compose |
| `environment:` block with hardcoded secrets | Same as above, with a warning that secrets were found inline |
| `env_file:` pointing to a custom path | Copy the file to `.env` in the stack directory, update the reference |
| `.env` already in the same directory | Copy as-is |
| Multiple `.env.*` files | Merge into single `.env`, preserving comments; warn about conflicts |

### Handling Running Containers

The import must handle stacks that are currently running:

- **Adopt in place:** No disruption. Docktor attaches to existing containers.
- **Full migration:** Requires downtime. The wizard shows estimated duration based on volume data size and warns clearly: "Your services will be offline for approximately X minutes during migration."
- **Rollback:** If migration fails at any step, Docktor rolls back: restarts the original compose in the original directory. The old data is never deleted until the user confirms success.

### Docker Compose Discovery via Docker API

In addition to filesystem scanning, Docktor can use `docker compose ls` (or the Docker API's label-based filtering) to find compose projects that are currently running, even if the user doesn't remember where the compose file lives. This catches cases where the compose file is in a non-standard location.

### Post-Import Validation

After import (either mode), Docktor runs its standard validation:

- Volume convention check (warnings for non-conforming mounts).
- YAML safety scan (privileged, host mounts, etc.).
- Health check detection.
- Parse and cache service metadata.

---

## Implementation Stack

### Backend

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | **Node.js (LTS) with TypeScript** | Strong Docker SDK support, async I/O for log streaming, type safety throughout |
| Framework | **Fastify** | Schema-based validation, high performance, excellent plugin ecosystem |
| ORM / DB | **Prisma + SQLite** (upgrade path to Postgres) | SQLite keeps single-host deployment trivial; Prisma makes migration painless later |
| Docker interaction | **dockerode** | Mature Node.js Docker client for inspect, log streaming, events |
| Compose orchestration | Shell out to `docker compose` CLI | Wrapped in a typed service layer; dockerode doesn't handle compose natively |
| Job scheduler | **node-cron** (MVP), upgrade to **BullMQ + Redis** later | File-watch reconciliation, update checks, backup scheduling |
| Auth | **Lucia** or **better-auth** | Lightweight, session-based; sufficient for single-user MVP |

### Frontend

| Layer | Technology | Rationale |
|---|---|---|
| Framework | **Next.js (App Router)** | Full-stack React framework, SSR, API routes, strong ecosystem |
| UI library | **shadcn/ui + Tailwind CSS** | Accessible, composable components without heavy dependencies |
| YAML editor | **CodeMirror 6** | Mature, extensible, good YAML mode support |
| Real-time logs | **SSE (Server-Sent Events)** | Simpler than WebSockets for unidirectional log streaming from `docker logs --follow` |

### Infrastructure / System-Level

| Concern | Technology |
|---|---|
| Reverse proxy | **Nginx** (with optional Nginx Proxy Manager integration — see Proxy section) |
| Backup engine | **Restic** invoked via CLI from the backend |
| Container runtime | **Docker Engine + Docker Compose v2** (plugin) |
| Packaging | Docktor ships as a Docker Compose stack itself (dogfooding) |
| OS target | Debian/Ubuntu LTS primarily; install script provided |

### Project Structure

```
docktor/
├── apps/
│   ├── api/              # Fastify backend (TypeScript)
│   └── web/              # Next.js frontend
├── packages/
│   ├── docker/           # dockerode + compose CLI wrapper
│   ├── backup/           # restic CLI wrapper
│   ├── proxy/            # Nginx config generator / NPM API client
│   └── shared/           # shared types, validation, utils
├── prisma/
│   └── schema.prisma
├── docker-compose.yml    # Docktor's own deployment
└── install.sh
```

---

## Docktor Deployment

### Architecture: Docker Managing Docker

Docktor itself runs as a Docker Compose stack. This creates a recursive situation: a container that manages other containers and needs access to both the Docker daemon and the host filesystem. This is solved entirely through bind mounts and the Docker socket — no Docker-in-Docker (DinD) required.

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
│  │    /opt/docktor/data    → SQLite DB, config     │   │
│  │    /opt/docktor/backups → restic repo           │   │
│  │                                                │   │
│  │  Runs: Fastify API + Next.js frontend          │   │
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
│  ┌─── Stack: Vaultwarden ────────────────────────┐   │
│  │  /opt/docktor/stacks/vaultwarden/              │   │
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
      # Docker socket — allows Docktor to manage containers on the host
      - /var/run/docker.sock:/var/run/docker.sock

      # Stacks directory — where all managed stacks live
      - /opt/docktor/stacks:/stacks

      # Docktor's own persistent data (SQLite DB, config)
      - /opt/docktor/data:/data

      # Restic backup repository
      - /opt/docktor/backups:/backups

      # Brownfield: host filesystem access for scanning existing stacks
      - /:/host:ro
    environment:
      - DOCKTOR_BASE_URL=https://docktor.example.com
      - DOCKTOR_STACKS_DIR=/stacks
      - DOCKTOR_DATA_DIR=/data
      - DOCKTOR_BACKUP_DIR=/backups
```

### Key Design Decisions

#### Docker Socket, Not DinD

Docktor mounts the host's Docker socket (`/var/run/docker.sock`). This means:

- Docktor's container talks directly to the host's Docker daemon.
- When Docktor runs `docker compose up`, the resulting containers are **siblings** on the host, not nested children.
- All containers (Docktor + managed stacks) share the same Docker daemon and see each other.
- This is the same pattern used by Portainer, Traefik, and other Docker management tools.

> **Security note:** Docker socket access is effectively root on the host. This is an inherent requirement for any Docker management tool. The install script documents this clearly.

#### /stacks/ is a Host Bind Mount

The `/stacks/` directory inside the Docktor container maps to `/opt/docktor/stacks/` on the host (configurable). This is critical because:

- **Stack compose files reference `./volumes/` paths.** When Docktor shells out to `docker compose up` inside `/stacks/nextcloud/`, the compose file's `./volumes/db-data` resolves to `/stacks/nextcloud/volumes/db-data` inside the Docktor container — which is `/opt/docktor/stacks/nextcloud/volumes/db-data` on the host. Docker sees the host path because the compose commands run through the host's Docker daemon via the socket.
- **Path translation is required.** Docktor must be aware that paths inside its container differ from paths on the host. The `DOCKTOR_STACKS_DIR` env var and the mount point establish this mapping. When generating compose commands or inspecting volume mounts, Docktor translates between container paths (`/stacks/...`) and host paths (`/opt/docktor/stacks/...`).

#### Host Filesystem Access for Brownfield

For brownfield import (scanning for existing stacks), Docktor needs to read the host filesystem beyond just `/stacks/`. This is solved by a **read-only mount of the host root**:

```yaml
- /:/host:ro
```

- The scan feature searches under `/host/home/`, `/host/opt/`, `/host/srv/`, etc.
- This mount is **read-only** — Docktor can discover and analyze existing stacks but cannot modify them in place from this mount.
- For "Adopt in Place" mode, Docktor creates a symlink or registers the host path — but compose commands still run through the Docker socket, which operates on host paths natively.
- For "Full Migration" mode, data is copied from the discovered location into `/stacks/<stack-id>/` (which is writable).

> **Alternative (more restrictive):** Instead of mounting `/`, the user can configure specific scan paths in the install script:
> ```yaml
> - /home:/host/home:ro
> - /opt:/host/opt:ro
> - /srv:/host/srv:ro
> ```
> This is more secure but requires the user to know where their stacks live.

#### Path Translation: Container vs. Host

This is the single trickiest aspect of the architecture. Docktor operates inside a container but orchestrates processes on the host:

| Operation | Docktor sees (container path) | Docker daemon sees (host path) |
|---|---|---|
| Stack directory | `/stacks/nextcloud/` | `/opt/docktor/stacks/nextcloud/` |
| Volume bind mount | `./volumes/db-data` (relative) | `/opt/docktor/stacks/nextcloud/volumes/db-data` |
| Brownfield scan | `/host/home/user/docker/` | `/home/user/docker/` |
| SQLite database | `/data/docktor.db` | `/opt/docktor/data/docktor.db` |

**Implementation rule:** All compose file paths use **relative paths** (`./volumes/...`). Since `docker compose` is invoked with the working directory set to the stack directory, and the Docker daemon resolves paths from the host perspective via the bind mount, relative paths resolve correctly on the host without explicit translation.

For brownfield scanning and migration, a `PathResolver` utility translates between the `/host/...` mount and actual host paths:

```typescript
class PathResolver {
  // /host/home/user/docker → /home/user/docker (strip mount prefix for display)
  toHostPath(containerPath: string): string;
  // /home/user/docker → /host/home/user/docker (add mount prefix for access)
  toContainerPath(hostPath: string): string;
  // /opt/docktor/stacks/nextcloud → /stacks/nextcloud (for internal use)
  toStacksPath(hostPath: string): string;
}
```

### Docktor as a Self-Managed Stack

Docktor does **not** appear in its own UI as a manageable stack. It is a system-level service, not a user stack. Reasons:

- Allowing users to stop/restart Docktor from within Docktor creates an obvious problem.
- Docktor's own updates are handled via `docker compose pull && docker compose up -d` from the host (SSH). A UI-based self-update mechanism is out of scope for MVP.
- Docktor's own data (`/data/`) is backed up as part of a system-level backup, not per-stack backup.

### Install Script

The install experience should be a single command:

```bash
curl -fsSL https://get.docktor.io | bash
```

The script:

1. Checks prerequisites: Docker Engine, Docker Compose v2 plugin, minimum Docker version.
2. Creates directory structure: `/opt/docktor/{stacks,data,backups}`.
3. Writes `docker-compose.yml` for Docktor with sensible defaults.
4. Prompts for base URL / domain (or defaults to `http://localhost:8443`).
5. Runs `docker compose up -d`.
6. Prints the URL to access the Docktor UI and first-run setup instructions.

For users who want more control, a manual install guide is also provided.

### Adopt in Place: How It Works with Docker Socket

When Docktor adopts an existing stack "in place" (brownfield, lightweight mode), the compose file stays in its original host directory (e.g., `/home/user/docker/nextcloud/`). This works because:

1. Docktor discovers the stack by scanning `/host/home/user/docker/nextcloud/docker-compose.yml` (read-only mount).
2. Docktor registers the **host path** (`/home/user/docker/nextcloud/`) in its database, not the container path.
3. When running compose commands, Docktor invokes `docker compose -f /home/user/docker/nextcloud/docker-compose.yml up -d`. Since this runs through the Docker socket and the Docker daemon operates on host paths, it resolves correctly — even though Docktor itself can't write to that path via its `/host` read-only mount.
4. The file watcher monitors the stack via the read-only `/host/...` mount (read is sufficient for hash checks).
5. To edit the compose file for an adopted-in-place stack, Docktor displays the file in the editor but writes require the user to save changes on the host (or the user can migrate to full management under `/stacks/`).

> **Limitation:** Adopted-in-place stacks have reduced Docktor functionality — no direct compose editing, no volume convention enforcement, incomplete backup coverage. The UI makes this clear with a "Partially managed — migrate for full features" badge.

---

## Database Schema

All metadata is stored in SQLite via Prisma. The compose file and `.env` remain on disk — the database stores derived and operational data only.

```prisma
// prisma/schema.prisma

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL") // default: file:/data/docktor.db
}

generator client {
  provider = "prisma-client-js"
}

// ─── Authentication ─────────────────────────────────────────

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  passwordHash   String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  sessions       Session[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

// ─── Stacks ─────────────────────────────────────────────────

model Stack {
  id               String        @id // slugified name, e.g. "my-nextcloud"
  displayName      String        // user-facing name, e.g. "My Nextcloud"
  description      String?

  // Filesystem
  hostPath         String        // absolute host path, e.g. "/opt/docktor/stacks/my-nextcloud"
  isAdoptedInPlace Boolean       @default(false) // true = brownfield adopt, limited features

  // State machine
  status           StackStatus   @default(DRAFT)
  previousStatus   StackStatus?  // stored before transient states (BACKING_UP, etc.)

  // Compose parsing cache
  lastKnownHash    String?       // SHA256 of docker-compose.yml
  lastParsedAt     DateTime?
  configChanged    Boolean       @default(false) // true = file changed since last deploy

  // Import provenance (brownfield migration)
  importedFrom     String?       // original host path before migration
  importedAt       DateTime?

  // Disk usage
  volumeSizeBytes  BigInt?       // last measured size of ./volumes/
  volumeSizeAt     DateTime?     // when volumeSizeBytes was last updated

  // Backup hooks (optional, JSON)
  backupPreHook    String?       // shell command to run before backup
  backupPostHook   String?       // shell command to run after backup

  // Scheduling
  backupSchedule   String?       // cron expression, null = use global default
  backupRetention  String?       // JSON retention policy, null = use global default

  // Relations
  services         Service[]
  proxyConfigs     ProxyConfig[]
  backups          Backup[]
  statusLogs       StatusLog[]
  deployments      Deployment[]

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
}

enum StackStatus {
  DRAFT
  DEPLOYING
  RUNNING
  HEALTHY
  UNHEALTHY
  STOPPED
  ERROR
  UPDATING
  BACKING_UP
  RESTORING
  MIGRATING
}

// ─── Parsed Service Metadata ────────────────────────────────

model Service {
  id            String   @id @default(cuid())
  stackId       String
  stack         Stack    @relation(fields: [stackId], references: [id], onDelete: Cascade)

  serviceName   String   // as defined in docker-compose.yml
  image         String   // e.g. "nextcloud:28"
  imageTag      String?  // e.g. "28" (extracted)
  imageDigest   String?  // current local digest

  // Ports (JSON array of { host: number, container: number, protocol: string })
  ports         String?  // JSON

  // Volumes (JSON array of { hostPath: string, containerPath: string, type: "bind"|"external" })
  volumes       String?  // JSON

  // Container runtime state (updated by poller)
  containerId   String?
  containerState String? // "running", "exited", "restarting", etc.
  healthStatus  String?  // "healthy", "unhealthy", "starting", null
  restartCount  Int      @default(0)

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([stackId, serviceName])
}

// ─── Proxy Configuration ────────────────────────────────────

model ProxyConfig {
  id            String   @id @default(cuid())
  stackId       String
  stack         Stack    @relation(fields: [stackId], references: [id], onDelete: Cascade)

  serviceName   String   // which service in the stack to expose
  domain        String   // e.g. "cloud.example.com"
  internalPort  Int      // e.g. 80
  tlsEnabled    Boolean  @default(true)
  isPublic      Boolean  @default(true) // false = LAN-only

  // NPM integration
  npmProxyHostId Int?    // Nginx Proxy Manager host ID, if managed

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([domain])
}

// ─── Backups ────────────────────────────────────────────────

model Backup {
  id            String       @id @default(cuid())
  stackId       String
  stack         Stack        @relation(fields: [stackId], references: [id], onDelete: Cascade)

  resticSnapshotId String    // restic snapshot ID
  sizeBytes     BigInt?
  trigger       BackupTrigger // manual or scheduled
  status        BackupStatus
  errorMessage  String?

  startedAt     DateTime
  completedAt   DateTime?
  createdAt     DateTime     @default(now())
}

enum BackupTrigger {
  MANUAL
  SCHEDULED
}

enum BackupStatus {
  IN_PROGRESS
  COMPLETED
  FAILED
}

// ─── Status Log ─────────────────────────────────────────────

model StatusLog {
  id         String      @id @default(cuid())
  stackId    String
  stack      Stack       @relation(fields: [stackId], references: [id], onDelete: Cascade)

  fromStatus StackStatus?
  toStatus   StackStatus
  message    String?     // human-readable context (e.g., "Deploy failed: image not found")
  output     String?     // command output (truncated, for deploy/update errors)

  createdAt  DateTime    @default(now())
}

// ─── Deployments (Template → Stack link) ────────────────────

model Deployment {
  id             String   @id @default(cuid())
  stackId        String
  stack          Stack    @relation(fields: [stackId], references: [id], onDelete: Cascade)

  templateId     String?  // marketplace template ID, null if manual
  templateVersion String? // version of the template used

  composeHash    String   // SHA256 of the compose file at deploy time
  deployedAt     DateTime @default(now())
  success        Boolean
  errorMessage   String?
}

// ─── Global Settings ────────────────────────────────────────

model Setting {
  key       String   @id
  value     String   // stored as string; JSON for complex values, encrypted for secrets
  encrypted Boolean  @default(false) // if true, value is AES-encrypted
  updatedAt DateTime @updatedAt
}

// ─── Registry Credentials ───────────────────────────────────

model Registry {
  id         String  @id @default(cuid())
  name       String  // display name, e.g. "Docker Hub", "My GHCR"
  url        String  // e.g. "docker.io", "ghcr.io"
  username   String?
  password   String? // encrypted
  isDefault  Boolean @default(false) // used for unqualified image names

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([url])
}
```

### Key Design Decisions

- **Stack ID is the primary key** — it's the slugified name and also the directory name. No surrogate key needed.
- **Service model stores parsed data** — extracted from compose file on parse. Also stores runtime container state updated by the poller.
- **JSON fields for complex data** — Ports and volumes are stored as JSON strings. SQLite doesn't have a native JSON type, but Prisma handles serialization. This avoids many-to-many join tables for data that's always read/written as a unit.
- **Setting model is key-value** — flexible for adding new settings without migrations. Encrypted flag marks values that need decryption before use (SMTP password, restic password, registry credentials).
- **StatusLog is append-only** — never updated or deleted (except via retention cleanup). This provides a complete audit trail.

---

## Compose File Parsing & File Watching

### Source of Truth Principle

The `docker-compose.yml` on disk is always authoritative. The database stores derived metadata only. This means external edits (e.g., via SSH) are a supported workflow, not a bug.

### File Watcher (Required)

A background process using **chokidar** (Node.js) monitors `/stacks/*/docker-compose.yml` for changes:

- On change detection: re-hash file (SHA256), compare to `lastKnownHash` in DB.
- If hash differs: re-parse, update DB metadata, flag stack as "config changed" in the UI.
- Polling interval as fallback: every 60 seconds, reconciliation loop hashes all compose files to catch any events missed by the filesystem watcher (e.g., NFS mounts where inotify is unreliable).

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

**Live streaming:** Docktor uses `dockerode`'s container log stream (equivalent to `docker logs --follow --tail 500`) and pushes lines to the frontend via SSE. Each service in a stack gets its own log stream. The UI shows a combined view with service-name prefixes, and allows filtering by service.

**Persistence:** Docktor configures the Docker logging driver for all managed stacks to use `json-file` with rotation:

```yaml
# Injected into every service by Docktor at deploy time
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"
```

This means Docker itself handles log rotation. Logs are stored in Docker's standard location (`/var/lib/docker/containers/<id>/`) and are accessible via the Docker API. Docktor does **not** duplicate logs to its own `logs/` directory — the `logs/` directory in the stack is reserved for Docktor's own operational logs (deploy output, backup output, migration output).

**Retention:** Docker's `max-size` and `max-file` options provide ~50 MB of log retention per service. This is sufficient for debugging without consuming excessive disk space. Users who need longer retention can override the logging config in their compose file.

**Historical browsing:** The UI allows scrolling back through available Docker logs (up to the retention limit). Since Docker stores logs per container restart, logs survive container restarts but are lost when a container is removed and recreated (e.g., during an update). The StatusLog in the database records deploy/update events so the user knows when container recreation happened.

> **Design note:** Piping Docker logs to Docktor-managed files was considered but rejected — it duplicates storage, requires a background process per container, and reinvents what Docker's json-file driver already does well. Leveraging Docker's native logging keeps things simple and predictable.

### Status & Health Checks

Status is derived from two sources:

1. **Container state** via `docker inspect` — running, stopped, restarting, etc.
2. **Health check status** via Docker's native `HEALTHCHECK` — healthy, unhealthy, starting.

**Uptime tracking:** The StatusLog model records state transitions with timestamps, enabling a simple uptime percentage display per stack (e.g., "99.2% uptime over 30 days").

### Stack Lifecycle State Machine

Each stack has a single `status` field in the database. The following states and transitions are defined:

**States:**

| State | Meaning |
|---|---|
| `DRAFT` | Stack created in DB, compose file written, but never deployed. |
| `DEPLOYING` | `docker compose up -d` is currently running. |
| `RUNNING` | All containers are up. No healthcheck defined, or healthcheck not yet evaluated. |
| `HEALTHY` | All containers are up and all healthchecks pass. |
| `UNHEALTHY` | One or more containers report unhealthy via Docker HEALTHCHECK. |
| `STOPPED` | All containers are stopped (user-initiated via `docker compose stop`). |
| `ERROR` | Deploy failed, or one or more containers are in a crash loop / exited unexpectedly. |
| `UPDATING` | Pulling new images and recreating containers. |
| `BACKING_UP` | Backup in progress (containers may be stopped during this operation). |
| `RESTORING` | Restore from backup in progress. |
| `MIGRATING` | Brownfield full migration in progress. |

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

**Auto-transitions (no user action required):**

- `RUNNING` → `HEALTHY`: Docktor polls `docker inspect` and detects all healthchecks passing.
- `HEALTHY` → `UNHEALTHY`: A healthcheck starts failing.
- `UNHEALTHY` → `HEALTHY`: The healthcheck recovers (e.g., container self-heals).
- `RUNNING`/`HEALTHY` → `ERROR`: A container exits unexpectedly or enters a crash loop.
- `ERROR` → `RUNNING`/`HEALTHY`: A container with `restart: unless-stopped` recovers on its own.
- `BACKING_UP` → (previous state): Backup completes, stack returns to whatever state it was in before.

**Polling interval:** Docktor polls container state every 15 seconds via `docker inspect`. State transitions are recorded in the StatusLog.

### Operation Locking via State

The state machine prevents conflicting concurrent operations. **A stack can only accept user-initiated operations that are valid transitions from its current state.** The UI disables buttons accordingly:

| Current state | Allowed user actions |
|---|---|
| `DRAFT` | Deploy, Delete |
| `DEPLOYING` | (none — wait) |
| `RUNNING` / `HEALTHY` / `UNHEALTHY` | Stop, Update, Backup, Restore, Edit, Delete |
| `STOPPED` | Deploy (start), Backup, Restore, Edit, Delete |
| `ERROR` | Deploy (retry), Stop, Delete, view Logs |
| `UPDATING` | (none — wait) |
| `BACKING_UP` | (none — wait) |
| `RESTORING` | (none — wait) |
| `MIGRATING` | (none — wait) |

If a second browser tab or API call attempts an invalid operation, the backend checks the current state and returns an error: "Cannot update stack: backup is currently in progress."

### Error Handling on Deploy Failure

When `docker compose up -d` fails (bad image name, port conflict, OOM, etc.):

1. Stack transitions to `ERROR` state.
2. The error output from the compose command is captured and stored in the StatusLog.
3. The UI shows the error state with a link to the logs.
4. **No automatic rollback.** The user must diagnose the issue via logs, fix the compose file or environment, and re-deploy manually.
5. The previous compose file is not preserved — if the user needs to revert, they can restore from backup or use the file watcher's "config changed" indicator to know what changed.

> **Design note:** Automatic rollback on deploy failure sounds appealing but is complex (what if the previous config also fails? What if volumes changed?). For MVP, the user is the rollback mechanism. They have logs, they have backups, and they have the compose file in an editor.

### Disk Space Monitoring

Docktor tracks disk usage per stack and for the host:

- **Per stack:** Size of `./volumes/` directory, calculated periodically (every hour via cron job) using `du -sb`. Stored in the Stack model.
- **Host-level:** Total/used/available disk space on the partition where `/stacks/` lives, via `df`. Displayed on the dashboard.
- **Warnings:**
  - Stack-level: if a stack's volume data has grown more than 20% since last check.
  - Host-level: if available disk drops below 10% or 2 GB (whichever is larger).
- Disk warnings appear as a banner on the dashboard and in notification emails (if configured).

### Updates

- Docktor checks Docker registries for newer image versions based on **version tags**, not `:latest`.
- Version comparison strategy (best-effort, since tagging conventions vary):
  - **Semver tags** (e.g., `1.2.3`): Compare using semver rules.
  - **Date-based tags** (e.g., `2025-01-15`): Compare chronologically.
  - **Digest comparison**: Always available as fallback — compare image digest of local vs. remote.
- The UI shows what changed: current tag/digest vs. available tag/digest.
- **Updates are never automatic.** Always triggered by the user via an "Update" button.
- On update: pull new image, recreate containers, verify health.

> **Design note:** Unifying version detection across all images is inherently imperfect. The goal is to surface "a newer version likely exists" with enough detail for the user to make an informed decision. Edge cases (custom tags, multi-arch digests) are accepted limitations.

---

## Networking

### Current Scope (MVP)

Each stack gets its own default Docker bridge network (standard `docker compose` behavior). Services within a stack can communicate freely.

### Inter-Stack Communication (Post-MVP)

A common self-hosting pattern is one stack depending on another (e.g., multiple apps sharing a single Postgres stack). This requires a shared Docker network strategy:

- **Approach:** A Docktor-managed "shared" overlay network that stacks can opt into.
- **UI:** When editing a stack, the user can declare dependencies on other stacks. Docktor injects the shared network into both compose files.
- **Security principle:** Only explicitly declared connections are allowed. A database service should never be exposed to all stacks by default.

> **Design note:** This is deliberately deferred. For MVP, users who need inter-stack communication can manually add `external: true` networks to their compose files — Docktor won't interfere.

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

### Security: Selective Exposure

Only services explicitly marked for proxy exposure are accessible. Supporting services (databases, Redis, etc.) remain on internal Docker networks only. The UI makes this distinction clear — when configuring a stack with multiple services, each service has an independent "Expose" toggle.

---

## Secrets & Environment Variables

### Problem

`.env` files contain secrets (DB passwords, API keys) and sit in plaintext on disk. This is standard Docker practice but is a risk if the host is compromised.

### Approach (MVP)

- `.env` files remain on disk (consistent with how Docker Compose expects them).
- File permissions are locked down: `chmod 600`, owned by the Docktor system user.
- Secrets are **not** stored in the database — the DB only stores non-sensitive metadata.
- Backups via restic are encrypted at rest, which covers the backup vector.

### Approach (Post-MVP)

- Optional integration with **Docker Secrets** for swarm-capable setups.
- Optional encryption of `.env` files at rest using a master key derived from the user's password (decrypted into memory on stack deploy).

> **Design note:** Storing secrets in the database was considered but rejected — it would make the DB a high-value target and duplicate what's already on the filesystem. Defense-in-depth via filesystem permissions + encrypted backups is the pragmatic MVP path.

---

## Global Settings

All global configuration is stored in the database (in a `Settings` key-value model) and editable via a Settings page in the UI. Environment variables from Docktor's own compose file serve as initial defaults only — once the wizard completes, the DB is authoritative.

### Settings Categories

**General:**

| Key | Type | Description |
|---|---|---|
| `instance_name` | string | Display name for this Docktor instance (e.g., "My Home Server") |
| `base_url` | string | External URL for Docktor (e.g., `https://docktor.example.com`) |
| `timezone` | string | IANA timezone (e.g., `Europe/Berlin`) for scheduling and log timestamps |

**Backup (Restic):**

| Key | Type | Description |
|---|---|---|
| `restic_repo_path` | string | Repository location: local path, `sftp:user@host:/path`, or `s3:endpoint/bucket` |
| `restic_password` | string (encrypted) | Repository encryption password. Auto-generated during setup or user-provided. Stored encrypted in DB using a key derived from the app secret. |
| `backup_default_schedule` | string | Default cron expression for new stacks (e.g., `0 2 * * *` for daily at 2 AM) |
| `backup_default_retention` | JSON | Default retention policy (e.g., `{ "daily": 7, "weekly": 4, "monthly": 6 }`) |

**Notifications (SMTP):**

| Key | Type | Description |
|---|---|---|
| `smtp_host` | string | SMTP server hostname |
| `smtp_port` | number | SMTP port (default: 587) |
| `smtp_username` | string | SMTP username |
| `smtp_password` | string (encrypted) | SMTP password, stored encrypted |
| `smtp_from` | string | Sender email address |
| `notification_recipient` | string | Where to send alerts |
| `smtp_enabled` | boolean | Master toggle |

**Scanning (Brownfield):**

| Key | Type | Description |
|---|---|---|
| `scan_paths` | string[] | Host directories to scan for existing stacks (default: `["/home", "/opt", "/srv", "/root"]`) |

---

## Registry Configuration

Docktor needs access to Docker registries to check for image updates and pull images.

### MVP: Public Registries Only

For the first version, Docktor works with publicly accessible images from:

- Docker Hub (`docker.io`)
- GitHub Container Registry (`ghcr.io`)
- Quay.io (`quay.io`)

No authentication required. Update checks use the registry's HTTP API (v2 manifest endpoint) to compare digests and list tags.

### Post-MVP: Authenticated Registries

A Registry management page in Settings allows adding multiple registries:

| Field | Description |
|---|---|
| Name | Display name (e.g., "My GitHub Packages") |
| URL | Registry base URL (e.g., `ghcr.io`) |
| Username | Auth username or token name |
| Password / Token | Auth credential (stored encrypted in DB) |
| Default | Whether this is checked first for unqualified image names |

Credentials are used when:

- Pulling images during deploy/update.
- Querying the registry API for available tags during update checks.
- Pulling images from private repositories referenced in marketplace templates.

---

## YAML Validation & Safety

### Philosophy

Docktor should never prevent users from doing what Docker itself allows. The tool makes things easier — it doesn't add restrictions. However, it should ensure users make dangerous choices *knowingly*.

### Validation Layers

1. **Syntax validation:** YAML parse errors are caught and shown inline in CodeMirror before deployment.
2. **Volume convention enforcement:** Named Docker volumes are rejected with an auto-convert offer. Absolute paths outside the stack directory trigger a warning that they won't be backed up (see Volume Strategy).
3. **Warning system:** The following patterns trigger a visible warning banner (yellow, not blocking):
   - `privileged: true`
   - Host volume mounts outside `/stacks/` (e.g., mounting `/etc` or `/var/run/docker.sock`)
   - `network_mode: host`
   - `cap_add` with sensitive capabilities
4. **Confirmation dialog:** If warnings are present, deployment requires an explicit "I understand the risks, deploy anyway" confirmation.

> **Design note:** This mirrors the philosophy of tools like `sudo` — warn clearly, then trust the user. Blocking dangerous configs would make Docktor less useful than raw Docker, which defeats the purpose.

---

## Notifications

Notifications are sent via SMTP to the configured recipient email. Triggers:

- **Stack enters `ERROR` or `UNHEALTHY` state.** Includes: stack name, state, timestamp, last few lines of container logs.
- **Backup failure.** Includes: stack name, error message, timestamp.
- **Disk space warning.** Triggered when available disk drops below 10% or 2 GB.
- **Backup completed successfully** (optional, off by default).

Each trigger type can be individually enabled/disabled in Settings.

---

## Backup & Restore

### What Gets Backed Up

The entire stack directory:

```
/stacks/<stack-id>/
├── docker-compose.yml     ✅ backed up
├── .env                   ✅ backed up
├── volumes/               ✅ backed up (all service data)
│   ├── app-data/
│   └── db-data/
└── logs/                  ❌ excluded (ephemeral, large)
```

Because all persistent data lives in `./volumes/` as bind mounts, backing up a stack is backing up a directory. No Docker volume API interaction, no sidecar containers, no `docker cp`.

**Absolute-path volumes** (outside the stack directory) are **not** included in backups. The UI warns about this at compose-edit time and again at backup time.

### Backup Engine: Restic

- Backups are encrypted, deduplicated, and versioned.
- Snapshot metadata (snapshot ID, timestamp, size) stored in the database.
- Backup targets: local directory, SFTP, S3-compatible storage.

### Data Consistency

**Problem:** Backing up `./volumes/db-data/` while a database is writing to it risks corruption.

**Strategy (MVP):**

1. **Stop-and-backup (default, safe):** `docker compose stop` → restic backup of stack directory → `docker compose start`. Causes brief downtime. Acceptable for most self-hosted services where uptime is not mission-critical.
2. **Application-aware hooks (optional, per-template):** Templates can define pre-backup and post-backup commands, stored in the Stack model in the database:
   ```json
   {
     "pre": "docker exec <stack>-db-1 pg_dump -U postgres > /tmp/dump.sql && docker cp <stack>-db-1:/tmp/dump.sql ./volumes/db-dump/dump.sql",
     "post": "rm -f ./volumes/db-dump/dump.sql"
   }
   ```
   This allows database dumps into the `volumes/` tree before backup without stopping the container.

> **Design note:** The bind-mount convention dramatically simplifies backup. The remaining hard problem is consistency for stateful services (databases). Stop-and-backup is the honest, safe default. Application-aware hooks provide an escape hatch for zero-downtime backups where the user is willing to configure them.

### Restore

1. User selects a snapshot from the UI (list pulled from restic).
2. Docktor stops the current stack (if running).
3. Restic restores the stack directory (`docker-compose.yml`, `.env`, `volumes/`) to a temp location.
4. Files are moved into place, replacing the current stack directory contents.
5. Stack is redeployed via `docker compose up -d`.
6. Health checks confirm successful restore.

### Backup Scheduling

- Configurable per stack (e.g., daily at 2 AM, weekly).
- Managed via the node-cron job scheduler.
- Retention policies configurable (e.g., keep 7 daily, 4 weekly, 6 monthly).

---

## Marketplace

### Vision

The Marketplace will evolve into a **SaaS platform** — similar in concept to Google Play Store or Docker Hub — where users can discover, publish, and rate self-hosting templates. For MVP, it starts simple and grows.

### MVP: Bundled + Remote Index

- **Bundled templates:** A curated set of ~20 popular self-hosting apps (Nextcloud, Vaultwarden, Gitea, Immich, Paperless-ngx, etc.) ships with the Docktor Docker image.
- **Remote index:** Docktor fetches a template index from a central API (`https://marketplace.docktor.io/api/v1/templates`). This allows publishing new templates without updating Docktor itself.
- **Template metadata:** ID, name, description, icon URL, tags/categories, compose file content, author, version, created/updated dates, source URL (e.g., link to the app's website).
- **All templates follow Docktor conventions:** bind-mount volumes, `.env`-based configuration, no named volumes.

### Future: Full SaaS Marketplace

- **User accounts:** Authors register on the marketplace platform, verify their identity, and publish templates.
- **Publishing flow:** Author submits a template → automated validation (linting, security scan, convention check) → review queue → published.
- **Ratings & reviews:** Users rate templates (1–5 stars) and leave feedback. Aggregated scores displayed in the browse UI.
- **Categories & search:** Templates organized by category (media, productivity, development, home automation, etc.) with full-text search.
- **Version history:** Authors can publish updates. Docktor notifies users of template updates separately from image updates.
- **Install counts & popularity:** Track how many Docktor instances have deployed each template.
- **Verified authors:** Badge for trusted publishers (e.g., official app maintainers).

### Trust Model (MVP)

- **Official templates** (curated by Docktor maintainers): Deployed without extra confirmation.
- **Community templates:** Displayed with a clear "Community Contributed — Review Before Deploying" banner. Deployment requires a confirmation dialog showing which images are used, which ports are exposed, and whether any warning-level patterns are present.

> **Design note:** The marketplace SaaS is a separate project with its own backend, database, and auth system. Docktor instances are API consumers. The marketplace API is public and read-only for browsing; write access (publishing) requires marketplace authentication.

---

## Security Summary (MVP)

| Concern | Mitigation |
|---|---|
| Docker socket access | Required for operation. Equivalent to root. Documented clearly in install guide. |
| Host filesystem (brownfield) | Mounted read-only (`/:/host:ro`). Restrictive alternative: mount only specific scan paths. |
| Auth | Session-based auth via Lucia/better-auth. Single user for MVP. |
| HTTPS for UI | Docktor's own UI served behind the same Nginx/NPM proxy with TLS. |
| CSRF | Fastify CSRF plugin enabled by default. |
| Secrets on disk | `.env` files with `chmod 600`. Not stored in DB. |
| Secrets in DB | SMTP password, restic password, registry tokens stored AES-encrypted in Settings/Registry models. |
| Secrets in backups | Restic encryption at rest. |
| Arbitrary YAML | Warning system + confirmation dialog. Never blocks, always informs. |
| Marketplace templates | Confirmation dialog with risk summary for community templates. |
| RBAC | Deferred to post-MVP. Single-user model sufficient for personal server use case. |

---

## Implementation Priority

| Phase | Scope |
|---|---|
| **1 — Core Loop + Import** | First-run wizard, auth, settings page, stack CRUD, state machine, compose deploy/stop/restart, file watcher, scan & discover existing stacks, adopt in place, full migration wizard with volume conversion, disk space monitoring |
| **2 — Observability** | Live log streaming via Docker API, container status polling with health checks, uptime tracking, StatusLog recording |
| **3 — Proxy** | Nginx Proxy Manager integration, automatic HTTPS, selective service exposure per service |
| **4 — Backup** | Restic repository init, stop-and-backup, restore flow, scheduling, retention policies, backup hooks |
| **5 — Updates** | Public registry polling (Docker Hub, GHCR, Quay), version/digest comparison, manual update flow |
| **6 — Marketplace** | Bundled templates, remote index API integration, template browsing, deployment with confirmation |
| **7 — Notifications** | SMTP configuration, error/unhealthy/disk/backup-failure alerts with per-trigger toggles |

---

## Future Roadmap (Out of Scope for MVP)

- RBAC and multi-user access control per stack
- Inter-stack networking with shared Docker networks
- Shared volume strategy for cross-stack data access
- Marketplace SaaS platform (user accounts, publishing, ratings, reviews)
- Authenticated private registry support (GHCR, self-hosted registries)
- Docktor self-update via the UI
- Plugin system for extensibility
- Form-based YAML abstraction (JSON Schema rendering)
- Metrics and dashboards (Prometheus/Grafana integration)
- OAuth or LDAP integration
- Docker Secrets integration for encrypted secret management
- Application-aware backup hooks as first-class template feature
- Template signing and automated security scanning

---

## Summary

Docktor favors simplicity, file-based configuration, and user empowerment. It is designed for a single server, a single user, and the principle that the tool should make Docker easier without making it less capable. The YAML-first approach and bind-mount volume convention keep the system transparent and recoverable — if Docktor disappears, the user still has working compose files and all their data in plain directories on disk.
