# Phase 4: Backup & Restore - Research

**Researched:** 2026-03-18
**Domain:** restic CLI integration, Node.js child_process spawn, SSE streaming, cron scheduling, AES-encrypted settings, React form composition
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Backup progress display**
- Backup runs in the **background** — triggering a backup shows a toast ("Backup started") and returns immediately; no blocking modal
- The stack detail page gains a new **Backups tab** (5th tab: Overview / Compose / Environment / Logs / **Backups**)
- A dedicated **backup detail page** exists at `/stacks/:id/backups/:backupId`:
  - Shows live SSE-streamed restic output during an active backup
  - Once complete: static log lines + status badge (IN_PROGRESS / COMPLETED / FAILED), start time, duration, size
- Manual Backup button is **disabled** (not hidden) while the stack is in BACKING_UP state, with label "Backup in progress…"

**Stack detail header — action bar refactor**
- The header action bar is being cleaned up as part of this phase (too many buttons once Backup Now is added)
- **Primary button:** Deploy only (or "Redeploy" when already running)
- **Dropdown menu (ellipsis/kebab):** Stop, Restart, Update Images, Backup Now, Delete
- Destructive actions (Delete) remain visually distinct inside the dropdown (e.g., red text)

**Settings — Backup tab**
- Settings page gains a third tab: **General | Notifications | Backup**
- Backup tab contains two cards:
  1. **Repository** card: repo type selector (Local / SFTP / S3-compatible) with conditional fields revealed on selection:
     - Local: path field only
     - SFTP: host, username, private key or password
     - S3: endpoint URL, bucket name, access key, secret key
     - Restic password field (stored AES-encrypted with `Setting.encrypted = true`, same as SMTP password)
  2. **Defaults** card: global default backup schedule (cron expression input) and global default retention policy (daily/weekly/monthly count inputs) — inherited by stacks that don't override

**Backups tab — per-stack configuration**
- Backups tab in stack detail has three sections from top to bottom:
  1. **Backup Configuration** card: schedule override (cron input or "Use global default" toggle), retention override (or "Use global default"), pre-backup hook (optional shell command), post-backup hook (optional shell command)
  2. **Backup History** section: list of Docktor `Backup` records (status badge, trigger type MANUAL/SCHEDULED, date, duration, size, link to detail page)
  3. **Snapshots** section: live list from `restic snapshots` (snapshot ID, date, size, tags) with a **Restore** button per row

**Restore flow**
- **Confirmation:** Destructive confirm dialog — shows what will happen (stop stack → overwrite files → redeploy), user must **type the stack name** to unlock the Restore button (same pattern as GitHub repo deletion)
- **Progress:** Restore creates a new Backup record (with a RESTORE trigger type), stack transitions to RESTORING state, toast links to the restore detail page (same `/stacks/:id/backups/:backupId` pattern)
- **On failure:** Stack transitions to ERROR state with a clear error message. Restore button remains accessible in ERROR state so the user can retry or choose a different snapshot. No automatic rollback.

**Backup failure notification (NOTF-05)**
- Wire NOTF-05 into the existing NotificationService from Phase 3
- Notification includes: stack name, backup trigger type (manual/scheduled), backup target (local/SFTP/S3), error message
- Deduplication: once per incident (same pattern as other notification triggers — suppress until stack recovers from ERROR)
- Toggle for backup failure notifications added to the Notification Triggers card in Settings > Notifications tab

