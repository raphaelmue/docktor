# Technology Stack

**Project:** Docktor — Docker Compose management platform
**Researched:** 2026-03-10
**Scope:** Milestone 2 additions — container state poller, live log streaming, settings page,
file watcher, update checker, SMTP notifications, first-run wizard, brownfield import,
backup/restore (restic), Nginx Proxy Manager integration.

---

## Current Stack (Locked — Do Not Change)

These are confirmed from the existing codebase and `server/package.json`.

| Layer | Technology | Version (installed) | Notes |
|-------|-----------|---------------------|-------|
| Runtime | Node.js + TypeScript | Node 20 LTS in dev, 22-slim in prod image | ESM (`"type": "module"`) |
| HTTP server | Fastify | 5.7.4 | `fastify-type-provider-zod` for typed routes |
| Frontend | React + Vite | — | SPA, served by Fastify in prod via `@fastify/static` |
| UI | shadcn/ui + Tailwind CSS | — | Locked |
| ORM / DB | Prisma + PostgreSQL | — | Multi-file schema under `server/prisma/schema/` |
| Auth | better-auth | — | Email + password, session-based |
| Compose orchestration | `docker compose` CLI via `node:child_process` | — | `DockerExecutor` service wrapper |
| Docker SDK | dockerode | 4.0.9 | For inspect, log streaming |
| File watching | chokidar | 4.0.3 | Already installed |
| Job scheduler | node-cron | 3.0.3 | Already installed |
| YAML parsing | yaml | 2.7.0 | Already installed |
| Validation | Zod | 4.3.6 | Shared between client and server |

---

## Recommended Additions

### 1. SMTP — nodemailer

**Recommendation: nodemailer ^6.9**
**Confidence: HIGH** — de facto standard for SMTP in Node.js; no serious alternative.

nodemailer is not yet installed. It is the industry standard for SMTP in Node.js, has been
maintained since 2010, and has zero runtime dependencies. It supports TLS/STARTTLS, connection
pooling, and all standard auth mechanisms (LOGIN, PLAIN, OAuth2 — only LOGIN/PLAIN needed for
MVP). The v6.x line is current and stable.

Do not use: `email-templates` (overkill), `@sendgrid/mail` (SaaS dependency), `mailgen`
(template generator only, not a transport). nodemailer alone is sufficient.

**Install:**
```bash
npm install nodemailer
npm install -D @types/nodemailer
```

**Usage pattern for Docktor:**
```typescript
import nodemailer from 'nodemailer';

// Create transporter once; reuse across notifications
const transporter = nodemailer.createTransport({
  host: settings.smtp_host,
  port: settings.smtp_port,     // 587 default (STARTTLS)
  secure: settings.smtp_port === 465,  // true for 465, false for 587
  auth: {
    user: settings.smtp_username,
    pass: settings.smtp_password,  // decrypt from DB before use
  },
});

await transporter.sendMail({
  from: settings.smtp_from,
  to: settings.notification_recipient,
  subject: `[Docktor] Stack "${stackId}" entered ERROR state`,
  text: `Stack ${stackId} entered ERROR state at ${new Date().toISOString()}\n\n${lastLogLines}`,
});
```

**Key points:**
- Call `transporter.verify()` when saving SMTP settings to validate credentials immediately.
- Re-create the transporter when settings change (settings change is infrequent; singleton is fine).
- `smtp_port: 587` with `secure: false` is the correct default for modern STARTTLS servers.
  `smtp_port: 465` with `secure: true` is for SSL-wrapped legacy connections.
- Store `smtp_password` AES-encrypted in the Settings model (already planned in DB schema).

---

### 2. Restic CLI Invocation

**Recommendation: `node:child_process.spawn` (built-in) — no extra library needed**
**Confidence: HIGH** — derived from existing `DockerExecutor` pattern already in the codebase.

Restic is invoked as a CLI process, exactly like `docker compose`. The project already uses
`execFileAsync` (promisified `execFile` from `node:child_process`) in `DockerExecutor`. Use the
same pattern for a `ResticExecutor` service.

Use `execFile` (not `exec`) to avoid shell injection via user-supplied values (repo paths,
passwords). Pass restic arguments as an array.

**Do not add execa.** Execa v5 is present as a transitive dependency but is not a direct
dependency. Execa v9+ (ESM-only rewrite) is the current version — the transitive v5 is stale.
The project's existing approach (`node:child_process.execFile`) is correct for short-lived
commands like backup/restore. There is no benefit to adding execa here.

