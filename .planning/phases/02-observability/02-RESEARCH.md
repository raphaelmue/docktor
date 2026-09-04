# Phase 2: Observability - Research

**Researched:** 2026-03-13
**Domain:** File watching (chokidar), Docker registry inspection, background job scheduling, SSE broadcasting, Prisma schema migrations
**Confidence:** HIGH — primary sources are the installed codebase and pinned library type definitions

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **File change detection:** Hybrid chokidar watch + 60s polling fallback (matches StatePoller pattern)
- **Single watcher** on /stacks root directory tree, `ignored` option filters non-compose files
- **Hash-based change detection:** re-hash docker-compose.yml and compare to DB `lastKnownHash` — only flag if SHA256 actually differs
- **On file change response:** re-hash → parse YAML → validate structure; if valid: update DB hash + create `StackEvent` row `config_changed`; if invalid: `StackEvent` row `config_error` with message
- **SSE broadcast:** emit `config_changed` / `config_error` with `stackId` + event type via existing `StateBroadcaster`
- **Auto-clear `configChanged` flag:** when user deploys, updates, or restarts from UI (action = acknowledgment)
- **Update check interval:** Fixed 6-hour window per image, staggered evenly (N images → 6h / N interval)
- **Cache:** results stored for full 6-hour interval; `ImageUpdateCheck` table: `imageRef, lastCheckedAt, latestVersion, latestDigest, updatedAt`
- **Comparison strategy:** semver → date-tag → digest fallback
  1. Try semver parse (1.2.3 < 1.3.0)
  2. Try date parse (YYYY-MM-DD, YYYYMMDD, etc.)
  3. SHA256 digest compare
- **`latest` tag:** digest-compare — resolve `latest` to digest, compare to running container's `imageDigest`
- **Registry query:** dockerode + `docker manifest inspect` shell-out; uses Docker CLI auth config for private registries
- **Registry auto-detection:** `library/nginx` = Docker Hub, `ghcr.io/user/app` = GHCR, custom domain = private

### Claude's Discretion
- Exact chokidar configuration (`ignoreInitial`, `awaitWriteFinish`, etc.)
- `StackEvent` table schema (polymorphic type field vs separate tables)
- `ImageUpdateCheck` table schema (dedupe by `imageRef` vs include `stackId` FK)
- Semver parsing library choice (`semver` npm package vs manual regex)
- Date tag parsing logic (which formats to support)
- Error handling for registry API failures (retry logic, timeout, fallback behavior)
- UI badge design for 'update available' (color, text, icon)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FW-01 | Background process watches `/stacks/*/docker-compose.yml` for changes using chokidar | chokidar 4.0.3 already installed; `watch()` + `ignored` function pattern documented below |
| FW-02 | When compose file changes: re-hash (SHA256), update DB metadata, flag stack as "config changed" | `hashComposeContent()` exists in `compose-parser.ts`; `Stack.lastKnownHash` + `Stack.configChanged` already in schema |
| FW-03 | 60s polling fallback re-hashes all compose files to catch events missed by inotify (NFS) | `node-cron` already used in `StatePoller`; same `*/60 * * * * *` cron pattern applies |
| UPD-01 | Background job polls Docker registries for newer image versions (semver, date-tag, or digest) | `semver` 7.7.4 installed; `docker manifest inspect` shell-out via DockerExecutor pattern |
| UPD-02 | Update checks rate-limit safe: results cached, checks staggered, not triggered on every poll | `ImageUpdateCheck` table + stagger math pattern documented below |
| UPD-03 | Stack detail page shows "update available" badge when newer images found | Extend `StackDetail` API response + badge component; existing badge patterns in `[id].tsx` |
| UPD-04 | User can trigger an update (pull + recreate) from stack detail page — never automatic | New `POST /api/stacks/:id/update` route; DockerExecutor `pull` + `up` sequence |
</phase_requirements>

---

## Summary

Phase 2 adds two passive monitoring capabilities to Docktor: a file watcher that detects external compose file edits, and an update checker that polls Docker registries for newer images. Both are background jobs following the established `StatePoller` pattern (constructor-injectable deps, `start()`/`stop()`, registered in `app.ts` `onReady`/`onClose` hooks).