### Claude's Discretion
- Restic CLI invocation details (spawn args, env var injection for credentials vs stdin, RESTIC_PASSWORD env var approach)
- SSE endpoint design for backup/restore log streaming (reuse existing log SSE pattern or new endpoint)
- Retention policy input format (separate fields for daily/weekly/monthly counts vs single JSON input)
- Cron expression input — whether to provide a human-readable preview ("runs every day at 3am") or just accept raw cron
- `restic snapshots` call timing (on tab open vs cached with manual refresh button)
- Exact RESTORE trigger enum value in Prisma schema (may require adding RESTORE to BackupTrigger)
- Error boundary / loading states for the Snapshots section (restic call can fail if repo is unreachable)
- How to display the absolute-path volume warning (BCK-07) — inline in the Backup Configuration card when detected

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BCK-01 | User can configure a restic repository (local path, SFTP, or S3-compatible) and password via Settings | Settings key-value model + AES encrypt/decrypt pattern already exists; new backup settings keys added to SETTING_KEYS |
| BCK-02 | Restic password is stored AES-encrypted in the DB | `encrypt()`/`decrypt()` from `lib/crypto.ts` — identical to SMTP password pattern |
| BCK-03 | User can trigger a manual backup for any stack from the stack detail page | `POST /api/backups` spawns restic in background; state machine already has BACKUP action and BACKING_UP status |
| BCK-04 | User can configure a per-stack backup schedule (cron expression) | Stack model already has `backupSchedule` field; BackupScheduler job uses node-cron per-stack tasks |
| BCK-05 | User can configure per-stack retention policy (daily/weekly/monthly counts) | Stack model has `backupRetention` (JSON string); `restic forget --keep-daily N --keep-weekly N --keep-monthly N --prune` runs post-backup |
| BCK-06 | Backup includes entire stack directory (docker-compose.yml, .env, volumes/) excluding logs/ | `restic backup <stackPath> --exclude=<stackPath>/logs` — stack path already accessible via `getStackPath()` |
| BCK-07 | Absolute-path volumes outside the stack directory are excluded from backup with a visible warning | Parse compose file volumes at backup time; detect absolute paths not prefixed with stack path; emit warning in UI |
| BCK-08 | User can view a list of available restic snapshots for a stack | `restic snapshots --tag <stackId> --json` parsed and returned from a new GET endpoint |
| BCK-09 | User can restore a stack from a selected snapshot (stop → restore → redeploy → health check) | `restic restore <snapshotId> --target /` orchestrated in BackupService; state machine has RESTORE action and RESTORING status |
| BCK-10 | Restic CLI is invoked using spawn (not execFile) to support streaming progress output | Node.js `child_process.spawn()` with line-buffered stdout/stderr; lines broadcast via SSE |
| BCK-11 | Stack transitions to BACKING_UP state during backup and returns to previous state on completion or ERROR on failure | `previousStatus` field on Stack already exists; state machine BACKUP transition already defined |
</phase_requirements>

---

## Summary

Phase 4 integrates the `restic` CLI into Docktor as the backup engine. Restic is a mature, well-documented CLI tool with clear exit codes, `--json` output mode, and environment-variable-based credential injection — all patterns that compose naturally with Node.js `child_process.spawn()` and the existing SSE streaming infrastructure.

The Prisma schema already anticipates this phase: `StackStatus` has `BACKING_UP` and `RESTORING`, the state machine has `BACKUP` and `RESTORE` actions, `Stack` has `backupPreHook`, `backupPostHook`, `backupSchedule`, `backupRetention`, and `previousStatus`, and a `Backup` model exists with `resticSnapshotId`, `trigger`, `status`, `errorMessage`, `sizeBytes`. The only Prisma change needed is adding `RESTORE` to the `BackupTrigger` enum.

The server layer needs one new service (`BackupService`), one repository (`BackupRepository`), one route file (`routes/backups.ts`), and one job (`BackupScheduler`). The client layer needs one new API client (`backups-api.ts`), one new hook (`use-backup-stream.ts`), a new detail page, and additions to the existing stack detail and settings pages. The `NotificationService` needs a `backup_failure` event type and the `NotificationWatcher`'s deduplication model is reused in `BackupService` directly.

**Primary recommendation:** Use `child_process.spawn()` with `RESTIC_PASSWORD` and backend-specific env vars injected into the child process environment (never on the command line). Stream stdout/stderr lines via a per-backup `EventEmitter` that the SSE endpoint subscribes to, following the same pattern as `stateEventBroadcaster`.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `node-cron` | 3.x (project has `^3.0.3`) | Per-stack backup schedules | DiskChecker already uses it; BackupScheduler follows the same structure |
| `child_process` (Node built-in) | N/A | `spawn()` restic CLI process | BCK-10 mandates spawn, not execFile |
| `@docktor/shared` | workspace | Zod schemas for backup settings + new API inputs | New schemas added here |

### No New NPM Dependencies Required
All backup functionality can be implemented with Node.js built-ins and the libraries already present. Restic is an **external binary** installed on the host — Docktor invokes it via `spawn`, it is not an npm package.

### Restic Binary
- Restic is installed on the Docker host (not in the Docktor container unless Docktor itself runs as a container with restic bundled)
- Version requirement: restic >= 0.17.0 is recommended for reliable exit codes (exit 10 = repo not found, exit 11 = lock failure, exit 12 = wrong password)
- Invoked via the binary path: default `restic`, overridable via `RESTIC_BINARY` env var (defensive design)

