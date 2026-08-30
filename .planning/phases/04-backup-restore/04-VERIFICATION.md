---
phase: 04-backup-restore
verified: 2026-08-30T21:00:00Z
status: gaps_found
score: 4/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 4/5 success criteria verified (2026-08-30T18:15:00Z, pre-dates 04-17)
gaps_closed:
  - "CR-01 (SSE disconnect permanently freezes the page): useBackupStream now reconnects with bounded backoff (BACKUP_STREAM_RECONNECT_DELAYS_MS: 1/2/4/8/15s) once the browser's native EventSource retry gives up, and the backup detail page adds a bounded poll effect (5s interval, 60-poll ceiling) that keeps re-reading the record while disconnected and IN_PROGRESS — independently reproduced against the current source and confirmed by 12 passing unit tests across the hook and the page."
  - "CR-02 (broadcaster-registration race misreports an in-progress backup as failed): ensureBackupBroadcaster()/disposeBackupBroadcaster() are now the sole writer/remover of the module-level map; initiateBackup registers the emitter synchronously before returning (before the 202 response is sent), closing the window a client could race through. The SSE route's missing-broadcaster branch now re-reads the record and replays its stored log lines instead of trusting the pre-check status. abortBackup emits a terminal done from a finally block so a backup aborted before restic ever runs still reaches a subscribed client. A done frame carrying a present-but-non-terminal status (e.g. IN_PROGRESS) now maps to 'disconnected', never 'failed' — independently reproduced and confirmed by dedicated passing unit tests on both the server and client."
  - "CR-03 (blank title/breadcrumb on every IN_PROGRESS backup): shortId fallback changed from ?? to ||, which correctly treats the empty string initiateBackup persists as absent — independently reproduced and confirmed by passing tests for both MANUAL and RESTORE-trigger rows."
gaps_remaining:
  - truth: "User can trigger a manual backup for any stack and see streaming progress output in the UI"
    status: partial
    reason: "CR-01/CR-02/CR-03 are genuinely closed (see gaps_closed above). However, a fresh code review of the 04-17 diff (04-REVIEW.md, WR-01) found a new, independently-confirmed defect introduced by the CR-01 fix itself: useBackupStream's connect() unconditionally clears all displayed log lines on every invocation, including the automatic reconnect scheduleReconnect() triggers after a CLOSED-state disconnect — and the server never replays already-emitted 'line' events to a newly (re)subscribing client on a still-IN_PROGRESS backup. A user watching a long-running backup who experiences any transient disconnect (proxy blip, laptop sleep, Wi-Fi hiccup) will see the entire visible log reset to blank the moment the reconnect succeeds, even though the backup is still running normally and nothing was lost server-side. This directly undermines 'see streaming progress output in the UI' on exactly the disconnect/reconnect path the last three gap-closure rounds were built to fix."
    artifacts:
      - path: "client/src/hooks/use-backup-stream.ts"
        issue: "connect() (line 31) calls setLines([]) unconditionally on every invocation — including calls from scheduleReconnect()'s timer — wiping log lines the user has already seen. Confirmed by reading the current source: connect() is the only place lines is reset, and it runs on both the initial mount and every scheduled reconnect."
      - path: "server/src/routes/backups.ts"
        issue: "The /stream route's live-emitter branch (lines 188-207) only forwards future emitter.on('line', ...) events to a new subscriber. It never replays log lines already emitted before this (re)subscription for a still-IN_PROGRESS backup — only the two terminal-status branches (already-finished, and the CR-02 missing-broadcaster fallback) replay backup.logLines."
    missing:
      - "Gate the setLines([]) clear so it only fires on the very first connect() call for a given backupId (e.g. an isFirstConnect flag local to the effect), not on every reconnect"
      - "Or: have the server replay the in-memory lines accumulated so far for a live IN_PROGRESS backup on new subscription (requires exposing that accumulator from runBackup/runRestore, not just the terminal logLines already persisted to the DB)"
      - "Invert the existing test 'clears lines received before a reconnect when the replacement connection opens' (client/test/unit/hooks/use-backup-stream.test.ts:281-294) to assert lines are preserved across a reconnect, once fixed"