All key dependencies are already installed: `chokidar` 4.0.3 (root workspace `node_modules`), `semver` 7.7.4 (root workspace), `node-cron` 3.x (server), `yaml` 2.x (server). The existing `StateBroadcaster` and `StatePoller` patterns are exact templates for the new jobs. The Prisma schema needs two new models (`StackEvent`, `ImageUpdateCheck`) and the existing `Stack` model already has `configChanged` and `lastKnownHash` fields.

The trickiest implementation is `docker manifest inspect` for registry queries: it shells out to Docker CLI (which reads `~/.docker/config.json` auth automatically), returns JSON with digest info, and must handle rate limits gracefully. The 6-hour stagger strategy with `ImageUpdateCheck.lastCheckedAt` is the rate-limit safety mechanism — no npm rate-limit library needed.

**Primary recommendation:** Model `FileWatcher` and `UpdateChecker` exactly on `StatePoller` — same constructor injection pattern, same lazy repo loading, same cron + event loop structure. Both jobs extend the existing `StateBroadcaster` event union type to add the three new event types.

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| chokidar | 4.0.3 | File system watching with inotify + fallback polling | Declared in root `package.json`; already used by the monorepo tooling |
| node-cron | 3.x | Cron-style interval scheduling | Already used in `StatePoller` for 60s reconcile |
| semver | 7.7.4 | Semver parsing and comparison | Already installed at root workspace; `semver.valid()` + `semver.gt()` |
| yaml | 2.x | YAML parsing for compose validation | Already in server deps; used by `compose-parser.ts` |
| dockerode | 4.0.4 | Docker API for image digest lookup | Already in server deps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto | built-in | SHA256 hashing | Already used in `hashComposeContent()` — no new dep |
| node:child_process | built-in | `docker manifest inspect` shell-out | Already used in `DockerExecutor` via `execFile` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `docker manifest inspect` shell-out | Registry HTTP API v2 directly | Shell-out inherits Docker CLI auth config automatically; HTTP API requires manual auth token management per registry type. Shell-out is correct choice here. |
| `semver` npm package | Manual regex | `semver` handles edge cases (prerelease, build metadata, coerce). Use `semver.valid()` to test parseability; fall through to date/digest if null. |
| node-cron for update stagger | setInterval | node-cron is already established; for the stagger pattern use a single cron that checks `lastCheckedAt < now - 6h` per image rather than per-image timers. |

**No new npm installs needed for server.** `semver` types may need to be added to server devDependencies if not already transitively present.

```bash
# Verify semver types are accessible from server
# If not, add: npm install --save-dev @types/semver -w server
```

---

## Architecture Patterns

### New Files
```
server/src/jobs/
├── file-watcher.ts          # FileWatcher class (mirrors state-poller.ts structure)
├── update-checker.ts        # UpdateChecker class
└── index.ts                 # NEW: startJobs() / stopJobs() registry

server/src/repositories/
└── stack-event-repository.ts   # StackEvent + ImageUpdateCheck DB queries

server/prisma/schema/
├── stack-event.prisma          # NEW: StackEvent model
└── image-update-check.prisma   # NEW: ImageUpdateCheck model
```

### Pattern 1: FileWatcher Job Structure (mirrors StatePoller exactly)

```typescript
// server/src/jobs/file-watcher.ts
import chokidar from "chokidar"
import cron from "node-cron"

export class FileWatcher {
    private watcher: chokidar.FSWatcher | null = null
    private cronTask: cron.ScheduledTask | null = null
    private readonly repo: FileWatcherRepo | null

    constructor(repo?: FileWatcherRepo) {
        this.repo = repo ?? null
    }

    async start(): Promise<void> {
        await this.startChokidar()
        this.cronTask = cron.schedule("*/60 * * * * *", async () => {
            await this.reconcile()
        })
    }

    stop(): void {
        this.watcher?.close()
        this.watcher = null
        this.cronTask?.stop()
        this.cronTask = null
    }
}
```

