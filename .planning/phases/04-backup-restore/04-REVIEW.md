---
phase: 04-backup-restore
reviewed: 2026-08-30T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - server/src/application/backup-service.ts
  - server/src/routes/backups.ts
  - server/test/unit/application/backup-service.test.ts
  - client/src/hooks/use-backup-stream.ts
  - client/src/routes/app/stacks/backups/[backupId].tsx
  - client/test/unit/hooks/use-backup-stream.test.ts
  - client/test/unit/routes/stacks/backup-detail-page.test.tsx
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 04: Code Review Report (gap-closure plan 04-17 follow-up)

**Reviewed:** 2026-08-30
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

This is a scoped follow-up review of gap-closure plan 04-17, which claimed to close
CR-01 (SSE disconnect leaves the detail page permanently stale), CR-02 (202/runBackup
race drops SSE clients or mis-reports status), and CR-03 (nameless title/breadcrumb
during IN_PROGRESS). I traced each fix against the three commits that implement it
(`90cb0be`, `527cd29`, `4473742`) and against its dedicated tests.

**CR-02 (server broadcaster registration timing) is correctly and completely fixed.**
`ensureBackupBroadcaster()`/`disposeBackupBroadcaster()` are now the sole
writer/remover of the module-level map; `initiateBackup` registers synchronously
(no `await` in between) right after `backupRepo.create()` resolves, which genuinely
closes the race window between the 202 response and `runBackup` starting. The SSE
route's missing-broadcaster branch now re-reads the record and replays stored log
lines instead of trusting the pre-check status. Both are backed by direct unit tests
(`"registers a broadcaster ... before initiateBackup returns"`, `"a listener attached
between initiateBackup and runBackup still receives runBackup's done event (CR-02
regression)"`).

**CR-03 (nameless title/breadcrumb) is correctly and completely fixed.** The
`(backup?.resticSnapshotId || backupId).slice(0, 8)` fallback correctly treats the
empty string persisted by `initiateBackup` as absent, unlike a `??` would have. Tests
cover both the MANUAL and RESTORE trigger cases with an empty `resticSnapshotId`.

**CR-01 (SSE disconnect) is mostly fixed but the client-side reconnect has a real
regression:** every full reconnect (`connect()`, invoked both on first mount and from
`scheduleReconnect()`'s timer) unconditionally calls `setLines([])`, which wipes all
log lines the user has already seen. The server does not replay already-emitted
`"line"` events to a newly (re)subscribing client for a still-`IN_PROGRESS` backup, so
this is a genuine, user-visible loss of the visible backup progress log on exactly the
disconnect/reconnect path this fix was built to handle. See WR-01 below. This is
explicitly exercised (and asserted as correct) by the hook's own test
`"clears lines received before a reconnect when the replacement connection opens"` —
the test passing does not mean the behavior is desirable.

The bounded poll on the page (`BACKUP_RESYNC_POLL_INTERVAL_MS` / `_MAX_POLLS`) and its
three independent termination conditions (record leaves IN_PROGRESS, stream returns to
"streaming", hard poll ceiling) are implemented and tested correctly, and the one-shot
resync effect is correctly narrowed to only fire on `"completed"`/`"failed"` so it can
never race the poll effect for the same transition.

No security issues, injections, or hardcoded secrets were found in the reviewed diff.
`getBackupRepoConfig()`'s decrypt failure paths correctly fail closed (empty string,
never leak ciphertext).

## Warnings

### WR-01: Reconnecting the backup stream silently wipes already-displayed log output

**File:** `client/src/hooks/use-backup-stream.ts:30-34` (`connect()`)
**Issue:** `connect()` calls `setLines([])` unconditionally on every invocation,
including reconnects triggered by `scheduleReconnect()`'s timer after a `CLOSED`-state
disconnect (the exact scenario CR-01 targets). The server does not replay previously
emitted `"line"` broadcaster events to a new subscriber on an `IN_PROGRESS` backup —
`routes/backups.ts`'s `/stream` handler only forwards *future* `emitter.on("line", ...)`
events to a live subscriber; it only replays `logLines` from the DB in the two
terminal-status branches (already-finished backup, or the CR-02 missing-broadcaster
fallback). This means: a user watching a long-running backup who experiences a single
dropped connection (proxy blip, laptop sleep, Wi-Fi hiccup) will see the entire visible
log reset to empty the moment the manual reconnect succeeds, even though the backup
itself is still running normally and nothing was actually lost server-side. Repeated
disconnects (a flaky connection) would repeatedly blank the visible log. This directly
undermines the purpose of CR-01 — a user could reasonably interpret the sudden empty
log as the backup having restarted or failed.
**Fix:** Do not clear `lines` on a reconnect — only clear it on the very first
`connect()` call for a given `backupId`. For example, gate the clear on an
`isFirstConnect` flag local to the effect (`let isFirstConnect = true` at the top of
the effect, `if (isFirstConnect) { setLines([]); isFirstConnect = false }` inside
`connect()`), or have the server replay `lines` accumulated so far for a live,
`IN_PROGRESS` backup on new subscription (requires exposing the in-memory
`lines` accumulator from `runBackup`/`runRestore`, not just terminal `logLines`).
The existing test `"clears lines received before a reconnect when the replacement
connection opens"` will need to be inverted to assert lines are preserved.

