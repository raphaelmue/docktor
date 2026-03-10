# Codebase Concerns

**Analysis Date:** 2026-03-10

---

## Known Bugs

**ContainerStatus interface missing `health` and `exitCode` fields — state poller is silently broken:**
- Symptoms: Health-based status transitions (RUNNING → HEALTHY, → UNHEALTHY) and crash-loop detection never trigger. `deriveStackStatus` always sees `undefined` for `c.health` and `c.exitCode`, so all stacks with healthchecks remain stuck at RUNNING instead of transitioning to HEALTHY/UNHEALTHY. Exit-code-based ERROR detection also never fires.
- Files: `server/src/infrastructure/docker-executor.ts` (interface declaration + `ps()` mapping), `server/src/jobs/state-poller.ts` (consumer)
- Trigger: Any deployed stack with a Docker HEALTHCHECK defined. Any container that crashes with a non-zero exit code.
- Root cause: The `ContainerStatus` interface only declares `{ service, state, status, ports }`. The `ps()` method only maps `obj.Service`, `obj.State`, `obj.Status`, `obj.Ports` from Docker's JSON output. It does not map `obj.Health` or `obj.ExitCode`. The poller's `deriveStackStatus` function references `c.health` and `c.exitCode`, which are `undefined` at runtime because TypeScript does not catch accesses on undeclared interface members via index access.
- Fix approach: Add `health: string` and `exitCode: number` to the `ContainerStatus` interface. Map `obj.Health ?? ""` and `obj.ExitCode ?? 0` in the `ps()` return statement inside `docker-executor.ts`.

**`StackRepository` missing `findAllActive` and `updateServiceStates` methods — state poller will crash at runtime:**
- Symptoms: The `StatePoller` calls `this.repo.findAllActive()` and `this.repo.updateServiceStates()` but neither method exists on `StackRepository`. TypeScript accepts this because `StatePoller` takes the repo typed as `StackRepository` and the mock in tests defines these methods — but the concrete class does not. At runtime the poller will throw `TypeError: this.repo.findAllActive is not a function`.
- Files: `server/src/jobs/state-poller.ts` (caller), `server/src/repositories/stack-repository.ts` (missing implementations), `server/src/jobs/index.ts` (wires `new StackRepository()` into `StatePoller`)
- Fix approach: Add `findAllActive()` to `StackRepository` — query stacks where `status NOT IN [DRAFT, DEPLOYING, UPDATING, BACKING_UP, RESTORING, MIGRATING]` or equivalent "active" set. Add `updateServiceStates(stackId, containers)` — update each `Service` row's `containerState` and `healthStatus` from the polled data.

---

## Tech Debt

**Settings validation schema mismatch between `shared/` and `server/`:**
- Issue: `server/src/repositories/settings-repository.ts` imports `SETTING_DEFAULTS`, `SETTING_KEYS`, `Settings`, and `SettingKey` from `@docktor/shared`, but `shared/src/validation/settings.ts` only exports `updateSettingSchema` (a generic key/value schema) and `UpdateSettingInput`. The `SettingsRepository` also imports `updateSettingsSchema` from `@docktor/shared` (used in `server/src/routes/settings.ts`) — this type is defined in the shared dist but the source `shared/src/validation/settings.ts` only has the single-key variant. The shared package's settings validation is incomplete.
- Files: `shared/src/validation/settings.ts`, `server/src/repositories/settings-repository.ts`, `server/src/routes/settings.ts`
- Impact: Unclear which settings types the shared package actually exports at runtime. If `SETTING_KEYS`, `SETTING_DEFAULTS`, and the bulk `updateSettingsSchema` are missing from the shared source, builds may fail or fall back to stale dist files.
- Fix approach: Add `SETTING_KEYS`, `SETTING_DEFAULTS`, and a typed bulk `updateSettingsSchema` (accepting `Partial<Settings>`) to `shared/src/validation/settings.ts`. Re-export from `shared/src/index.ts`.

