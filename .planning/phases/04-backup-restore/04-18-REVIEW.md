---
phase: 04-backup-restore
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - server/src/application/backup-service.ts
  - server/src/application/index.ts
  - server/src/lib/sse-backup-log.ts
  - server/src/routes/backups.ts
  - server/test/unit/lib/sse-backup-log.test.ts
  - server/test/unit/application/backup-service.test.ts
  - client/src/hooks/use-backup-stream.ts
  - client/test/unit/hooks/use-backup-stream.test.ts
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: issues_found
---

# Phase 04: Code Review Report (Gap Closure 04-18 — WR-01 SSE Backup Log Replay)

**Reviewed:** 2026-08-31T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The `sse-backup-log.ts` helper and its unit tests are well designed: the
replay-then-live sequencing is genuinely race-free (snapshot → replay →
attach listener, all synchronous, no `await` in between), and the test suite
exercises the exact interleavings that matter (buffered-then-live ordering,
no double delivery, `done` with/without an explicit status, client-close
detaching listeners without ending an already-gone socket). The client hook
(`use-backup-stream.ts`) correctly clears its buffer on every reconnect
because it now trusts the server to always replay the full log, and its
backoff/attempt-reset logic is covered thoroughly.

However, one defect makes the entire reconnect-replay mechanism this phase
was built to close (WR-01) unreachable for **restores**: `POST
/api/stacks/:id/restore` awaits the full restore synchronously before
returning the backup id, so by the time a client can open the SSE stream the
backup is already terminal — the live/buffered branch (`streamLiveBackupLog`)
this gap closure hardened is never exercised on that code path. There are
also several pre-existing quality issues in the surrounding files worth
fixing while this area is being touched: a Prisma call made directly from
`application/index.ts` (bypassing the repository layer the project mandates),
an `any`-typed parameter where a concrete type already exists, a broadcaster
leak on a failure path in `initiateBackup`, a path-prefix bug in the
volume-warning detector, and pre/post backup hooks whose exit codes are
silently discarded.

## Critical Issues

### CR-01: `runRestore` is awaited synchronously in the HTTP handler — the SSE replay path is unreachable for restores, and the request can hang for the full restore duration

**File:** `server/src/routes/backups.ts:79-88`
**Issue:**
```js
app.post(
    "/api/stacks/:id/restore",
    {schema: {params: stackParamsSchema, body: restoreSnapshotSchema}},
    async (request, reply) => {
        const {id} = request.params
        const {snapshotId} = request.body
        const backup = await backupService.runRestore(id, snapshotId)
        return reply.status(202).send({backupId: backup.id})
    },
)
```
`BackupService.runRestore()` (`server/src/application/backup-service.ts:294-413`)
runs the entire restore sequence in-process — stop containers, `restic
restore`, `docker up`, compose re-sync, notifications — and only resolves
(returning `{id: backup.id}`) after the operation reaches a terminal state
(`COMPLETED`/`FAILED`), at which point `disposeBackupBroadcaster(backup.id)`
has already run in its `finally` block.

Compare this to the backup flow in the very same file
(`server/src/routes/backups.ts:34-74`), which correctly calls
`initiateBackup()` to get an id back immediately, then runs `runBackup()` in
a detached fire-and-forget block — this is exactly the split that lets a
client subscribe to `/api/backups/:id/stream` *while the backup is still
in progress* and receive the replay-then-live sequence this gap-closure
plan hardened.

For restore, there is no such split. Consequences:
1. **The WR-01 replay/live-forwarding code path (`streamLiveBackupLog`) is
   dead code for restores.** By the time the client receives `backupId`
   from the 202 response and opens the stream, `backupRepository` already
   shows a terminal status, so the route always takes the
   `backup.status !== "IN_PROGRESS"` branch (`server/src/routes/backups.ts:163-170`)
   and just dumps the stored `logLines` — no live tailing, no reconnect
   scenario ever occurs, because there is nothing left to reconnect to.
2. **Availability/timeout risk.** The HTTP request stays open for the
   entire restore duration (stopping containers, restoring a potentially
   large snapshot, redeploying). Reverse proxies, load balancers, and
   browser `fetch`/XHR defaults commonly time out well before that
   completes, producing a failed request in the UI even though the server
   continues the restore in the background — the user never even receives
   the `backupId` needed to watch progress.
3. **`202 Accepted` semantics are violated** — 202 means "accepted for
   asynchronous processing", but the handler blocks until processing is
   fully done.

