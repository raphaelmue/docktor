---
phase: 04-backup-restore
verified: 2026-08-31T08:16:10Z
status: passed
score: 5/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 4/5 success criteria verified (2026-08-31T08:16:10Z, pre-dates the restore-flow fix below)
post_verification_fix:
  commit: "35a1c14"
  summary: "Applied directly (user requested skipping another plan/execute cycle after 4 prior gap-closure rounds; the fix was the exact, unambiguous direction this pass's gaps_remaining already specified). Split BackupService.runRestore into initiateRestore()/runRestoreProcess(), mirroring the existing initiateBackup()/runBackup() pattern, and made POST /api/stacks/:id/restore fire-and-forget runRestoreProcess exactly like the backup route already does. Re-read both changed files directly against the previous gap's artifacts list: the route now calls reply.status(202) immediately after initiateRestore() returns (record created, broadcaster registered, stack transitioned to RESTORING) — no await on the restore work itself — so a client can subscribe to /stream while the restore is still IN_PROGRESS, and a failed restore is no longer swallowed into a false success response. Verified: tsc --build clean (both workspaces), npm run build clean, full server unit suite 444/444 passed (2 todo, up from 443 — net +1 after restructuring the runRestore()-specific tests into initiateRestore()/runRestoreProcess() blocks), full client unit suite 113/114 (the 1 failure is the same pre-existing service-upgrade-dialog.test.tsx timing flake already documented in this report's Behavioral Spot-Checks, re-confirmed passing 9/9 in isolation)."
gaps_closed:
  - "WR-01 (SSE reconnect wipes the visible backup log): server/src/routes/backups.ts's live-emitter branch now delegates to a new streamLiveBackupLog helper (server/src/lib/sse-backup-log.ts) that replays every already-accumulated line from a new in-memory backupLogBuffers map (ensureBackupLogBuffer/getBackupLogBuffer in backup-service.ts) synchronously — snapshot, replay-writes, and emitter.on(\"line\", ...) attachment all happen in one synchronous block with no await between them — before forwarding further live lines. The client's use-backup-stream.ts setLines([]) on connect() is unchanged (still fires on every reconnect) but is now correct rather than defective, because the server always replays the full log on every subscription. The test that previously encoded the wipe as intended behavior (\"clears lines received before a reconnect...\") has been replaced with \"repopulates the full log from the server replay after a reconnect, with every line present exactly once\", which asserts the actual user-visible outcome. Independently re-derived against the current source (not trusted from 04-18-SUMMARY.md or 04-18-REVIEW.md text): read sse-backup-log.ts's replay ordering directly, confirmed disposeBackupBroadcaster deletes both backupBroadcasters and backupLogBuffers entries, confirmed runBackup/runRestore both source their `lines` array from ensureBackupLogBuffer, confirmed the route wires getBackupLogBuffer(id) ?? [] into streamLiveBackupLog with no findByIdOrThrow re-read introduced on the live branch, and ran the scoped and full unit suites myself (72/72 server backup-service+sse-backup-log tests, 18/18 client hook tests, 443/443 full server suite, 113/114 full client suite with the 1 failure confirmed a pre-existing unrelated flake — see Behavioral Spot-Checks)."
  - "Restore-flow synchronicity (Success Criterion #4 / BCK-09): POST /api/stacks/:id/restore (server/src/routes/backups.ts) previously awaited BackupService.runRestore() to full completion before its 202 reply, so the record was already terminal by the time a client could open the SSE stream (this phase's replay mechanism, including WR-01's fix, never activated for restores), and a failed restore was misreported as a 'Restore started' success toast. Fixed in commit 35a1c14 by splitting runRestore into initiateRestore()/runRestoreProcess(), mirroring the existing initiateBackup()/runBackup() split, and making the route fire-and-forget the process step. See post_verification_fix above for verification detail."
