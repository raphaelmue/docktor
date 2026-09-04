# Codebase Structure

**Analysis Date:** 2026-03-10

## Directory Layout

```
docktor/                          # Monorepo root
├── shared/                       # @docktor/shared — Zod schemas + inferred types
│   └── src/
│       └── validation/           # stacks.ts, auth.ts, settings.ts, index.ts
├── server/                       # @docktor/server — Fastify API + background jobs
│   ├── src/
│   │   ├── index.ts              # Server entry point (listen)
│   │   ├── app.ts                # App factory (buildApp)
│   │   ├── application/          # Use-case orchestration (StackService)
│   │   ├── domain/               # Pure business logic (state machine, compose config)
│   │   ├── infrastructure/       # External adapters (DockerExecutor, StackFilesystem)
│   │   ├── repositories/         # Prisma data access (StackRepository, SettingsRepository)
│   │   ├── routes/               # HTTP handlers (stacks.ts, auth.ts, settings.ts)
│   │   ├── jobs/                 # Background jobs (StatePoller, startJobs)
│   │   ├── lib/                  # Shared utilities (auth, db, errors, slugify, etc.)
│   │   └── generated/            # Auto-generated Prisma client (do not edit)
│   ├── prisma/
│   │   └── schema/               # Split Prisma schema files (one model per file)
│   ├── stacks/                   # Dev-time stack directories (runtime data)
│   ├── dev-data/                 # Sample stack data for development
│   └── test/
│       ├── unit/                 # Unit tests mirroring src/ structure
│       └── integration/          # Integration tests against real DB
├── client/                       # @docktor/client — React SPA (Vite + React Router)
│   └── src/
│       ├── main.tsx              # SPA entry point + router definition
│       ├── components/
│       │   ├── common/           # Layout and generic data components
│       │   │   ├── layout/       # Page, PageHeader, PageContent, etc.
│       │   │   └── data/table/   # Reusable table components
│       │   ├── domain/
│       │   │   └── stack/        # Stack-specific components (StackList, StackStatusBadge)
│       │   └── ui/               # shadcn/ui primitives (Button, Card, Table, etc.)
│       ├── hooks/                # Custom React hooks (use-stacks, use-stack, use-log-stream)
│       ├── lib/                  # API clients and utilities
│       │   ├── api.ts            # Base apiFetch + ApiError
│       │   ├── stacks-api.ts     # Stack resource API functions + TS types
│       │   ├── settings-api.ts   # Settings API functions
│       │   └── auth-client.ts    # better-auth browser client
│       └── routes/
│           ├── app/              # Authenticated app pages
│           │   ├── dashboard.tsx
│           │   ├── settings.tsx
│           │   └── stacks/       # Stacks pages (index, create, [id])
│           └── auth/             # Unauthenticated pages (login, signup)
├── docs/                         # Design documents
├── .planning/                    # GSD planning artifacts
│   └── codebase/                 # Codebase map documents (this file)
├── .github/workflows/            # CI pipeline definitions
├── package.json                  # Root workspace config + shared devDependencies
├── tsconfig.json                 # Root TypeScript project references
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # Production compose
├── docker-compose.dev.yml        # Development compose (DB only)
└── yarn.lock                     # Lockfile (committed)
```

## Directory Purposes

**`shared/src/validation/`:**
- Purpose: All Zod schemas and TypeScript input types shared across server and client
- Contains: One file per domain area — `stacks.ts`, `auth.ts`, `settings.ts`; re-exported via `index.ts`
- Key files: `shared/src/validation/stacks.ts` (createStackSchema, updateStackSchema, stackParamsSchema)

**`server/src/application/`:**
- Purpose: Use-case classes; coordinates domain, repo, and infrastructure to implement features
- Contains: `StackService` class; `index.ts` wires and exports the singleton
- Key files: `server/src/application/stack-service.ts`, `server/src/application/index.ts`

**`server/src/domain/`:**
- Purpose: Pure business logic with no I/O or framework dependencies
- Contains: State machine (`stack-status-machine.ts`), compose config value object (`compose-config.ts`)
- Key files: `server/src/domain/stack-status-machine.ts` (TRANSITIONS, assertTransition, TransitionError)