**Key insight:** Constructor-injectable `repo` with lazy dynamic import fallback — same `getRepo()` pattern as `StatePoller` avoids pulling `db.ts` into unit test module graph.

### Pattern 2: Chokidar Configuration (Claude's Discretion)

```typescript
// Source: chokidar 4.0.3 type definitions (index.d.ts)
// ignoreInitial: true — don't emit 'add' events for files already present at startup
// awaitWriteFinish — prevents partial-file events on slow SSH/SFTP writes
// ignored function — filter to only docker-compose.yml files

const STACKS_ROOT = process.env.STACKS_ROOT ?? "/stacks"

this.watcher = chokidar.watch(STACKS_ROOT, {
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 1000,  // wait 1s after last write before emitting
        pollInterval: 100,
    },
    ignored: (filePath: string) => {
        // Only watch docker-compose.yml files, ignore everything else
        // Note: chokidar still watches directory structure; only FILE events are filtered
        return !filePath.endsWith("docker-compose.yml") && !isDirectory(filePath)
    },
    depth: 2,  // /stacks/<id>/docker-compose.yml — depth 2 from root
})

this.watcher.on("change", async (filePath) => {
    await this.handleFileChange(filePath)
})
this.watcher.on("add", async (filePath) => {
    // New compose file detected (new stack added externally)
    await this.handleFileChange(filePath)
})
this.watcher.on("error", (error) => {
    console.error("[FileWatcher] chokidar error:", error)
})
```

**awaitWriteFinish is critical for SSH use case:** Without it, vim/nano on remote SSH saves produce multiple rapid change events on an incomplete file. `stabilityThreshold: 1000` debounces to the final stable write.

### Pattern 3: StackEvent Table Schema (Claude's Discretion Recommendation)

Use a **single polymorphic table** with a `type` enum — matches how `StatusLog` works in the existing schema. Simpler to query, consistent with project patterns.

```prisma
// server/prisma/schema/stack-event.prisma

enum StackEventType {
  config_changed
  config_error
  update_available
}

model StackEvent {
  id      String         @id @default(cuid())
  stackId String
  stack   Stack          @relation(fields: [stackId], references: [id], onDelete: Cascade)

  type    StackEventType
  message String?        // validation error message for config_error; "image:tag" for update_available
  payload String?        // JSON — extra context (e.g., old hash vs new hash)

  createdAt DateTime @default(now())

  @@index([stackId, createdAt])
}
```

Add `stackEvents StackEvent[]` relation to `Stack` model.

### Pattern 4: ImageUpdateCheck Table Schema (Claude's Discretion Recommendation)

Dedupe by `imageRef` only (not `stackId`) — a single `nginx:latest` shared across 3 stacks should only be checked once. The update check is about the image, not the stack.

```prisma
// server/prisma/schema/image-update-check.prisma

model ImageUpdateCheck {
  id            String   @id @default(cuid())
  imageRef      String   @unique  // e.g., "nginx:latest", "ghcr.io/user/app:1.2.3"
  lastCheckedAt DateTime
  latestTag     String?  // newest discovered tag (null if check failed)
  latestDigest  String?  // digest of latest (for digest comparison)
  currentDigest String?  // digest when check ran (to detect digest-only changes)
  hasUpdate     Boolean  @default(false)
  checkError    String?  // last error message if check failed

  updatedAt DateTime @updatedAt
}
```

**Stagger logic:** At startup, `UpdateChecker` loads all distinct `imageRef` values from `Service` table, then schedules a single cron that processes images whose `lastCheckedAt` is null or `> 6 hours ago`, one per execution cycle.

### Pattern 5: SSE Event Type Extension

Extend `StateBroadcaster` union type to include the 3 new event types:

```typescript
// Extend StateEvent union in state-broadcaster.ts

export interface ConfigChangedEvent {
    type: "config_changed"
    stackId: string
    newHash: string
}

export interface ConfigErrorEvent {
    type: "config_error"
    stackId: string
    message: string
}

export interface UpdateAvailableEvent {
    type: "update_available"
    stackId: string
    imageRef: string
    latestTag: string | null
    hasUpdate: boolean
}

export type StateEvent =
    | ContainerStateEvent
    | StackStatusEvent
    | ConfigChangedEvent
    | ConfigErrorEvent
    | UpdateAvailableEvent
```

