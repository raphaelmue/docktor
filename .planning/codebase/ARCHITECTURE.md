# Architecture

**Analysis Date:** 2026-03-10

## Pattern Overview

**Overall:** Monorepo with layered backend (Domain / Application / Infrastructure / Routes) and a React SPA frontend, sharing a validation package.

**Key Characteristics:**
- Three yarn workspaces: `@docktor/shared`, `@docktor/server`, `@docktor/client`
- Server follows strict DDD-inspired layering: domain logic is isolated from infrastructure concerns
- In production, the server serves the built client SPA as static files on the same port (3000)
- State machine governs all Docker stack lifecycle transitions, preventing illegal operations

## Layers

**Shared (`shared/`):**
- Purpose: Zod schemas and TypeScript types shared between server and client
- Location: `shared/src/validation/`
- Contains: `stacks.ts`, `auth.ts`, `settings.ts` — schema definitions and inferred input types
- Depends on: `zod`
- Used by: Server (request validation), Client (form types)

**Routes (`server/src/routes/`):**
- Purpose: HTTP endpoint definitions — thin handlers that delegate to the application layer
- Location: `server/src/routes/stacks.ts`, `server/src/routes/auth.ts`, `server/src/routes/settings.ts`
- Contains: Fastify plugin functions with Zod-validated request/response schemas
- Depends on: application layer singletons, shared validation schemas, auth middleware
- Used by: Fastify server registered in `server/src/app.ts`

**Application (`server/src/application/`):**
- Purpose: Orchestrates use cases by coordinating domain logic, repositories, and infrastructure
- Location: `server/src/application/stack-service.ts`, `server/src/application/index.ts`
- Contains: `StackService` class — wires together `StackRepository`, `StackFilesystem`, `DockerExecutor`
- Depends on: domain, repositories, infrastructure layers
- Used by: routes layer via singleton exported from `server/src/application/index.ts`

**Domain (`server/src/domain/`):**
- Purpose: Pure business logic — no I/O, no framework dependencies
- Location: `server/src/domain/stack-status-machine.ts`, `server/src/domain/compose-config.ts`
- Contains: state machine transition tables, `TransitionError`, compose config value object
- Depends on: nothing (only generated Prisma enums for type safety)
- Used by: application layer

**Repositories (`server/src/repositories/`):**
- Purpose: Data access abstraction over Prisma — all DB queries live here
- Location: `server/src/repositories/stack-repository.ts`, `server/src/repositories/settings-repository.ts`
- Contains: `StackRepository` class with typed query methods; Prisma transactions for atomic operations
- Depends on: `server/src/lib/db.ts` (Prisma client singleton), generated Prisma types
- Used by: application layer, jobs layer

**Infrastructure (`server/src/infrastructure/`):**
- Purpose: External system adapters — filesystem and Docker CLI integration
- Location: `server/src/infrastructure/docker-executor.ts`, `server/src/infrastructure/stack-filesystem.ts`
- Contains: `DockerExecutor` (wraps `docker compose` CLI via `child_process`), `StackFilesystem` (fs read/write for compose/env files)
- Depends on: Node.js built-ins (`child_process`, `fs/promises`), `server/src/lib/stacks-dir.ts`
- Used by: application layer

**Jobs (`server/src/jobs/`):**
- Purpose: Background polling to auto-reconcile stack status from real Docker container states
- Location: `server/src/jobs/state-poller.ts`, `server/src/jobs/index.ts`
- Contains: `StatePoller` class, `deriveStackStatus` pure function, `startJobs` initializer
- Depends on: repositories, infrastructure layers
- Used by: app startup

**Client (`client/src/`):**
- Purpose: React SPA for managing stacks via the REST API
- Location: `client/src/`
- Contains: routes (pages), hooks (data fetching), lib (API clients), components (UI and domain)
- Depends on: server REST API via `apiFetch`, `@docktor/shared` for input types, `better-auth` client SDK
- Used by: end users in browser

## Data Flow

**Create Stack (HTTP Request):**
1. `POST /api/stacks` hits `server/src/routes/stacks.ts` — Zod validates body using `createStackSchema` from `@docktor/shared`
2. Route delegates to `stackService.createStack()` in `server/src/application/stack-service.ts`
3. Application calls `StackFilesystem.createDirectory()` and `StackFilesystem.writeCompose()` to create files on disk
4. Calls `createComposeConfig()` from domain to parse and hash the compose file
5. Calls `StackRepository.create()` which writes to PostgreSQL via Prisma
6. Returns created stack record; route sends HTTP 201

**Deploy Stack:**
1. `POST /api/stacks/:id/deploy` → `stackService.deployStack()`
2. Application fetches stack from repo, calls `assertTransition()` domain function to validate the state machine allows DEPLOY
3. Transitions status to `DEPLOYING` in DB (with status log entry, atomically via Prisma transaction)
4. Calls `DockerExecutor.up()` which spawns `docker compose up -d --remove-orphans`
5. Records deployment result in `Deployment` table
6. Transitions to `RUNNING` or `ERROR` depending on outcome

**State Polling (Background):**
1. `startJobs()` sets a 15-second interval calling `StatePoller.poll()`
2. Poller fetches all active stacks via `StackRepository.findAllActive()`
3. For each stack, calls `DockerExecutor.ps()` to get live container states
4. Calls `deriveStackStatus()` (pure domain function) to compute target status
5. If status differs from DB, calls `StackRepository.transitionStatus()` to auto-reconcile

