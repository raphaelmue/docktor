# Architecture Patterns

**Project:** Docktor
**Researched:** 2026-03-10
**Scope:** Background jobs, SSE log streaming, CLI subprocess integration

---

## Recommended Architecture

Docktor is a **single-process Fastify server** that owns API handling, background jobs, SSE streams, and static file
serving. All features in this milestone slot cleanly into the existing layered architecture — no new top-level patterns
are needed. The work is adding three new vertical slices: the jobs subsystem, the SSE log route, and settings persistence.

```
┌─────────────────────────────────────────────────────────────────┐
│  server/src/                                                     │
│                                                                  │
│  ┌─── Routes (HTTP boundary) ──────────────────────────────┐    │
│  │  GET /api/stacks/:id/logs  (SSE)                         │    │
│  │  GET /api/settings                                       │    │
│  │  PUT /api/settings                                       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                   │                                               │
│  ┌─── Application (use-case orchestration) ────────────────┐    │
│  │  StackService  (existing)                                │    │
│  │  SettingsService  (new)                                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                   │                                               │
│  ┌─── Domain (pure logic) ─────────────────────────────────┐    │
│  │  stack-status-machine.ts  (existing)                     │    │
│  │  deriveStackStatus()  (belongs here, pure fn)            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                   │                                               │
│  ┌─── Repositories (DB access) ────────────────────────────┐    │
│  │  StackRepository  (existing)                             │    │
│  │  SettingsRepository  (new — key-value CRUD)              │    │
│  └──────────────────────────────────────────────────────────┘    │
│                   │                                               │
│  ┌─── Infrastructure (external adapters) ──────────────────┐    │
│  │  DockerExecutor  (existing — docker compose CLI)         │    │
│  │  DockerodeClient  (new — log streaming + inspect)        │    │
│  │  StackFilesystem  (existing — file ops)                  │    │
│  │  CliRunner  (new — restic, any future CLIs)              │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─── Jobs (background processes) ─────────────────────────┐    │
│  │  StatePoller  (15s interval — docker compose ps)         │    │
│  │  FileWatcher  (chokidar + 60s reconciliation fallback)   │    │
│  │  UpdateChecker  (node-cron, registry polling)            │    │
│  │  BackupScheduler  (node-cron, per-stack schedules)       │    │
│  │  startJobs() / stopJobs()  (lifecycle hooks)             │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `routes/logs.ts` | Accept SSE connection, pipe dockerode stream to response | `DockerodeClient` |
| `routes/settings.ts` | Validate and proxy settings reads/writes | `SettingsService` |
| `application/settings-service.ts` | Business logic around settings (defaults, encryption) | `SettingsRepository` |
| `repositories/settings-repository.ts` | Key-value CRUD against `Setting` Prisma model | Prisma / PostgreSQL |
| `infrastructure/dockerode-client.ts` | Wrap dockerode: log streaming, container inspect | `dockerode` library |
| `infrastructure/cli-runner.ts` | Spawn CLIs (restic, etc.) with stdout/stderr capture | `child_process` |
| `jobs/state-poller.ts` | Poll every 15s, reconcile DB status from live container state | `DockerExecutor`, `StackRepository` |
| `jobs/file-watcher.ts` | Watch compose files via chokidar, reconcile hash on change | `StackFilesystem`, `StackRepository` |
| `jobs/update-checker.ts` | Schedule registry digest checks, write update-available flags | `DockerodeClient`, `StackRepository` |
| `jobs/backup-scheduler.ts` | node-cron wrappers per stack schedule, invoke backup service | `BackupService`, `SettingsRepository` |
| `jobs/index.ts` | `startJobs(app)` + `stopJobs()` — wires all jobs to Fastify lifecycle | All job classes |

**Key boundary rule:** Jobs and routes do NOT call each other. Jobs write to the DB; routes read from the DB (or stream
directly from Docker). This keeps the jobs layer testable independently from the HTTP layer.

---

## Data Flow

### Background Job Lifecycle

```
server/src/index.ts
  → buildApp()               ← registers plugins, routes
  → app.listen()
  → app.addHook('onReady')   ← startJobs(app) called here
      │
      ├── StatePoller.start()     → setInterval(15s) → DockerExecutor.ps() → StackRepository.transitionStatus()
      ├── FileWatcher.start()     → chokidar.watch()  → StackFilesystem.hash() → StackRepository.setConfigChanged()
      ├── UpdateChecker.start()   → node-cron         → DockerodeClient.getDigest() → StackRepository.setUpdateAvailable()
      └── BackupScheduler.start() → node-cron (per stack) → BackupService.runBackup()

  → app.addHook('onClose')   ← stopJobs() called here
      └── all jobs: clearInterval / chokidar.close() / cron.stop()