regressions:
  - "WR-01 is a new defect introduced by 04-17's own CR-01 reconnect fix, not a pre-existing issue re-surfacing. Before 04-17, a disconnect froze the page (CR-01) — the user saw stale-but-intact lines forever. After 04-17, a disconnect recovers automatically but wipes the visible log on every reconnect. Net UX effect is an improvement (the page is no longer permanently stuck), but the log-continuity property was never explicitly a must-have and is now demonstrably broken on the exact path this round targeted."
deferred: []
human_verification:
  - test: "Live re-run of UAT Test 22: configure a per-stack schedule, trigger a backup with no repository configured on both the manual route and the scheduled cron path"
    expected: "A visible FAILED backup with a stated reason and the stack in ERROR — no server crash, no permanently wedged BACKING_UP stack"
    why_human: "04-15-SUMMARY.md flags this guard as human_judgment: true — the manual-route guard has no integration/route-level test, only unit coverage of the shared abortBackup() method. Unchanged by 04-17."
  - test: "Restore a stack from a snapshot and watch the restore run live on the detail page (currently blocked — UAT Tests 14-17/23 were skipped for want of a snapshot)"
    expected: "Restore behaves identically to a backup on this page: badge, log source, and alert all resync/reconnect correctly, including the new CR-01/02/03 fixes"
    why_human: "POST /api/stacks/:id/restore fully awaits runRestore before its 202 reply (confirmed in routes/backups.ts:78-87), so no client has ever watched a restore live end-to-end. The broadcaster registration/disposal path is structurally identical to runBackup's (same two helper functions, no trigger branch) and is unit-tested directly, but this remains unobserved live, per 04-17-SUMMARY.md's own D6 rationale."
---

# Phase 4: Backup & Restore — Re-Verification Report

**Phase Goal:** Users can take encrypted, versioned backups of any stack and restore from a snapshot without manual restic CLI knowledge

**Verified:** 2026-08-30T21:00:00Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plan 04-17 (closing CR-01/CR-02/CR-03), incorporating a fresh code review of the 04-17 diff (04-REVIEW.md, reviewed 2026-08-30)

## Re-Verification Context

**Scope of this pass:** Plan 04-17 claims to close the three CRITICAL findings (CR-01, CR-02, CR-03) that the previous verification pass (2026-08-30T18:15:00Z) promoted from code-review findings to blocking gaps against ROADMAP Success Criterion #2. A fresh, scoped code review was then run against the 04-17 diff specifically (`04-REVIEW.md`, 7 files, 0 critical / 3 warning / 2 info findings) and flagged a new regression (WR-01) introduced by the CR-01 fix itself. This verification independently re-derives all three CR closures against the current source and re-reads the WR-01 finding directly against the code and its own test, rather than trusting either SUMMARY.md's narrative or the review text.

**Verdict on CR-01/CR-02/CR-03:** All three are genuinely closed. Verified by:
- Reading `ensureBackupBroadcaster()`/`disposeBackupBroadcaster()` and their call sites directly in `server/src/application/backup-service.ts` — confirmed `initiateBackup` registers the broadcaster (line 159) before `stackRepo.update` (line 161) and before the method returns, well before the route's 202 response is sent.
- Reading the SSE route's missing-broadcaster branch (`server/src/routes/backups.ts:172-186`) — confirmed it re-reads the record via `findByIdOrThrow` and replays `refreshed.logLines` instead of trusting the pre-check status.
- Reading `abortBackup()` (`backup-service.ts:532-567`) — confirmed the terminal `emit("done", "FAILED")` and `disposeBackupBroadcaster` run inside a `finally` block, so a rejected notification cannot strand a subscribed client.
- Reading `useBackupStream`'s `onerror`/`onmessage` handlers (`client/src/hooks/use-backup-stream.ts`) — confirmed the CLOSED-vs-CONNECTING readyState branch, the bounded backoff schedule, and the three-way `done`-status mapping (COMPLETED/FAILED/present-non-terminal → disconnected).
- Reading the page's `shortId` fallback (`client/src/routes/app/stacks/backups/[backupId].tsx`) — confirmed `||` (not `??`) is used, and the bounded poll effect for the `disconnected` case.
- Running the scoped unit test files for both changed areas (58 server tests, 37 client tests — all passing) and both workspaces' `tsc --noEmit` (clean).

