---
status: complete
phase: 02-observability
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md, 02-13-SUMMARY.md, 02-14-SUMMARY.md, 02-15-SUMMARY.md, 02-16-SUMMARY.md]
started: 2026-08-28T14:17:56Z
updated: 2026-08-30T00:25:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Background Jobs Start Successfully
expected: After server startup, StatePoller, FileWatcher, and UpdateChecker jobs are running. No crash logs or uncaught exceptions in console. FileWatcher is watching STACKS_ROOT directory, UpdateChecker cron is scheduled.
result: pass

### 3. Config File Change Detection (regression retest — was failing)
expected: Modify a docker-compose.yml file in STACKS_ROOT (e.g. change an image tag or a port). Within a few seconds, FileWatcher detects the change, updates the stack's service metadata (image, tag, ports, volumes) in the database — not just the hash — and broadcasts a config_changed SSE event.
result: pass

### 4. Config Error Detection (regression retest — was failing)
expected: Introduce invalid YAML syntax (or remove the services key) in a docker-compose.yml file. FileWatcher detects the error, logs it, and broadcasts a config_error StackEvent/SSE event.
result: pass
note: "Backend detection/broadcast confirmed working. No UI indication shown — user confirmed this is the pre-existing, already-tracked gap (see .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md), independently re-checked at Test 18."

### 5. Instant File-Change Detection on Windows/Docker Desktop (regression retest — was failing)
expected: With the stack detail page open, modify the compose file on disk. The change is detected within seconds (not only on the next cron reconcile tick), even when running under Docker Desktop on Windows.
result: pass

### 6. Update Checker Detects a Newer Image via Registry (regression retest — was blocker)
expected: For a service with a newer tag available in its registry (e.g. Docker Hub), UpdateChecker's registry query succeeds (no "manifest inspect returned null" error) and the update-available badge appears next to the service, showing the newer tag.
result: pass

### 7. Version Candidates Are Genuinely Newer (new — bugfix from live verification)
expected: Opening the version picker for a service with updates available lists only tags that are genuinely newer than the current one (proper semver/date ranking) — it does not list moving tags (e.g. "latest") or OS/flavor variant tags (e.g. "alpine3.24") as if they were newer versions.
result: pass

### 8. Per-Service Upgrade Dialog Persists to Compose File (new feature)
expected: Click the upgrade action on a service with an available update. Pick a specific version in the dialog and confirm. The stack transitions through UPDATING back to RUNNING, the service's Tag column updates live, and the docker-compose.yml on disk is rewritten with the new tag (survives a restart, not just a container recreate).
result: pass

### 9. Upgrade Dialog States Are Distinguishable (new feature)
expected: Opening the upgrade dialog for different services shows a clearly different state depending on context: loading while fetching candidates, a populated list when candidates exist, a distinct "already on the newest version" message when there's nothing newer, a distinct "never checked yet" message when no check has run, and a retry option on request failure.
result: pass

### 10. Upgrade Blocked During Transitional Stack States (new feature)
expected: While a stack is BACKING_UP, RESTORING, DEPLOYING, UPDATING, or MIGRATING, the per-service upgrade action is disabled (visible but not clickable), not hidden.
result: pass

### 11. Bulk "Update Images" Shows Contextual Feedback (regression retest — was: issue, fix: 02-13-PLAN.md)
expected: Click "Update Images" in the stack detail page actions. If no images had updates, a toast says images are already up to date. If images were pulled and updated, a toast confirms images were updated successfully — distinct messages for each case.
result: pass

### 12. SSE Live Updates for Config Changes (regression retest — was: issue, fix: 02-14-PLAN.md)
expected: With the stack detail page open, modify the compose file on disk. Within seconds, a config_changed SSE event triggers a background refresh and the UI shows the yellow "config changed" state — without the page/tab state resetting or looking like a full page reload.
result: pass
note: "First reported as an issue: toast and detail-page alert weren't yellow (G-02-12b) — the SSE-refresh regression itself (G-02-12) was already confirmed fixed at that point. G-02-12b fixed inline in 1f49d8c (toast.warning + className overrides on the toast and the Alert, since Alert is shadcn-managed). Client unit tests updated/passing, tsc clean."
previously_reported: "pass, however it looks like the page was refreshed. Can this be prevented?"