```

**Why `onReady` not module-level startup:** `onReady` fires after all plugins are registered and the server is bound.
Starting jobs earlier can race with the DB connection or plugin setup. `onClose` ensures clean shutdown (no dangling
intervals/watchers causing test hangs or port conflicts).

### SSE Log Streaming (end-to-end)

```
Browser
  → EventSource('GET /api/stacks/:id/logs?service=<name>')
  → Fastify route handler
      → sets headers: Content-Type: text/event-stream, Cache-Control: no-cache, Connection: keep-alive
      → calls DockerodeClient.getLogStream(containerId, { follow: true, stdout: true, stderr: true, tail: 100 })
          → dockerode returns a Node.js Readable (multiplexed docker stream)
          → demuxStream (dockerode.modem.demuxStream) splits stdout/stderr
          → for each line: reply.raw.write('data: <json-encoded line>\n\n')
      → on client disconnect (req.socket 'close' event): destroy the dockerode stream
```

**Why `reply.raw` not reply.send:** Fastify's high-level response finalizes the response body. SSE requires an open
connection that writes incrementally. `reply.raw` gives direct access to the underlying `http.ServerResponse` stream.

**Why JSON-encoded SSE data:** Raw log lines may contain colons (SSE separator) or newlines (SSE frame delimiter).
Encoding as `JSON.stringify({line, stream, ts})` makes parsing deterministic on the client.

**Client side (`useLogStream` hook):**
```
EventSource → onmessage → JSON.parse(event.data) → append to log buffer (useState)
onError → mark stream as disconnected (show reconnect UI)
cleanup → eventSource.close() on unmount
```

### Settings Persistence

```
Client
  → PUT /api/settings  { key: 'instance_name', value: 'My Server' }
  → SettingsService.set(key, value)
      → detect if key is in ENCRYPTED_KEYS list → AES-256 encrypt value
      → SettingsRepository.upsert(key, value, encrypted: true/false)
          → prisma.setting.upsert({ where: { key }, update: {...}, create: {...} })

Client
  → GET /api/settings
  → SettingsService.getAll()
      → SettingsRepository.findAll()
      → for each encrypted row: decrypt value before returning
      → return as Record<string, string>
```

**Why upsert not update:** The `Setting` model is key-value; rows may or may not exist depending on whether the user
has configured that setting yet. Upsert avoids a read-before-write and handles first-run state cleanly.

### CLI Tool Integration (restic + docker compose)

```
CliRunner.run(cmd: string, args: string[], options):
  → spawn(cmd, args, { stdio: 'pipe', env: {...} })
  → accumulate stdout chunks → string
  → accumulate stderr chunks → string
  → on close(code):
      code === 0 → resolve({ stdout, stderr })
      code !== 0 → reject(new CliError(cmd, code, stderr))

CliError extends AppError:
  → message: '[cmd] exited with code [code]: [stderr snippet]'
  → carries full stderr for logging/storage
```

**Pattern distinction from DockerExecutor:** The existing `DockerExecutor` uses `execFile` (buffered, suitable for
short-lived compose commands). `CliRunner` should use `spawn` with streaming for restic (backups produce large output
over time). Long-running processes must have a timeout and the ability to be aborted (pass an `AbortController`).

---

## Patterns to Follow

### Pattern 1: Job as a Stateful Class with start/stop

```typescript
// server/src/jobs/state-poller.ts
export class StatePoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: StackRepository,
    private readonly docker: DockerExecutor,
    private readonly intervalMs = 15_000,
  ) {}

  start(): void {
    if (this.timer) return; // idempotent
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<void> { /* ... */ }
}
```

**Why:** Testable (instantiate with mocks, call `poll()` directly), stoppable (critical for test isolation), idempotent
start (safe to call multiple times).

### Pattern 2: Fastify Lifecycle Hooks for Job Registration

```typescript
// server/src/app.ts  (addition)
import { startJobs, stopJobs } from './jobs/index.js';

app.addHook('onReady', async () => {
  startJobs();
});

