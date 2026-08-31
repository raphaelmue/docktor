---
phase: 04-backup-restore
verified: 2026-08-31T08:16:10Z
status: gaps_found
score: 4/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 4/5 success criteria verified (2026-08-30T21:00:00Z, pre-dates 04-18)
gaps_closed:
  - "WR-01 (SSE reconnect wipes the visible backup log): server/src/routes/backups.ts's live-emitter branch now delegates to a new streamLiveBackupLog helper (server/src/lib/sse-backup-log.ts) that replays every already-accumulated line from a new in-memory backupLogBuffers map (ensureBackupLogBuffer/getBackupLogBuffer in backup-service.ts) synchronously — snapshot, replay-writes, and emitter.on(\"line\", ...) attachment all happen in one synchronous block with no await between them — before forwarding further live lines. The client's use-backup-stream.ts setLines([]) on connect() is unchanged (still fires on every reconnect) but is now correct rather than defective, because the server always replays the full log on every subscription. The test that previously encoded the wipe as intended behavior (\"clears lines received before a reconnect...\") has been replaced with \"repopulates the full log from the server replay after a reconnect, with every line present exactly once\", which asserts the actual user-visible outcome. Independently re-derived against the current source (not trusted from 04-18-SUMMARY.md or 04-18-REVIEW.md text): read sse-backup-log.ts's replay ordering directly, confirmed disposeBackupBroadcaster deletes both backupBroadcasters and backupLogBuffers entries, confirmed runBackup/runRestore both source their `lines` array from ensureBackupLogBuffer, confirmed the route wires getBackupLogBuffer(id) ?? [] into streamLiveBackupLog with no findByIdOrThrow re-read introduced on the live branch, and ran the scoped and full unit suites myself (72/72 server backup-service+sse-backup-log tests, 18/18 client hook tests, 443/443 full server suite, 113/114 full client suite with the 1 failure confirmed a pre-existing unrelated flake — see Behavioral Spot-Checks)."