### WR-02: The SSE route (including the new CR-02 fallback branch) has zero test coverage

**File:** `server/src/routes/backups.ts:144-209`
**Issue:** `grep` across `server/test/` finds no test file that exercises
`GET /api/backups/:id/stream` at all — not the pre-existing already-terminal branch,
not the live-emitter subscribe/unsubscribe-on-close branch, and not the newly added
CR-02 missing-broadcaster re-read-and-replay branch (lines 172-186). CLAUDE.md requires
"every new feature and bug fix must have corresponding tests," and this branch is
precisely the code path 04-17 added to close CR-02 on the server side — its only
verification is the *service*-level unit tests in `backup-service.test.ts`, which
never touch the route/HTTP layer (hijacked raw response, header writing, `request.raw
"close"` cleanup, or the interaction between `getBackupBroadcaster` and the re-read
fallback).
**Fix:** Add a Fastify integration test (or a route-level test using `app.inject()`/a
raw HTTP client capable of reading a streamed response) that: (1) asserts the
already-terminal backup replays `logLines` then ends; (2) asserts a live emitter
streams `"line"` events and a final `"done"` frame; (3) asserts the missing-broadcaster
fallback replays `refreshed.logLines` and ends with `refreshed.status` when
`getBackupBroadcaster` returns `undefined` for a still-registered-in-DB backup id.

### WR-03: `initiateBackup` can leave an orphaned, undisposed broadcaster if `stackRepo.update` fails

**File:** `server/src/application/backup-service.ts:159-164`
**Issue:** `ensureBackupBroadcaster(backup.id)` is now called before
`await this.stackRepo.update(stackId, {status: "BACKING_UP", ...})`. If that update
throws (DB error, connection loss), `initiateBackup` rejects, the route handler never
reaches its fire-and-forget block (which is what would otherwise call `runBackup` or
`abortBackup`, both of which are the only places that call
`disposeBackupBroadcaster`), and the emitter registered a few lines earlier is never
removed from the module-level map. Practically low-impact (no 202 response is ever
sent for this request, so no SSE client can ever subscribe to the orphaned emitter),
but it is a structural violation of the file's own stated invariant — the header
comment on `ensureBackupBroadcaster`/`disposeBackupBroadcaster` says they are "the
only function[s] permitted to write/remove" the map, implying paired lifecycle, and
this path breaks that pairing. The underlying "backup row stuck IN_PROGRESS until
server restart" behavior on this same failure path is pre-existing and out of scope
here; only the newly-added broadcaster-leak half is new in this diff.
**Fix:** Wrap the `stackRepo.update` call (and anything else between registration and
return) in a `try { ... } catch (err) { disposeBackupBroadcaster(backup.id); throw err }`,
or move `ensureBackupBroadcaster` to be the very last statement before `return`.

## Info

### IN-01: `if (data.line)` drops genuinely empty log lines

**File:** `client/src/hooks/use-backup-stream.ts:45-47`
**Issue:** `if (data.line) { setLines((prev) => [...prev, data.line!]) }` treats an
empty-string `line` payload as absent, so a blank line in restic's stdout/stderr
output (blank lines are common in CLI tool output, e.g. between sections) is silently
dropped instead of rendered as a blank line. Pre-existing (unchanged by 04-17), but
still present in a file under review.
**Fix:** `if (data.line !== undefined)` or `if (typeof data.line === "string")`.

### IN-02: Redundant `?? false` on an already-boolean expression

**File:** `client/src/routes/app/stacks/backups/[backupId].tsx:57-61`
**Issue:** `isStreaming` is defined as `backup?.status === "IN_PROGRESS"`, which is
always a `boolean` (strict equality never yields `undefined`). The subsequent
`useBackupStream(backupId, isStreaming ?? false)` call's `?? false` can never trigger
and adds noise.
**Fix:** `useBackupStream(backupId, isStreaming)`.

---

_Reviewed: 2026-08-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