**Fix:** Split `runRestore` the same way `initiateBackup`/`runBackup` are
split — an `initiateRestore()` that creates the `Backup` row, transitions
the stack, registers the broadcaster, and returns `{id}` immediately, and a
`runRestoreProcess()` (or similar) that performs the actual restore and is
invoked fire-and-forget from the route, mirroring `server/src/routes/backups.ts:34-74`:
```js
app.post("/api/stacks/:id/restore", {schema: {...}}, async (request, reply) => {
    const {id} = request.params
    const {snapshotId} = request.body
    const restore = await backupService.initiateRestore(id, snapshotId)

    void backupService.runRestoreProcess(restore.id, id, snapshotId).catch((err) => {
        app.log.error({err}, "[backups] fire-and-forget runRestore failed")
    })

    return reply.status(202).send({backupId: restore.id})
})
```

## Warnings

### WR-01: `application/index.ts` calls Prisma directly, bypassing the repository layer, and casts without justification

**File:** `server/src/application/index.ts:33-39`
**Issue:**
```js
update: async (id: string, data: Record<string, unknown>) => {
    const {prisma} = await import("../lib/db.js")
    await prisma.stack.update({
        where: {id},
        data: data as {status?: StackStatus; previousStatus?: StackStatus | null},
    })
},
```
This is in `application/`, not `repositories/`, and it calls
`prisma.stack.update()` directly. CLAUDE.md is explicit about this:
"Repositories are the only place that touches Prisma" and, in *Common
Pitfalls to Avoid*, "Do not import Prisma client outside `repositories/` or
`lib/database.ts`". `StackRepository` already has `updateStackStatus()`
(`server/src/repositories/stack-repository.ts:252`) but it does not accept
`previousStatus`, which is presumably why this adapter reached around the
repository instead of extending it. The `data as {...}` cast is also an
unchecked cast with no comment explaining why it's safe, which CLAUDE.md
requires ("`as SomeType` is only acceptable with a comment explaining why it
is safe").

**Fix:** Add a proper method to `StackRepository`, e.g.
```ts
// stack-repository.ts
async updateStatus(id: string, data: {status: StackStatus; previousStatus?: StackStatus | null}) {
    await prisma.stack.update({where: {id}, data})
}
```
and have the adapter delegate to it without touching Prisma or casting:
```ts
update: (id: string, data: {status: StackStatus; previousStatus?: StackStatus | null}) =>
    repo.updateStatus(id, data),
```
This also removes the need for `BackupStackRepo.update`'s overly-loose
`Record<string, unknown>` parameter type.

### WR-02: `any`-typed `composeConfig` parameter where a concrete type already exists

**File:** `server/src/application/backup-service.ts:95`, `server/src/application/index.ts:42`
**Issue:**
```ts
// backup-service.ts:95
replaceServices(stackId: string, composeConfig: any): Promise<void>

// index.ts:42
replaceServices: (stackId: string, composeConfig: any) => repo.replaceServices(stackId, composeConfig),
```
`StackRepository.replaceServices` (`server/src/repositories/stack-repository.ts:105`)
already declares its parameter as `ComposeConfig` (`server/src/domain/compose-config.ts:5-8`),
and `runRestore()` already constructs one via `createComposeConfig()`
(`server/src/application/backup-service.ts:355`). CLAUDE.md: "No `any` — use
`unknown` and narrow the type, or model the type properly." There is no
reason to widen this to `any` in the interface/adapter — the concrete type
is available in both files.
**Fix:**
```ts
import type {ComposeConfig} from "../domain/compose-config.js"
// ...
replaceServices(stackId: string, composeConfig: ComposeConfig): Promise<void>
```

### WR-03: Broadcaster is leaked if `initiateBackup` fails after registering it

**File:** `server/src/application/backup-service.ts:172-194`
**Issue:**
```ts
const backup = await this.backupRepo.create({...})

// Register the broadcaster now — before this method returns ...
ensureBackupBroadcaster(backup.id)               // (1) registers into the module-level Map

await this.stackRepo.update(stackId, {           // (2) if this throws...
    status: "BACKING_UP",
    previousStatus: stack.status,
})

return {id: backup.id}
```
If step (2) throws (DB error, connection drop, etc.), `initiateBackup()`
rejects and the caller in `routes/backups.ts` never learns `backup.id`
(the exception is thrown before `reply.status(202).send({backupId: ...})`
is reached), so nothing ever calls `runBackup()`, `abortBackup()`, or any
other path that would call `disposeBackupBroadcaster(backup.id)`. The
`EventEmitter` registered in step (1) is orphaned in the module-level
`backupBroadcasters` map forever (until process restart) — a slow, unbounded
resource leak on a plausible failure path (any transient DB error between
backup-row creation and the stack-status update).
**Fix:** Wrap the post-registration work in try/catch and dispose on
failure:
```ts
ensureBackupBroadcaster(backup.id)
try {
    await this.stackRepo.update(stackId, {status: "BACKING_UP", previousStatus: stack.status})
} catch (err) {
    disposeBackupBroadcaster(backup.id)
    throw err
}
return {id: backup.id}
```

### WR-04: `detectAbsolutePathVolumes` prefix match is not path-boundary-aware — false negatives for sibling directories

**File:** `server/src/application/backup-service.ts:518`
**Issue:**
```ts
if (path.isAbsolute(resolvedSource) && !resolvedSource.startsWith(stackPath)) {
    warnings.push(`${serviceName}: ${source}`)
}
```
`String.prototype.startsWith` does not respect path segment boundaries. If
`stackPath` is `/stacks/myapp` and a compose volume mounts
`/stacks/myapp-shared-secrets`, this is incorrectly treated as "inside the
stack directory" (`"/stacks/myapp-shared-secrets".startsWith("/stacks/myapp")`
is `true`), so the absolute-path-outside-stack warning is silently
suppressed for a directory that is not actually under `stackPath` at all.
This is a false negative in a safety warning specifically meant to flag
volumes backups won't capture.
**Fix:** Compare using `path.relative` (or ensure a trailing separator
before comparing):
```ts
const rel = path.relative(stackPath, resolvedSource)
const isInside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
if (path.isAbsolute(resolvedSource) && !isInside) {
    warnings.push(`${serviceName}: ${source}`)
}
```