**`server/src/infrastructure/`:**
- Purpose: Adapters that interact with the outside world (Docker CLI, host filesystem)
- Contains: `DockerExecutor` (spawns `docker compose` commands), `StackFilesystem` (reads/writes compose and env files)
- Key files: `server/src/infrastructure/docker-executor.ts`, `server/src/infrastructure/stack-filesystem.ts`

**`server/src/repositories/`:**
- Purpose: All Prisma queries; no raw SQL elsewhere in the codebase
- Contains: `StackRepository` (full CRUD + status transitions), `SettingsRepository`
- Key files: `server/src/repositories/stack-repository.ts`

**`server/src/routes/`:**
- Purpose: Thin Fastify plugin handlers — validate input, call service/repo, return response
- Contains: One file per resource group registered as Fastify plugins
- Key files: `server/src/routes/stacks.ts`, `server/src/routes/settings.ts`, `server/src/routes/auth.ts`

**`server/src/jobs/`:**
- Purpose: Background polling for status reconciliation
- Contains: `StatePoller` class and `startJobs()` factory with `setInterval`
- Key files: `server/src/jobs/state-poller.ts`, `server/src/jobs/index.ts`

**`server/src/lib/`:**
- Purpose: Cross-cutting server utilities that don't belong to a single layer
- Contains: `auth.ts` (better-auth config), `auth-middleware.ts` (requireAuth hook), `db.ts` (Prisma singleton), `errors.ts` (AppError hierarchy), `slugify.ts`, `stacks-dir.ts` (path helpers), `compose-parser.ts`
- Key files: `server/src/lib/errors.ts`, `server/src/lib/auth-middleware.ts`, `server/src/lib/db.ts`

**`server/src/generated/`:**
- Purpose: Prisma-generated client code output
- Generated: Yes — by `prisma generate`
- Committed: No — excluded from git; regenerated at build time

**`server/prisma/schema/`:**
- Purpose: Split Prisma schema — one `.prisma` file per model for maintainability
- Key files: `stack.prisma` (Stack model + StackStatus enum), `base.prisma` (datasource + generator config)

**`client/src/routes/app/`:**
- Purpose: All authenticated page components; mapped 1:1 to URL routes
- Contains: `dashboard.tsx`, `settings.tsx`, `stacks/index.tsx`, `stacks/create.tsx`, `stacks/[id].tsx`

**`client/src/routes/auth/`:**
- Purpose: Unauthenticated pages (login/signup)
- Contains: `login.tsx`, `signup.tsx`, `components/` (shared form components)

**`client/src/hooks/`:**
- Purpose: Data-fetching hooks encapsulating loading/error/data state per resource
- Contains: `use-stacks.ts`, `use-stack.ts`, `use-log-stream.ts`, `use-mobile.ts`

**`client/src/lib/`:**
- Purpose: API communication layer and browser utilities
- Contains: `api.ts` (base fetch wrapper), `stacks-api.ts` (stack functions + types), `settings-api.ts`, `auth-client.ts`, `utils.ts`

**`client/src/components/ui/`:**
- Purpose: shadcn/ui primitive components (Button, Card, Table, Tabs, etc.) — do not add business logic here
- Generated: Partially (shadcn CLI generates these from templates)

**`client/src/components/common/`:**
- Purpose: Layout primitives and generic data-display components reusable across features
- Key files: `client/src/components/common/layout/page.tsx` (Page, PageHeader, PageContent, PageTitle, PageActions, PageDescription)

**`client/src/components/domain/stack/`:**
- Purpose: Stack-specific UI components (not generic, not page-level)
- Contains: `StackList`, `StackStatusBadge`, etc.

## Key File Locations

**Entry Points:**
- `server/src/index.ts`: Server process entry — starts Fastify
- `server/src/app.ts`: App factory — `buildApp()` used by both server and tests
- `client/src/main.tsx`: SPA entry — React root, router, route definitions

**Configuration:**
- `package.json`: Workspace definitions, shared devDependencies, root scripts
- `tsconfig.json`: Root TypeScript project references for all three workspaces
- `server/prisma/schema/base.prisma`: Prisma datasource and client generator config
- `.env.development`: Development environment variables (exists, not tracked with secrets)
- `.env.example`: Template listing all required environment variables