---

## Architecture Patterns

### Recommended Project Structure (new files)
```
server/src/
├── application/
│   └── backup-service.ts          # BackupService — orchestrates restic invocations
├── repositories/
│   └── backup-repository.ts       # BackupRepository — all Backup model queries
├── infrastructure/
│   └── restic-executor.ts         # ResticExecutor — wraps spawn(), stream lines
├── jobs/
│   └── backup-scheduler.ts        # BackupScheduler — per-stack cron task registry
└── routes/
    └── backups.ts                 # /api/stacks/:id/backup, /api/backups/:id, SSE

client/src/
├── lib/
│   └── backups-api.ts             # API client for all backup endpoints
├── hooks/
│   └── use-backup-stream.ts       # SSE hook for backup log line streaming
└── routes/app/stacks/
    ├── [id].tsx                   # +Backups tab; action bar refactor
    ├── backups/
    │   └── [backupId].tsx         # Backup/restore detail page
    └── components/
        ├── backups-tab.tsx        # Backups tab content (3 sections)
        ├── backup-config-card.tsx # Schedule/retention/hooks config card
        ├── backup-history.tsx     # List of Backup records
        └── snapshots-section.tsx  # Live restic snapshots list + restore button

shared/src/validation/
└── backups.ts                     # Zod schemas: backup settings, trigger backup, restore
```

### Pattern 1: ResticExecutor — spawn wrapper

**What:** A class that wraps `child_process.spawn()`, injects credentials via env vars (never CLI args), and emits lines via an EventEmitter for SSE consumption.

**When to use:** Every restic invocation — backup, restore, snapshots, forget.

**Credentials via environment, never CLI args:**
```typescript
// Source: restic official docs — RESTIC_PASSWORD, AWS_ACCESS_KEY_ID, etc.
// server/src/infrastructure/restic-executor.ts

import {spawn} from "node:child_process"
import {EventEmitter} from "node:events"

export interface ResticRunOptions {
    args: string[]
    env: Record<string, string>  // credentials injected here
    onLine: (line: string) => void
}

export class ResticExecutor {
    private readonly binary: string

    constructor(binary?: string) {
        this.binary = binary ?? process.env.RESTIC_BINARY ?? "restic"
    }

    async run(options: ResticRunOptions): Promise<{exitCode: number; stderr: string}> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.binary, options.args, {
                env: {...process.env, ...options.env},
                stdio: ["ignore", "pipe", "pipe"],
            })

            let stderrBuf = ""
            let lineBuf = ""

            child.stdout.on("data", (chunk: Buffer) => {
                lineBuf += chunk.toString("utf8")
                const lines = lineBuf.split("\n")
                lineBuf = lines.pop() ?? ""
                for (const line of lines) {
                    if (line.trim()) options.onLine(line)
                }
            })

            child.stderr.on("data", (chunk: Buffer) => {
                stderrBuf += chunk.toString("utf8")
            })

            child.on("error", reject)
            child.on("close", (code) => {
                if (lineBuf.trim()) options.onLine(lineBuf)
                resolve({exitCode: code ?? 1, stderr: stderrBuf})
            })
        })
    }
}
```

### Pattern 2: Per-Backup SSE Broadcaster

**What:** A `Map<string, EventEmitter>` keyed by `backupId` held in the BackupService (or a module-level singleton). When a backup runs, its lines are emitted. The SSE route subscribes and writes each line.

**When to use:** The backup detail page SSE endpoint (`GET /api/backups/:id/stream`).

**Example:**
```typescript
// server/src/application/backup-service.ts (excerpt)

// Module-level broadcaster map — lives for the process lifetime
const backupBroadcasters = new Map<string, EventEmitter>()

export function getBackupBroadcaster(backupId: string): EventEmitter | undefined {
    return backupBroadcasters.get(backupId)
}

// Inside BackupService.runBackup():
const emitter = new EventEmitter()
emitter.setMaxListeners(20)
backupBroadcasters.set(backup.id, emitter)

try {
    await resticExecutor.run({
        args: ["backup", stackPath, "--exclude", logsPath, "--tag", stackId, "--json"],
        env: this.buildResticEnv(repoConfig),
        onLine: (line) => emitter.emit("line", line),
    })
} finally {
    emitter.emit("done")
    backupBroadcasters.delete(backup.id)
}
```