gaps_remaining:
  - truth: "User can view a list of available snapshots for a stack and restore the stack from any selected snapshot"
    status: partial
    reason: "The underlying restore mechanics (stop containers, restic restore, docker up, compose-hash resync) work and are unchanged by 04-18. However, a fresh code review of the 04-18 diff (04-18-REVIEW.md, CR-01) found — and this pass independently re-confirms by direct source reading — that POST /api/stacks/:id/restore (server/src/routes/backups.ts:79-87) synchronously `await`s the entire BackupService.runRestore() before sending its 202 reply. Two concrete, code-provable consequences follow, not merely a hypothetical or a 'never observed live' gap: (1) the whole live-SSE-replay mechanism this phase (04-15 through 04-18) invested in is structurally unreachable for restores — by the time a client can open /api/backups/:id/stream, the record is already terminal, so it always takes the already-finished branch and streamLiveBackupLog never runs for a restore; (2) runRestore() (backup-service.ts:294-413) catches all of its own errors internally, always sets a terminal status (COMPLETED or FAILED) on the Backup/Stack rows, and always resolves normally (never rejects) — so the route always returns 202, and the client's snapshots-section.tsx handleConfirmRestore (lines 64-77) always shows toast.success(\"Restore started\", {action: {label: \"View progress\", ...}}) even when the restore has already finished, and even when it has already FAILED. A user who restores a snapshot that fails sees a green 'Restore started' success toast — the only place a failure becomes visible is if they separately navigate to the backup detail page. This was carried forward from the previous verification pass as a human_verification item ('never observed live, for want of a snapshot'), but the defect does not require live observation to prove — it is demonstrable by reading routes/backups.ts and backup-service.ts's control flow and snapshots-section.tsx's toast handler directly, which is what this pass did. Escalated from human_verification to a gap for that reason."
    artifacts:
      - path: "server/src/routes/backups.ts"
        issue: "Lines 79-87: POST /api/stacks/:id/restore awaits backupService.runRestore(id, snapshotId) to full completion before calling reply.status(202).send(...), unlike the backup route (lines 34-74) which correctly splits initiateBackup() (fast, returns id) from a fire-and-forget runBackup() so a client can subscribe to the SSE stream while the backup is still IN_PROGRESS."
      - path: "server/src/application/backup-service.ts"
        issue: "runRestore() (lines 294-413) has no equivalent of initiateBackup()/runBackup()'s split — it performs the entire orchestration in one method and only returns after the try/catch/finally at line 381 reaches its finally block, by which point disposeBackupBroadcaster has already run and the record is terminal."
      - path: "client/src/routes/app/stacks/components/snapshots-section.tsx"
        issue: "handleConfirmRestore (lines 64-77) always renders toast.success(\"Restore started\", ...) on a resolved triggerRestore() promise. Because the promise only resolves after the restore has already reached a terminal state (COMPLETED or FAILED — runRestore never rejects on a restore failure, only on a truly unexpected error before the try block), a failed restore is misreported to the user as a success at the moment they learn about it."
    missing:
      - "Split runRestore the same way initiateBackup/runBackup are split: an initiateRestore() that creates the Backup row, transitions the stack, registers the broadcaster/log buffer, and returns {id} immediately, plus a fire-and-forget runRestoreProcess() invoked from the route exactly like runBackup() is today (04-18-REVIEW.md's CR-01 fix proposal, server/src/routes/backups.ts:34-74 as the existing pattern to mirror)."
      - "Once split, snapshots-section.tsx's toast should reflect only that the restore was accepted for processing (which is already true of its current wording, 'Restore started') — the real bug this closes is that recovering from that split makes streamLiveBackupLog reachable for restores, so a client that clicks 'View progress' actually sees a running restore instead of an already-terminal one."
      - "Add automated coverage (route or integration level) asserting the restore route returns 202 before the restore reaches a terminal state — the current unit tests only exercise runRestore() in isolation, not the route's timing contract."
    reason_for_escalation: "04-18-REVIEW.md (fresh, standard-depth review of the 04-18 diff) independently found and confirmed this at Critical severity. This verification independently re-derived it against the current source rather than trusting the review's narrative, and found it demonstrable by direct code reading (control-flow tracing plus the toast call site), not something that requires human/live observation. The previous verification pass's classification as human_verification ('never observed live, for want of a snapshot') undersold the defect: it is not merely unobserved, it is structurally guaranteed to misrepresent restore state to the user on every restore, and to leave the phase's SSE-replay investment (04-15/04-16/04-17/04-18) permanently dead code on the restore path. This is a pre-existing defect, not a regression introduced by 04-18 — 04-18 explicitly and correctly scoped it out of its own objective (WR-01 was the SSE live-branch replay, not restore-flow synchronicity) — but a phase re-verification assesses the whole phase's goal (\"...restore from a snapshot without manual restic CLI knowledge\"), not only the most recent gap-closure plan's stated scope."
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
**Status:** gaps_found
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
| 4 | User can view a list of available snapshots for a stack and restore the stack from any selected snapshot | ✗ FAILED (partial) | `GET /api/stacks/:id/snapshots` is unchanged and works. The restore action itself mechanically succeeds or fails correctly server-side (stop → restore → redeploy → status/ERROR handling all function). **However**, `POST /api/stacks/:id/restore` blocking synchronously on the full restore before its 202 reply means this phase's SSE-replay investment (including this round's WR-01 fix) never activates for restores, and a **failed** restore is misreported to the client as a "Restore started" success toast. Escalated to a gap in this pass — see Gaps Summary. |
| 5 | A backup failure transitions the stack to ERROR state and triggers a notification if SMTP is configured | ✓ VERIFIED | `runBackup()`/`runRestore()` catch blocks set stack status to `"ERROR"` and call `notificationService.notify(...)`. `abortBackup()` extends the same guarantee. Untouched by 04-18. |

