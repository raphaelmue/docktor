# Phase 04: Backup & Restore — Gap-Closure Pattern Map

**Mapped:** 2026-08-30
**Mode:** Gap-closure (13 plans already executed: 04-01..04-08, 04-10..04-14)
**Files analyzed:** 6 (all pre-existing, no new files expected)
**Analogs found:** 6 / 6 (every file being touched is its own best analog — this phase is deep in an established codebase; the planner should treat "current state of the file itself" as the pattern to preserve, and only change the specific defect)

## Scope recap (from VERIFICATION.md + UAT.md)

Two UAT items remain open after gap-closure plans 04-07/04-08/04-10/04-11:

- **UAT Test 12 — "View Failed Backup Error" (major):** re-verified 2026-04-01, still reports "no logs, only the error message" for a FAILED backup.
- **UAT Test 22 — "Scheduled Backup Execution" (blocker):** re-verified 2026-04-01, still reports the same `TypeError: Cannot read properties of undefined (reading 'id') at BackupService.runBackup` crash that Gap 11 (plan 04-11) was supposed to have fixed.

Both re-verification reports post-date the code fixes for Gap 10 (stderr emission) and Gap 11 (BackupScheduler parameter passing), yet UAT still reports failure. This is the key signal for the gap-closure plan: **either the fixes are incomplete/have a residual bug, or the manual testers re-tested against stale data (old Backup rows / stale server process)**. Read the current code below carefully — a couple of concrete residual defects were found during this pattern-mapping pass; treat them as leads, not confirmed root cause, since VERIFICATION.md explicitly says these need live-restic manual verification.

## File Classification

| File | Role | Data Flow | Analog | Match Quality |
|------|------|-----------|--------|---------------|
| `server/src/infrastructure/restic-executor.ts` | infrastructure (process wrapper) | streaming (child_process spawn → line events) | itself (already correct pattern; see Lead 1 below) | exact — do not restructure, only patch if a defect is confirmed |
| `server/src/application/backup-service.ts` | service (application) | event-driven / orchestration | itself | exact |
| `server/src/jobs/backup-scheduler.ts` | job | event-driven (cron) | `server/src/jobs/disk-checker.ts` (structural analog) + itself | exact |
| `server/src/routes/backups.ts` | route | request-response + SSE (pub-sub) | `server/src/routes/events.ts` (SSE pattern origin) + itself | exact — see Lead 2 (SSE `done` event missing `status`) |
| `client/src/routes/app/stacks/backups/[backupId].tsx` | route/page (React) | request-response + streaming | itself | exact — see Lead 3 (backup object never refreshed after SSE completes) |
| `client/src/hooks/use-backup-stream.ts` | hook | streaming (SSE via EventSource) | `client/src/hooks/use-log-stream.ts` (original analog cited in RESEARCH.md) | exact |

## Pattern Assignments

### `server/src/infrastructure/restic-executor.ts` (infrastructure, streaming)

Current `run()` (lines ~64-131) already:
- Buffers stdout line-by-line, emits each non-empty line via `onLine`.
- Buffers stderr line-by-line, emits each non-empty line via `onLine` **prefixed with `[stderr] `** (this is the Gap 10 fix, confirmed present in the current file).
- Flushes any partial stdout/stderr buffer on `close`.
- Throws (rejects) an `Error` with `.exitCode` / `.stderr` properties when the child exits non-zero (Gap 8/9 fix, confirmed present).
- `isRepositoryNotFoundError()` (lines 8-20) treats exit code 10 as a fallback but primarily matches on the stderr string `"unable to open config file"`, because real restic 0.16.x returns generic exit code 1 for a missing repo, not documented exit code 10.

**Lead 1 — verify onLine ordering guarantees:** `onLine` is called synchronously from Node's `data` event handlers, in whatever order stdout/stderr chunks arrive from the OS pipe (interleaved, not necessarily in the exact chronological order restic wrote them, since stdout and stderr are separate pipes read independently). This is fine for display but means "logs missing" symptoms are NOT explained by ordering. Do not "fix" ordering — the actual defect (if any) is downstream of this file.

**Verification-worthy defect candidate:** none found in this file. If planner finds Test 12 failures reproduce with a *freshly triggered* failing backup, the defect is almost certainly downstream (backup-service persistence or client rendering), not here.

### `server/src/application/backup-service.ts` (service, event-driven orchestration)

Reference block for `runBackup()` (lines 145-225) — this is the canonical pattern for "any backup/restore method that must always persist logLines + transition Stack status, success or failure":