**Verdict on WR-01 (new finding, not yet acted on):** Confirmed as a genuine, currently-unfixed regression — not a hypothetical. `client/src/hooks/use-backup-stream.ts`'s `connect()` (line 31) calls `setLines([])` on every invocation, including from `scheduleReconnect()`'s timer. `server/src/routes/backups.ts`'s `/stream` route never replays already-emitted `"line"` events to a new subscriber on a still-`IN_PROGRESS` backup (only the two terminal-status branches replay `logLines`). The hook's own test, `"clears lines received before a reconnect when the replacement connection opens"` (`client/test/unit/hooks/use-backup-stream.test.ts:281-294`), explicitly asserts `result.current.lines` becomes `[]` after a reconnect — i.e. the test encodes the defect as intended behavior. This is squarely inside ROADMAP Success Criterion #2 ("...see streaming progress output in the UI") and reproduces on the exact disconnect/reconnect path this round of gap closure was built to fix, so I am not treating it as a cosmetic nit: it stays open as `gaps_remaining`, keeping the overall phase status `gaps_found`.

I did **not** promote WR-02 (zero route-level test coverage for the SSE endpoint, confirmed by grep — no test file references `backups/:id/stream`) or WR-03 (an orphaned-broadcaster edge case on a `stackRepo.update` failure between registration and return, practically unreachable by any client since no 202 is ever sent on that path) to gaps — see Anti-Patterns section for reasoning.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can configure a restic repository (local path, SFTP, or S3-compatible) and password in Settings; password is stored encrypted | ✓ VERIFIED | `server/src/routes/backups.ts` PUT `/api/settings/backup` (lines 316-373) calls `encrypt()` on `sftpKey` (346), `s3SecretKey` (354), `password` (362) before persisting; GET route (283-312) never returns raw secrets, only `has*` booleans. File untouched by 04-17 — unchanged since the previous verification pass, re-confirmed here by direct re-read. |
| 2 | User can trigger a manual backup for any stack and see streaming progress output in the UI | ✗ FAILED (partial) | CR-01/CR-02/CR-03 are genuinely closed (see Re-Verification Context and Data-Flow Trace below), each independently re-derived from the current source and backed by passing regression tests. **However**, WR-01 (log-wipe-on-reconnect) is a confirmed, currently-open defect on this exact path — a transient disconnect while a backup is running blanks the visible log the moment the automatic reconnect succeeds. See Gaps Summary. |
| 3 | User can configure a per-stack backup schedule and retention policy; scheduled backups run automatically | ✓ VERIFIED | `PUT /api/stacks/:id/backup-config` (routes/backups.ts 245-279) validates the cron expression and calls `backupScheduler.upsert`/`remove`. `BackupScheduler` and `runScheduledBackup`'s `abortBackup` guard (04-15) are unchanged by 04-17. |
| 4 | User can view a list of available snapshots for a stack and restore the stack from any selected snapshot | ✓ VERIFIED | `GET /api/stacks/:id/snapshots` (routes/backups.ts 103-116) and `POST /api/stacks/:id/restore` (78-87) unchanged by 04-17. `runRestore` now registers/disposes its broadcaster through the identical `ensureBackupBroadcaster`/`disposeBackupBroadcaster` pair as `runBackup` (backup-service.ts), extending CR-02's fix to the restore path — confirmed by dedicated passing unit tests. A live-watched restore has still never been observed end-to-end (no client ever subscribes mid-restore, since the 202 reply fully awaits `runRestore`) — carried forward as a human-verification item, not a gap. |
| 5 | A backup failure transitions the stack to ERROR state and triggers a notification if SMTP is configured | ✓ VERIFIED | `runBackup()`/`runRestore()` catch blocks (unchanged) set stack status to `"ERROR"` and call `notificationService.notify(...)`. `abortBackup()` (backup-service.ts 532-567) extends the same guarantee to backups that never reach restic, now hardened so a rejected `notify()` cannot prevent the terminal `done`/broadcaster disposal (confirmed via the `try {...} finally {...}` structure and a passing "emits done even when the notification send rejects" test). |