### Pattern 6: Jobs Registry (new index.ts)

`app.ts` currently imports `statePoller` directly. Extract into a `startJobs()` / `stopJobs()` pattern:

```typescript
// server/src/jobs/index.ts
import {statePoller} from "./state-poller.js"
import {fileWatcher} from "./file-watcher.js"
import {updateChecker} from "./update-checker.js"

export async function startJobs(): Promise<void> {
    await statePoller.start()
    await fileWatcher.start()
    await updateChecker.start()
}

export function stopJobs(): void {
    statePoller.stop()
    fileWatcher.stop()
    updateChecker.stop()
}
```

Update `app.ts` `onReady`/`onClose` hooks to use `startJobs()`/`stopJobs()`.

### Pattern 7: docker manifest inspect Shell-Out

```typescript
// In DockerExecutor, add manifestInspect() method:
async manifestInspect(imageRef: string): Promise<{digest: string; tags?: string[]} | null> {
    try {
        const {stdout} = await execFileAsync("docker", ["manifest", "inspect", "--verbose", imageRef], {
            timeout: 30_000,  // registry calls can be slow
        })
        const data = JSON.parse(stdout)
        // docker manifest inspect --verbose returns array for multi-arch or single object
        const manifest = Array.isArray(data) ? data[0] : data
        return {
            digest: manifest?.Ref ?? manifest?.SchemaV2Manifest?.config?.digest ?? null,
        }
    } catch (err: any) {
        if (err.stderr?.includes("no such manifest")) return null
        throw err
    }
}
```

**Critical:** `docker manifest inspect` reads `~/.docker/config.json` auth automatically for private registries — this is why the user chose shell-out over direct HTTP registry API.

### Anti-Patterns to Avoid

- **Don't watch individual files:** Watch the root `/stacks` directory tree with `ignored` filter. Watching individual paths requires re-watching when new stacks are added.
- **Don't trigger update checks on every FileWatcher poll:** The 60s cron for file watching and the 6h stagger for update checking are separate concerns with different cadences.
- **Don't store `stackId` in `ImageUpdateCheck`:** The same `nginx:latest` used by 5 stacks should be one DB row, not five. Query via `Service.image` join to find which stacks have an update.
- **Don't use `usePolling: true` globally in chokidar:** This defeats the purpose of inotify. Let chokidar use native events; the separate 60s cron handles NFS/CIFS fallback.
- **Don't call `docker manifest inspect` for every poll cycle:** Rate limit is Docker Hub's 100 pulls/6h for unauthenticated. Use `lastCheckedAt` gate strictly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File system watching | Custom inotify wrapper | chokidar 4.x | Handles inotify, kqueue, FSEvents, polling fallback, debouncing, symlinks |
| Semver comparison | Manual regex parsing | `semver` npm package | Edge cases: `1.2.3-rc.1`, `1.2.3+build.1`, coerce (`v1.2` → `1.2.0`) |
| Write debouncing | setTimeout + clear | chokidar `awaitWriteFinish` | Built-in, handles partial write race conditions |
| Registry auth | Custom token management | `docker manifest inspect` | CLI reads `~/.docker/config.json` automatically |

---

## Common Pitfalls

### Pitfall 1: chokidar `ignored` with directory paths
**What goes wrong:** The `ignored` function receives both file paths AND directory paths. If you filter `!path.endsWith("docker-compose.yml")` without also allowing directories, chokidar won't descend into subdirectories.
**Why it happens:** chokidar calls `ignored(path, stats)` for each entry it encounters, including directories.
**How to avoid:** In the `ignored` function, check `stats?.isDirectory()` — directories must return `false` (not ignored) to allow traversal. Only filter out files that aren't `docker-compose.yml`.
**Warning signs:** FileWatcher starts but never emits any events.