**Client Data Fetch:**
1. React route mounts → custom hook (e.g., `useStacks`) calls API function from `client/src/lib/stacks-api.ts`
2. API function calls `apiFetch()` in `client/src/lib/api.ts` using `fetch` with `credentials: "include"`
3. Response shape mirrors Prisma model + relations (typed by hand in `client/src/lib/stacks-api.ts`)
4. Hook stores result in `useState`, exposes `{ data, loading, error, refetch }`

**State Management:**
- Client uses local component state (`useState`) and custom fetch hooks — no global state library
- Server state is the source of truth; client refetches after every mutation via `refetch()`

## Key Abstractions

**StackStatus State Machine:**
- Purpose: Enforces legal lifecycle transitions for Docker Compose stacks
- Location: `server/src/domain/stack-status-machine.ts`
- Pattern: Static `TRANSITIONS` record maps action → allowed source statuses; `assertTransition()` throws `TransitionError` on violation; application layer converts to `BadRequestError` (400)
- States: `DRAFT`, `DEPLOYING`, `RUNNING`, `HEALTHY`, `UNHEALTHY`, `STOPPED`, `ERROR`, `UPDATING`, `BACKING_UP`, `RESTORING`, `MIGRATING`

**StackService:**
- Purpose: Single application-layer facade for all stack operations
- Location: `server/src/application/stack-service.ts`
- Pattern: Constructor-injected dependencies (`StackRepository`, `StackFilesystem`, `DockerExecutor`) — enables unit testing with mocks; singleton wired in `server/src/application/index.ts`

**AppError Hierarchy:**
- Purpose: Typed HTTP errors that propagate cleanly to Fastify's global error handler
- Location: `server/src/lib/errors.ts`
- Pattern: `AppError(message, statusCode)` base class; subclasses `NotFoundError` (404), `ConflictError` (409), `BadRequestError` (400); global handler in `server/src/app.ts` maps these to HTTP responses

**Shared Validation Schemas:**
- Purpose: Single source of truth for input shapes consumed by both server (validation) and client (TypeScript types)
- Location: `shared/src/validation/stacks.ts`, `shared/src/validation/settings.ts`, `shared/src/validation/auth.ts`
- Pattern: Zod schema + `z.infer<>` type export; server plugs schemas directly into Fastify route definitions via `fastify-type-provider-zod`

**Custom React Hooks:**
- Purpose: Encapsulate fetch lifecycle (loading/error/data) per resource
- Location: `client/src/hooks/use-stacks.ts`, `client/src/hooks/use-stack.ts`, `client/src/hooks/use-log-stream.ts`
- Pattern: `useCallback` for stable fetch reference, `useEffect` to trigger on mount, returns `{ data, loading, error, refetch }`; `useLogStream` uses `EventSource` (SSE) for live log tailing

## Entry Points

**Server (`server/src/index.ts`):**
- Location: `server/src/index.ts`
- Triggers: `node dist/server/index.js` (production), dev script via `tsx`
- Responsibilities: Calls `buildApp()`, binds to `PORT`/`HOST` env vars, starts Fastify listening

**App Factory (`server/src/app.ts`):**
- Location: `server/src/app.ts`
- Triggers: Called by `server/src/index.ts` and test setup
- Responsibilities: Creates Fastify instance, registers plugins (cors, cookie, zod type provider), registers route plugins (`authRoutes`, `stackRoutes`, `settingsRoutes`), sets up global error handler, serves static SPA in production via `@fastify/static`

**Client (`client/src/main.tsx`):**
- Location: `client/src/main.tsx`
- Triggers: Browser loads `index.html` → Vite bundles → React hydrates `#root`
- Responsibilities: Sets up `BrowserRouter`, defines all routes, wraps app routes in `ProtectedRoute` that redirects unauthenticated users to `/login`

## Error Handling

**Strategy:** Throw typed errors from domain/application layers; catch centrally at Fastify's global error handler.

**Patterns:**
- Domain throws `TransitionError`; application catches and re-throws as `BadRequestError`
- Repository throws `NotFoundError` for missing records; `ConflictError` for duplicates
- Global handler in `server/src/app.ts` maps `AppError` subclasses to their `statusCode`
- Zod validation errors from `fastify-type-provider-zod` are caught and returned as 400 with `details`
- Unhandled errors fall through to 500 with generic message; Pino logs the original error
- Client wraps `apiFetch` errors in `ApiError(message, status)`; hooks expose an `error: string | null` to UI

## Cross-Cutting Concerns

**Logging:** Pino logger built into Fastify; `pino-pretty` in development, structured JSON in production, silent in test (controlled by `NODE_ENV` in `server/src/app.ts`)

**Validation:** Zod schemas defined in `@docktor/shared`; enforced at route boundary via `fastify-type-provider-zod`; slug format validated in `server/src/lib/slugify.ts`

**Authentication:** `better-auth` with Prisma adapter configured in `server/src/lib/auth.ts`; session validated per-request via `requireAuth` Fastify hook in `server/src/lib/auth-middleware.ts`; all `/api/stacks` and `/api/settings` routes are protected; `/api/auth/*` routes are public

---

*Architecture analysis: 2026-03-10*
