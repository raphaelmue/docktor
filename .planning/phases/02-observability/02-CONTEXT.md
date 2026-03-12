# Phase 2: Observability - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect external compose file changes and surface image update availability. Two passive monitoring capabilities: file watching (alerts when compose files are edited via SSH) and update checking (alerts when newer container images are available in registries). No new user actions—just awareness.

</domain>

<decisions>
## Implementation Decisions

### File change detection strategy
- Hybrid approach: chokidar watch for instant detection + 60s polling fallback
- Polling catches NFS/CIFS mounts where inotify doesn't fire events (matches StatePoller pattern: event-driven + reconciliation loop)
- Single watcher on /stacks root directory tree
- Use chokidar `ignored` option to filter out non-compose files (logs, volumes, temp files)
- Hash-based change detection: re-hash docker-compose.yml and compare to DB-stored hash (ComposeConfig.hash already exists)
- Only flag 'config changed' if SHA256 hash actually differs (prevents false positives on touch-without-change)

### File change response behavior
- On file change: re-hash, parse YAML, validate structure (services, volumes, etc.)
- If valid: update DB hash, create StackEvent row with type 'config_changed'
- If invalid: create StackEvent row with type 'config_error', include validation error message
- Broadcast SSE event with stackId + event type ('config_changed' or 'config_error')
- Dashboard and detail page subscribe to SSE stream and update badges in real-time (reuse existing StateBroadcaster pattern)
- Store change events in StackEvent table (preserves history, allows querying "show me all config changes")
- Auto-clear 'config changed' flag when user deploys, updates, or restarts the stack from UI (action implies acknowledgment)

### Update check scheduling & caching
- Fixed 6-hour check interval for all images
- Stagger checks by even distribution: divide 6-hour window by number of unique images (e.g., 10 images → check one every 36 minutes)
- Cache results for full interval (6 hours) — next check happens 6 hours after last check
- Store in DB: ImageUpdateCheck table with imageRef, lastCheckedAt, latestVersion, latestDigest, updatedAt
- Query ImageUpdateCheck on stack detail page load to show 'update available' badge

### Update comparison logic
- Semver → date → digest fallback strategy:
  1. Try parsing tag as semver (1.2.3 < 1.3.0)
  2. If not valid semver, try parsing as date (2024-01-01 < 2024-02-01)
  3. If neither, compare SHA256 image digests
- 'latest' tag: digest-compare (resolve 'latest' to current digest, compare to running container's digest, only flag update if digest changed)
- Query registries using dockerode + `docker manifest inspect` shell-out (leverages Docker CLI auth config for private registries)
- Auto-detect registry from image ref (library/nginx = Docker Hub, ghcr.io/user/app = GitHub Container Registry, custom domain = private registry)

### Claude's Discretion
- Exact chokidar configuration (ignoreInitial, awaitWriteFinish, etc.)
- StackEvent table schema design (whether to use polymorphic type field or separate tables)
- ImageUpdateCheck table schema (whether to dedupe by imageRef or include stackId FK)
- Semver parsing library choice (semver npm package vs manual regex)
- Date tag parsing logic (YYYY-MM-DD, YYYYMMDD, or other formats)
- Error handling for registry API failures (retry logic, timeout, fallback behavior)
- UI badge design for 'update available' (color, text, icon)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/jobs/state-poller.ts`: Background job pattern with event-driven + reconciliation loop — FileWatcher follows same structure
- `server/src/lib/state-broadcaster.ts`: SSE broadcast singleton — reuse for file change and update events
- `server/src/infrastructure/dockerode-client.ts`: Docker API adapter — extend with image inspection methods
- `server/src/infrastructure/docker-executor.ts`: Shell-out to Docker CLI — add `manifestInspect()` method for registry queries
- `server/src/domain/compose-config.ts`: ComposeConfig value object with hash field — already stores SHA256, reuse for change detection
- `server/src/repositories/stack-repository.ts`: Stack DB queries — extend with event log queries

### Established Patterns
- Background jobs: registered in `server/src/jobs/index.ts`, started in `app.ts` `onReady` hook
- SSE endpoints: `writeHead()`, `write()` comment keepalive, stream data, close on request.raw 'close'
- Cron scheduling: use `node-cron` for interval-based jobs (StatePoller uses it for 15s interval)
- Error handling: throw `AppError` subclasses from service layer, global handler in `app.ts` converts to HTTP
- DB transactions: use Prisma `$transaction()` for atomic multi-step operations

### Integration Points
- New jobs: `server/src/jobs/file-watcher.ts`, `server/src/jobs/update-checker.ts`
- Job registry: add to `server/src/jobs/index.ts` `startJobs()` function
- Database: add `StackEvent` table, `ImageUpdateCheck` table via Prisma migrations
- SSE events: extend `StateBroadcaster` to emit `config_changed`, `config_error`, `update_available` events
- Stack detail page: query ImageUpdateCheck table, display 'update available' badge if newer version exists

</code_context>

<specifics>
## Specific Ideas

- User chose hybrid chokidar + polling to match the StatePoller pattern (event-driven + reconciliation)
- User chose to validate YAML on change and error on invalid (proactive vs detect-only)
- User chose event log table over simple boolean flag (preserves history for debugging)
- 6-hour interval chosen to stay within Docker Hub free tier rate limits (100 pulls/6h)
- Even distribution staggering chosen over random jitter for predictability

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-observability*
*Context gathered: 2026-03-12*