**ResticExecutor pattern (mirrors DockerExecutor):**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ResticExecutor {
  private async restic(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('restic', args, {
      env: { ...process.env, ...env },
      timeout: 300_000, // 5 minutes for backup/restore operations
    });
  }

  async backup(repoPath: string, repoPassword: string, sourceDir: string, tags: string[]): Promise<void> {
    await this.restic(
      ['backup', sourceDir, '--json', ...tags.flatMap(t => ['--tag', t])],
      { RESTIC_REPOSITORY: repoPath, RESTIC_PASSWORD: repoPassword }
    );
  }

  async snapshots(repoPath: string, repoPassword: string): Promise<ResticSnapshot[]> {
    const { stdout } = await this.restic(
      ['snapshots', '--json'],
      { RESTIC_REPOSITORY: repoPath, RESTIC_PASSWORD: repoPassword }
    );
    return JSON.parse(stdout);
  }

  async restore(repoPath: string, repoPassword: string, snapshotId: string, targetDir: string): Promise<void> {
    await this.restic(
      ['restore', snapshotId, '--target', targetDir],
      { RESTIC_REPOSITORY: repoPath, RESTIC_PASSWORD: repoPassword }
    );
  }

  async forget(repoPath: string, repoPassword: string, policy: RetentionPolicy): Promise<void> {
    const flags = [
      policy.daily    ? `--keep-daily=${policy.daily}` : null,
      policy.weekly   ? `--keep-weekly=${policy.weekly}` : null,
      policy.monthly  ? `--keep-monthly=${policy.monthly}` : null,
    ].filter(Boolean) as string[];
    await this.restic(
      ['forget', '--prune', ...flags],
      { RESTIC_REPOSITORY: repoPath, RESTIC_PASSWORD: repoPassword }
    );
  }
}
```

**Key points:**
- Pass `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` as environment variables, never as CLI args.
  This avoids them appearing in `ps` output.
- `restic` is installed in the Docker image (confirmed in `docs/design.md` Dockerfile).
- For backup/restore, `execFile` is acceptable — these are one-shot operations with a bounded
  timeout. Streaming stdout for progress updates is a post-MVP enhancement.
- `restic init` must be called once on first backup. Check with `restic snapshots` — if it
  fails with exit code 1 and "no initialized repository", call `init` automatically.
- `--json` flag on `snapshots` returns machine-parseable output; always use it.

---

### 3. Dockerode: Container Inspect and Log Streaming

**Recommendation: dockerode 4.0.9 (already installed) — use `container.logs()` with `follow:true` + `container.modem.demuxStream()`**
**Confidence: HIGH** — verified directly against installed source (`node_modules/dockerode`,
`node_modules/docker-modem`).

**Container Inspect (for state poller):**

```typescript
import Dockerode from 'dockerode';

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

// Get container by ID (stored in Service.containerId from docker compose ps)
const container = docker.getContainer(containerId);
const info = await container.inspect();