app.addHook('onClose', async () => {
  await stopJobs();
});
```

**Why not top-level module startup:** Hooks fire in the right order relative to plugin setup and DB availability.
`onClose` ensures tests that call `app.close()` don't leave dangling timers.

### Pattern 3: SSE Route with Backpressure and Cleanup

```typescript
// server/src/routes/logs.ts
app.get('/api/stacks/:id/logs', async (request, reply) => {
  const containerId = await resolveContainerId(request.params.id, request.query.service);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // disable nginx buffering
  });
  reply.raw.flushHeaders();

  const logStream = await dockerodeClient.getLogStream(containerId);

  logStream.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trimEnd();
    reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`);
  });

  logStream.on('end', () => {
    reply.raw.write('event: end\ndata: {}\n\n');
    reply.raw.end();
  });

  request.socket.on('close', () => {
    logStream.destroy();
  });
});
```

**`X-Accel-Buffering: no`:** Required when Nginx/NPM sits in front — prevents the proxy from buffering SSE frames.

### Pattern 4: CLI Subprocess with Streaming and Abort

```typescript
// server/src/infrastructure/cli-runner.ts
export class CliRunner {
  async run(
    cmd: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: 'pipe',
        signal: options.signal,
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new CliError(cmd, code ?? -1, stderr));
      });

      proc.on('error', reject);

      if (options.timeout) {
        setTimeout(() => proc.kill('SIGTERM'), options.timeout);
      }
    });
  }
}
```

### Pattern 5: Dockerode Container Lookup by Compose Labels

Dockerode identifies containers by ID. The bridge from stack/service name to container ID uses Docker's label system.
Compose sets `com.docker.compose.project=<stackId>` and `com.docker.compose.service=<serviceName>` on every container.

```typescript
// server/src/infrastructure/dockerode-client.ts
async findContainer(stackId: string, serviceName: string): Promise<Dockerode.Container> {
  const containers = await this.docker.listContainers({
    filters: JSON.stringify({
      label: [
        `com.docker.compose.project=${stackId}`,
        `com.docker.compose.service=${serviceName}`,
      ],
    }),
  });
  if (!containers.length) throw new NotFoundError(`Container not found: ${stackId}/${serviceName}`);
  return this.docker.getContainer(containers[0].Id);
}
```

**Confidence:** HIGH. These labels are set by Docker Compose v2 on every container it creates and are the standard way
to query Compose-managed containers via the API.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Starting Jobs at Module Import Time

**What:** `const poller = new StatePoller(); poller.start();` at the top level of `jobs/index.ts`.

**Why bad:** Fires immediately when the module is imported, before Fastify plugins or the DB connection are ready.
Causes test pollution — any test that imports from the jobs layer starts background timers.

**Instead:** Export a `startJobs()`/`stopJobs()` pair, called only from Fastify lifecycle hooks.

### Anti-Pattern 2: `execFile` / Buffered Spawn for Long-Running CLIs

**What:** Using the existing `execFile(promisify)` pattern for restic backup commands.

**Why bad:** `execFile` buffers all output in memory until the process exits. A restic backup of a large stack may run
for minutes and produce megabytes of progress output. Buffering it risks OOM and provides no progress feedback.

**Instead:** Use `spawn` with streaming stdout/stderr. Capture output incrementally. For backup progress, stream output
to the stack's operational log file and emit SSE events for the UI progress bar.

### Anti-Pattern 3: One SSE Connection per Log Line Poll

**What:** Client polls `GET /api/stacks/:id/logs` every few seconds, each time opening and closing a connection.

**Why bad:** Each request spawns a new `docker logs` process (via dockerode), which re-reads from the beginning (or
from `tail`). Multiplied across many containers this creates unnecessary Docker API load and log duplication in the UI.

**Instead:** One persistent SSE connection per service. The client opens it once on mount, closes on unmount. The
server streams from dockerode's `follow: true` log attach, which keeps a live connection to the Docker daemon.

### Anti-Pattern 4: State Poller Transitioning During Active Operations

**What:** The poller calls `transitionStatus()` unconditionally every 15s, overwriting transitional states like
`DEPLOYING`, `UPDATING`, `BACKING_UP`.

**Why bad:** A stack in `DEPLOYING` has no containers yet. `docker compose ps` returns empty. The poller would
incorrectly infer the stack is `STOPPED` or `ERROR` and transition it, breaking the deploy flow.