### Pitfall 2: chokidar `change` event fired multiple times per save
**What goes wrong:** Text editor writes on remote SSH (vim, nano, VS Code remote) produce 2-4 change events as the file is written in chunks.
**Why it happens:** inotify fires on every write syscall, not on file close.
**How to avoid:** Use `awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }`. This makes chokidar wait until the file size stops changing for 1000ms before emitting.
**Warning signs:** DB gets duplicate `config_changed` StackEvent rows within milliseconds.

### Pitfall 3: `docker manifest inspect` experimental flag
**What goes wrong:** Older Docker versions (< 23.x) require `DOCKER_CLI_EXPERIMENTAL=enabled` or `--experimental` flag for `manifest inspect`.
**Why it happens:** `docker manifest` was experimental in Docker 18-22.
**How to avoid:** In Docker 23+ (released Jan 2023) `manifest inspect` is stable by default. Docktor targets a server environment — safe to assume Docker 23+. Document minimum Docker version requirement.
**Warning signs:** `Error: "docker manifest" requires experimental CLI features to be enabled`.

### Pitfall 4: `docker manifest inspect` rate limiting
**What goes wrong:** Docker Hub returns 429 Too Many Requests after 100 anonymous pulls per 6 hours.
**Why it happens:** `manifest inspect` counts as a pull against Docker Hub rate limits.
**How to avoid:** The 6-hour stagger strategy is designed exactly for this. Enforce `lastCheckedAt` strictly — skip image if `now - lastCheckedAt < 6h`. Handle 429 in the catch block: set `checkError`, don't retry immediately, next attempt will be in the next stagger window.
**Warning signs:** All images suddenly show `checkError` containing "429" or "toomanyrequests".

### Pitfall 5: `Stack.configChanged` never cleared
**What goes wrong:** The `configChanged` flag on `Stack` stays `true` permanently even after a deploy.
**Why it happens:** Forgetting to add the auto-clear logic to deploy/update/restart stack service methods.
**How to avoid:** In `StackService.deploy()`, `StackService.update()`, and `StackService.restart()`, include `configChanged: false` in the DB update. This is the "action implies acknowledgment" contract.
**Warning signs:** After deploying, the "config changed" badge persists on the detail page.

### Pitfall 6: Semver `coerce` vs `valid`
**What goes wrong:** Tags like `28` (Nextcloud), `24.0` (Nginx variants) fail `semver.valid()` but succeed with `semver.coerce()`.
**Why it happens:** Standard semver requires three parts (`X.Y.Z`); many images use truncated versions.
**How to avoid:** Use `semver.coerce(tag)` first to normalize, then `semver.valid()` on the coerced result. If coerce returns null, fall through to date-tag comparison.
**Warning signs:** Images with two-part version tags (`nginx:24.0`) never get semver comparison, always fall through to digest.

---

## Code Examples

### Chokidar Watch with ignored filter
```typescript
// Source: chokidar 4.0.3 index.d.ts + handler.d.ts
import {watch} from "chokidar"
import {statSync} from "node:fs"

const watcher = watch("/stacks", {
    ignoreInitial: true,
    awaitWriteFinish: {stabilityThreshold: 1000, pollInterval: 100},
    depth: 2,
    ignored: (filePath: string, stats?: import("node:fs").Stats) => {
        // Always allow directories (needed for tree traversal)
        if (stats?.isDirectory() ?? false) return false
        // Only watch docker-compose.yml files
        return !filePath.endsWith("docker-compose.yml")
    },
})

watcher.on("change", (filePath) => { /* handle */ })
watcher.on("add", (filePath) => { /* handle */ })
```

### Semver comparison with coerce fallback
```typescript
// Source: semver 7.7.4 (node_modules/semver/index.js)
import semver from "semver"

function compareVersions(currentTag: string, latestTag: string): "newer" | "same" | "older" | "unknown" {
    const current = semver.coerce(currentTag)
    const latest = semver.coerce(latestTag)

    if (current && latest) {
        if (semver.gt(latest, current)) return "newer"
        if (semver.eq(latest, current)) return "same"
        return "older"
    }
    return "unknown"  // fall through to date or digest comparison
}
```

