# Domain Pitfalls

**Domain:** Docker Compose management platform (Docktor)
**Researched:** 2026-03-10
**Confidence:** HIGH (grounded in codebase inspection + domain expertise; web search unavailable)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or unrecoverable state.

---

### Pitfall 1: Poller Stomps on User-Initiated State Transitions (Race Condition)

**What goes wrong:**
The 15-second state poller reads container state from `docker inspect` and writes it to the DB. A user triggers `deploy` (DEPLOYING), but before `docker compose up` completes, the poller runs, sees no containers yet or partial container state, and writes `STOPPED` or `ERROR` back to the DB. This corrupts the state machine mid-transition and can cause the deploy handler to attempt a state transition from an unexpected state.

**Why it happens:**
The poller and the deploy handler are concurrent paths writing to the same `Stack.status` column. The current `transitionStatus` in `stack-repository.ts` uses the *current DB value* as the `from` state — if the poller has already overwritten it, the deploy completion finds an unexpected current state and either throws or silently overwrites the poller's write.

**Consequences:**
- Stack stuck in `DEPLOYING` forever (if deploy completion can't find expected `DEPLOYING` state to transition away from).
- Stack incorrectly marked `ERROR` or `STOPPED` mid-deploy, triggering incorrect notifications.
- StatusLog gains spurious transitions that break audit trail semantics.

**Prevention:**
- The poller must skip stacks in transitional states: `DEPLOYING`, `UPDATING`, `BACKING_UP`, `RESTORING`, `MIGRATING`. Read the DB state *before* calling dockerode; if the state is transitional, skip that stack entirely for this poll cycle.
- Use an optimistic-lock pattern for state writes: `UPDATE stacks SET status = $new WHERE id = $id AND status = $expected`. Prisma supports this via `where` in `update`. If 0 rows updated, the transition was superseded — treat as a no-op, log a warning.
- Never allow the poller to transition *into* a terminal transient state (`DEPLOYING`, `BACKING_UP`, etc.) — only allow it to transition *from* `RUNNING/HEALTHY/UNHEALTHY/STOPPED` to `ERROR` or between health states.

**Detection:**
- StatusLog entries showing `DEPLOYING → STOPPED → DEPLOYING` within seconds.
- DB `status = DEPLOYING` with no in-progress job (orphaned transitional state after restart).

**Phase:** MVP — Container state poller.

---

### Pitfall 2: dockerode Log Streams Not Destroyed on Client Disconnect (Memory Leak)

**What goes wrong:**
`container.logs({ follow: true, stdout: true, stderr: true })` returns a Node.js stream. When a browser tab closes or the SSE connection drops, if the server-side stream is not explicitly destroyed, dockerode holds the TCP connection to the Docker socket open indefinitely. Over time (many container restarts, tab opens/closes), the process accumulates hundreds of zombie streams and open file descriptors, eventually hitting the OS fd limit or causing high memory pressure.

**Why it happens:**
Fastify's `reply.raw` (the underlying `http.ServerResponse`) emits `close` when the client disconnects, but this event must be manually listened for and wired to `stream.destroy()`. It is easy to pipe the log stream to the response without setting up the teardown path.

**Consequences:**
- File descriptor exhaustion crashes Fastify after many reconnects (common in development with hot-reloading).
- Docker daemon eventually reports too many open connections.
- Memory grows unboundedly on long-lived instances.

**Prevention:**
```
// Required pattern for every SSE log endpoint:
request.raw.on('close', () => {
  logStream.destroy();
});
```
- Track all active streams in a `Map<streamKey, Readable>` at the SSE route level. On Fastify server shutdown (`fastify.addHook('onClose', ...)`), destroy all active streams.
- Use `stream.pipeline()` or `pump` instead of manual piping — these handle destruction automatically on error/close.
- Set a maximum concurrent streams limit per stack (e.g., 5) to bound resource usage.

**Detection:**
- `lsof -p <pid> | grep docker.sock | wc -l` growing over time.
- `process._getActiveHandles()` accumulating streams.
- Docker daemon logs `too many open connections` errors.

**Phase:** MVP — SSE log streaming.

---

### Pitfall 3: SSE Log Accumulation Causes Browser Tab to Freeze (Unbounded Buffer)

**What goes wrong:**
The SSE endpoint streams all logs since container start (`tail: 'all'` or no `tail` option). For a Nextcloud container that has been running for 6 months, this can be hundreds of megabytes of log data. The browser receives the entire history before showing the user anything, then freezes trying to render thousands of lines in a React component that re-renders on every new line.

**Why it happens:**
dockerode's `logs()` defaults to no tail limit. The React component likely stores all lines in `useState([...lines, newLine])` which triggers a full re-render on every append. Combined, this is unbounded in both network transfer and DOM size.

**Consequences:**
- Browser tab OOM crash or freeze for containers with long log histories.
- Initial connection appears hung to the user.
- Client-side memory grows without bound during long streaming sessions.

**Prevention:**
- Always set `tail: 100` (or user-configurable, max 500) in the initial `container.logs()` call.
- On the client, implement a circular buffer: keep only the last N lines (e.g., 1000) in state, dropping oldest on overflow.
- Use virtual scrolling (e.g., `@tanstack/react-virtual`) for the log display — never render all lines in the DOM.
- Debounce React state updates: batch incoming SSE lines (e.g., 100ms window) before calling `setState` to prevent a render per line.

**Detection:**
- Chrome DevTools Memory tab showing `Array` entries growing unboundedly in the log component.
- Initial SSE connection taking >5 seconds for older containers.

**Phase:** MVP — SSE log streaming.

---

### Pitfall 4: SSE Reconnect Storm After Server Restart

**What goes wrong:**
The browser's native `EventSource` API reconnects automatically after connection loss, with a fixed 3-second retry interval by default. After a Fastify restart (e.g., deployment of a new Docktor version), all connected clients reconnect simultaneously, each triggering a new dockerode stream. If 5 stacks each have 3 services open in browser tabs, that is 15 simultaneous dockerode connections at t+3s.

**Why it happens:**
`EventSource` reconnect is automatic and immediate. There is no built-in jitter or exponential backoff in the browser's `EventSource` implementation.

**Consequences:**
- Thundering herd of Docker socket connections on restart.
- If the Docker daemon is briefly unavailable (e.g., Docker update), reconnect storm repeatedly hammers the daemon.

**Prevention:**
- Implement client-side reconnect with exponential backoff using a custom wrapper instead of bare `EventSource` (the `use-log-stream.ts` hook is the right place for this — use a custom `lastEventId` + manual reconnect loop).
- Server-side: rate-limit new SSE connections per stack (e.g., max 1 new connection per stack per second) using a token bucket or similar.
- Include a random jitter (0–2s) in the client reconnect timer.

**Detection:**
- Fastify access log shows N identical GET `/api/stacks/:id/logs` requests within the same second after restart.

**Phase:** MVP — SSE log streaming.

---

### Pitfall 5: restic Process Left Running After Node.js Timeout (Orphan Process)

**What goes wrong:**
Invoking restic via `child_process.execFile` or `spawn` with a timeout causes Node.js to kill the *Node.js-side* handle when the timeout fires, but on Linux this does not guarantee the child process (`restic`) is killed. restic continues running on the host, holding locks on the repository. The next backup attempt finds a stale lock and fails.

**Why it happens:**
`execFile` with `timeout` option sends `SIGTERM` to the child process. restic may ignore `SIGTERM` during a long network operation (e.g., uploading to S3). Additionally, if the child is a shell (`/bin/sh -c restic ...`) rather than `restic` directly, `SIGTERM` kills the shell but not the `restic` grandchild.

**Consequences:**
- Restic repository stale lock blocks all subsequent backups for that stack until manually unlocked.
- Running `restic unlock` requires either manual SSH access or a Docktor recovery UI action (not yet built).
- If multiple stale processes accumulate, the Docker container's process table fills with zombie restic processes.

**Prevention:**
- Always spawn restic directly (not via shell): `spawn('restic', ['backup', ...], { detached: false })`. Never use `exec` or `execFile` with shell: true.
- On timeout: send `SIGTERM`, then after 5 seconds send `SIGKILL` to the child pid. Use `process.kill(child.pid, 'SIGKILL')`.
- After any abnormal backup termination, automatically run `restic unlock` as part of the cleanup path before marking the backup as failed.
- Use a per-stack mutex (e.g., an in-memory `Set<stackId>` of active backup jobs) to prevent concurrent restic processes for the same stack.
- Set `GOGC=off` env var is not useful here; instead, set explicit `--timeout` flags in restic subcommands where available.

**Detection:**
- `ps aux | grep restic` on host showing processes with long-running times.
- Backup job in DB stuck in `BACKING_UP` state with no running Node.js job tracking it (survives restart).

**Phase:** Post-MVP — Backup & Restore.

---

### Pitfall 6: restic Exit Code Does Not Distinguish Fatal vs. Partial Errors

**What goes wrong:**
restic uses exit code 1 for fatal errors (backup entirely failed) and exit code 3 for partial success (some files backed up, some failed due to permission errors). Treating any non-zero exit as a fatal failure causes the backup to be marked failed when it actually completed with warnings — and more importantly, treating exit code 3 as success causes partial backups to be stored as "complete" snapshots.

**Why it happens:**
The standard Node.js pattern `if (exitCode !== 0) throw new Error(...)` doesn't distinguish between exit codes.

**Consequences:**
- A Nextcloud data directory with database files locked by PostgreSQL causes exit code 3 on every backup, either silently creating incomplete snapshots or triggering false failure alerts.
- Users get notified of "backup failure" on every run even though most data was captured.

**Prevention:**
- Explicitly check exit codes: `0` = full success, `3` = partial (log warning, store snapshot with `partial: true` flag in the Backup model, notify user differently than full failure), `1` = fatal failure.
- Parse stderr for `restic: error` vs. `restic: warning` lines to give users actionable context.
- Document that Docktor's stop-and-backup strategy (stop containers before backup) should eliminate most exit code 3 cases by avoiding locked files.

**Detection:**
- Backup records showing failure for stacks that clearly have data in the repository.
- stderr containing `warning: could not read file` lines paired with exit code 3.

**Phase:** Post-MVP — Backup & Restore.

---

### Pitfall 7: Brownfield Path Translation: Container Path vs. Host Path Mismatch

**What goes wrong:**
During brownfield scanning, Node.js code running inside the Docktor container reads `/host/home/user/apps/nextcloud/docker-compose.yml` (via the read-only `/:/host:ro` mount). The compose file contains `./volumes/db-data:/var/lib/postgresql/data`. When Docktor tries to register this stack or interact with it via Docker CLI, the Docker daemon (running on the host) interprets the compose file's paths relative to the *host* directory, not the container's `/host/...` prefix.

**Why it happens:**
Paths seen by Node.js (container-scoped) and paths passed to Docker CLI (host-scoped) are different namespaces. A `cwd` of `/host/home/user/apps/nextcloud` inside the container does not exist as a valid path from the Docker daemon's perspective.

**Consequences:**
- `docker compose ps` run from within the Docktor container with `cwd: /host/home/user/apps/nextcloud` fails because the directory does not exist at that path inside the container.
- Volume paths in compose files appear correct but mount nothing on the actual filesystem (Docker daemon resolves them from the host path, which differs from container path by the `/host` prefix).

**Prevention:**
- Maintain a strict `containerPath → hostPath` translation layer (the `PathResolver` utility mentioned in the design doc). Rule: `hostPath = containerPath.replace(/^\/host/, '')`.
- Never pass container-namespaced paths to `docker compose` CLI. Always translate before shelling out.
- Validate the translation at scan time: after translating, verify the directory exists on the host (by checking it via the container's `/host` mount).
- Store the canonical *host path* in `Stack.hostPath` (as the schema already defines), never the container-internal path.

**Detection:**
- `docker compose` commands return "no such file or directory" errors for stacks discovered via brownfield scan.
- `Stack.hostPath` entries starting with `/host/` in the database.

**Phase:** Post-MVP — Brownfield Import.

---

### Pitfall 8: NPM API Idempotency — Duplicate Proxy Host Creation

**What goes wrong:**
Calling the Nginx Proxy Manager API to create a proxy host is not idempotent by default. If Docktor calls `POST /api/nginx/proxy-hosts` and the request times out (NPM is slow to respond), then retries, it creates duplicate proxy host entries in NPM. Both entries are active — NPM serves the domain via whichever entry it processes first, and the duplicate causes confusion and potential TLS certificate conflicts.

**Why it happens:**
REST APIs without client-supplied idempotency keys are not safe to retry naively. NPM's API (v2) does not accept a client-supplied idempotency key.

**Consequences:**
- Two proxy host entries for the same domain in NPM's UI.
- TLS certificate renewal may fail if NPM tries to issue two certificates for the same domain.
- Deleting the stack from Docktor only removes the DB record; stale NPM entries persist.

**Prevention:**
- Before calling `POST /api/nginx/proxy-hosts`, always call `GET /api/nginx/proxy-hosts` and check for an existing entry with matching domain + forward host. If found, use `PUT /api/nginx/proxy-hosts/:id` instead.
- Store the NPM proxy host ID in `ProxyConfig` (already part of the schema). On any write operation, check this field first — if set, update rather than create.
- Implement a reconciliation job that periodically compares Docktor's `ProxyConfig` records with NPM's actual state and flags/resolves drift.

**Detection:**
- NPM UI showing two entries for the same domain.
- `ProxyConfig` records without an NPM proxy host ID (orphaned after failed create).

**Phase:** Post-MVP — Proxy Configuration.

---

### Pitfall 9: NPM API Authentication Token Expiry Mid-Operation

**What goes wrong:**
NPM uses JWT tokens with short expiry (default: 1 day). If Docktor caches the token at startup and the token expires during a long-running operation (or simply overnight), NPM API calls return 401. If the 401 is not handled and the token not refreshed, all proxy operations silently fail until Docktor is restarted.

**Why it happens:**
JWT expiry is time-based and silent. There is no push notification from NPM that the token is expiring.

**Consequences:**
- Proxy host creation/deletion silently fails. User deploys a stack expecting a domain to be configured, but it isn't.
- No user-visible error if the NPM integration layer swallows 401 responses.

**Prevention:**
- Implement token refresh logic: catch 401 responses, re-authenticate using stored NPM credentials, retry the original request once.
- Proactively refresh the token before it expires: decode the JWT expiry claim, schedule a refresh at `expiry - 5 minutes`.
- Store NPM credentials (username/password) in the Settings model (encrypted), not just the token.
- Surface NPM integration errors to the user immediately (don't silently swallow them).

**Detection:**
- NPM API calls returning 401 in server logs.
- Proxy configs in DB that have no corresponding NPM entry after several days.

**Phase:** Post-MVP — Proxy Configuration.

---

## Moderate Pitfalls

---

### Pitfall 10: chokidar File Events Not Firing in Docker Volumes (inotify Limitations)

**What goes wrong:**
chokidar uses inotify on Linux. When the watched directory is a Docker bind mount (the `/stacks` directory is bind-mounted from the host), inotify events propagate correctly *for changes made inside the container*. However, if the user edits a compose file via SSH directly on the host (which is an explicitly supported workflow), the inotify events may be delayed, coalesced, or dropped depending on the host kernel version and how the file editor writes (atomic rename vs. in-place write).

**Why it happens:**
Some editors (vim, nano) write to a temp file then `rename()` into place. rename does not trigger an `IN_MODIFY` inotify event on the original path — it triggers `IN_MOVED_TO` on the directory. Older kernels (pre-4.18) on some VPS providers have unreliable inotify over bind mounts.

**Consequences:**
- External edits are not detected; the "config changed" flag is not set.
- Stack continues running with an outdated service definition in the DB.

**Prevention:**
- The design already specifies a 60-second polling fallback — this is the correct mitigation. Treat chokidar as "fast path" and the poller as "guaranteed path". Never rely solely on chokidar events.
- Configure chokidar with `usePolling: false` initially, but document that `usePolling: true` may be needed on NFS/overlay filesystem environments.
- On the 60-second poll, hash all compose files and compare to `lastKnownHash` regardless of whether chokidar fired.

**Detection:**
- Compose file on disk has different content than DB `lastKnownHash` but `configChanged` flag is false.
- chokidar emitting no events after in-container file write tests.

**Phase:** Post-MVP — File Watcher.

---

### Pitfall 11: Docker Registry Rate Limiting During Update Checks

**What goes wrong:**
Docker Hub enforces pull/API rate limits: 100 requests per 6 hours for anonymous requests, 200/hour for free authenticated accounts. An update checker that calls the registry manifest API for every service image on every check interval (e.g., every hour for 10 stacks with 3 services each = 30 API calls/hour) will hit rate limits quickly, causing all update checks to fail with 429 responses.

**Why it happens:**
Each `GET /v2/<image>/manifests/<tag>` call counts against the rate limit. Checking all stacks simultaneously compounds this.

**Consequences:**
- Update checker returns errors for all stacks once rate limit is hit.
- False "up to date" readings if errors are silently swallowed.

**Prevention:**
- Cache manifest responses with a TTL of at least 1 hour. Store `lastCheckedAt` and `lastKnownDigest` per service in the Registry or Service model.
- Stagger update checks: don't check all stacks at once — spread checks across the hour using jittered scheduling.
- Support authenticated Docker Hub access (Registry model already in schema) to increase rate limits.
- Distinguish 429 responses from actual errors — back off exponentially on 429, don't mark as "update check failed".

**Detection:**
- Registry API returning HTTP 429 in server logs.
- All services showing the same `lastCheckedAt` timestamp (bulk checking).

**Phase:** Post-MVP — Update Checker.

---

### Pitfall 12: Poller Creating Excessive StatusLog Entries (Log Spam)

**What goes wrong:**
If the poller runs every 15 seconds and a container is in a crash loop, it records a new `StatusLog` entry every 15 seconds: `RUNNING → ERROR → RUNNING → ERROR`. This produces thousands of log entries per day for a single unhealthy stack, bloating the `StatusLog` table with useless repeated transitions.

**Why it happens:**
The poller naively writes a StatusLog entry every time it detects a state change. In a crash loop, the state oscillates continuously.

**Consequences:**
- StatusLog table grows to millions of rows within days for crash-looping containers.
- The audit trail becomes meaningless (can't distinguish intentional restarts from crash loops).
- DB query performance degrades for the stack detail page which queries StatusLog.

**Prevention:**
- Only write a StatusLog entry if the new state differs from the *previous poller-observed state*, not from the DB's current state (which may lag). Use an in-memory `Map<stackId, lastPolledState>` to track previous observations.
- Implement a de-bounce: don't transition to ERROR until the poller has seen error state for at least N consecutive polls (e.g., 2 out of 3).
- Apply StatusLog retention: periodically delete entries older than 30 days (keep one entry per hour as summary).

**Detection:**
- `SELECT COUNT(*) FROM "StatusLog" WHERE "stackId" = $id` returning very large counts.
- StatusLog entries showing `RUNNING → ERROR` with 15-second intervals.

**Phase:** MVP — Container state poller.

---

### Pitfall 13: Restic Backup Running Against a Live Database (Data Corruption)

**What goes wrong:**
If a user adopts a stack without stopping containers before backup (or if the stop-and-backup default is overridden), restic captures PostgreSQL/MySQL/SQLite data files mid-write. The resulting snapshot contains inconsistent database files that cannot be restored cleanly.

**Why it happens:**
Database engines write-ahead log files, journal files, and data pages are not in a consistent state at any arbitrary filesystem moment unless the database is quiesced.

**Consequences:**
- Restored database fails to start (WAL inconsistency) or starts with data corruption.
- User loses data they believed was safely backed up.

**Prevention:**
- Default backup strategy is stop-and-backup (containers stopped before restic runs). This is already the design's default.
- Document clearly: "backups stop containers briefly (typically < 30 seconds)."
- For the post-MVP application-aware backup hook feature, document the correct patterns: `pg_dump` to a file before restic backup, not live filesystem backup.
- The Backup model's `status` field should include a `PARTIAL` state for backups that completed without container stop.

**Detection:**
- Backup records with `trigger = MANUAL` and stack still in `RUNNING` state at backup time.
- Restored stacks where database container exits immediately with WAL recovery errors.

**Phase:** Post-MVP — Backup & Restore.

---

## Minor Pitfalls

---

### Pitfall 14: `docker compose ps --format json` Output Format Changes Between Compose Versions

**What goes wrong:**
The existing `DockerExecutor.ps()` already parses JSON output from `docker compose ps --format json`. The JSON field names (`Service`, `State`, `Status`, `Ports`) changed between Compose v2 minor versions. The current code already handles this with fallbacks (`obj.Service ?? obj.Name`), but future versions may introduce further field renames.

**Prevention:**
- The fallback pattern already in the codebase is correct. Extend it defensively for any new fields.
- Log unparseable lines at `warn` level rather than silently returning empty strings.
- Pin the Docker Compose CLI version in the Dockerfile to avoid unexpected format changes in production.

**Phase:** MVP — Container state poller.

---

### Pitfall 15: SSE Connection Held Open Prevents Fastify Graceful Shutdown

**What goes wrong:**
When Fastify receives `SIGTERM` (e.g., during a Docker container update), it waits for all active connections to close before exiting. Long-lived SSE connections for log streaming hold the HTTP connection open indefinitely, causing the graceful shutdown to time out and the process to be force-killed.

**Prevention:**
- On Fastify's `onClose` hook, send a special SSE event (`event: shutdown\ndata: {}\n\n`) to all active SSE clients, then destroy the underlying streams. Clients should handle this event by closing their `EventSource` and showing a "server restarted" message.
- Set a maximum SSE connection lifetime (e.g., 10 minutes) after which the server sends an `event: timeout` and closes, requiring client reconnect. This also helps GC accumulation.

**Phase:** MVP — SSE log streaming.

---

### Pitfall 16: `execFileAsync` with `promisify` Buffers All stdout in Memory

**What goes wrong:**
The existing `DockerExecutor.composeExec()` uses `promisify(execFile)` which buffers the entire stdout/stderr in memory before resolving. For `docker compose up -d` this is fine (small output). For future operations like `restic backup` (which streams multi-line progress) or `docker compose logs` (unbounded output), this approach accumulates all output in a single buffer before the caller sees it.

**Prevention:**
- Keep `promisify(execFile)` for compose operations where output is bounded and small.
- For restic operations and log-producing commands, use `spawn` with streaming stdout/stderr so output can be written to the stack's `logs/` directory incrementally.
- Set `maxBuffer` explicitly in `execFile` options for safety (current code has no limit; default is 200KB which `docker compose up` can exceed for large stacks).

**Phase:** Post-MVP — Backup & Restore (restic commands).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Container state poller | Poller stomps on transitional states | Skip stacks in transitional states; use optimistic locking |
| Container state poller | StatusLog spam from crash loops | In-memory previous-state tracking + debounce before writing |
| SSE log streaming | dockerode stream leak on disconnect | `request.raw.on('close', stream.destroy)` — mandatory pattern |
| SSE log streaming | Unbounded log history freezes browser | `tail: 100` default; circular buffer on client; virtual scroll |
| SSE log streaming | SSE connection blocks graceful shutdown | `onClose` hook sends shutdown event, destroys streams |
| Restic backup | Orphan restic process holds repo lock | `SIGKILL` after SIGTERM; auto-unlock on backup failure cleanup |
| Restic backup | Exit code 3 mishandled | Explicit exit code handling; partial-success state in Backup model |
| Restic backup | Live DB files in snapshot | Stop-and-backup by default; document clearly |
| NPM integration | Duplicate proxy host on retry | GET-before-POST; store NPM ID in ProxyConfig immediately |
| NPM integration | JWT token expiry mid-operation | 401 retry-with-refresh pattern; proactive token renewal |
| Brownfield import | Container path vs. host path mismatch | PathResolver translation layer; never pass `/host/*` paths to Docker CLI |
| File watcher | inotify unreliable on bind mounts | 60-second poll as guaranteed fallback (already in design) |
| Update checker | Docker Hub rate limiting | Per-service TTL cache; staggered schedule; auth support |

---

## Sources

- Confidence: HIGH for pitfalls 1–9 and 12–16 (grounded in codebase inspection, domain mechanics, and training knowledge confirmed by code structure).
- Confidence: MEDIUM for pitfall 10 (inotify behavior on bind mounts — well-documented Linux behavior but not verified against current kernel versions via external sources).
- Confidence: HIGH for pitfall 11 (Docker Hub rate limits are published and stable).
- Web search unavailable during this research session; findings based on codebase analysis (`server/src/infrastructure/docker-executor.ts`, `server/src/application/stack-service.ts`, `server/src/domain/stack-status-machine.ts`, `server/package.json`, `docs/design.md`, `.planning/PROJECT.md`) and applied domain knowledge of dockerode, Node.js child_process, restic CLI, SSE, and Docker APIs.