**SSE route:**
```typescript
// server/src/routes/backups.ts (excerpt)
app.get("/api/backups/:id/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })
    reply.raw.write(": connected\n\n")

    const backup = await backupRepository.findByIdOrThrow(request.params.id)

    // If already complete, stream stored log lines and close
    if (backup.status !== "IN_PROGRESS") {
        for (const line of backup.logLines ?? []) {
            reply.raw.write(`data: ${JSON.stringify({line})}\n\n`)
        }
        reply.raw.write(`data: ${JSON.stringify({done: true, status: backup.status})}\n\n`)
        reply.raw.end()
        return
    }

    const emitter = getBackupBroadcaster(backup.id)
    if (!emitter) {
        reply.raw.end()
        return
    }

    const onLine = (line: string) => reply.raw.write(`data: ${JSON.stringify({line})}\n\n`)
    const onDone = () => reply.raw.end()
    emitter.on("line", onLine)
    emitter.once("done", onDone)

    await new Promise<void>((resolve) => {
        request.raw.on("close", () => {
            emitter.off("line", onLine)
            emitter.off("done", onDone)
            resolve()
        })
        emitter.once("done", resolve)
    })
})
```

### Pattern 3: BackupScheduler — per-stack cron task registry

**What:** Maintains a `Map<string, cron.ScheduledTask>` of active tasks. On startup, loads all stacks with a schedule. Provides `upsert(stackId, schedule)` and `remove(stackId)` to allow dynamic schedule changes when the user saves stack config.

**When to use:** Same structure as `DiskChecker`; registered in `jobs/index.ts`.

```typescript
// server/src/jobs/backup-scheduler.ts (structure)
export class BackupScheduler {
    private tasks = new Map<string, cron.ScheduledTask>()

    upsert(stackId: string, cronExpr: string): void {
        this.tasks.get(stackId)?.stop()
        const task = cron.schedule(cronExpr, () => {
            void this.runScheduledBackup(stackId)
        })
        this.tasks.set(stackId, task)
    }

    remove(stackId: string): void {
        this.tasks.get(stackId)?.stop()
        this.tasks.delete(stackId)
    }

    stop(): void {
        for (const task of this.tasks.values()) task.stop()
        this.tasks.clear()
    }

    private async runScheduledBackup(stackId: string): Promise<void> {
        const {backupService} = await import("../application/index.js")
        await backupService.runBackup(stackId, "SCHEDULED")
    }
}
```

### Pattern 4: Restic environment variable injection

**What:** Build a `Record<string, string>` with no secrets on the CLI, using the correct env var names per backend type.

**Source:** restic official documentation — https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html

```typescript
function buildResticEnv(config: BackupRepoConfig): Record<string, string> {
    const base: Record<string, string> = {
        RESTIC_REPOSITORY: buildRepoUrl(config),
        RESTIC_PASSWORD: config.password,  // AES-decrypted at call site
    }

    if (config.repoType === "s3") {
        return {
            ...base,
            AWS_ACCESS_KEY_ID: config.s3AccessKey,
            AWS_SECRET_ACCESS_KEY: config.s3SecretKey,
        }
    }

    // Local and SFTP: RESTIC_REPOSITORY format handles auth
    // SFTP: "sftp:user@host:/path" — relies on SSH key in ~/.ssh/
    // or sftp.command flag for custom SSH invocation
    return base
}

function buildRepoUrl(config: BackupRepoConfig): string {
    if (config.repoType === "local") return config.repoPath
    if (config.repoType === "s3") {
        const endpoint = config.s3Endpoint
            ? `s3:${config.s3Endpoint}/${config.s3Bucket}`
            : `s3:s3.amazonaws.com/${config.s3Bucket}`
        return endpoint
    }
    // SFTP: "sftp:user@host:/path/to/repo"
    return `sftp:${config.sftpUser}@${config.sftpHost}:${config.sftpPath}`
}
```

### Pattern 5: Retention policy — restic forget

**What:** After a successful backup, run `restic forget --tag <stackId> --keep-daily N --keep-weekly N --keep-monthly N --prune`.

**Source:** restic docs — https://restic.readthedocs.io/en/stable/060_forget.html