// ContainerInspectInfo.State shape (confirmed from @types/dockerode):
// info.State.Status:    'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created'
// info.State.Running:   boolean
// info.State.ExitCode:  number
// info.State.Health?:   { Status: 'healthy' | 'unhealthy' | 'starting' | 'none', FailingStreak, Log }
```

**State mapping for the poller:**
```
container.State.Status === 'running' && no health → RUNNING
container.State.Status === 'running' && health.Status === 'healthy' → HEALTHY
container.State.Status === 'running' && health.Status === 'unhealthy' → UNHEALTHY
container.State.Status === 'running' && health.Status === 'starting' → RUNNING (transitioning)
container.State.Status === 'exited' && ExitCode !== 0 → ERROR
container.State.Status === 'restarting' → ERROR (crash loop)
container.State.Status === 'dead' → ERROR
```

**Log Streaming (for SSE endpoint):**

Docker logs are multiplexed: stdout and stderr share the same stream with an 8-byte header per
chunk (byte 0: stream type 1=stdout/2=stderr; bytes 4-7: payload length as uint32 big-endian).
You must demux this stream. `docker.modem.demuxStream()` does this — verified in
`node_modules/docker-modem/lib/modem.js` line 434.

```typescript
// In a Fastify SSE route handler:
app.get('/api/stacks/:id/logs/:service', async (request, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // disable Nginx buffering
  });

  const container = docker.getContainer(containerId);

  // AbortController for clean cancellation on client disconnect
  const ac = new AbortController();
  request.raw.on('close', () => ac.abort());

  const logStream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 100,       // last 100 lines of history on connect
    timestamps: true,
    abortSignal: ac.signal,
  });

  // Demux the multiplexed Docker log stream
  const { PassThrough } = await import('node:stream');
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(logStream, stdout, stderr);

  function emitLine(line: string, streamName: 'stdout' | 'stderr') {
    res.write(`data: ${JSON.stringify({ stream: streamName, line })}\n\n`);
  }

  stdout.on('data', (chunk: Buffer) => emitLine(chunk.toString(), 'stdout'));
  stderr.on('data', (chunk: Buffer) => emitLine(chunk.toString(), 'stderr'));
  logStream.on('end', () => res.end());
  logStream.on('error', () => res.end());
});
```

**Key points:**

1. **TTY containers skip demux.** If the container was started with `tty: true` in its compose
   file, Docker does NOT multiplex the stream — stdout and stderr are merged into a raw byte
   stream. Check `ContainerInspectInfo.Config.Tty`. If `Tty === true`, read `logStream` directly
   without calling `demuxStream`. Most self-hosted app containers do NOT use TTY.

2. **AbortSignal support is confirmed in `ContainerLogsOptions`.** Use `AbortController` to
   cancel the upstream Docker log stream when the SSE client disconnects. This prevents memory
   leaks from orphaned streams. Without this, every client disconnect leaves a live stream
   attached to the Docker socket.

3. **`reply.hijack()` is the correct Fastify 5 pattern** for streaming responses (confirmed
   from Fastify docs and `Migration-Guide-V5.md`). Do NOT use `reply.send()` for SSE.

4. **`X-Accel-Buffering: no`** is required when Nginx/NPM sits in front of Fastify. Without it,
   Nginx buffers the SSE stream and the client sees nothing until the buffer fills.

5. **Combined view:** For a combined log stream across all services in a stack, open one
   `container.logs()` stream per service and prefix each line with `[service-name] `. All
   streams write to the same SSE response. Maintain an `AbortController` per service and abort
   all when the client disconnects.

---

### 4. Chokidar: File Watching

**Recommendation: chokidar 4.0.3 (already installed)**
**Confidence: HIGH** — verified directly against installed source and type definitions.

Chokidar 4.x dropped native binary dependencies entirely (no more `fsevents` on macOS in prod
context). On Linux (Docktor's deployment target), it uses inotify via `fs.watch`. The API is
unchanged from v3.

**Pattern for compose file watching:**
```typescript
import chokidar from 'chokidar';