**Score:** 4/5 success criteria verified (Success Criterion #2 partially verified — the three previously-blocking defects are genuinely closed, but a new regression from the same fix remains open)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/application/backup-service.ts` | `ensureBackupBroadcaster()`/`disposeBackupBroadcaster()` as sole map writer/remover; `initiateBackup` registers before returning; `abortBackup` emits terminal `done` from `finally` | ✓ VERIFIED | Lines 19-47 (map + helper pair), 159 (`initiateBackup` registration before line 161's `stackRepo.update`), 532-567 (`abortBackup`'s try/finally). 58/58 scoped unit tests pass. |
| `server/src/routes/backups.ts` | SSE missing-broadcaster branch re-reads record and replays log lines | ✓ VERIFIED | Lines 172-186: `backupRepository.findByIdOrThrow(id)` then replay of `refreshed.logLines`, `done` with `refreshed.status`. |
| `client/src/hooks/use-backup-stream.ts` | `BACKUP_STREAM_RECONNECT_DELAYS_MS`, `onopen`, bounded backoff, 3-way `done` mapping | ✓ VERIFIED (wiring), ⚠️ but see WR-01 for a behavioral gap in the same file | Lines 8, 13 (constants), 37-40 (`onopen`), 72-82 (`onerror`/`scheduleReconnect`), 48-64 (3-way status mapping). 18 hook unit tests pass (part of the 37 scoped total). |
| `client/src/routes/app/stacks/backups/[backupId].tsx` | Bounded poll effect for `disconnected`; empty-string-safe `shortId` | ✓ VERIFIED | Confirmed present via SUMMARY-cited line ranges and passing 19 page unit tests (part of the 37 scoped total); not independently re-read line-by-line in this pass since its own tests directly assert the poll-termination and title-fallback behaviors this artifact claims. |
| `server/test/unit/application/backup-service.test.ts` | Broadcaster lifecycle + terminal-done coverage | ✓ VERIFIED | Re-run in this pass: 58/58 passing. |
| `client/test/unit/hooks/use-backup-stream.test.ts` | Reconnect backoff, attempt bound, non-terminal mapping | ✓ VERIFIED (and confirms WR-01) | Re-run in this pass as part of the 37/37 passing total. Also contains the assertion that encodes WR-01 (line 281-294). |
| `client/test/unit/routes/stacks/backup-detail-page.test.tsx` | Poll-while-disconnected, poll termination, non-blank title | ✓ VERIFIED | Re-run in this pass as part of the 37/37 passing total. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `initiateBackup` | module-level `backupBroadcasters` map | `ensureBackupBroadcaster(backup.id)` called synchronously before return, before the route's 202 | ✓ WIRED | `backup-service.ts:159`, ahead of the `await this.stackRepo.update(...)` on line 161 — no `await` intervenes between registration and the method resolving. |
| SSE route missing-broadcaster branch | DB record | `backupRepository.findByIdOrThrow(id)` re-read, replays `logLines` | ✓ WIRED | `routes/backups.ts:179-184`. |
| `EventSource onerror` (readyState CLOSED) | `scheduleReconnect` → `connect()` | bounded backoff timer | ✓ WIRED | `use-backup-stream.ts:72-97`; confirmed by passing "reconnects after the first backoff delay" and "resets the attempt counter on open" tests. |
| Page `streamStatus === "disconnected"` | poll effect → `getBackup()` | interval capped at `BACKUP_RESYNC_MAX_POLLS` | ✓ WIRED | Confirmed by 5 passing page tests naming this exact behavior (D4 in 04-17-SUMMARY.md coverage table). |
| `connect()` reconnect invocation | `setLines([])` | unconditional call at the top of `connect()` | ⚠️ WIRED — but wired to the wrong behavior (WR-01) | `use-backup-stream.ts:31` fires on every `connect()` call, not gated to first-connect-only; confirmed by the hook's own test asserting the clear happens on reconnect. |
| Live SSE emitter `"line"` events | new (re)subscribing client | `emitter.on("line", onLine)` | ✗ DISCONNECTED for already-emitted lines (WR-01, server half) | `routes/backups.ts:188-207` only forwards *future* `"line"` events to a new subscriber; no replay of lines already emitted before this subscription for a live, still-`IN_PROGRESS` backup. |

### Data-Flow Trace (Level 4) — SSE Reconnect Path

| Stage | Data Variable | Source | Produces Real Data | Status |
|-------|---------------|--------|---------------------|--------|
| Server orchestration | broadcaster registration timing | `ensureBackupBroadcaster` called at `initiateBackup` time (backup-service.ts:159), reused by `runBackup`/`runRestore` | Closes the CR-02 race — real, live emitter always exists by the time a client can know the backup id | ✓ FLOWING |
| SSE missing-broadcaster fallback | `refreshed.status`/`refreshed.logLines` | Fresh `findByIdOrThrow` re-read (routes/backups.ts:179) | Real current state, not stale pre-check status | ✓ FLOWING |
| Client hook | `BackupStreamStatus` on a `done` frame | 3-way branch on `data.status` (use-backup-stream.ts:48-64) | Correctly distinguishes COMPLETED/FAILED/non-terminal — no verdict rendered for a non-verdict | ✓ FLOWING |
| Client hook reconnect | `lines` state on `connect()` | `setLines([])` unconditional (use-backup-stream.ts:31) | **Discards real, already-received log history on every reconnect** — a live, running backup's visible progress resets to nothing | ✗ DISCONNECTED (WR-01) |
| Server live-emitter branch | already-emitted `"line"` events | Only `emitter.on("line", onLine)` going forward (routes/backups.ts:189-191) | No mechanism replays lines emitted before this (re)subscription | ✗ DISCONNECTED (WR-01, server half — no replay source exists for this branch) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server backup-service unit tests (broadcaster lifecycle, abortBackup, restore parity) | `yarn workspace @docktor/server test:unit test/unit/application/backup-service.test.ts` | `Test Files 1 passed (1)`, `Tests 58 passed (58)` | ✓ PASS |
| Client backup-stream hook + detail-page unit tests | `yarn workspace @docktor/client test test/unit/hooks/use-backup-stream.test.ts test/unit/routes/stacks/backup-detail-page.test.tsx` | `Test Files 2 passed (2)`, `Tests 37 passed (37)` | ✓ PASS |
| Server typecheck | `yarn workspace @docktor/server tsc --noEmit` | exit 0, no output | ✓ PASS |
| Client typecheck | `yarn workspace @docktor/client tsc --noEmit` | exit 0, no output | ✓ PASS |
| Debt-marker scan on all 7 files touched by 04-17 | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all 7 key-files | No matches in any file | ✓ PASS |
| CR-01/CR-02/CR-03 reproduction (code inspection against cited lines) | Direct read of `backup-service.ts`, `routes/backups.ts`, `use-backup-stream.ts`, `[backupId].tsx` | Registration-before-return, re-read fallback, bounded backoff + poll, `||` fallback all present as claimed | ✓ PASS (confirms closure) |
| WR-01 reproduction (log wipe on reconnect) | Code inspection: `use-backup-stream.ts:31` (`connect()`) + `routes/backups.ts:188-207` (no replay for live branch) + existing test at lines 281-294 | `setLines([])` unconditional on every `connect()`; no server-side replay mechanism for the live branch; the hook's own test asserts the wipe as expected behavior | ✓ PASS (confirms defect) |
| SSE route (`GET /api/backups/:id/stream`) test coverage (WR-02) | `grep -rln "backups/:id/stream" server/test/` | No matches — zero route-level tests exist for this endpoint | ✓ PASS (confirms WR-02; not promoted to a gap, see below) |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|-------------|-----------------|--------|----------|
| BCK-01 | 04-01, 04-03, 04-04, 04-05, 04-13 | ✓ SATISFIED | Settings Backup tab, `PUT /api/settings/backup`, encrypted persistence. Untouched by 04-17 — carried forward from the previous verification pass, which cited this with line numbers. |
| BCK-02 | 04-01, 04-03, 04-05, 04-07, 04-10, 04-14 | ✓ SATISFIED | `encrypt()`/`decrypt()` for password, SFTP key, S3 secret. Untouched by 04-17. |
| BCK-03 | 04-01, 04-03, 04-04, 04-06, 04-08, 04-11, 04-15, 04-16, 04-17 | ⚠️ PARTIAL | `POST /api/stacks/:id/backup`, SSE streaming, terminal-status threading, page resync, and now CR-01/02/03 closure are all in place and tested — but see the open WR-01 gap on the same "see streaming progress" behavior. |
| BCK-04 | 04-01, 04-03, 04-04, 04-05, 04-07, 04-10, 04-11, 04-14, 04-15 | ✓ SATISFIED | Per-stack cron schedule, `BackupScheduler`, `abortBackup` guard against wedging. Untouched by 04-17. |
| BCK-05 | 04-01, 04-02, 04-04, 04-05, 04-07, 04-08, 04-14 | ✓ SATISFIED | Retention policy parsing/UI. Untouched by 04-17. |
| BCK-06 | 04-01, 04-06, 04-08, 04-11 | ✓ SATISFIED | `buildBackupArgs` excludes `logs/`. Untouched by 04-17. |
| BCK-07 | 04-01, 04-03, 04-06 | ✓ SATISFIED | `detectAbsolutePathVolumes` with tilde-path handling. Untouched by 04-17. |
| BCK-08 | 04-01, 04-02, 04-04, 04-06 | ✓ SATISFIED | Snapshot listing endpoint + UI. Untouched by 04-17; edge-probe rows (adjacency/empty/ordering) remain unasserted, carried forward from prior passes, not re-litigated here since neither this nor prior rounds touched this area. |
| BCK-09 | 04-01, 04-03, 04-04, 04-06, 04-15, 04-16, 04-17 | ✓ SATISFIED | `runRestore()` orchestration; broadcaster registration/disposal now structurally identical to `runBackup`'s (04-17). A live-watched restore remains unobserved end-to-end (human-verification item, not a gap — restore's 202 fully awaits completion, so no client has ever subscribed mid-restore). |
| BCK-10 | 04-01, 04-02, 04-04, 04-06 | ✓ SATISFIED | `spawn`-based `ResticExecutor`. Untouched by 04-17. |
| BCK-11 | 04-01, 04-03, 04-06, 04-15, 04-16, 04-17 | ✓ SATISFIED | `assertTransition`, BACKING_UP→ERROR/previous-status; `abortBackup()` extends this to backups that never reach restic, now hardened with try/finally. |
| NOTF-05 | 04-15 | ✓ SATISFIED | `notificationService.notify({type: "backup_failure", ...})` called from `runBackup`, `runRestore`, and `abortBackup`. |

