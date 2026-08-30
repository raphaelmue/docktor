---
phase: 04-backup-restore
reviewed: 2026-08-30T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - client/src/hooks/use-backup-stream.ts
  - client/src/routes/app/stacks/backups/[backupId].tsx
  - client/test/unit/hooks/use-backup-stream.test.ts
  - client/test/unit/routes/stacks/backup-detail-page.test.tsx
  - server/src/application/backup-service.ts
  - server/src/jobs/backup-scheduler.ts
  - server/src/routes/backups.ts
  - server/test/unit/application/backup-service.test.ts
  - server/test/unit/jobs/backup-scheduler.test.ts
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-08-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

These two gap-closure plans (04-15, 04-16) fixed a real class of bugs — failure diagnostics not being persisted, the stack getting wedged in `BACKING_UP`, and the detail page showing stale content after the SSE stream ended. The `abortBackup` path, the `[error] ...` logLines entries on failure, and the one-shot resync effect on the detail page are all correctly implemented for the *specific* scenarios their own tests exercise (terminal-transition resync, no-repo-config abort, dependency-fetch-rejects abort).

However, the fix for "stale UI after the SSE stream ends" is incomplete: it only handles the case where the *backend* has actually reached a terminal status. Two other ways the stream can end prematurely — a genuine network/proxy disconnect while the backup is still running, and a server-side race where a client subscribes to `/stream` before `runBackup` has registered its broadcaster — still leave the page permanently frozen with no reconnect and, in the broadcaster-race case, an incorrectly reported terminal status. Additionally, a pre-existing bug in the page's `shortId` computation (not part of this gap closure, but visible in the reviewed file) means the page title and breadcrumb render empty text for the single most common state a user will view this page in: `IN_PROGRESS`.

## Critical Issues

### CR-01: SSE stream never reconnects; one-shot resync leaves the page permanently stale after any transient disconnect

**File:** `client/src/hooks/use-backup-stream.ts:38-46`, `client/src/routes/app/stacks/backups/[backupId].tsx:90-113`

**Issue:**
`useBackupStream`'s effect only re-subscribes when `backupId` or `active` changes (line 47: `}, [backupId, active])`). Once the `EventSource` reaches a terminal state — `onerror` fires and sets `status: "disconnected"` (lines 38-41) — there is no code path that ever reopens the connection for the *same* `backupId`/`active` pair.