**State machine defines `UPDATE`, `BACKUP`, `RESTORE` actions but `StackService` never uses them:**
- Issue: `server/src/domain/stack-status-machine.ts` declares transitions and target statuses for `UPDATE`, `BACKUP`, and `RESTORE` actions. No corresponding methods exist in `StackService`. The `services/` directory in the server is empty. The `MIGRATING`, `UPDATING`, `BACKING_UP`, `RESTORING` StackStatus enum variants and the `Backup`, `ProxyConfig`, `Registry` Prisma models are all defined but have no backing implementation.
- Files: `server/src/domain/stack-status-machine.ts`, `server/src/application/stack-service.ts`, `server/src/services/.gitkeep`, `server/prisma/schema/backup.prisma`, `server/prisma/schema/proxy.prisma`, `server/prisma/schema/registry.prisma`
- Impact: Schema carries models that are not yet wired up. Dead code in the state machine. Not a runtime bug but increases schema complexity and migration surface for no current benefit.
- Fix approach: This is intentional scaffolding per the design doc (post-MVP features). Acceptable as-is but should not grow further until implementations exist.

**Ports and volumes stored as raw JSON strings in the database:**
- Issue: `Service.ports` and `Service.volumes` are `String?` columns storing JSON arrays. Every consumer must call `JSON.parse()` directly — e.g. `client/src/routes/app/stacks/[id].tsx` line 289 calls `JSON.parse(svc.ports)` inline in JSX. No shared type guard or helper exists.
- Files: `server/src/repositories/stack-repository.ts` (write), `client/src/routes/app/stacks/[id].tsx` (read), `server/prisma/schema/service.prisma`
- Impact: Silent failures if JSON is malformed. Duplicate parsing logic spread across client and server. No TypeScript type safety on the parsed shape.
- Fix approach: Create typed accessor helpers in `shared/` (e.g. `parsePorts(raw: string | null)`) or switch to Prisma JSON field type so Prisma serializes/deserializes automatically.

**`app.ts` does not register `settingsRoutes`:**
- Issue: `server/src/routes/settings.ts` exists and is tested via integration tests, but `server/src/app.ts` only registers `authRoutes` and `stackRoutes`. The settings routes are not mounted in the app.
- Files: `server/src/app.ts`, `server/src/routes/settings.ts`
- Impact: `GET /api/settings` and `PUT /api/settings` return 404 in the running application even though the routes file and tests exist. The integration tests likely import the app via a test setup that registers additional routes, masking this.
- Fix approach: Add `await app.register(settingsRoutes)` in `buildApp()` in `server/src/app.ts`.

**`StackService.stopStack` transitions to STOPPED before calling docker — leaves DB in wrong state on failure:**
- Issue: In `stopStack`, the DB is transitioned to `STOPPED` before `docker.stop()` is called. If Docker succeeds, state is correct. If Docker fails, the code transitions the DB to `ERROR`. But during the window between the STOPPED write and the docker call, the state machine is already in STOPPED — this bypasses the "stop is allowed from RUNNING/HEALTHY/UNHEALTHY/ERROR" guard on a second concurrent stop attempt.
- Files: `server/src/application/stack-service.ts` lines 143–165
- Impact: Low probability race condition on concurrent stop requests; state log shows a spurious STOPPED entry before ERROR. Inconsistency between the DB state and actual container state.
- Fix approach: Mirror the `deployStack` pattern — transition to an intermediate "STOPPING" state (requires schema addition) or validate that the pre-transition happens after Docker confirms the stop.

---

## Security Considerations

**Docker socket mounted into the container grants root-equivalent access:**
- Risk: The production deployment mounts `/var/run/docker.sock` into the Docktor container. Any code execution vulnerability in Docktor (e.g. via crafted YAML, log injection, or dependency vulnerability) gives an attacker full Docker daemon access — which is equivalent to root on the host.
- Files: `docker-compose.yml`, `docs/design.md` (documents this intentionally)
- Current mitigation: Documented in design doc. No exploit in current code.
- Recommendations: Enforce strict input validation on all compose file paths. Consider a Docker socket proxy (e.g. `tecnativa/docker-socket-proxy`) to limit which Docker API calls are permitted.

**Compose file path is derived directly from the stack ID slug without path traversal validation:**
- Risk: `getStackPath(id)` in `server/src/lib/stacks-dir.ts` constructs the path as `path.join(getStacksDir(), id)`. The stack ID is validated by `stackIdSchema` (`/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`) before reaching filesystem operations — this regex correctly prevents `..` traversal. However any future code path that calls filesystem methods with an unvalidated ID string would be vulnerable.
- Files: `server/src/lib/stacks-dir.ts`, `shared/src/validation/stacks.ts`
- Current mitigation: Zod schema validation on all route params via `stackParamsSchema`. Risk is low.
- Recommendations: Add an explicit path-traversal assertion in `getStackPath()` itself (verify the resolved path starts with `getStacksDir()`) as defence in depth.