export function startFileWatcher(stacksDir: string) {
  const watcher = chokidar.watch(`${stacksDir}/*/docker-compose.yml`, {
    persistent: true,
    ignoreInitial: true,     // don't fire 'add' events for files present at startup
    awaitWriteFinish: {
      stabilityThreshold: 500,  // wait 500ms after last write before firing 'change'
      pollInterval: 100,
    },
    usePolling: false,       // use inotify on Linux; set to true only for NFS/FUSE mounts
    depth: 1,                // only watch one level deep inside stacksDir
  });

  watcher.on('change', async (filePath) => {
    const stackId = extractStackIdFromPath(filePath);
    await reconcileStackConfig(stackId);
  });

  watcher.on('error', (err) => {
    logger.error({ err }, 'File watcher error');
  });

  return watcher;
}
```

**Key points:**

1. **`awaitWriteFinish` is mandatory for compose files.** Editors and `scp`/`rsync` often write
   files non-atomically (open → truncate → write). Without `awaitWriteFinish`, the 'change'
   event fires while the file is still being written and the YAML parse will fail or return
   partial content.

2. **Polling fallback is a separate reconciliation loop, not a chokidar option.** Do NOT set
   `usePolling: true` globally — it is expensive (polls every N ms for every watched file).
   Instead, implement a 60s interval via `node-cron` that hashes all compose files and compares
   to `Stack.lastKnownHash`. This catches changes missed by inotify on NFS mounts or bind-mounted
   volumes in Docker.

3. **NFS/FUSE caveat.** If the stacks directory is on an NFS mount (e.g., a NAS), inotify events
   are not delivered. The 60s polling reconciler is the safety net. Document this limitation.

4. **Glob pattern `${stacksDir}/*/docker-compose.yml`** watches exactly the files needed without
   watching the volumes/ subdirectory (which would generate enormous noise from database writes).

5. **`ignoreInitial: true`** is critical. On startup, chokidar fires 'add' events for all already-
   watched files. Without this flag, every startup would trigger config reconciliation for all
   stacks.

---

### 5. Nginx Proxy Manager API Integration

**Recommendation: native `fetch` (Node.js built-in) — no HTTP client library needed**
**Confidence: MEDIUM** — NPM API behavior derived from training knowledge (knowledge cutoff
August 2025); web fetch tools unavailable during this research session. Verify against
https://github.com/NginxProxyManager/nginx-proxy-manager before implementation.

NPM exposes a REST API (no official versioning, but stable in practice). Authentication uses
JWT tokens issued via `POST /api/tokens`. Proxy hosts are created/updated via
`POST /api/nginx/proxy-hosts` and `PUT /api/nginx/proxy-hosts/:id`.

**Do not add an NPM client library.** No battle-tested Node.js client library exists. The NPM
API surface Docktor needs is small (token management + proxy host CRUD + SSL request). Use
native `fetch` directly.

**NPM API client pattern:**
```typescript
export class NginxProxyManagerClient {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private baseUrl: string, private email: string, private password: string) {}

  private async authenticate(): Promise<void> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) return;

    const res = await fetch(`${this.baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: this.email, secret: this.password }),
    });
    if (!res.ok) throw new Error(`NPM auth failed: ${res.status}`);
    const data = await res.json() as { token: string; expires: string };
    this.token = data.token;
    this.tokenExpiry = new Date(data.expires);
  }

  async createProxyHost(opts: {
    domain: string;
    forwardHost: string;
    forwardPort: number;
    ssl?: boolean;
  }): Promise<number> {
    await this.authenticate();
    const res = await fetch(`${this.baseUrl}/api/nginx/proxy-hosts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        domain_names: [opts.domain],
        forward_scheme: 'http',
        forward_host: opts.forwardHost,
        forward_port: opts.forwardPort,
        ssl_forced: opts.ssl ?? true,
        certificate_id: opts.ssl ? 'new' : null,
        meta: { letsencrypt_agree: opts.ssl, letsencrypt_email: 'admin@docktor' },
      }),
    });
    if (!res.ok) throw new Error(`NPM create proxy host failed: ${res.status}`);
    const host = await res.json() as { id: number };
    return host.id;
  }

  async deleteProxyHost(id: number): Promise<void> {
    await this.authenticate();
    await fetch(`${this.baseUrl}/api/nginx/proxy-hosts/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
  }
}
```

**Key points:**

1. **Store NPM URL + credentials in the Settings model** (encrypted for password). NPM base URL
   defaults to `http://nginx-proxy-manager:81` when NPM runs as a Docktor-managed stack on the
   same Docker network.

2. **Store the NPM proxy host ID in `ProxyConfig.npmHostId`** (add to schema if not present).
   This allows updating or deleting the proxy host later. Without it, you cannot identify which
   NPM host corresponds to which Docktor service.

3. **Token expiry:** NPM JWT tokens expire after 1 day by default. Cache the token and
   re-authenticate when expired (as shown above). Do not authenticate on every request.

4. **SSL via Let's Encrypt:** NPM handles TLS automatically via Let's Encrypt when
   `certificate_id: 'new'` is set. This requires the NPM container to be reachable from the
   public internet on port 80. For LAN-only deployments, set `ssl: false`.

5. **NPM API is not officially versioned.** It is an internal API that has changed across NPM
   versions. **This is the highest-risk integration in this milestone.** Test against the actual
   NPM version running in the user's environment. The proxy configuration feature should be
   marked as requiring specific NPM version compatibility (NPM 2.x API).

6. **Low adoption risk mitigation:** Proxy configuration is the last post-MVP phase. Defer
   until the API surface is validated against a running NPM instance during development.

---

## Full Stack Summary

### Core Framework (Locked)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22 LTS (prod), 20 LTS (dev) | Runtime | Strong async I/O, Docker socket support |
| TypeScript | ^5.7.3 | Language | Type safety across client/server/shared |
| Fastify | ^5.7.4 | HTTP + SSE + static serving | High-perf, schema validation, reply.hijack() for SSE |
| React + Vite | — | SPA frontend | Fast builds, HMR, no SSR overhead needed |

### Database (Locked)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | — | Primary database | Robust, multi-schema Prisma support |
| Prisma | — | ORM | Multi-file schema, type-safe queries |

### Docker Integration (Locked)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| dockerode | ^4.0.9 | Container inspect + log streaming | Mature Node.js Docker API client |
| docker compose CLI | v2 (plugin) | Stack lifecycle operations | dockerode cannot orchestrate compose |
| node:child_process | built-in | CLI invocation for compose + restic | No extra library needed |

### Supporting Libraries (Installed, Configured in Milestone 2)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | ^4.0.3 | Watch compose files for external edits | File watcher feature |
| node-cron | ^3.0.3 | Polling reconciliation + backup scheduling + update checks | All background jobs |
| yaml | ^2.7.0 | Compose file parsing | Brownfield scan + config parse |

### New Additions for Milestone 2

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| nodemailer | ^6.9 | SMTP email notifications | Industry standard, zero deps, full TLS/auth support |
| @types/nodemailer | ^6.4 | TypeScript types for nodemailer | Dev dependency |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| SMTP | nodemailer | @sendgrid/mail | SaaS dependency; self-hosters should not need a cloud SMTP relay |
| SMTP | nodemailer | email-templates | Template generation overkill; Docktor emails are simple text alerts |
| CLI execution | node:child_process | execa | Transitive dep only (stale v5); no benefit over built-in for one-shot commands |
| NPM API | native fetch | node-fetch, axios, got | Node 18+ has built-in fetch; no need for HTTP client libraries |
| SSE | reply.raw (Fastify) | @fastify/sse, fastify-sse-v2 | These plugins add reply.sse() for simple use; Docktor's SSE streams are complex (dockerode pipe) and reply.hijack() + reply.raw gives full control |
| File watching | chokidar | fs.watch (native) | Native fs.watch is not cross-platform reliable and lacks glob support, awaitWriteFinish, and depth filtering |

---

## Installation

```bash
# New dependency (server)
cd server && npm install nodemailer
npm install -D @types/nodemailer

# All other dependencies are already installed
```

---

## Confidence Summary

| Area | Confidence | Source |
|------|------------|--------|
| dockerode API (logs, inspect) | HIGH | Verified against installed source: `node_modules/dockerode` v4.0.9, `node_modules/docker-modem`, `node_modules/@types/dockerode` |
| dockerode demuxStream | HIGH | Verified against `node_modules/docker-modem/lib/modem.js` line 434 |
| Fastify SSE pattern (reply.hijack + reply.raw) | HIGH | Verified against `node_modules/fastify/docs/Reference/Reply.md` and Migration-Guide-V5.md |
| ContainerLogsOptions.abortSignal | HIGH | Verified in `@types/dockerode` line 2083 |
| ContainerInspectInfo.State shape | HIGH | Verified in `@types/dockerode` lines 585-608 |
| chokidar API | HIGH | Verified against `node_modules/chokidar/index.d.ts` |
| node:child_process for restic | HIGH | Mirrors existing DockerExecutor pattern in codebase |
| nodemailer API | HIGH (training) | Industry standard; no breaking changes in v6 since 2019. Not independently verified this session due to tool restrictions. |
| NPM API endpoints | MEDIUM | Training knowledge (August 2025). Web fetch denied. Verify against https://github.com/NginxProxyManager/nginx-proxy-manager/tree/develop/backend/internal/api before implementing the proxy phase. |
| NPM JWT token schema | MEDIUM | Same caveat as above |

---

## Risks and Flags

**Highest risk: Nginx Proxy Manager API.**
NPM's API is internal and undocumented officially. It changes across NPM versions without
announcement. Implementation should be deferred to the final post-MVP phase and validated
against a live NPM instance early in that phase. If the API has changed materially,
the proxy integration may need a different approach (e.g., direct Nginx config file generation
instead of NPM API calls).

**Medium risk: dockerode TTY containers.**
Some containers use `tty: true`, which bypasses the Docker multiplex framing. The log streaming
implementation must check `ContainerInspectInfo.Config.Tty` and skip `demuxStream` for those
containers. Failure to handle this results in binary garbage in the log stream.

**Low risk: chokidar on NFS.**
inotify events are not delivered on NFS mounts. The 60s polling reconciler is the mitigation,
but this must be implemented — it is not optional.

---

## Sources

- Installed source: `server/package.json` — confirmed all existing dependencies and versions (HIGH)
- Installed source: `node_modules/@types/dockerode/index.d.ts` — ContainerInspectInfo, ContainerLogsOptions, abortSignal (HIGH)
- Installed source: `node_modules/docker-modem/lib/modem.js` — demuxStream implementation (HIGH)
- Installed source: `node_modules/dockerode/lib/container.js` — logs() implementation with isStream/follow (HIGH)
- Installed source: `node_modules/chokidar/index.d.ts` — ChokidarOptions, FSWatcher API (HIGH)
- Installed source: `node_modules/fastify/docs/Reference/Reply.md` — reply.hijack() + reply.raw pattern (HIGH)
- Installed source: `node_modules/fastify/docs/Guides/Ecosystem.md` — @fastify/sse plugin reference (HIGH)
- Project context: `.planning/PROJECT.md` — requirements, constraints, architectural decisions (HIGH)
- Project context: `docs/design.md` — detailed technical design (HIGH)
- Existing codebase: `server/src/infrastructure/docker-executor.ts` — child_process pattern (HIGH)
- Training knowledge (August 2025 cutoff): nodemailer API, NPM API — WebSearch and WebFetch denied during this session