```typescript
// Retention stored as JSON in Stack.backupRetention:
interface RetentionPolicy {
    keepDaily: number
    keepWeekly: number
    keepMonthly: number
}

function buildForgetArgs(stackId: string, policy: RetentionPolicy): string[] {
    return [
        "forget",
        "--tag", stackId,
        "--keep-daily", String(policy.keepDaily),
        "--keep-weekly", String(policy.keepWeekly),
        "--keep-monthly", String(policy.keepMonthly),
        "--prune",
    ]
}
```

### Pattern 6: Absolute-path volume detection (BCK-07)

**What:** Parse the compose file volumes section; detect any bind mount where the host path does not start with the stack directory path.

```typescript
function detectAbsolutePathVolumes(
    composeContent: string,
    stackPath: string,
): string[] {
    const doc = yaml.parse(composeContent)
    const warnings: string[] = []

    for (const [serviceName, service] of Object.entries(doc.services ?? {})) {
        const svc = service as {volumes?: Array<string | {source?: string; type?: string}>}
        for (const vol of svc.volumes ?? []) {
            const source = typeof vol === "string"
                ? vol.split(":")[0]
                : vol.source

            if (source && path.isAbsolute(source) && !source.startsWith(stackPath)) {
                warnings.push(`${serviceName}: ${source}`)
            }
        }
    }
    return warnings
}
```

### Pattern 7: RESTORE trigger — Prisma migration

**What:** Add `RESTORE` to the `BackupTrigger` enum. The Backup record created for a restore uses `trigger: RESTORE` so backup history and restore history share one table and one detail page URL pattern.

```prisma
// server/prisma/schema/backup.prisma — add RESTORE
enum BackupTrigger {
  MANUAL
  SCHEDULED
  RESTORE
}
```

This requires a `prisma migrate dev` migration.

### Pattern 8: Backup log storage

**What:** Store accumulated log lines in a `logLines String[]` column on `Backup` so the detail page can display historical output after a backup completes (not just during). This is cheaper than writing to a file.

```prisma
// server/prisma/schema/backup.prisma — add to Backup model
logLines  String[]
```

### Anti-Patterns to Avoid
- **Credentials on CLI args:** Never pass `RESTIC_PASSWORD` or S3 keys as `restic --password "..."` CLI arguments. They will appear in `ps aux` output. Always use env vars.
- **execFile for restic:** `execFile` buffers all output until completion; `spawn` is required for streaming (BCK-10).
- **Blocking the route handler:** The backup POST route must return immediately (202 Accepted) and run the restic process in the background (`void backupService.runBackup(...)`).
- **Running restic forget inside the same spawn as backup:** Forget is a separate invocation after the backup completes.
- **Storing restic password in plaintext:** Use `encrypt()` from `lib/crypto.ts` on write, `decrypt()` on read — same pattern as SMTP password.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Encrypted blob storage | Custom cipher | `encrypt()`/`decrypt()` in `lib/crypto.ts` | AES-256-GCM already implemented and tested |
| Cron parsing/validation | Custom regex | `node-cron` `validate(expr)` method | Handles standard 5-field and 6-field cron expressions |
| Restic snapshot listing | Shell parse of text output | `restic snapshots --json` | JSON output is stable and machine-readable |
| SSE keepalive | Custom ping loop | Same `request.raw.on('close', ...)` pattern already in `routes/events.ts` and log SSE | Pattern is established and tested |
| Volume path resolution | Custom OS path logic | `path.isAbsolute()` + `String.startsWith(stackPath)` | Node built-in, no edge cases |

**Key insight:** Restic handles all the hard parts of backup (deduplication, encryption at rest, integrity verification, incremental snapshots). Docktor's job is only to invoke it correctly and expose the results.

---

## Common Pitfalls

### Pitfall 1: Restic repository not initialized

**What goes wrong:** `restic backup` fails with exit code 10 if the repository has never been initialized with `restic init`.
**Why it happens:** Restic repos must be explicitly initialized before first use.
**How to avoid:** In `BackupService.runBackup()`, check if the repo exists first by running `restic cat config` (exit 0 = repo exists, exit 10 = not found). If not found, run `restic init` automatically before the first backup.
**Warning signs:** Exit code 10 from spawn; stderr contains "Is there a repository at the following location?"

### Pitfall 2: Stack in BACKING_UP blocks snapshot listing

**What goes wrong:** `GET /api/stacks/:id/snapshots` calls `restic snapshots` — this acquires a read lock on the repo, which conflicts with a concurrent `restic backup` holding a write lock.
**Why it happens:** Restic uses repository-level locking.
**How to avoid:** The snapshots endpoint should check if the stack is `BACKING_UP` or `RESTORING` and return a 409 with a message ("Backup in progress, try again shortly") rather than calling restic.
**Warning signs:** `restic snapshots` hangs for 30s then returns exit 11.