On the page, the resync effect (lines 102-110) is a one-shot: it fires once when `streamStatus` leaves `"streaming"` while `isStreaming` is still true, and calls `loadBackup("resync", ...)`. If that refetch comes back still `IN_PROGRESS` (which is exactly what happens on a transient network blip, proxy timeout, or brief server hiccup — the backup itself hasn't failed, only the connection dropped), then:
- `isStreaming` stays `true` (unchanged)
- `streamStatus` stays `"disconnected"` (unchanged)
- the effect's dependency array `[isStreaming, streamStatus, loadBackup]` hasn't changed, so React does not re-run it
- `useBackupStream`'s effect deps (`backupId`, `active`) also haven't changed, so the `EventSource` is never reopened

The page is now stuck forever showing the log lines and status as of the moment of disconnect, even though the backup keeps running (and eventually completes or fails) on the server. The user has no way to see the outcome short of a full page reload. This is the exact class of bug the gap-closure plan set out to fix ("stale-UI bug on the backup detail page after the SSE stream ends"), reappearing for the "stream drops but backup is still running" case rather than the "stream reaches a genuine terminal status" case that the new tests cover.

**Fix:** Give the hook (or the page) a retry/backoff loop that reopens the `EventSource` while `active` is true and the backend record is still `IN_PROGRESS`, e.g.:
```ts
// in useBackupStream, track a retry counter that bumps on error and is
// included in the effect's dependency array, so onerror triggers a
// reconnect rather than a terminal "disconnected" state:
const [retryToken, setRetryToken] = useState(0)
...
es.onerror = () => {
    es.close()
    if (active) {
        setTimeout(() => setRetryToken((t) => t + 1), 2000)
    } else {
        setStatus("disconnected")
    }
}
...
}, [backupId, active, retryToken])
```
Alternatively (simpler), have the page poll `GET /api/backups/:id` on an interval whenever `isStreaming` is true and `streamStatus !== "streaming"`, instead of a single one-shot fetch, so a still-in-progress backup keeps getting resynced until it reaches a real terminal state.

---

### CR-02: SSE route conflates "backup not yet started" with "backup already finished" when the broadcaster lookup misses

**File:** `server/src/routes/backups.ts:170-178`
**Also relevant:** `server/src/application/backup-service.ts:150-151` (`runBackup`), `:254-255` (`runRestore`), `:504-513` (`abortBackup`)

**Issue:** The stream handler does:
```ts
const emitter = getBackupBroadcaster(id)
if (!emitter) {
    // Broadcaster gone (race condition) — end immediately
    reply.raw.write(`data: ${JSON.stringify({done: true, status: backup.status})}\n\n`)
    reply.raw.end()
    return
}
```
The comment assumes a missing broadcaster only ever means "the backup already finished and `backupBroadcasters.delete()` already ran." But `backupBroadcasters.set(...)` is only called inside `runBackup` (line 151) and `runRestore` (line 255) — i.e. *after* the fire-and-forget dependency fetch (`Promise.all([...])` in `routes/backups.ts:40-44` / `backup-scheduler.ts:122-126`) has resolved. There is a real window, between `POST /api/stacks/:id/backup` returning 202 and the fire-and-forget task actually invoking `runBackup`, during which:
- the DB row's status is `IN_PROGRESS` (set by `initiateBackup`)
- no broadcaster has been registered yet

If a client opens `GET /api/backups/:id/stream` in that window, `getBackupBroadcaster(id)` returns `undefined`, and the handler immediately ends the stream with `done: true, status: "IN_PROGRESS"`. The client's `useBackupStream` hook interprets any status other than `"COMPLETED"` as `"failed"` (`use-backup-stream.ts:30`), so a backup that hasn't even started running restic yet is reported to the UI as already failed — and, per CR-01, the page then has no way to recover once `isStreaming`/`streamStatus` settle, even though the backup goes on to complete successfully on the server moments later.

Given how the frontend flow works (trigger backup → immediately navigate to the detail page → immediately open the SSE stream), this window is not a hypothetical corner case — it is on the natural, likely path for a fast client / slow server.

**Fix:** Register the broadcaster (or at least a placeholder marker) synchronously at backup-creation time rather than inside `runBackup`/`runRestore`, e.g. have `initiateBackup`/`runRestore`'s create-step set an empty `EventEmitter` into `backupBroadcasters` immediately, so `getBackupBroadcaster` can never return `undefined` while the DB row is still `IN_PROGRESS`. Alternatively, in the "broadcaster gone" branch, re-fetch the backup row instead of trusting the value read before the check, and if it's still `IN_PROGRESS`, wait/poll briefly rather than immediately reporting a terminal status.

---

### CR-03: `shortId` fallback doesn't catch the empty-string `resticSnapshotId` that every in-progress backup has, rendering an empty page title and breadcrumb

**File:** `client/src/routes/app/stacks/backups/[backupId].tsx:119`

**Issue:**
```ts
const shortId = (backup?.resticSnapshotId ?? backupId).slice(0, 8);
```
`initiateBackup` creates every backup record with `resticSnapshotId: ""` (`server/src/application/backup-service.ts:128`), and the snapshot id is only populated once the backup completes (`server/src/application/backup-service.ts:190-197`). `??` only falls back to `backupId` when the left side is `null`/`undefined` — an empty string is neither, so for every backup that is currently `IN_PROGRESS` (the state a user is looking at whenever the live SSE stream and auto-scroll are active — i.e. the primary use case of this page), `shortId` evaluates to `"".slice(0, 8)` → `""`.

Consequences on this render path (lines 119-121, 220):
- `pageTitle` becomes `"Backup #"` (or `"Restore #"`) with nothing after the `#`
- the breadcrumb's current-page label (`<BreadcrumbPage>{shortId}</BreadcrumbPage>`, line 220) renders empty text

This is deterministic, not a race — it reproduces on every single "watch a backup run live" visit, which is the page's core use case.

**Fix:**
```ts
const shortId = (backup?.resticSnapshotId || backupId).slice(0, 8);
```
(use `||` so an empty string also falls through to `backupId`), or explicitly:
```ts
const shortId = (backup?.resticSnapshotId ? backup.resticSnapshotId : backupId).slice(0, 8);
```

## Warnings

### WR-01: `abortBackup` relies on a non-atomic check-then-act to guarantee it "never clobbers a completed row"

**File:** `server/src/application/backup-service.ts:504-513`

**Issue:** The docstring for `abortBackup` (lines 496-503) explicitly promises: "Idempotent: a no-op on an unknown backup id or a backup that has already reached a terminal status (COMPLETED/FAILED), so it never clobbers a row that runBackup already finished." The implementation enforces this only via a read-then-write:
```ts
const backup = await this.backupRepo.findById(backupId)
if (!backup || backup.status !== "IN_PROGRESS") return
await this.backupRepo.update(backupId, {status: "FAILED", ...})
```
There is no conditional update (e.g. `WHERE status = 'IN_PROGRESS'`) — just a plain `update` by id. Under the current call sites (both `routes/backups.ts` and `backup-scheduler.ts` only call `abortBackup` in branches that are mutually exclusive with `runBackup` ever having started), this is safe in practice today. But the safety is an invariant of the *callers*, not of `abortBackup` itself, and the docstring's guarantee reads as if it were self-enforced. Any future caller that invokes `abortBackup` concurrently with (or racing) `runBackup` — e.g. a timeout-based "abort if it's been running too long" feature — would be able to overwrite a `COMPLETED` row back to `FAILED`.

**Fix:** Make the guarantee self-enforced with a conditional update, e.g. `backupRepo.updateIfInProgress(backupId, {...})` implemented as `prisma.backup.updateMany({where: {id, status: "IN_PROGRESS"}, data: {...}})`, and treat `count === 0` as the no-op case instead of relying on the earlier `findById` read.

### WR-02: `recoverInProgressBackups()` doesn't get the same failure-diagnostics treatment as the new `abortBackup` path

**File:** `server/src/application/backup-service.ts:537-554`

**Issue:** `recoverInProgressBackups()` exists for the same fundamental problem `abortBackup` was added to solve — a backup row stuck `IN_PROGRESS` with no process actually working on it (here: because the server restarted). Unlike `abortBackup`, it does not:
- append an `[error] Server restarted during backup` line to `logLines` (it only sets `errorMessage`, leaving `logLines` at whatever it already was — typically `[]`)
- call `notificationService.notify(...)`

This means a backup that fails via server-restart recovery will show `"No log output was captured for this backup."` in the Output card on the detail page (per the empty-message logic added in this same gap closure, `[backupId].tsx:114-117`), even though a specific, known reason for the failure exists — it's just not surfaced in the log panel the way every other failure path now surfaces it.

**Fix:** Reuse the same `logLines: [`[error] ${errorMessage}`]` pattern (and consider a notification) in `recoverInProgressBackups`, or better, route both through the same private helper so future failure paths can't drift out of sync again.

### WR-03: Background resync failures are silently swallowed with no retry, compounding CR-01

**File:** `client/src/routes/app/stacks/backups/[backupId].tsx:74-80, 102-110`

**Issue:** In `loadBackup`, a `resync`-mode failure only does `console.warn("Background backup refresh failed", err)` — no state is set, no retry is scheduled. Combined with the one-shot nature of the resync effect (see CR-01), if the *first* resync attempt after a stream disconnect happens to fail (e.g., transient network error, which is plausible right after the SSE connection itself just dropped), the page never tries again. There's no visible difference to the user between "backup still legitimately running" and "we gave up trying to find out" — both render as an indefinitely `IN_PROGRESS`-looking page.

**Fix:** At minimum, retry the resync fetch (with backoff) on failure rather than giving up after one attempt; ideally, fold this into the same reconnect/poll loop recommended for CR-01.

### WR-04: Inconsistent logging conventions — raw `console.*` mixed with the structured Fastify logger

**File:** `server/src/routes/backups.ts:32,34,39,45,47,55,57` vs. `:59,67`; `server/src/application/backup-service.ts` (throughout, e.g. `:155,160,162,191,206`)

**Issue:** `routes/backups.ts`'s fire-and-forget backup handler uses `console.log`/`console.error` for the majority of its tracing (lines 32, 34, 39, 45, 47, 55, 57) but switches to Fastify's structured `app.log.error` for the two actual error paths (lines 59, 67) in the very same function. `backup-service.ts` uses `console.log`/`console.error`/`console.warn` exclusively throughout — it has no access to a request-scoped or app-scoped logger at all. This fragments observability: structured log fields (request id, level, timestamps in the configured format) are only available for a subset of these log lines, and any log-shipping/redaction configured on the Fastify logger won't apply to the `console.*` calls.

**Fix:** Inject a logger into `BackupService`/`BackupScheduler` (or use a shared app-level logger singleton) and route all diagnostic output through it, matching the pattern already used for the two `app.log.error` calls in the same route file.

## Info

### IN-01: Dead nullish-coalescing fallback

**File:** `client/src/routes/app/stacks/backups/[backupId].tsx:56`

**Issue:** `useBackupStream(backupId, isStreaming ?? false)` — `isStreaming` (line 53: `backup?.status === "IN_PROGRESS"`) is a strict equality comparison and is therefore always a `boolean`, never `undefined`. The `?? false` is unreachable.

**Fix:** `useBackupStream(backupId, isStreaming)`.

### IN-02: Duplicate Zod param schemas

**File:** `server/src/routes/backups.ts:19-20`

**Issue:** `stackParamsSchema` and `backupParamsSchema` are byte-for-byte identical (`z.object({id: z.string()})`). Keeping two names for the same shape invites drift if one is later tightened (e.g. to a UUID/cuid format) without the other following.

**Fix:** Use a single shared `idParamsSchema` for both, or add a comment explaining why they're intentionally kept separate.

### IN-03: Interface return type doesn't match the concrete implementation it's assigned

**File:** `server/src/jobs/backup-scheduler.ts:6, 115`

**Issue:** `BackupSchedulerService.initiateBackup` is typed `Promise<{id: string} | undefined>`, but the concrete `BackupService.initiateBackup` (`server/src/application/backup-service.ts:116-137`) never resolves `undefined` — it resolves `{id: string}` or the promise rejects (e.g. via `assertTransition` throwing). The `if (!result) return` guard at `backup-scheduler.ts:115` is therefore unreachable dead code for the production wiring in `createProductionScheduler`.

**Fix:** Either drop `| undefined` from the interface (and the now-dead guard), or, if the `| undefined` case is meant to model a future/alternate implementation, add a comment clarifying that the guard is defensive rather than reachable today.

---

_Reviewed: 2026-08-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