**Core Logic:**
- `server/src/application/stack-service.ts`: All stack operations
- `server/src/domain/stack-status-machine.ts`: Lifecycle state machine
- `server/src/repositories/stack-repository.ts`: All stack DB queries
- `shared/src/validation/stacks.ts`: Stack input schemas and types

**Testing:**
- `server/test/unit/`: Server unit tests mirroring `src/` layer structure
- `server/test/integration/`: Server integration tests (real DB)
- `client/test/unit/`: Client unit tests
- `client/test/integration/`: Client integration/component tests

## Naming Conventions

**Files:**
- `kebab-case.ts` for all TypeScript source files (e.g., `stack-service.ts`, `use-stacks.ts`)
- `.tsx` extension only for React components
- `[id].tsx` for dynamic route segments (Next.js-style, used with React Router)
- `index.ts` as barrel/entry file for each directory that needs a public interface

**Directories:**
- `kebab-case` throughout (e.g., `stack-filesystem`, `status-log`)
- Domain directories named after the layer they represent (`application`, `domain`, `infrastructure`, `repositories`, `routes`, `jobs`)

**Classes:**
- PascalCase (e.g., `StackService`, `DockerExecutor`, `StackRepository`)

**Functions and hooks:**
- camelCase for functions (e.g., `createStack`, `deriveStackStatus`)
- `use-` prefix for React hook files and function names (e.g., `use-stacks.ts` → `useStacks()`)

**Prisma models:**
- PascalCase model names (e.g., `Stack`, `Service`, `StatusLog`)
- Schema split across `server/prisma/schema/*.prisma` — one file per model

## Where to Add New Code

**New API resource (e.g., "backups"):**
1. Add Zod schemas to `shared/src/validation/backups.ts`, re-export from `shared/src/validation/index.ts`
2. Add domain logic (if needed) to `server/src/domain/`
3. Add infrastructure adapter (if needed) to `server/src/infrastructure/`
4. Add repository to `server/src/repositories/backup-repository.ts`
5. Add service to `server/src/application/backup-service.ts`, wire singleton in `server/src/application/index.ts`
6. Add route plugin to `server/src/routes/backups.ts`, register it in `server/src/app.ts`
7. Add API functions + types to `client/src/lib/backups-api.ts`
8. Add hooks to `client/src/hooks/use-backups.ts`
9. Add page components to `client/src/routes/app/backups/`
10. Register routes in `client/src/main.tsx`

**New page (authenticated):**
- Implementation: `client/src/routes/app/<feature>.tsx` or `client/src/routes/app/<feature>/index.tsx`
- Register in: `client/src/main.tsx` under the `ProtectedRoute` wrapper

**New domain component:**
- Implementation: `client/src/components/domain/<feature>/<component-name>.tsx`

**New Prisma model:**
- Add: `server/prisma/schema/<model-name>.prisma`
- Regenerate: `yarn db:generate`
- Generated client lands in: `server/src/generated/prisma/`

**New background job:**
- Implementation: `server/src/jobs/<job-name>.ts`
- Start from: `server/src/jobs/index.ts` (`startJobs` function)

**Utilities shared across server layers:**
- Location: `server/src/lib/<util-name>.ts`

## Special Directories

**`server/src/generated/`:**
- Purpose: Prisma client output — all Prisma types, enums, and query builders
- Generated: Yes (`prisma generate`)
- Committed: No

**`server/stacks/`:**
- Purpose: Runtime directory where stack compose and env files are stored on disk
- Generated: Yes (created by `StackFilesystem` at runtime)
- Committed: No (contains live user data)

**`server/dev-data/`:**
- Purpose: Sample stack files for local development
- Generated: No (manually maintained)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning artifacts — codebase maps, phase plans
- Generated: Yes (by GSD tooling)
- Committed: Yes

**`client/src/components/ui/`:**
- Purpose: shadcn/ui component library primitives
- Generated: Partially (shadcn CLI)
- Committed: Yes (customized after generation)

**`.test/` (in each workspace):**
- Purpose: Test output artifacts — coverage reports, playwright results
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-10*