### Pitfall 3: Orphaned BACKING_UP state after server restart

**What goes wrong:** Server restarts while a backup is in progress; the stack stays in `BACKING_UP` forever because the spawned process is dead.
**Why it happens:** There is no recovery for in-flight async ops across process restarts.
**How to avoid:** On `startJobs()`, query for any `Backup` records in `IN_PROGRESS` status and transition them to `FAILED` (and restore `Stack.previousStatus`). This is the same server-restart recovery pattern.
**Warning signs:** Stack stuck in BACKING_UP after redeployment.

### Pitfall 4: SFTP authentication failures in non-interactive context

**What goes wrong:** SFTP backend connects via SSH; if the host is not in `~/.ssh/known_hosts`, restic prompts interactively and hangs.
**Why it happens:** `spawn()` defaults to inheriting the process environment; SSH strict host key checking is on by default.
**How to avoid:** For SFTP, pass `-o sftp.args='-o StrictHostKeyChecking=accept-new'` (or `-o BatchMode=yes` plus a pre-populated known_hosts). Document this in the UI as a requirement. Alternatively, surface SSH key fingerprint verification as a one-time setup step.
**Warning signs:** Restic backup hangs indefinitely with no output on SFTP repos.

### Pitfall 5: restic forget with --tag removes cross-stack snapshots

**What goes wrong:** If two stacks share the same restic repository and you forget with `--tag <stackId>`, it only removes that stack's snapshots — this is correct. But if tags were omitted during backup, forget without `--tag` would delete snapshots from all stacks.
**Why it happens:** Tags must be applied consistently on every backup invocation.
**How to avoid:** Always pass `--tag <stackId>` on `restic backup` and `restic forget`. The tag is the stack's id string (slug). Verify this in tests.
**Warning signs:** Other stacks losing snapshots after one stack's retention policy runs.

### Pitfall 6: BigInt serialization in JSON

**What goes wrong:** Prisma returns `sizeBytes` as `BigInt`. `JSON.stringify()` throws `TypeError: Do not know how to serialize a BigInt`.
**Why it happens:** JavaScript's `JSON.stringify` does not handle BigInt.
**How to avoid:** In repository methods and route responses, convert `sizeBytes` to `String` or `Number` before sending. The existing `Backup` model already has `sizeBytes BigInt?` — add a serialization layer in `BackupRepository.toDto()`.
**Warning signs:** 500 errors on backup list endpoint when `sizeBytes` is populated.

### Pitfall 7: Restore leaves stack in RESTORING on restic failure

**What goes wrong:** Restic restore exits non-zero; BackupService does not transition the stack back to ERROR, leaving it stuck in RESTORING.
**Why it happens:** Error handling must be explicit around every restic invocation.
**How to avoid:** The `runRestore()` method must wrap the entire operation in try/catch and always set the stack status: RUNNING/previous-state on success, ERROR on any failure. Use a `finally` block to guarantee the state is always updated.

---

## Code Examples

### Triggering a backup — background POST route
```typescript
// server/src/routes/backups.ts
app.post("/api/stacks/:id/backup", {
    schema: {params: stackParamsSchema},
}, async (request, reply) => {
    // Fire and forget — returns 202 immediately
    const backup = await backupService.initiateBackup(request.params.id, "MANUAL")
    void backupService.runBackup(backup.id)  // runs in background
    return reply.status(202).send({backupId: backup.id})
})
```

### Fetching snapshots — restic snapshots --json
```typescript
// server/src/infrastructure/restic-executor.ts
async snapshots(repoConfig: BackupRepoConfig, tag: string): Promise<ResticSnapshot[]> {
    const lines: string[] = []
    const {exitCode, stderr} = await this.run({
        args: ["snapshots", "--tag", tag, "--json"],
        env: this.buildEnv(repoConfig),
        onLine: (l) => lines.push(l),
    })

    if (exitCode === 10) return []  // repo not yet initialized
    if (exitCode !== 0) throw new Error(`restic snapshots failed: ${stderr}`)

    const json = lines.join("")
    return JSON.parse(json) as ResticSnapshot[]
}
```