**No rate limiting on auth endpoints:**
- Risk: `POST /api/auth/sign-in` and `POST /api/auth/sign-up` are handled by better-auth via `toNodeHandler`. There is no Fastify rate-limit plugin registered in `buildApp()`. Brute-force password attacks are unconstrained.
- Files: `server/src/app.ts`, `server/src/routes/auth.ts`
- Current mitigation: None detected.
- Recommendations: Add `@fastify/rate-limit` scoped to `/api/auth/*` routes.

**No CSRF protection despite design doc stating it is planned:**
- Risk: The design document (`docs/design.md`) states "Fastify CSRF plugin enabled by default" in the security summary. The actual `buildApp()` does not register `@fastify/csrf-protection`. Cookie-based sessions used by better-auth are susceptible to CSRF if the app ever serves requests from other origins.
- Files: `server/src/app.ts`
- Current mitigation: CORS is restricted to `http://localhost:5173` in development and disabled in production (`origin: false`), which blocks cross-origin requests and provides partial mitigation. Not equivalent to CSRF tokens.
- Recommendations: Either add `@fastify/csrf-protection` or document why the CORS-only approach is sufficient for the single-user single-origin use case.

**`.env` file content served over API without any redaction:**
- Risk: `GET /api/stacks/:id/env` returns the full raw content of the `.env` file as plaintext. This exposes all secrets (database passwords, API keys) to anyone with a valid session.
- Files: `server/src/routes/stacks.ts`, `server/src/application/stack-service.ts` (`getEnvContent`)
- Current mitigation: Endpoint is behind `requireAuth`. Risk is bounded to authenticated users (currently single-user).
- Recommendations: Acceptable for MVP single-user scenario. Before multi-user support is added, implement secret redaction or access control on env file reads.

---

## Performance Bottlenecks

**State poller runs `docker compose ps` for all active stacks sequentially blocked by one slow stack:**
- Problem: `StatePoller.poll()` calls `Promise.allSettled()` which runs all stack polls concurrently, but each poll calls `docker compose ps` which shells out to the Docker CLI with no timeout. A single unresponsive stack (e.g. compose file referencing a missing network) can block the entire poller iteration for up to 120 seconds (the `execFileAsync` default timeout in `docker-executor.ts`).
- Files: `server/src/jobs/state-poller.ts`, `server/src/infrastructure/docker-executor.ts`
- Cause: `execFileAsync` timeout is 120s; the poller runs every 15s via `setInterval`. Concurrent polls can pile up if one is stuck.
- Improvement path: Add a shorter per-stack poll timeout (e.g. 10s) in `composeExec` for the `ps` command specifically, or wrap `pollStack` with `Promise.race` against a timeout.

**`findAll` always includes services for every stack in list view:**
- Problem: `StackRepository.findAll()` always runs `include: { services: true }`. As the number of stacks and services grows, this fetches increasingly large payloads for the stacks list page which only displays service names and images.
- Files: `server/src/repositories/stack-repository.ts`, `server/src/routes/stacks.ts`
- Cause: No pagination or field selection on the list endpoint.
- Improvement path: Add pagination to `GET /api/stacks`. Consider a separate lightweight list query that omits services or selects only needed columns.

---

## Fragile Areas

**`DockerExecutor.ps()` silently returns `[]` on any Docker error:**
- Files: `server/src/infrastructure/docker-executor.ts` lines 57–59
- Why fragile: The `catch` block returns an empty array for all errors — including transient errors (Docker daemon restart), permission errors, and genuine absent containers. The state poller treats an empty array as "no containers exist yet, don't auto-transition." A Docker daemon restart will therefore prevent any status transitions until the daemon recovers, with no error surfaced.
- Safe modification: Distinguish between "no containers" (empty stdout) and "Docker command failed" (exception). Log the error and propagate it or set an error flag rather than silently returning `[]`.
- Test coverage: Unit tests mock `docker.ps` directly and do not test this fallback path.