### Date tag parsing
```typescript
// Date formats found in the wild:
// YYYY-MM-DD: "2024-01-15" (rolling release images)
// YYYYMMDD: "20240115" (some Alpine variants)
// YYYYMM: "202401" (monthly release cycle)

const DATE_PATTERNS = [
    /^(\d{4})-(\d{2})-(\d{2})$/,  // YYYY-MM-DD
    /^(\d{4})(\d{2})(\d{2})$/,     // YYYYMMDD
    /^(\d{4})(\d{2})$/,            // YYYYMM
]

function parseDateTag(tag: string): Date | null {
    for (const pattern of DATE_PATTERNS) {
        const m = pattern.exec(tag)
        if (m) {
            const d = new Date(`${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`)
            if (!isNaN(d.getTime())) return d
        }
    }
    return null
}
```

### Update check stagger math
```typescript
// Stagger N images evenly across 6-hour window
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6 hours

async function getNextImageToCheck(images: string[]): Promise<string | null> {
    if (images.length === 0) return null
    const staggerMs = CHECK_INTERVAL_MS / images.length
    const cutoff = new Date(Date.now() - staggerMs)

    // Find image with oldest lastCheckedAt (or never checked)
    const record = await prisma.imageUpdateCheck.findFirst({
        where: {
            imageRef: {in: images},
            OR: [
                {lastCheckedAt: {lt: cutoff}},
                {lastCheckedAt: null},
            ],
        },
        orderBy: {lastCheckedAt: "asc"},  // null sorts first
    })
    return record?.imageRef ?? null
}
```

### Registry auto-detection
```typescript
function detectRegistry(imageRef: string): "dockerhub" | "ghcr" | "private" {
    // "nginx" or "library/nginx" or "nginx:latest" → Docker Hub
    if (!imageRef.includes("/") || imageRef.startsWith("library/")) return "dockerhub"
    // "user/app" (single slash, no domain) → Docker Hub
    const host = imageRef.split("/")[0]
    if (!host.includes(".") && !host.includes(":")) return "dockerhub"
    if (host === "ghcr.io") return "ghcr"
    return "private"
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `docker manifest inspect` experimental | Stable in Docker CLI 23+ | Jan 2023 | No flags needed on modern Docker hosts |
| chokidar v3 (CommonJS) | chokidar v4 (ESM-first) | 2024 | Import with `import {watch} from "chokidar"` not `require("chokidar")` — project is `"type": "module"` ESM, this is correct |
| Per-image cron timers | Single cron + `lastCheckedAt` DB gate | N/A (design choice) | Simpler to reason about, survives restarts (state in DB) |

**Deprecated/outdated:**
- `chokidar.watch(..., { usePolling: true })` globally: Don't set this — it disables native inotify and hammers disk. The 60s cron handles NFS fallback separately.
- `docker pull` for update detection: Don't use pull to check for updates (modifies local image store, counts heavily against rate limits). Use `manifest inspect` instead.

---

## Open Questions

1. **`docker manifest inspect` output format variation**
   - What we know: Returns JSON; multi-arch images return array; single-arch returns object.
   - What's unclear: Exact key names for digest vary by registry (Docker Hub vs GHCR vs private). May need to handle both `Ref` and `SchemaV2Manifest.config.digest` formats.
   - Recommendation: Add a small `parseManifestDigest(stdout)` normalizer with fallbacks; log raw output in development for debugging.

2. **Image ref normalization for `ImageUpdateCheck` deduplication**
   - What we know: `nginx` and `docker.io/library/nginx:latest` and `nginx:latest` are the same image.
   - What's unclear: Should we normalize before storing as the `imageRef` key?
   - Recommendation: Normalize on insert: strip `docker.io/library/` prefix, append `:latest` if no tag present. Store canonical form.

3. **`docker manifest inspect` for latest tag — tag listing**
   - What we know: For `nginx:latest` we compare running digest vs registry digest.
   - What's unclear: For semver comparison, we need to list all available tags to find the "latest semver". `docker manifest inspect` cannot list tags — that requires the registry tags API.
   - Recommendation: For semver/date comparison, the context says "check for newer versions". This implies knowing the newest available tag. Option A: Use Docker Hub tags API (`https://hub.docker.com/v2/repositories/{name}/tags`) for Docker Hub. Option B: Scope Phase 2 to digest comparison only for `latest`, and semver/date comparison for explicitly-tagged images (e.g., `nginx:1.25.3`). The CONTEXT.md implies the comparison is between the running tag and a newer discovered tag — **clarify in planning whether "newer tag discovery" is in scope or just "digest changed for current tag"**. The CONTEXT.md wording ("check for newer container images") suggests newer tag discovery is intended, but the implementation method (manifest inspect only) may limit this to digest-only for `latest`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `server/vitest.config.ts` (unit project), `client/vitest.config.ts` |
| Quick run command | `npm run test:unit -w server` |
| Full suite command | `npm run test -w server && npm run test -w client` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FW-01 | FileWatcher starts chokidar watcher on stacks root | unit | `npm run test:unit -w server -- --reporter=verbose -t "FileWatcher"` | ❌ Wave 0 |
| FW-02 | On compose file change: re-hash, update DB, create StackEvent config_changed | unit | same | ❌ Wave 0 |
| FW-02 | Invalid compose: create StackEvent config_error with message | unit | same | ❌ Wave 0 |
| FW-03 | 60s reconcile re-hashes all compose files | unit | same | ❌ Wave 0 |
| UPD-01 | UpdateChecker.checkImage() returns newer/same/unknown for semver/date/digest | unit | `npm run test:unit -w server -- --reporter=verbose -t "UpdateChecker"` | ❌ Wave 0 |
| UPD-02 | getNextImageToCheck() respects stagger window | unit | same | ❌ Wave 0 |
| UPD-03 | Stack detail API response includes update_available flag | unit (route) | same | ❌ Wave 0 |
| UPD-04 | POST /api/stacks/:id/update triggers pull + recreate | unit | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit -w server`
- **Per wave merge:** `npm run test -w server && npm run test -w client`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/test/unit/jobs/file-watcher.test.ts` — covers FW-01, FW-02, FW-03
- [ ] `server/test/unit/jobs/update-checker.test.ts` — covers UPD-01, UPD-02
- [ ] `server/test/unit/application/update-service.test.ts` — covers UPD-04 (or extend stack-service.test.ts)
- [ ] No new framework install needed — vitest already configured

---

## Sources

### Primary (HIGH confidence)
- `server/node_modules/chokidar` (root workspace) v4.0.3 — type definitions read directly from `index.d.ts`
- `server/src/jobs/state-poller.ts` — job structure template (source of truth for pattern)
- `server/src/lib/state-broadcaster.ts` — SSE event union pattern
- `server/src/infrastructure/docker-executor.ts` — shell-out pattern via `execFile`
- `server/src/domain/compose-config.ts` + `server/src/lib/compose-parser.ts` — hash and parse utilities
- `server/prisma/schema/stack.prisma` — existing `Stack` fields (`lastKnownHash`, `configChanged`)
- `server/prisma/schema/service.prisma` — `Service.imageDigest` field exists for digest comparison
- `server/package.json` — confirms `chokidar ^4.0.3`, `node-cron ^3.0.3`, `yaml ^2.7.0` installed
- Root `node_modules/semver` v7.7.4 — `index.js` exports verified directly

### Secondary (MEDIUM confidence)
- Docker CLI documentation for `docker manifest inspect` — stable since Docker 23 (Jan 2023); `--verbose` flag returns full manifest JSON including digest

### Tertiary (LOW confidence)
- Docker Hub rate limit of 100 pulls/6h for unauthenticated — widely cited, may change; the 6-hour interval was chosen with this in mind per CONTEXT.md

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified by reading installed `package.json` and type definitions
- Architecture: HIGH — patterns derived directly from existing codebase (`StatePoller`, `StateBroadcaster`, `DockerExecutor`)
- Pitfalls: MEDIUM-HIGH — chokidar `ignored` directory pitfall verified from type definition; SSH write debouncing is well-documented chokidar use case; `docker manifest` stability verified from Docker release history
- Open questions: LOW — `docker manifest inspect` output format variation and tag listing scope need validation during implementation

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable libraries; Docker CLI API is stable)