### Client hook — adapt useLogStream for backup stream
```typescript
// client/src/hooks/use-backup-stream.ts
export function useBackupStream(backupId: string, active: boolean) {
    const [lines, setLines] = useState<string[]>([])
    const [status, setStatus] = useState<"streaming" | "done" | "error">("streaming")
    const esRef = useRef<EventSource | null>(null)

    useEffect(() => {
        if (!active) return
        const url = `/api/backups/${backupId}/stream`
        const es = new EventSource(url, {withCredentials: true})
        esRef.current = es

        es.onmessage = (e) => {
            const data = JSON.parse(e.data)
            if (data.line) setLines(prev => [...prev, data.line])
            if (data.done) {
                setStatus(data.status === "COMPLETED" ? "done" : "error")
                es.close()
            }
        }

        return () => { es.close(); esRef.current = null }
    }, [backupId, active])

    return {lines, status}
}
```

### Settings — backup repo config keys
```typescript
// server/src/application/settings-service.ts additions
const BACKUP_SETTING_KEYS = {
    REPO_TYPE:        "backup.repoType",       // "local" | "sftp" | "s3"
    REPO_PATH:        "backup.repoPath",       // local path
    REPO_HOST:        "backup.sftpHost",
    REPO_USER:        "backup.sftpUser",
    REPO_KEY:         "backup.sftpKey",        // encrypted
    S3_ENDPOINT:      "backup.s3Endpoint",
    S3_BUCKET:        "backup.s3Bucket",
    S3_ACCESS_KEY:    "backup.s3AccessKey",
    S3_SECRET_KEY:    "backup.s3SecretKey",    // encrypted
    PASSWORD:         "backup.password",        // AES-encrypted
    DEFAULT_SCHEDULE: "backup.defaultSchedule",
    DEFAULT_RETENTION:"backup.defaultRetention",// JSON string
} as const
```

### Notification event type extension
```typescript
// server/src/application/notification-service.ts — add backup_failure to union
export interface NotificationEvent {
    type: "stack_error" | "stack_unhealthy" | "disk_warning" | "backup_failure"
    // ... existing fields
    backupTrigger?: "MANUAL" | "SCHEDULED"
    backupRepoType?: "local" | "sftp" | "s3"
}
```

The `notify()` method's `toggleKey` switch must add `"backup_failure" → "notify.backupFailure"`.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `execFile` for CLI tools | `spawn()` for streaming output | Required for BCK-10; enables live progress display |
| Single global cron schedule | Per-stack `node-cron` task registry | Allows different schedules per stack |
| Manual credential flags on CLI | Env var injection into child process | Security — credentials not visible in process list |

**Restic exit codes (>= 0.17.0):**
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Command failed |
| 3 | Backup: couldn't read some source data (partial success) |
| 10 | Repository doesn't exist |
| 11 | Failed to lock repository |
| 12 | Wrong password |

---

## Open Questions

1. **SFTP host key verification**
   - What we know: SSH strict host checking blocks non-interactive use unless the host is pre-trusted
   - What's unclear: Whether Docktor should require users to pre-populate `known_hosts` or handle it in-app
   - Recommendation: Use `-o StrictHostKeyChecking=accept-new` via `sftp.args` on first connect. Document clearly in the Settings UI. This is what most self-hosted tools do.

2. **Restic binary availability**
   - What we know: Restic must be installed on the host; it is not bundled
   - What's unclear: Should BackupService check binary existence on startup and surface an error in Settings?
   - Recommendation: Yes. Add a `GET /api/settings/backup/status` endpoint that runs `restic version` and returns `{available: true/false, version?: string}`. Display this in the Repository card with an alert if unavailable.

3. **Log storage for completed backups**
   - What we know: The decision requires detail page to show "static log lines" once complete
   - What's unclear: Storing thousands of log lines in a Postgres `String[]` column is fine for typical backups (< 1000 lines) but may grow large for large volume backups
   - Recommendation: Store log lines in `Backup.logLines String[]` (Prisma `@db.Text[]` in PostgreSQL). Cap at 5000 lines with a truncation marker. This avoids filesystem complexity.

4. **Cron expression validation**
   - What we know: `node-cron` exposes a `validate(expr)` method
   - What's unclear: Whether to show a human-readable preview ("runs at 03:00 every day")
   - Recommendation: Use `node-cron`'s `validate()` for server-side validation. On the client, use the `croner` library's `Cron` constructor (already available for validate-without-scheduling) to generate a human-readable next-run preview. No additional npm dep needed — `croner` is a dev community alternative but `node-cron` 3.x `validate()` is sufficient for server use.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `server/vitest.config.ts` |