**Score:** 4/5 success criteria verified (Success Criterion #2 is now fully closed after 04-18; Success Criterion #4 is newly escalated to partial in this pass on independently-confirmed evidence)

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
| `POST /api/stacks/:id/restore` | `GET /api/backups/:id/stream` live branch | client navigates via the "View progress" toast action after the restore route resolves | ✗ NOT REACHABLE | `routes/backups.ts:79-87` awaits `runRestore` to a terminal state before replying, so by the time a client can call the stream endpoint, the record is already terminal and the route always takes the already-finished branch (lines 161-170) — `streamLiveBackupLog` never executes for a restore. |

### Data-Flow Trace (Level 4) — SSE Replay Path

| Stage | Data Variable | Source | Produces Real Data | Status |
|-------|---------------|--------|---------------------|--------|
| Server accumulator | `lines` array in `runBackup`/`runRestore` | `ensureBackupLogBuffer(id)` | Same array later persisted as `logLines` — zero-delta, no duplicate allocation | ✓ FLOWING |
| SSE live branch | `buffered` param to `streamLiveBackupLog` | `getBackupLogBuffer(id) ?? []` | Real in-memory accumulator, not a stale DB read | ✓ FLOWING |
| SSE live branch | replay + live frames written to `reply.raw` | `streamLiveBackupLog`'s synchronous replay-then-listen block | No line dropped or duplicated across the boundary — proven by a dedicated passing test | ✓ FLOWING |
| Client hook | `lines` state after a reconnect | `setLines([])` then re-population from the replayed+live SSE frames | Ends holding the complete log exactly once, per the replacement test | ✓ FLOWING |
| **Restore path** | subscriber's view of `streamLiveBackupLog`'s replay/live mechanism | Never invoked — the record is terminal before any client can subscribe | No live data ever flows through this mechanism for a restore | ✗ DISCONNECTED (new gap, restore path only) |
| **Restore path** | client's toast state on a failed restore | `triggerRestore()`'s resolved promise, unconditionally mapped to `toast.success("Restore started", ...)` | The promise always resolves (even on restore failure), so the toast always renders as success regardless of actual outcome | ✗ DISCONNECTED (new gap) |

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
| BCK-09 | 04-01, 04-03, 04-04, 04-06, 04-15, 04-16, 04-17 | ⚠️ PARTIAL | Restore orchestration (`stop → restore → redeploy`) itself is correct and unchanged. But the route-level synchronicity defect (see gaps_remaining) means the restore's status/progress is misreported to the client on failure, and the phase's own SSE-replay mechanism can never be exercised for a restore. Downgraded from the previous pass's ✓ SATISFIED on independently-confirmed evidence in this pass. |
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

See frontmatter `human_verification` — 2 items remain: a live re-run of UAT Test 22 (manual-route repository-missing guard, still only unit-tested, unchanged by 04-18), and — reframed from the previous pass — a live end-to-end restore observation that can only be meaningfully performed *after* the restore-synchronicity gap above is code-fixed (today, there is nothing to observe live: the record is always already terminal by the time a client could watch it).

## Gaps Summary

Plan 04-18 correctly and verifiably closed WR-01, the sole remaining gap from the previous verification pass. Every claim in 04-18-SUMMARY.md about the replay mechanism, the parallel `backupLogBuffers` map, and the replacement client test was independently re-derived against the current source in this pass (not trusted from the summary's narrative) and is backed by passing regression tests I ran myself: a reconnect during a running manual backup now shows the complete log with no lines lost and no lines duplicated. Success Criterion #2 is now fully verified.

However, a fresh code review of the 04-18 diff surfaced a Critical finding (its CR-01) on code the plan touched only incidentally — the restore route's full synchronicity — which this pass independently re-confirmed by direct code reading and is escalating from the previous pass's `human_verification` classification to a blocking `gaps_remaining` entry against ROADMAP Success Criterion #4 / requirement BCK-09. The defect is not merely "unobserved live": `POST /api/stacks/:id/restore` always blocks until the restore reaches a terminal state before its 202 reply, which (a) makes this phase's entire SSE-replay investment (04-15 through 04-18) permanently unreachable for restores, and (b) causes a **failed** restore to be reported to the user as a "Restore started" success toast, because `runRestore()` never rejects on a restore failure — it always resolves normally after persisting a terminal status. Both facts are provable by reading `routes/backups.ts`, `backup-service.ts`, and `snapshots-section.tsx` directly, with no live/human observation required to establish them.

Recommend a follow-up gap-closure plan that splits `runRestore` into an `initiateRestore()`/`runRestoreProcess()` pair mirroring the existing `initiateBackup()`/`runBackup()` split, so the route can return `202` immediately and a client can subscribe to the SSE stream — including the WR-01 replay fix this round delivered — while a restore is still in progress, and so a failed restore is never misreported as a success.

---

_Verified: 2026-08-31T08:16:10Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap-closure plan 04-18, incorporating independent re-derivation of WR-01's closure and an independent escalation decision on 04-18-REVIEW.md's CR-01 finding_