```typescript
const lines: string[] = []
try {
    const onLine = (line: string): void => {
        lines.push(line)
        emitter.emit("line", line)
    }
    // ... invoke resticExecutor with onLine ...
    await this.backupRepo.update(backupRecord.id, {
        status: "COMPLETED", completedAt: new Date(), logLines: lines, resticSnapshotId: snapshotId ?? "",
    })
    await this.stackRepo.update(stack.id, {status: targetStatus})
} catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await this.backupRepo.update(backupRecord.id, {
        status: "FAILED", completedAt: new Date(), logLines: lines, errorMessage,
    })
    await this.stackRepo.update(stack.id, {status: "ERROR"})
    await this.notificationService.notify({type: "backup_failure", ...})
} finally {
    emitter.emit("done")
    backupBroadcasters.delete(backupRecord.id)
}
```

`runRestore()` (lines 232-346) follows the identical try/catch/finally shape — **use it as the analog for any restore-side gap-closure fix**, keeping both methods symmetric.

**Confirmed correct:** both catch blocks pass `logLines: lines` (not `logLines: []`), so if `lines` was populated via `onLine` before the throw, it IS persisted on failure. This means Test 12 failing to show logs implies one of:
1. The tested Backup row predates the Gap 10 stderr-emission fix (stale data — logLines column was empty at persist time because the running server binary didn't have the fix yet).
2. The failure happened at a point *before* any restic process produced output (e.g., `runHook()` pre-hook failure, or a thrown error before `onLine` fires even once) — in that case zero log lines is arguably correct behavior, and the real gap is a UX one: the client should distinguish "no restic output because it never ran" from "logs missing due to a bug", perhaps by pushing a synthetic line like `lines.push('[error] ' + errorMessage)` in the catch block before persisting, matching the pattern already used for stderr line prefixing (`[stderr] ...`) in restic-executor.ts.

Planner should treat option 2 (append a synthetic `[error] <message>` line to `lines` in the `catch` blocks of both `runBackup()` and `runRestore()`, mirroring the `[stderr]` prefix convention) as the most direct, low-risk closure for Test 12, since it guarantees the log pane is never empty on a FAILED backup regardless of when in the pipeline the failure occurred.

### `server/src/jobs/backup-scheduler.ts` (job, cron/event-driven)

Analog: `server/src/jobs/disk-checker.ts` for job registration/`jobs/index.ts` wiring shape (per RESEARCH.md Pattern 3 — already followed).

Current `runScheduledBackup()` (lines 111-141) already fetches all three `runBackup()` args via `Promise.all` (this is the Gap 11 fix) and wraps everything in nested try/catch so a scheduled failure cannot crash the process. This looks structurally correct.

**Lead — same stale-server-process theory as above:** the Test 22 "blocker" crash message quoted in UAT.md is character-for-character identical to the original Gap 11 report ("TypeError: Cannot read properties of undefined (reading 'id') at BackupService.runBackup"). Since current code no longer calls `runBackup(result.id)` (single arg) anywhere — it calls `runBackup(backupRecord, stack, repoConfig)` — this exact TypeError should not be reproducible against the current build. Planner should treat this as **highest priority to re-run live** (per VERIFICATION.md human_verification #6) before writing any further code change; if it still reproduces, add a debug log immediately before the `runBackup` call dumping `typeof backupRecord`, `typeof stack`, `typeof repoConfig` to pinpoint which of the three `Promise.all` results is actually undefined (e.g. `stackRepository.findByIdOrThrow` throwing and being swallowed somewhere, or `getBackupRepoConfig()` racing with settings not yet loaded on cold start).

### `server/src/routes/backups.ts` (route, SSE)

SSE analog origin: `server/src/routes/events.ts` (`request.raw.on('close', ...)` keepalive pattern — already followed here, lines 130-186).

**Confirmed defect (Lead 2):** the live-streaming `onDone` handler (lines 171-175) writes:
```typescript
const onDone = (): void => {
    reply.raw.write(`data: ${JSON.stringify({done: true})}\n\n`)  // <-- missing `status` field
    reply.raw.end()
    resolve()
}
```
but the already-finished branch (lines 148-154, used when the client opens the stream after completion) correctly includes `status`:
```typescript
reply.raw.write(`data: ${JSON.stringify({done: true, status: backup.status})}\n\n`)
```
The client (`use-backup-stream.ts` line 28) does `setStatus(data.status === "COMPLETED" ? "done" : "error")`. Because the live path never sends `status`, **every backup that completes while being actively watched live is reported to the client as `status: "error"`**, even on success. This is a real, confirmed bug — fix by changing `emitter.emit("done")` in `backup-service.ts` to pass the final status, and threading it through to `onDone` in `routes/backups.ts`, e.g. `emitter.emit("done", finalStatus)` / `emitter.once("done", (finalStatus: string) => { reply.raw.write(`data: ${JSON.stringify({done: true, status: finalStatus})}\n\n`) ... })`. This does not appear to be the literal defect behind Test 12/22, but it is a genuine cross-cutting bug in the same SSE code path the gap-closure plan will already be touching, and CLAUDE.md's "continuous refactoring" rule + "leave no design debt behind" directive means it should be fixed in the same plan.

### `client/src/routes/app/stacks/backups/[backupId].tsx` (page, streaming display)

**Confirmed defect (Lead 3):** `backup` state (fetched once via `getBackup()` in the mount `useEffect`, lines 59-80) is never refetched or updated after the SSE stream reports `done`. `isStreaming` (line 53) is computed from this stale `backup.status`, so if a user opens the detail page for an IN_PROGRESS backup and watches it fail live, `backup.status` remains `"IN_PROGRESS"` in React state forever (until manual page reload), meaning:
- `isStreaming` stays `true`
- `displayLines` stays bound to `streamLines` (SSE-received lines) rather than `backup.logLines`
- The FAILED-state error `<Alert>` block (lines 232-239, gated on `backup.status === "FAILED"`) **never renders**, because `backup.status` never updates from `"IN_PROGRESS"`.

This directly matches Test 12's "still no logs, only the error message" symptom in a slightly different way than expected — worth checking: if the tester viewed a backup that was IN_PROGRESS and watched it fail, they may have seen no error alert at all (contradicting "only the error message" phrasing) or, if the underlying data flow differs from what's assumed here, they may have reloaded and then seen the error alert with empty stored `logLines`. Either path is closed by the same fix: **when `useBackupStream` reports `status !== "streaming"` (done), refetch `getBackup(backupId)` to sync `backup` state with the final DB row.** Pattern to copy: the existing mount-effect's `getBackup(backupId).then(setBackup)` call (lines 64-66) — add a second `useEffect` keyed on `streamStatus` that re-invokes the same `getBackup(backupId).then(setBackup)` once `streamStatus !== "streaming"`.

### `client/src/hooks/use-backup-stream.ts` (hook, SSE)

Analog origin: `client/src/hooks/use-log-stream.ts` (cited in RESEARCH.md as the pattern this hook was adapted from). Current shape (EventSource + cleanup-on-unmount via `return () => es.close()`) is correct and matches the established hook convention — no changes expected here except possibly exposing the final `status` string from the server payload as-is (already done) once Lead 2's server-side fix lands, so `"error"` vs `"COMPLETED"`/`"FAILED"` semantics stay consistent. Consider renaming the returned `status: "streaming" | "done" | "error"` union to distinguish `"error"` (SSE connection error) from `"failed"` (backup completed with FAILED status) if the planner wants to fully close the ambiguity introduced by Lead 2 — but this is optional polish, not required for gap closure.

## Shared Patterns

### Try/catch/finally with guaranteed state transition
**Source:** `server/src/application/backup-service.ts` lines 145-225 (`runBackup`) and 232-346 (`runRestore`)
**Apply to:** Any further edits to backup/restore orchestration — always wrap in try/catch/finally, always persist `logLines` and set Stack status in both success and failure branches, always `emitter.emit("done")` in `finally`.

### SSE done-event with status
**Source:** `server/src/routes/backups.ts` lines 147-155 (already-finished branch) vs lines 171-175 (live branch, currently missing `status`)
**Apply to:** Fixing Lead 2 — make the live branch match the already-finished branch's payload shape exactly.

### Client state resync after SSE completion
**Source:** N/A — this is a missing pattern; needs to be introduced in `client/src/routes/app/stacks/backups/[backupId].tsx`, modeled on its own existing `getBackup(backupId).then(setBackup)` call.
**Apply to:** Fixing Lead 3.

## No Analog Found

None — all files in scope for this gap-closure pass are pre-existing files from prior Phase 04 plans; there are no new files to create.

## Metadata

**Analog search scope:** `server/src/infrastructure/`, `server/src/application/`, `server/src/jobs/`, `server/src/routes/`, `client/src/routes/app/stacks/backups/`, `client/src/hooks/`
**Files scanned:** 6 target files read in full + `server/src/repositories/backup-repository.ts` (partial, for `logLines`/`toDto` verification)
**Pattern extraction date:** 2026-08-30
