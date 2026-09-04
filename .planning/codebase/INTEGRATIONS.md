# External Integrations

**Analysis Date:** 2026-03-10

## APIs & External Services

**Docker Engine:**
- Docker Compose CLI - Manages container lifecycle (up, stop, restart, ps) for user-defined stacks
  - Client: `dockerode` npm package (imported but Docker CLI is the primary interface)
  - Interface: `server/src/infrastructure/docker-executor.ts` calls `docker compose` via `child_process.execFile`
  - Operations: `up -d --remove-orphans`, `stop`, `restart`, `ps --format json`
  - Timeout: 120 seconds per operation
  - Docker socket access required at runtime (host Docker socket must be mounted)

**Restic (Backup):**
- `restic` CLI binary bundled in the production Docker image
- Used for backup functionality (schema model: `server/prisma/schema/backup.prisma`)
- No direct Node.js SDK; invoked via system process

## Data Storage

**Databases:**
- PostgreSQL (primary datastore)
  - Connection env var: `DATABASE_URL`
  - ORM: Prisma 7 with `@prisma/adapter-pg` (driver-adapter mode using `pg` native driver)
  - Client singleton: `server/src/lib/db.ts` — lazy-initialized `PrismaClient` with `PrismaPg` adapter
  - Schema directory: `server/prisma/schema/` (multi-file schema, split by domain)
  - Generated client: `server/src/generated/prisma/`
  - Migrations: managed via `prisma migrate dev` (dev) / `prisma db push` (quick sync)

**File Storage:**
- Local filesystem only
  - Stack compose files and `.env` files stored at `DOCKTOR_STACKS_DIR` (env var)
  - Application data at `DOCKTOR_DATA_DIR` (env var)
  - Backup files at `DOCKTOR_BACKUP_DIR` (env var)
  - Abstracted via `server/src/infrastructure/stack-filesystem.ts`

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- better-auth 1.x (self-hosted, no third-party auth SaaS)
  - Implementation: email + password authentication only (no OAuth providers configured)
  - Session storage: PostgreSQL via Prisma adapter (models: `User`, `Session`, `Account`, `Verification` in `server/prisma/schema/auth.prisma`)
  - Transport: HTTP-only cookies (`@fastify/cookie`)
  - Config: `server/src/lib/auth.ts`
  - Auth routes mounted at `/api/auth` prefix
  - Route handler registered via `server/src/routes/auth.ts`
  - Middleware: `server/src/lib/auth-middleware.ts`
  - Required env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
  - Trusted origins: `BETTER_AUTH_URL` value (or `http://localhost:5173` in dev)

## Monitoring & Observability

**Logging:**
- Fastify built-in logger (powered by Pino)
  - Development: `pino-pretty` transport for human-readable output
  - Production: JSON output (raw Pino)
  - Test: logging disabled
  - Config in `server/src/app.ts` via `envToLogger` map

**Error Tracking:**
- None (no Sentry, Datadog, or equivalent detected)

**Code Quality:**
- SonarQube - Static analysis and coverage reporting
  - Triggered via GitHub Actions CI on push/PR to `main`
  - Config: `sonar-project.properties` at repo root
  - Coverage from LCOV reports aggregated from server, client, shared packages
  - Required CI secrets: `SONAR_TOKEN`, `SONAR_HOST_URL`

## CI/CD & Deployment

**Hosting:**
- Docker container - multi-stage build via `Dockerfile` at repo root
- No specific cloud platform detected (generic container deployment)

**CI Pipeline:**
- GitHub Actions - workflow at `.github/workflows/ci.yml`
  - Triggers: push to `main`, pull requests targeting `main`
  - Steps: install → generate Prisma client → build → typecheck → unit tests → server tests → Playwright tests → SonarQube scan
  - Uses `testcontainers` for server integration tests (spins up real PostgreSQL)
  - Coverage artifacts uploaded with 5-day retention

**Container Registry:**
- Not configured in CI (no push-to-registry step detected)

## Webhooks & Callbacks

**Incoming:**
- None detected (no `/webhook` routes in server)

**Outgoing:**
- None detected

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: `3000`)
- `HOST` - Server bind address (default: `0.0.0.0`)
- `NODE_ENV` - Runtime environment (`development`, `production`, `test`)
- `DOCKTOR_BASE_URL` - Application base URL
- `DOCKTOR_STACKS_DIR` - Filesystem path for Docker Compose stack files
- `DOCKTOR_DATA_DIR` - Filesystem path for application data
- `DOCKTOR_BACKUP_DIR` - Filesystem path for backup storage
- `BETTER_AUTH_SECRET` - Secret key for better-auth session signing
- `BETTER_AUTH_URL` - Public-facing app URL (used as trusted origin for auth)

**Optional env vars:**
- `CLIENT_DIST_PATH` - Path to built client SPA (production only; defaults to `../../client/dist` relative to server dist)
- `VITE_COVERAGE` - Set to `"true"` to enable Istanbul instrumentation in Playwright test runs

**Secrets location:**
- `.env.development` and `.env.production` at repo root (not committed; `.env.example` committed as template)
- CI secrets: `SONAR_TOKEN`, `SONAR_HOST_URL` stored in GitHub repository secrets

---

*Integration audit: 2026-03-10*