**`StackFilesystem.readCompose()` silently returns empty string on file read failure:**
- Files: `server/src/infrastructure/stack-filesystem.ts` lines 16–21
- Why fragile: If the compose file is missing or unreadable, `readCompose` returns `""` instead of throwing. `StackService.deployStack()` calls `readCompose` after `docker.up()` to compute the deployment hash — if the file is missing, the hash is computed on an empty string and recorded as the deploy hash. This would silently misidentify the deployed state.
- Safe modification: Throw a specific error when the compose file is absent rather than returning `""`. The `readEnv` silent-empty is intentional (env is optional) but compose should not be.
- Test coverage: Not tested for the missing-file case.

**Client-side action state uses a single `actionLoading` boolean for all stack operations:**
- Files: `client/src/routes/app/stacks/[id].tsx` lines 34, 102–119
- Why fragile: All action buttons (Deploy, Stop, Restart, Delete, Save compose, Save env) share one `actionLoading` flag. If `setActionLoading(false)` is called in `finally` but `toast.promise` swallows an async error, the flag could get stuck. Additionally, saving compose and triggering deploy simultaneously is not prevented.
- Safe modification: Use per-action loading state or a queue, and disable all action buttons when any action is in flight (which the current `disabled={actionLoading}` does — but note that `setActionLoading(false)` inside the async IIFE inside `toast.promise` is called in `finally`, so the flag should reliably clear).
- Test coverage: Not unit tested; client route tests are minimal.

---

## Missing Critical Features (Blocking Full MVP)

**Log streaming SSE endpoint does not exist on the server:**
- Problem: `client/src/hooks/use-log-stream.ts` connects to `GET /api/stacks/:id/logs` via SSE. This endpoint is not registered in `server/src/routes/stacks.ts` or anywhere in the server. The hook exists and is prepared for use, but no server-side route, dockerode integration, or log streaming is implemented.
- Blocks: Live log viewing feature listed as MVP in `docs/design.md`.
- Files: `client/src/hooks/use-log-stream.ts`, `server/src/routes/stacks.ts`

**No first-run account creation flow — open registration possible:**
- Problem: `POST /api/auth/sign-up` is publicly accessible with no guard against creating multiple accounts. The design doc defers the first-run wizard to post-MVP, meaning any user who reaches the signup URL can create an account.
- Blocks: Intended single-user enforcement.
- Files: `server/src/routes/auth.ts`, `server/src/lib/auth.ts`
- Recommendations: Add middleware that checks if any `User` row exists and rejects sign-up if it does, until a proper invitation/admin flow is implemented.

---

## Test Coverage Gaps

**`DockerExecutor` has no unit tests:**
- What's not tested: The `ps()` JSON parsing logic, port/field extraction from Docker's JSON output, the silent-empty catch block, the `composeExec` timeout behaviour.
- Files: `server/src/infrastructure/docker-executor.ts`
- Risk: The `ContainerStatus` mapping from Docker JSON is the critical data path for the entire state poller. Any regression in field mapping goes undetected.
- Priority: High

**`StackFilesystem` has no unit tests:**
- What's not tested: `readCompose` returning empty on error, `removeEnv` swallowing errors, `createDirectory` with pre-existing paths.
- Files: `server/src/infrastructure/stack-filesystem.ts`
- Risk: Silent failures in filesystem operations directly affect stack state consistency.
- Priority: Medium

**Client routes have minimal test coverage:**
- What's not tested: `client/src/routes/app/stacks/[id].tsx` (stack detail page), `client/src/routes/app/stacks/create.tsx`, `client/src/routes/app/dashboard.tsx`, `client/src/routes/app/settings.tsx` — none have unit tests.
- Files: `client/test/unit/routes/auth/components/login-form.test.tsx` is the only route-level test.
- Risk: UI state management bugs (dirty flags, action loading, error display) go undetected.
- Priority: Medium

**`StackRepository` integration tests do not cover deploy/stop/restart operations:**
- What's not tested: The `transitionStatus`, `recordDeployment`, `clearConfigChanged`, `replaceServices` repository methods are not exercised in `server/test/integration/stacks.test.ts` (only CRUD is covered).
- Files: `server/test/integration/stacks.test.ts`
- Risk: State transition bugs in the repository layer (e.g. concurrent writes, constraint violations) go undetected.
- Priority: Medium

---

*Concerns audit: 2026-03-10*