| Quick run command | `yarn workspace @docktor/server test:unit` |
| Full suite command | `yarn workspace @docktor/server test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BCK-01 | Backup settings GET/PUT round-trips correctly | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| BCK-02 | Restic password is encrypted on save, decrypted on restic invocation | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| BCK-03 | Manual backup transitions stack to BACKING_UP and returns 202 | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| BCK-04 | BackupScheduler registers/updates/removes cron tasks per stack | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-scheduler` | ❌ Wave 0 |
| BCK-05 | Retention policy args built correctly for restic forget | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose restic-executor` | ❌ Wave 0 |
| BCK-06 | Backup args include stack path and --exclude logs | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose restic-executor` | ❌ Wave 0 |
| BCK-07 | Absolute-path volume detection returns correct warnings | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| BCK-08 | snapshots() returns parsed JSON; returns [] on exit 10 | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose restic-executor` | ❌ Wave 0 |
| BCK-09 | Restore orchestration: stop → restore → redeploy sequence | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| BCK-10 | ResticExecutor uses spawn and emits lines as they arrive | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose restic-executor` | ❌ Wave 0 |
| BCK-11 | Stack returns to previousStatus on backup success, ERROR on failure | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |
| NOTF-05 | backup_failure notification sent with correct fields; deduplication skips second | unit | `yarn workspace @docktor/server test:unit -- --reporter=verbose backup-service` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn workspace @docktor/server test:unit`
- **Per wave merge:** `yarn workspace @docktor/server test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/test/unit/infrastructure/restic-executor.test.ts` — covers BCK-05, BCK-06, BCK-08, BCK-10 (mock child_process.spawn)
- [ ] `server/test/unit/application/backup-service.test.ts` — covers BCK-01, BCK-02, BCK-03, BCK-07, BCK-09, BCK-11, NOTF-05 (mock ResticExecutor + BackupRepository)
- [ ] `server/test/unit/jobs/backup-scheduler.test.ts` — covers BCK-04 (mock node-cron + BackupService)

---

## Sources

### Primary (HIGH confidence)
- restic official docs — https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html — env var names (RESTIC_PASSWORD, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, RESTIC_REPOSITORY)
- restic official docs — https://restic.readthedocs.io/en/stable/060_forget.html — forget flags (--keep-daily, --keep-weekly, --keep-monthly, --prune)
- restic official docs — https://restic.readthedocs.io/en/stable/075_scripting.html — exit codes, --json flag
- Existing codebase — `server/src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt (verified by reading source)
- Existing codebase — `server/prisma/schema/backup.prisma` — Backup model schema (verified by reading source)
- Existing codebase — `server/prisma/schema/stack.prisma` — StackStatus enum, Stack backup fields (verified)
- Existing codebase — `server/src/domain/stack-status-machine.ts` — BACKUP/RESTORE actions already defined (verified)
- Existing codebase — `server/src/jobs/disk-checker.ts` — DiskChecker pattern for BackupScheduler (verified)
- Existing codebase — `server/src/lib/state-broadcaster.ts` — EventEmitter-based broadcaster pattern (verified)
- Existing codebase — `server/src/routes/events.ts` — SSE route pattern (verified)

### Secondary (MEDIUM confidence)
- node-cron npm docs — version 3.0.3 already in project; `cron.schedule()` and `task.stop()` API used by DiskChecker
- Node.js docs — `child_process.spawn()` stdio pipe pattern — standard built-in, HIGH confidence

### Tertiary (LOW confidence — needs validation)
- SFTP host key handling recommendation (`StrictHostKeyChecking=accept-new`) — based on common self-hosted tool patterns; should be tested against real SFTP setup

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new npm deps; all required libraries already in project
- Architecture patterns: HIGH — all patterns derived directly from existing codebase (crypto.ts, state-broadcaster.ts, disk-checker.ts, events.ts) plus verified restic docs
- Pitfalls: HIGH for items 1/3/5/6/7 (derived from restic exit codes + TypeScript/Prisma behavior); MEDIUM for items 2/4 (SFTP locking/SSH behaviors need runtime verification)
- Validation: HIGH — vitest config and test structure confirmed from existing files

**Research date:** 2026-03-18
**Valid until:** 2026-06-18 (restic API is stable; node-cron 3.x is stable)