**No orphaned requirements** — every BCK-01 through BCK-11 ID is claimed by at least one plan's `requirements` frontmatter across the phase's 17 plans (04-01 through 04-17). `.planning/REQUIREMENTS.md`'s traceability table currently shows most BCK rows as "Gaps Found" — this is stale documentation from a blanket revert (`b304c71`, made when the pre-04-17 CR-01/02/03 gaps were discovered) that has not yet been re-synced for BCK-01/02/04-08/10, which the actual codebase satisfies unchanged. This is a documentation-lag issue, not a code gap; noted here rather than silently accepted.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `client/src/hooks/use-backup-stream.ts` | 31 | `setLines([])` unconditional on every `connect()` call, including reconnects (WR-01) | 🛑 Blocker (for SC #2's "see streaming progress output" on the exact reconnect path this round targeted) | Visible log resets to blank on every transient disconnect/reconnect of a still-running backup |
| `server/src/routes/backups.ts` | 188-207 | Live-emitter SSE branch never replays already-emitted `"line"` events to a (re)subscribing client (server half of WR-01) | 🛑 Blocker (same defect, other half) | No server-side mechanism exists to restore log continuity across a reconnect |

**Reviewed but not promoted to blockers:**
- WR-02 (zero route-level test coverage for `GET /api/backups/:id/stream`, including the new CR-02 fallback branch): confirmed real by grep (no test file references this endpoint), and CLAUDE.md requires tests for every new feature/bug fix. Not promoted to a gap because the underlying *behavior* it would cover is independently confirmed correct by direct code reading in this pass and by service-level unit tests exercising the same logic one layer down — the missing coverage is a project-quality debt, not an observed functional failure. Recommend a follow-up Fastify `app.inject()`/raw-HTTP-based route test per the review's suggested plan.
- WR-03 (`initiateBackup` can leave an orphaned, undisposed broadcaster if `stackRepo.update` fails between registration and return): confirmed structurally real, but no 202 response is ever sent on this failure path, so no SSE client can ever subscribe to the leaked emitter — no observable user-facing effect. Low-impact, not a gate on any success criterion.
- IN-01 (`if (data.line)` drops genuinely empty log lines), IN-02 (redundant `?? false` on an already-boolean expression): code-quality nits, no functional impact on any success criterion.

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 7 files touched by 04-17.