### WR-05: Pre/post backup hook exit codes and output are discarded

**File:** `server/src/application/backup-service.ts:224-226, 241-243`
**Issue:**
```ts
if (stack.backupPreHook) {
    await this.runHook(stack.backupPreHook, stackPath)
}
// ...
if (stack.backupPostHook) {
    await this.runHook(stack.backupPostHook, stackPath)
}
```
`runHook()` (`server/src/application/backup-service.ts:649-679`) returns
`{stdout, exitCode}` and only logs a `console.warn` server-side when the
exit code is non-zero — the return value is otherwise completely discarded
by both call sites. A failing pre-hook (e.g. a database "flush/quiesce"
script that is the entire reason a pre-hook feature exists) does not fail
the backup, is not written to `lines`/emitted over SSE, and is not recorded
in the persisted `Backup.logLines` or `errorMessage` — the backup proceeds
and is reported to the user as a normal success, even though the
consistency guarantee the hook was supposed to provide was never met. There
is also no test covering hook-failure behavior (`describe("runPreHook() /
runPostHook()")` in `server/test/unit/application/backup-service.test.ts:925-939`
only covers the happy path and the null/empty skip case).
**Fix:** At minimum, feed the hook's stdout/exit code into the same
`onLine`/`lines` accumulator used for restic output so it is visible in the
SSE stream and persisted log, and consider failing the backup (or at least
recording a warning marker) when a pre-hook exits non-zero:
```ts
if (stack.backupPreHook) {
    const result = await this.runHook(stack.backupPreHook, stackPath)
    if (result) onLine(`[pre-hook] exit ${result.exitCode}: ${result.stdout}`)
    if (result && result.exitCode !== 0) {
        throw new Error(`Pre-hook failed with exit code ${result.exitCode}`)
    }
}
```

## Info

### IN-01: Extensive `console.log`/`console.warn`/`console.error` usage instead of structured logging, inconsistent within the same files

**File:** `server/src/application/backup-service.ts` (e.g. lines 211, 216, 218, 230, 247), `server/src/routes/backups.ts` (e.g. lines 33, 35, 40, 46, 48, 56, 58, 311, 314, 361)
**Issue:** Both files use plain `console.log`/`console.error`/`console.warn`
extensively for request tracing and per-line restic output
(`` console.log(`[BackupService] Log line: ${line}`) `` runs once per line of
restic output), while `routes/backups.ts:60,68` uses Fastify's structured
`app.log.error` in the same file. This is inconsistent, bypasses log-level
configuration, and floods logs during large backups.
**Fix:** Route all logging through Fastify's `app.log` (injected or passed
through) instead of `console.*`, and drop the per-line debug log or gate it
behind a debug log level.

---

_Reviewed: 2026-08-31T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