**Instead:** The poller's `deriveStackStatus()` function must skip stacks in in-progress states
(`DEPLOYING`, `UPDATING`, `BACKING_UP`, `RESTORING`, `MIGRATING`). Only auto-transition stacks in stable states
(`RUNNING`, `HEALTHY`, `UNHEALTHY`, `STOPPED`, `ERROR`).

### Anti-Pattern 5: Settings Stored in Environment Variables at Runtime

**What:** Reading `process.env.INSTANCE_NAME` throughout the application.

**Why bad:** Environment variables are immutable at runtime. Settings must be user-editable through the UI without
restarting the server.

**Instead:** Settings are read from the `Setting` DB model via `SettingsRepository`. Environment variables in
Docktor's own compose file serve only as bootstrap defaults during first run.

---

## Suggested Build Order

Dependencies flow in one direction. Build lower layers first.

```
1. SettingsRepository + SettingsService + settings route
   └── No new dependencies. Builds on existing Prisma + Repository pattern.
   └── Required by: BackupScheduler (reads schedule settings), all features needing timezone.

2. DockerodeClient (infrastructure adapter for dockerode)
   └── Wraps existing dockerode dep. Needed before SSE route and UpdateChecker.
   └── Required by: SSE log streaming route, StatePoller (for inspect), UpdateChecker.

3. StatePoller (jobs layer)
   └── Depends on: DockerExecutor (existing), StackRepository (existing), startJobs/stopJobs wiring.
   └── Required by: correct status display in UI (MVP blocker).
   └── Build order note: Add startJobs/stopJobs hooks to app.ts at this step.

4. SSE Log Streaming Route
   └── Depends on: DockerodeClient (step 2).
   └── Standalone — no job dependencies.

5. FileWatcher (jobs layer)
   └── Depends on: chokidar (already in deps), StackFilesystem, StackRepository.
   └── Can run in parallel with step 4.

6. CliRunner (infrastructure adapter for subprocess CLIs)
   └── Needed before: ResticService (backup), UpdateChecker (if using docker pull for digests).

7. BackupService + BackupScheduler
   └── Depends on: CliRunner (step 6), SettingsRepository (step 1), StackRepository (existing).

8. UpdateChecker
   └── Depends on: DockerodeClient (step 2) or registry HTTP calls, StackRepository.
   └── node-cron already in deps.
```

**Critical path for MVP:** Steps 1 → 3 → 4 (settings, state poller, SSE logs). These three unblock the three
remaining MVP items identified in PROJECT.md.

---

## Scalability Considerations

Docktor is single-host by design. These are practical limits relevant to the target environment:

| Concern | At 5 stacks | At 50 stacks | At 200 stacks |
|---------|-------------|--------------|---------------|
| State poller load | Negligible — 5 `docker compose ps` calls per 15s | Light — 50 calls per 15s, ~3 calls/s | Monitor — consider batching or dockerode Events API instead of per-stack polling |
| SSE connections | Trivial | Light | Each open SSE holds a dockerode log stream; 200+ simultaneous streams is unlikely but would consume file descriptors |
| File watcher | Trivial — chokidar inotify watchers per file | Light — 50 watchers | Linux default inotify limit (8192) is fine up to ~8k files; 60s polling fallback covers NFS edge cases |
| DB query load | Negligible | Negligible | Negligible — Prisma queries are fast; PostgreSQL handles this trivially |

The single-process architecture does not need changing within these bounds. The design document explicitly scopes
Docktor to a single personal server, so 50 stacks is a realistic ceiling for the target user.

---

## Sources

- Existing codebase: `server/src/infrastructure/docker-executor.ts`, `server/src/application/stack-service.ts`,
  `server/src/repositories/stack-repository.ts`, `server/src/app.ts`, `server/src/index.ts`
- Design document: `docs/design.md` (v2)
- Project context: `.planning/PROJECT.md`
- Codebase architecture analysis: `.planning/codebase/ARCHITECTURE.md`
- `server/package.json` — confirms `chokidar ^4.0.3`, `dockerode ^4.0.4`, `node-cron ^3.0.3` already installed
- Docker Compose label spec: `com.docker.compose.project` and `com.docker.compose.service` are set by Compose v2 on
  all managed containers (documented in Docker Compose source and widely used by management UIs including Portainer).
  Confidence: HIGH.
- SSE spec (W3C EventSource): `text/event-stream` format with `data:` / `\n\n` framing. Confidence: HIGH.
- Fastify lifecycle hooks (`onReady`, `onClose`): documented in Fastify v5 Server Lifecycle reference. Confidence: HIGH.