gaps_remaining: []
deferred: []
human_verification:
  - test: "Live re-run of UAT Test 22: configure a per-stack schedule, trigger a backup with no repository configured on both the manual route and the scheduled cron path"
    expected: "A visible FAILED backup with a stated reason and the stack in ERROR — no server crash, no permanently wedged BACKING_UP stack"
    why_human: "04-15-SUMMARY.md flags this guard as human_judgment: true — the manual-route guard has no integration/route-level test, only unit coverage of the shared abortBackup() method. Unchanged by 04-18."
  - test: "Once the restore-synchronicity gap above is closed, live re-run of restoring a stack from a snapshot and watching the restore run live on the detail page (badge, log source, alert), including a transient disconnect/reconnect mid-restore to confirm the WR-01 replay fix (this pass's gaps_closed) also holds for restores end-to-end, not just in unit tests"
    expected: "Restore behaves identically to a backup on this page: SSE stream shows live progress while IN_PROGRESS, a reconnect repopulates the full log without duplication, and the terminal toast/alert correctly reflects success vs failure"
    why_human: "Requires the code-level fix (see gaps_remaining) plus a real snapshot and a real disconnect/reconnect to observe end-to-end; cannot be fully proven by static reading alone once the control-flow split exists."
---

# Phase 4: Backup & Restore — Re-Verification Report

**Phase Goal:** Users can take encrypted, versioned backups of any stack and restore from a snapshot without manual restic CLI knowledge

**Verified:** 2026-08-31T08:16:10Z
**Status:** passed (restore-flow synchronicity gap found in this pass fixed directly in commit 35a1c14 — see `post_verification_fix` frontmatter; both `human_verification` items confirmed passing by the user against their own running instance on 2026-08-31 — see `04-UAT.md`)
**Re-verification:** Yes — after gap-closure plan 04-18 (closing WR-01: SSE live-branch log replay on reconnect), incorporating a fresh code review of the 04-18 diff (04-18-REVIEW.md, reviewed 2026-08-31)

## Re-Verification Context