### 13. SSE Live Updates for Image Updates
expected: With the stack detail page open, when UpdateChecker finds a newer image, an update_available SSE event triggers a refetch and the blue update badge appears on the affected service without a manual page refresh.
result: pass

### 14. Config Changed Badge Clears on Action
expected: After deploying, restarting, or updating a stack that has a "config changed" badge, the badge disappears from both the detail and list views.
result: pass

### 15. Update Checker Works When Stack Is Stopped or in Error
expected: UpdateChecker still polls and detects updates for stacks in STOPPED or ERROR state, and the per-service upgrade action is available for those stacks too.
result: skipped
reason: "User was not able to test it (no stopped/error stack available to test against)."

### 16. Stack Event Audit Trail (regression retest — was: issue, fix: 02-15-PLAN.md, 02-16-PLAN.md)
expected: config_changed, config_error, and update_available events are recorded and queryable per stack with a timestamp and event type, visible in a new "Event Log" card on the stack detail page — separate from the "Status Log" card.
result: pass

### 17. Manual Reconcile / Cron Fallback
expected: Even without live file-watch events, the periodic reconcile loop still re-hashes stack compose files on its schedule and catches any drift.
result: pass

### 18. Config Error UI Indication (known gap — confirm still open)
expected: When FileWatcher detects a config_error, some visible indication appears in the UI (a badge, an error state) — not just a server log. (A prior investigation found the backend event fires correctly but the client has no handling for it yet; this test confirms whether that's still the case.)
result: skipped
reason: "Deferred follow-up: already created a todo for this (see .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md) — not a new blocking gap for this phase."

## Summary

total: 18
passed: 16
issues: 0
pending: 0
skipped: 2
blocked: 0

## Gaps

- gap_id: G-02-12b
  truth: "The 'config changed' state is shown in yellow, consistently, both as the badge and as the toast."
  status: resolved
  resolved_by: "fixed directly (not via a gap-closure plan) — see commit history"
  resolved_at: 2026-08-30
  reason: "User reported: passed, however, the toast as well as the badge at the top of the page are not yellow."
  severity: cosmetic
  test: 12
  root_cause: "The stack detail page's config-changed Alert (client/src/routes/app/stacks/[id].tsx:212-220) renders with no `variant` prop, so it falls back to Alert's 'default' CVA variant (client/src/components/ui/alert.tsx) — there is no 'warning'/yellow variant defined at all. Separately, use-stack.ts:78 calls toast.info(...) for the same event; sonner's Toaster (client/src/components/ui/sonner.tsx) does declare a distinct 'warning' icon, but no richColors prop is set anywhere, so even toast.warning() would not turn the toast yellow without an explicit className/style override. Neither surfaces the yellow treatment the stack-list badge already establishes (client/src/components/domain/stack/stack-list.tsx:31-35, bg-yellow-100/text-yellow-800)."
  artifacts:
    - path: "client/src/routes/app/stacks/[id].tsx"
      issue: "lines 212-220: config-changed Alert has no yellow/warning styling"
    - path: "client/src/hooks/use-stack.ts"
      issue: "line 78: toast.info(...) instead of a warning-styled toast for the config_changed event"
  missing:
    - "Apply the same yellow classes already used in stack-list.tsx (bg-yellow-100/text-yellow-800, dark:bg-yellow-900/dark:text-yellow-200) to the detail-page Alert via a className override (components/ui/alert.tsx is shadcn-managed and should not gain a new CVA variant for this)"
    - "Switch the config_changed toast to toast.warning(...) with a matching className/style override so it renders yellow, or reconsider whether it needs a distinct treatment"

- gap_id: G-02-11
  truth: "Click \"Update Images\" in the stack detail page actions. If no images had updates, a toast says images are already up to date."
  status: resolved
  resolved_by: 02-13-PLAN.md
  resolved_at: 2026-08-30
  reason: "User reported: the toast does not say \"no updates available\" - probably related to the issue that the badge is not removed if there are no newer images."
  severity: major
  test: 11
  root_cause: "updateImages() in server/src/application/stack-service.ts infers noUpdates by substring-matching docker compose pull's stdout+stderr against phrases like \"up to date\" / \"already exists\" — vocabulary that does not match the modern Docker Compose CLI's actual output (\"Pulled\" on success regardless of whether new layers were fetched; \"Skipped: Image is already present locally\" when no pull is attempted). noUpdates is effectively never true, so the client's toast.promise success branch always renders \"Images updated successfully\". Confirmed unrelated to the update-available badge (separate ImageUpdateCheck-table code path)."
  artifacts:
    - path: "server/src/application/stack-service.ts"
      issue: "updateImages() ~lines 269-285: noUpdates text-heuristic doesn't match current Docker Compose CLI output vocabulary"
    - path: "server/test/unit/application/stack-service.test.ts"
      issue: "No test coverage for the noUpdates: true branch"
  missing:
    - "Replace text-scraping heuristic with a positive signal (e.g. compare per-service image digest before/after pull) instead of parsing Compose's non-stable progress text"
    - "Add unit test coverage for the noUpdates: true case"
  debug_session: ".planning/debug/update-images-no-updates-toast-missing.md"

- gap_id: G-02-12
  truth: "A config_changed SSE event triggers a data refetch without a manual page refresh."
  status: resolved
  resolved_by: 02-14-PLAN.md
  resolved_at: 2026-08-30
  reason: "User reported: pass, however it looks like the page was refreshed. Can this be prevented?"
  severity: minor
  test: 12
  root_cause: "useStack() (client/src/hooks/use-stack.ts) uses one shared `loading` boolean for both the initial fetch and every SSE-triggered background refetch (config_changed and update_available handlers both call the same fetch()). StackDetailPage ([id].tsx lines 59-86) has an early `if (loading) return <minimal placeholder tree>` that is structurally unrelated to the full ~240-line page tree, so React unmounts/remounts the entire page (resetting tabs, scroll position, DOM) on every background SSE refresh, not just first load — reading as a full page refresh even though no navigation occurred. container_state/stack_status SSE events are unaffected since they merge into state without touching `loading`."
  artifacts:
    - path: "client/src/hooks/use-stack.ts"
      issue: "fetch() (lines 11-22) conflates initial-load and background-refresh loading state; config_changed/update_available handlers (lines 54-59) don't distinguish silent refresh from first load"
    - path: "client/src/routes/app/stacks/[id].tsx"
      issue: "lines 59-86: loading-gated early return swaps the whole page tree instead of gating only on data absence (!stack)"
  missing:
    - "Gate the full-page skeleton on !stack (no data yet) instead of the shared loading flag"
    - "Add a separate isRefreshing state that SSE-triggered fetches set, leaving the mounted page/stack data in place during background refresh"
  debug_session: ".planning/debug/config-changed-sse-looks-like-refresh.md"

- gap_id: G-02-16
  truth: "config_changed, config_error, and update_available events are recorded and queryable per stack with a timestamp and event type, visible in the UI's Status Log."
  status: resolved
  resolved_by: 02-15-PLAN.md, 02-16-PLAN.md
  resolved_at: 2026-08-30
  reason: "User reported: I dont see no config_changed in the \"Status Log\". Only in the server logs."
  severity: major
  test: 16
  root_cause: "Three compounding gaps. (1) No backend route exists to read StackEvent rows: GET /api/stacks/:id (findByIdWithRelations) includes services/deployments/statusLogs but never stackEvents, and there is no GET /api/stacks/:id/events route anywhere in stacks.ts. (2) No client wiring exists to fetch them, since there's no endpoint to call. (3) The UI's \"Status Log\" card was never designed to show StackEvent data at all — it renders stack.statusLogs, a different Prisma model (StackStatus state-machine transitions: fromStatus->toStatus), unrelated to the StackEvent audit-trail entity from 02-02-SUMMARY.md. The near-identical naming (\"Status Log\" label / StatusLog model / StackEvent type) masks that these are two separate features, only one of which was ever wired end-to-end. Secondary finding: the dedicated StackEventRepository (createEvent/findRecentByStack, built in 02-02) is dead code — nothing calls it; FileWatcher writes through a duplicate ad-hoc StackRepository.createStackEvent() (using `type: args.type as any`) instead."
  artifacts:
    - path: "server/src/routes/stacks.ts"
      issue: "No route exposes StackEvent data (no GET /api/stacks/:id/events)"
    - path: "server/src/repositories/stack-event-repository.ts"
      issue: "findRecentByStack() exists but is never called from anywhere — dead code"
    - path: "server/src/repositories/stack-repository.ts"
      issue: "lines 349-363: duplicate ad-hoc createStackEvent() with an `as any` cast, used instead of the dedicated repository; findByIdWithRelations (lines 16-29) never includes stackEvents"
    - path: "client/src/routes/app/stacks/[id].tsx"
      issue: "lines 282-323: \"Status Log\" card renders stack.statusLogs only — no reference to StackEvent/config_changed/config_error/update_available anywhere in the file"
  missing:
    - "Add GET /api/stacks/:id/events backed by stackEventRepository.findRecentByStack()"
    - "Add a client API function to fetch stack events"
    - "Add a UI section to render them — a new Event Log/Activity card, or merge into the existing Status Log card with clear labeling, since these are genuinely different data (product decision)"
    - "Consolidate the duplicate write path: route FileWatcher's config_changed/config_error writes through stackEventRepository instead of the ad-hoc StackRepository.createStackEvent() with its `as any` cast"
  debug_session: ".planning/debug/status-log-missing-config-changed-events.md"

## Out-of-Phase Blocker (session paused 2026-08-30)

While resuming this session to retest gaps G-02-11/12/16 on a different machine, a fresh
`docker compose up` crashed at server startup with an unrelated Prisma error
(`PrismaClientKnownRequestError` / `ECONNREFUSED` from `prisma.backup.findMany()`, raised inside
`BackupService.recoverInProgressBackups()`, called from `startJobs()` at `app.js:101`). This is
Phase 04 (backup-restore) code, not Phase 02 — but it prevents the server from becoming ready at
all, which blocks retesting tests 11, 12, and 16 here. Captured as
`.planning/todos/pending/2026-08-30-backup-recovery-crashes-server-on-db-not-ready.md` for
investigation (likely `/gsd-debug`) since it's outside this phase's plan set. Resume this UAT
session (`/gsd-verify-work 02`) once the server starts reliably on that machine.

**Resolved 2026-08-30:** fixed directly in `302eaec` (`fix(jobs): isolate per-job startup
failures so one job can't crash the server`) — each job's startup in `startJobs()` is now
individually try/caught, so `BackupRecovery` failing no longer takes down the HTTP server or the
other jobs. Todo marked complete in `6b1ce06`. A second, related issue surfaced while unblocking
this on the same machine — `.env.example`'s `DOCKTOR_STACKS_DIR=./dev-data/stacks` silently
overrides the correct docker-compose `/stacks` default via `.env.local`'s `env_file`, so
app-created stacks were writing to a non-persisted path. Not yet fixed in the repo (blocked on
`.env*` file access); user applying the workaround locally.

## Deferred Follow-Ups

- test: 18
  idea: "Config Error UI indication is confirmed still absent client-side. Already tracked as a todo, not spawned as a new gap: .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md"
  deferred_at: 2026-08-28