### Human Verification Required

See frontmatter `human_verification` — 2 items remain: a live re-run of UAT Test 22 (manual-route repository-missing guard, still only unit-tested), and a live restore-to-completion observation (structurally proven via the same broadcaster pair as backup, but never observed end-to-end for want of a snapshot). The previous pass's third human-verification item (visual confirmation of CR-03's blank title) is now closed — it is fixed and directly asserted by a passing unit test, so it no longer needs a human eyeball.

## Gaps Summary

Plan 04-17 correctly and verifiably closed all three CRITICAL defects (CR-01, CR-02, CR-03) that the previous verification pass promoted to blocking gaps against ROADMAP Success Criterion #2. Each closure was independently re-derived against the current source (not trusted from SUMMARY.md or 04-REVIEW.md text) and is backed by passing regression tests: a reconnect no longer permanently freezes the page, a client racing the 202-to-runBackup window no longer gets told an in-progress backup already finished, and the page title/breadcrumb is never blank for an IN_PROGRESS backup.

However, a fresh code review of the 04-17 diff surfaced a new, independently-confirmed regression (WR-01) introduced by the CR-01 reconnect fix itself: **the reconnect wipes the user's already-visible backup log on every disconnect/reconnect cycle**, because neither the client (`use-backup-stream.ts`'s unconditional `setLines([])`) nor the server (`routes/backups.ts`'s live-emitter branch, which only forwards future events) preserves log continuity across a reconnect. This is not a hypothetical: the hook's own test explicitly encodes the wipe as the expected, passing behavior. It sits squarely inside "see streaming progress output in the UI" and reproduces on precisely the path the last three gap-closure rounds (04-15, 04-16, 04-17) were built to harden — so this verification records Success Criterion #2 as still partially verified rather than fully closed, despite the substantial, well-tested progress in this round.

Recommend a follow-up gap-closure plan that either (a) gates the client's log clear to first-connect-only per `backupId`, or (b) has the server replay in-memory accumulated lines to a new subscriber on a live, `IN_PROGRESS` backup — and inverts the existing test that currently asserts the wipe as correct.

---

_Verified: 2026-08-30T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap-closure plan 04-17, incorporating independent re-derivation of 04-REVIEW.md's CR-01/02/03 closures and its new WR-01 finding_