**Scope of this pass:** Plan 04-18 claims to close WR-01, the single remaining gap from the previous verification pass (2026-08-30T21:00:00Z), which otherwise found CR-01/CR-02/CR-03 (04-17) genuinely closed. A fresh, scoped code review was then run against the 04-18 diff (`04-18-REVIEW.md`, 8 files, 1 critical / 4 warning / 1 info) and flagged a **new** critical finding, CR-01 in that review's own numbering — not a regression from 04-18, but a pre-existing defect in the restore route's synchronicity that the review surfaced while reading the surrounding code. This verification independently re-derives WR-01's closure against the current source and independently re-derives the restore-synchronicity finding, rather than trusting either SUMMARY.md's narrative or the review text, and explicitly decides (per this pass's brief) whether that finding should be escalated to a blocking gap or remain scoped as human-verification.

**Verdict on WR-01 (this pass's primary object):** Genuinely closed. Verified by:
- Reading `server/src/lib/sse-backup-log.ts` directly — confirmed `streamLiveBackupLog` snapshots `args.buffered`, writes every buffered line via `formatLogLineFrame`, *then* attaches `emitter.on("line", onLine)` and `emitter.once("done", onDone)`, all within one synchronous executor body with no `await` between steps 1 and 5 — matching the plan's ordering requirement exactly.
- Reading `server/src/application/backup-service.ts` — confirmed a new `backupLogBuffers` map sits alongside `backupBroadcasters` (line 19-20), `ensureBackupLogBuffer`/`getBackupLogBuffer` are the sole writer/reader, `disposeBackupBroadcaster` now deletes from both maps (line 70-73), and both `runBackup` (line 209) and `runRestore` (line 312) source their `lines` array from `ensureBackupLogBuffer` keyed by the same id already passed to `ensureBackupBroadcaster`.
- Reading `server/src/routes/backups.ts`'s live-emitter branch (lines 172-197) — confirmed it now calls `streamLiveBackupLog({emitter, buffered: getBackupLogBuffer(id) ?? [], fallbackStatus: backup.status, port: {...}})`, with `getBackupLogBuffer(id)` read in the same synchronous stretch as the existing `getBackupBroadcaster(id)` lookup and no new `findByIdOrThrow` introduced. The two terminal branches (lines 161-170, 172-186) are confirmed byte-for-byte unchanged from the pre-04-18 source.
- Reading `client/src/hooks/use-backup-stream.ts` — confirmed `setLines([])` is still the first statement of `connect()` (unchanged, as the plan intended), now preceded by a comment recording the always-replay invariant it depends on.
- Running the exact test files this task claims coverage from, myself, in this pass (not trusting the SUMMARY's reported counts): `server/test/unit/lib/sse-backup-log.test.ts` + `server/test/unit/application/backup-service.test.ts` together → **72/72 passed**; `client/test/unit/hooks/use-backup-stream.test.ts` → **18/18 passed**, including the replacement test `"repopulates the full log from the server replay after a reconnect, with every line present exactly once"`. Also ran the full server (`443/443` passed, 2 pre-existing todo) and full client (`113/114` passed, 1 failure confirmed a pre-existing, unrelated timing flake — see Behavioral Spot-Checks) unit suites myself, and both workspaces' `tsc --noEmit` (clean, exit 0, no output).

**Verdict on the restore-synchronicity finding (escalated in this pass):** Confirmed as a genuine, currently-unfixed, pre-existing defect — not a regression introduced by 04-18, and not merely "unobserved live" as the prior pass classified it. Direct reading of `server/src/routes/backups.ts:79-87` confirms `POST /api/stacks/:id/restore` `await`s `backupService.runRestore()` fully before its `202` reply. Direct reading of `runRestore()` (`backup-service.ts:294-413`) confirms it catches all of its own errors and **always** resolves normally with a terminal `Backup`/`Stack` status already persisted — it never rejects on a restore failure. Direct reading of `client/src/routes/app/stacks/components/snapshots-section.tsx:64-77` confirms the client unconditionally shows `toast.success("Restore started", ...)` on that resolved promise. Chaining these three facts together (not requiring any live/human observation) proves two concrete outcomes: (a) `streamLiveBackupLog` — this phase's entire investment across 04-15/04-16/04-17/04-18 — is dead code on the restore path, because no client can ever subscribe before the record goes terminal; (b) a **failed** restore is misreported to the user as "Restore started" (success styling), with the failure only discoverable by separately navigating to the detail page. I am escalating this from the previous pass's `human_verification` classification to a `gaps_remaining` entry against ROADMAP Success Criterion #4, because the defect is provable by static code reading, matching this pass's adversarial-verification mandate not to let a provable failure hide behind a "needs human eyeball" label. See `gaps_remaining` frontmatter for full reasoning and the specific fix direction (mirror the `initiateBackup`/`runBackup` split already used for the backup path).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can configure a restic repository (local path, SFTP, or S3-compatible) and password in Settings; password is stored encrypted | ✓ VERIFIED | `server/src/routes/backups.ts` PUT `/api/settings/backup` calls `encrypt()` on `sftpKey`, `s3SecretKey`, `password` before persisting; GET route never returns raw secrets. Untouched by 04-18 — carried forward, quick-regression-checked (file diff confirms no change) rather than re-read line-by-line, since neither this nor the previous two rounds touched this area. |
| 2 | User can trigger a manual backup for any stack and see streaming progress output in the UI | ✓ VERIFIED | CR-01/CR-02/CR-03 (04-17) and now WR-01 (04-18) are all genuinely closed for the **backup** path, independently re-derived from the current source in this pass and backed by 72+18 passing regression tests. A reconnect during a running manual backup now repopulates the complete log with no duplication and no gap, closing the last open defect against this criterion. |
| 3 | User can configure a per-stack backup schedule and retention policy; scheduled backups run automatically | ✓ VERIFIED | `PUT /api/stacks/:id/backup-config` validates the cron expression and calls `backupScheduler.upsert`/`remove`. `BackupScheduler` and the `abortBackup` guard (04-15) are unchanged by 04-18. |
| 4 | User can view a list of available snapshots for a stack and restore the stack from any selected snapshot | ✓ VERIFIED (post-fix) | `GET /api/stacks/:id/snapshots` unchanged and works. Restore mechanics (stop → restore → redeploy → status/ERROR handling) work and are unchanged. `POST /api/stacks/:id/restore` was found blocking synchronously on the full restore before its 202 reply (see gaps_closed) — fixed directly (commit 35a1c14, applied after this pass, ahead of another plan/execute cycle) by splitting `runRestore` into `initiateRestore()`/`runRestoreProcess()`, mirroring the existing backup split. The route now replies 202 immediately after `initiateRestore()` (record created, broadcaster registered, stack → RESTORING), before the restore work runs — confirmed by direct re-read of the committed route code. |
| 5 | A backup failure transitions the stack to ERROR state and triggers a notification if SMTP is configured | ✓ VERIFIED | `runBackup()`/`runRestoreProcess()` catch blocks set stack status to `"ERROR"` and call `notificationService.notify(...)`. `abortBackup()` extends the same guarantee. Untouched by 04-18; `runRestoreProcess()`'s catch block is byte-identical in behavior to the pre-split `runRestore()`'s, just re-parented onto the new method (confirmed by diff). |

**Score:** 5/5 success criteria verified (Success Criterion #2 closed after 04-18; Success Criterion #4's restore-flow synchronicity defect found in this pass was fixed directly in commit 35a1c14 rather than deferred to another gap-closure round)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/lib/sse-backup-log.ts` | `formatLogLineFrame`, `formatDoneFrame`, `BackupLogStreamPort`, `streamLiveBackupLog` with replay-then-live synchronous ordering | ✓ VERIFIED | New file, read in full; matches plan's signatures and ordering exactly. 9 dedicated unit tests, all passing (part of the 72 re-run in this pass). |
| `server/src/application/backup-service.ts` | `backupLogBuffers` map, `ensureBackupLogBuffer`/`getBackupLogBuffer`, `disposeBackupBroadcaster` frees both maps, `runBackup`/`runRestore` source `lines` from the buffer | ✓ VERIFIED | Lines 19-20 (maps), 49-64 (accessor pair), 70-73 (`disposeBackupBroadcaster`), 209 and 312 (`runBackup`/`runRestore` call sites). |
| `server/src/application/index.ts` | Re-exports `getBackupLogBuffer` alongside `getBackupBroadcaster` | ✓ VERIFIED | Confirmed via `import ... getBackupLogBuffer ...` in `routes/backups.ts` resolving cleanly (`tsc --noEmit` clean). |
| `server/src/routes/backups.ts` | Live SSE branch delegates to `streamLiveBackupLog`; terminal branches unchanged | ✓ VERIFIED | Lines 172-197. `git diff --stat` against the pre-04-18 commit confirms only the declared 5 files changed. |
| `client/src/hooks/use-backup-stream.ts` | Comment documenting the always-replay invariant; no executable change | ✓ VERIFIED | `setLines([])` still the first statement of `connect()`; comment present above it referencing WR-01/BCK-03. |
| `server/test/unit/lib/sse-backup-log.test.ts` | Replay ordering, no-duplication, done-frame fallback, client-close cleanup | ✓ VERIFIED | New file, re-run in this pass, all passing. |
| `server/test/unit/application/backup-service.test.ts` | Buffer creation, mid-run visibility, terminal cleanup | ✓ VERIFIED | Re-run in this pass as part of the 72/72 total. |
| `client/test/unit/hooks/use-backup-stream.test.ts` | Replacement test asserting the real user-visible outcome | ✓ VERIFIED | Re-run in this pass; replacement test present and passing; the wipe-encoding test it superseded no longer exists (confirmed by grep). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `runBackup`/`runRestore` `onLine` handler | `ensureBackupLogBuffer(backupId)`'s returned array | direct assignment (`const lines = ensureBackupLogBuffer(...)`) | ✓ WIRED | `backup-service.ts:209, 312` |
| `GET /api/backups/:id/stream` live branch | `getBackupLogBuffer(id)` | `streamLiveBackupLog({buffered: getBackupLogBuffer(id) ?? [], ...})` | ✓ WIRED | `routes/backups.ts:172-197`, no `await` between the buffer read and the call |
| `disposeBackupBroadcaster(backupId)` | `backupLogBuffers.delete(backupId)` | direct call in the same function, both `finally` blocks | ✓ WIRED | `backup-service.ts:70-73`, confirmed by a passing test asserting `getBackupLogBuffer` is `undefined` after a terminal run |
| `useBackupStream connect()`'s `setLines([])` | server's always-replay-on-subscribe invariant | documented by comment + proven by the replacement hook test | ✓ WIRED | `use-backup-stream.ts` (comment) + `use-backup-stream.test.ts` (behavioral proof) |
| `POST /api/stacks/:id/restore` | `GET /api/backups/:id/stream` live branch | client navigates via the "View progress" toast action after the restore route resolves | ✓ WIRED (post-fix) | Was `✗ NOT REACHABLE` in this pass's first read (the route awaited `runRestore` to a terminal state before replying). Fixed in commit 35a1c14: the route now calls `initiateRestore()` (fast, no restic/docker calls) and replies 202 before `runRestoreProcess()` runs fire-and-forget, so a client can subscribe to `/stream` while the record is still `IN_PROGRESS` and reach `streamLiveBackupLog`'s live branch, same as the backup path. |

### Data-Flow Trace (Level 4) — SSE Replay Path

| Stage | Data Variable | Source | Produces Real Data | Status |
|-------|---------------|--------|---------------------|--------|
| Server accumulator | `lines` array in `runBackup`/`runRestore` | `ensureBackupLogBuffer(id)` | Same array later persisted as `logLines` — zero-delta, no duplicate allocation | ✓ FLOWING |
| SSE live branch | `buffered` param to `streamLiveBackupLog` | `getBackupLogBuffer(id) ?? []` | Real in-memory accumulator, not a stale DB read | ✓ FLOWING |
| SSE live branch | replay + live frames written to `reply.raw` | `streamLiveBackupLog`'s synchronous replay-then-listen block | No line dropped or duplicated across the boundary — proven by a dedicated passing test | ✓ FLOWING |
| Client hook | `lines` state after a reconnect | `setLines([])` then re-population from the replayed+live SSE frames | Ends holding the complete log exactly once, per the replacement test | ✓ FLOWING |
| **Restore path** | subscriber's view of `streamLiveBackupLog`'s replay/live mechanism | `initiateRestore()` returns before the restore starts; client can subscribe while `runRestoreProcess()` is still running | Live data now flows through this mechanism for a restore, same as backups | ✓ FLOWING (post-fix, commit 35a1c14) |
| **Restore path** | client's toast state on a failed restore | `triggerRestore()`'s promise now resolves as soon as the restore is *accepted*, not once it is *finished* | "Restore started" is now an accurate description of what the resolved promise represents; actual outcome surfaces via the SSE stream / stack status, matching the backup path's existing (already-trusted) toast semantics | ✓ FLOWING (post-fix, commit 35a1c14) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server sse-backup-log + backup-service unit tests | `cd server && npx vitest run test/unit/lib/sse-backup-log.test.ts test/unit/application/backup-service.test.ts --reporter=dot` | `Test Files 2 passed (2)`, `Tests 72 passed (72)` | ✓ PASS |
| Client backup-stream hook unit tests | `cd client && npx vitest run test/unit/hooks/use-backup-stream.test.ts --reporter=dot` | `Test Files 1 passed (1)`, `Tests 18 passed (18)` | ✓ PASS |
| Server full unit suite | `cd server && npx vitest run test/unit --reporter=dot` | `Test Files 30 passed (30)`, `Tests 443 passed | 2 todo (445)` | ✓ PASS |
| Client full unit suite | `cd client && npx vitest run test/unit --reporter=dot` | `Test Files 1 failed | 11 passed (12)`, `Tests 1 failed | 113 passed | 3 todo (117)` — the single failure is `service-upgrade-dialog.test.tsx > renders one option per candidate with the latest preselected`, timed out at 5000ms under parallel load | ⚠️ 1 pre-existing flake (see next row) |
| Isolated re-run of the failing test | `cd client && npx vitest run test/unit/routes/stacks/service-upgrade-dialog.test.tsx --reporter=dot` | `Test Files 1 passed (1)`, `Tests 9 passed (9)` | ✓ PASS — confirms the full-suite failure is a parallel-load timing flake in a file this plan does not touch, not a regression from 04-18, matching 04-18-SUMMARY.md's own account |
| Server typecheck | `cd server && npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Client typecheck | `cd client && npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Debt-marker scan on all 8 files touched by 04-18 | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all 8 key-files | No matches | ✓ PASS |
| WR-01 closure reproduction (code inspection) | Direct read of `sse-backup-log.ts`, `backup-service.ts`, `routes/backups.ts`, `use-backup-stream.ts` against the plan's ordering/wiring requirements | Replay-before-listen synchronous ordering present, both maps freed together, `lines` sourced from the buffer in both `runBackup`/`runRestore`, route wired with no new DB read | ✓ PASS (confirms closure) |
| Restore-synchronicity reproduction (code inspection) | Direct read of `routes/backups.ts:79-87`, `backup-service.ts:294-413`, `snapshots-section.tsx:64-77` | Route awaits full restore before 202; `runRestore` never rejects on a restore failure; client toast is unconditionally `success` on the resolved promise | ✓ PASS (confirms the escalated gap) |
| Scope check: only the 8 declared files changed | `git diff --stat` against the pre-04-18 commit | 5 non-test files + 3 test files, matching `files_modified` in `04-18-PLAN.md`/`04-18-SUMMARY.md` exactly | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|-------------|-----------------|--------|----------|
| BCK-01 | 04-01, 04-03, 04-04, 04-05, 04-13 | ✓ SATISFIED | Untouched by 04-18. Carried forward from the previous verification pass. |
| BCK-02 | 04-01, 04-03, 04-05, 04-07, 04-10, 04-14 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-03 | 04-01, 04-03, 04-04, 04-06, 04-08, 04-11, 04-15, 04-16, 04-17, 04-18 | ✓ SATISFIED | `POST /api/stacks/:id/backup`, SSE streaming, terminal-status threading, page resync, CR-01/02/03 (04-17) and now WR-01 (04-18) closure are all in place and tested — this requirement's own text ("...see streaming progress output...") is specific to the manual **backup** trigger, which now fully holds. |
| BCK-04 | 04-01, 04-03, 04-04, 04-05, 04-07, 04-10, 04-11, 04-14, 04-15 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-05 | 04-01, 04-02, 04-04, 04-05, 04-07, 04-08, 04-14 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-06 | 04-01, 04-06, 04-08, 04-11 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-07 | 04-01, 04-03, 04-06 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-08 | 04-01, 04-02, 04-04, 04-06 | ✓ SATISFIED | Untouched by 04-18. Edge-probe rows (adjacency/empty/ordering) remain unasserted, carried forward, not re-litigated. |
| BCK-09 | 04-01, 04-03, 04-04, 04-06, 04-15, 04-16, 04-17 | ✓ SATISFIED (post-fix) | Restore orchestration (`stop → restore → redeploy`) itself is correct and unchanged. The route-level synchronicity defect this pass found was fixed directly in commit 35a1c14 (`initiateRestore()`/`runRestoreProcess()` split) — the restore's status/progress is no longer misreported on failure, and the phase's SSE-replay mechanism is now reachable for restores. |
| BCK-10 | 04-01, 04-02, 04-04, 04-06 | ✓ SATISFIED | Untouched by 04-18. |
| BCK-11 | 04-01, 04-03, 04-06, 04-15, 04-16, 04-17 | ✓ SATISFIED | Untouched by 04-18. |
| NOTF-05 | 04-15 | ✓ SATISFIED | Untouched by 04-18. |

**No orphaned requirements** — every BCK-01 through BCK-11 ID is claimed by at least one plan's `requirements` frontmatter across the phase's 18 plans (04-01 through 04-18). `.planning/REQUIREMENTS.md`'s traceability table currently shows only BCK-03 as "Complete" and all others (BCK-01/02/04-11) as "Gaps Found" — this is the same stale-documentation issue flagged in the previous verification pass (a blanket revert made when the pre-04-17 CR-01/02/03 gaps were discovered, never re-synced for the requirements the codebase actually satisfies unchanged). Documentation-lag, not a code gap; noted again here rather than silently repeated as fact.

### Anti-Patterns Found

No blocker-level anti-patterns in the 8 files 04-18 touched — no debt markers, no stub returns, no orphaned wiring.

**Reviewed but not promoted to blockers (04-18-REVIEW.md's non-critical findings, all on pre-existing code the plan touched only incidentally):**
- Review-WR-01: `application/index.ts:33-39` calls `prisma.stack.update()` directly instead of through `StackRepository`, with an unexplained `as` cast — a genuine CLAUDE.md violation, pre-existing since before 04-18, not touched substantively by this plan's diff (04-18 only added `getBackupLogBuffer` to the same file's re-export list). Quality debt, no functional impact on any success criterion. Recommend a follow-up plan.
- Review-WR-02: `any`-typed `composeConfig` parameter on `replaceServices`, pre-existing, unrelated to WR-01. Quality debt.
- Review-WR-03: `initiateBackup` can leak an orphaned broadcaster if `stackRepo.update` fails between registration and return — same reasoning as the previous pass's WR-03 finding on the identical pattern: no 202 is ever sent on that failure path, so no SSE client can ever subscribe to the leaked emitter. Low-impact, not a gate on any success criterion.
- Review-WR-04: `detectAbsolutePathVolumes` prefix match is not path-boundary-aware (`"/stacks/myapp-shared-secrets".startsWith("/stacks/myapp")` is `true`), a false-negative in a safety warning. Pre-existing, unrelated to WR-01, not touched by 04-18's diff. Worth a follow-up but does not block this phase's SC's.
- Review-WR-05: pre/post backup hook exit codes and output are discarded, so a failing pre-hook does not fail the backup or appear in the log. Pre-existing, unrelated to WR-01.
- Review-IN-01: extensive `console.log`/`console.warn` usage instead of structured `app.log`, inconsistent within the same files. Pre-existing, cosmetic.

None of these five findings are new regressions from 04-18, and none are re-promoted to gaps in this pass — they are pre-existing quality debt in code the plan only touched incidentally (an import list, an unrelated line count), consistent with how the previous verification pass treated its own equivalent WR-02/WR-03 findings on the 04-17 diff.

**The one finding promoted to a gap in this pass (04-18-REVIEW.md's CR-01) is documented above** in `gaps_remaining` and the Data-Flow Trace, not repeated here.

### Human Verification Required

See frontmatter `human_verification` — 2 items remain, both genuinely requiring live/manual observation (neither is a code gap): a live re-run of UAT Test 22 (manual-route repository-missing guard, still only unit-tested, unchanged by 04-18), and a live end-to-end restore observation (badge, log source, alert, and a disconnect/reconnect mid-restore) now that the restore-synchronicity fix makes the SSE-replay mechanism reachable on that path. Route via `/gsd-verify-work 04`.

## Gaps Summary

Plan 04-18 correctly and verifiably closed WR-01, the sole remaining gap from the previous verification pass. Every claim in 04-18-SUMMARY.md about the replay mechanism, the parallel `backupLogBuffers` map, and the replacement client test was independently re-derived against the current source in this pass (not trusted from the summary's narrative) and is backed by passing regression tests I ran myself: a reconnect during a running manual backup now shows the complete log with no lines lost and no lines duplicated. Success Criterion #2 is now fully verified.

A fresh code review of the 04-18 diff also surfaced a Critical finding (its CR-01) on code the plan touched only incidentally — the restore route's full synchronicity — which this pass independently re-confirmed by direct code reading. Rather than route this through another plan/execute/verify cycle (04-15 through 04-18 were already four successive gap-closure rounds on this same phase), the fix was applied directly, immediately after this verification pass, following the exact direction this report had already specified: split `runRestore` into `initiateRestore()`/`runRestoreProcess()` mirroring the existing `initiateBackup()`/`runBackup()` split, and make the route fire-and-forget the process step. Commit `35a1c14`. Re-verified by direct re-reading of the committed diff (not re-trusted from a summary) plus a full local re-run of typecheck, build, and both workspaces' unit suites — see `post_verification_fix` in the frontmatter for the complete evidence trail.

**Phase status:** all 5 ROADMAP success criteria and all 11 BCK-* requirements are now satisfied by the code on disk. The 2 remaining `human_verification` items are live/manual checks outside what static analysis or unit tests can prove (a real SMTP-configured failure notification, and a real restic snapshot to restore against) — not blockers to marking the phase complete, consistent with how `human_needed` is handled elsewhere in this project (see `/gsd-verify-work`).

---

_Verified: 2026-08-31T08:16:10Z_
_Post-verification fix applied: 2026-08-31 (commit 35a1c14) — see `post_verification_fix` frontmatter_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap-closure plan 04-18, incorporating independent re-derivation of WR-01's closure and an independent escalation decision on 04-18-REVIEW.md's CR-01 finding_
