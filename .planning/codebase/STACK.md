# Technology Stack

**Analysis Date:** 2026-03-10

## Languages

**Primary:**
- TypeScript 5.7.x - All source code across server, client, and shared packages
- CSS (Tailwind) - Client styling via utility classes

**Secondary:**
- SQL - Database migrations managed via Prisma

## Runtime

**Environment:**
- Node.js >=22.0.0 (enforced via `engines` field in root `package.json`)
- Node.js 22-slim Docker image in production

**Package Manager:**
- Yarn 4.12.0 (Berry, Corepack-managed)
- Lockfile: `yarn.lock` present at repo root
- Workspace structure: monorepo with `shared`, `server`, `client` packages

## Frameworks

**Core:**
- Fastify 5.x (`@docktor/server`) - HTTP server framework with type provider
- React 19.x (`@docktor/client`) - UI library
- React Router 7.x (`@docktor/client`) - Client-side routing

**Validation:**
- Zod 4.x - Schema validation used in all three packages; server uses `fastify-type-provider-zod` for route validation

**Auth:**
- better-auth 1.x - Authentication library with Prisma adapter; email+password strategy; config at `server/src/lib/auth.ts`

**Testing:**
- Vitest 4.x - Unit/integration test runner in all packages; config at `server/vitest.config.ts`, `client/vitest.config.ts`
- Playwright 1.x - E2E/integration tests for client; config at `client/playwright.config.ts`
- Testing Library (React, DOM, user-event) - Component testing helpers for client

**Build/Dev:**
- Vite 7.x - Client bundler; config at `client/vite.config.ts`
- tsx 4.x - TypeScript execution for server dev mode
- concurrently 9.x - Parallel dev server startup from root

## Key Dependencies

**Critical:**
- `prisma` 7 / `@prisma/client` 7 - ORM for PostgreSQL; schema split across `server/prisma/schema/`; client generated to `server/src/generated/prisma/`
- `@prisma/adapter-pg` 7.x + `pg` 8.x - PostgreSQL adapter for Prisma; driver-level connection via `PrismaPg` in `server/src/lib/db.ts`
- `dockerode` 4.x + Docker CLI - Docker Compose management; server invokes `docker compose` CLI via `child_process.execFile` in `server/src/infrastructure/docker-executor.ts`
- `better-auth` 1.x - Session-based auth with cookie transport; uses Prisma adapter
- `node-cron` 3.x - Background job scheduling (state polling every 15 seconds via `setInterval` in `server/src/jobs/index.ts`)
- `chokidar` 4.x - Filesystem watching
- `yaml` 2.x - YAML parsing for Docker Compose files

**UI:**
- `radix-ui` 1.x - Headless UI primitives
- `shadcn` 3.x (devDependency) - UI component generator tool
- `tailwindcss` 4.x - Utility CSS framework with Vite plugin
- `lucide-react` 0.575.x - Icon library
- `react-hook-form` 7.x + `@hookform/resolvers` - Form state management
- `sonner` 2.x - Toast notification library
- `next-themes` 0.4.x - Theme (dark/light) management
- `class-variance-authority` + `clsx` + `tailwind-merge` - Class name utilities

**Infrastructure:**
- `@fastify/cookie` - Cookie parsing plugin
- `@fastify/cors` - CORS plugin (development only; disabled in production)
- `@fastify/static` - Static file serving for client SPA in production
- `fastify-type-provider-zod` - Zod schema integration for Fastify route validation/serialization

## Configuration

**Environment:**
- Configured via `.env.development`, `.env.production`, `.env.example` at repo root
- `dotenv-cli` used to inject env vars into dev and migration scripts
- Required vars: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`, `DOCKTOR_BASE_URL`, `DOCKTOR_STACKS_DIR`, `DOCKTOR_DATA_DIR`, `DOCKTOR_BACKUP_DIR`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- Optional: `CLIENT_DIST_PATH` (production only, for serving built SPA)

**Build:**
- Root `tsconfig.json` uses project references pointing to `shared`, `server`, `client`
- Client build: `tsc -b && vite build` → output to `client/dist/`
- Server build: `tsc --project tsconfig.json` → output to `server/dist/`
- Shared build: `tsc` → output to `shared/dist/`
- Build order enforced: `shared` must build before `client` and `server`
- Prisma client generation: `prisma generate --config=server/prisma/prisma.config.ts`
- Path alias `@` maps to `client/src/` in Vite (client-side only)

## Platform Requirements

**Development:**
- Node.js 22+, Yarn 4.12.0 via Corepack
- Running PostgreSQL (default: `postgresql://docktor:docktor@localhost:5432/docktor`)
- Docker Engine with Compose plugin (for stack management features)
- Dev proxy: Vite dev server on `:5173` proxies `/api/*` to server on `:3000`

**Production:**
- Docker container (multi-stage build in `Dockerfile`)
- Docker CLI 27.5.1 + Compose plugin v2.33.1 bundled in the container image
- `restic` binary bundled for backup functionality
- External PostgreSQL database required (not bundled in Docker image)
- Exposes port 3000; serves both API and client SPA from single process

---

*Stack analysis: 2026-03-10*
