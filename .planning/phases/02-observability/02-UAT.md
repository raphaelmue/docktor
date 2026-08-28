---
status: complete
phase: 02-observability
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md]
started: 2026-08-28T14:17:56Z
updated: 2026-08-28T14:35:00Z
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

### 11. Bulk "Update Images" Shows Contextual Feedback
expected: Click "Update Images" in the stack detail page actions. If no images had updates, a toast says images are already up to date. If images were pulled and updated, a toast confirms images were updated successfully — distinct messages for each case.
result: issue
reported: "the toast does not say \"no updates available\" - probably related to the issue that the badge is not removed if there are no newer images."
severity: major

### 12. SSE Live Updates for Config Changes
expected: With the stack detail page open, modify the compose file on disk. Within seconds, a config_changed SSE event triggers a refetch and the UI shows the yellow "config changed" state without a manual page refresh.
result: issue
reported: "pass, however it looks like the page was refreshed. Can this be prevented?"
severity: minor

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

### 16. Stack Event Audit Trail
expected: config_changed, config_error, and update_available events are recorded and queryable per stack with a timestamp and event type.
result: issue
reported: "I dont see no config_changed in the \"Status Log\". Only in the server logs."
severity: major

### 17. Manual Reconcile / Cron Fallback
expected: Even without live file-watch events, the periodic reconcile loop still re-hashes stack compose files on its schedule and catches any drift.
result: pass

### 18. Config Error UI Indication (known gap — confirm still open)
expected: When FileWatcher detects a config_error, some visible indication appears in the UI (a badge, an error state) — not just a server log. (A prior investigation found the backend event fires correctly but the client has no handling for it yet; this test confirms whether that's still the case.)
result: skipped
reason: "Deferred follow-up: already created a todo for this (see .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md) — not a new blocking gap for this phase."

## Summary

total: 18
passed: 13
issues: 3
pending: 0
skipped: 2

## Gaps

- gap_id: G-02-11
  truth: "Click \"Update Images\" in the stack detail page actions. If no images had updates, a toast says images are already up to date."
  status: failed
  reason: "User reported: the toast does not say \"no updates available\" - probably related to the issue that the badge is not removed if there are no newer images."
  severity: major
  test: 11
  artifacts: []
  missing: []

- gap_id: G-02-12
  truth: "A config_changed SSE event triggers a data refetch without a manual page refresh."
  status: failed
  reason: "User reported: pass, however it looks like the page was refreshed. Can this be prevented?"
  severity: minor
  test: 12
  artifacts: []
  missing: []

- gap_id: G-02-16
  truth: "config_changed, config_error, and update_available events are recorded and queryable per stack with a timestamp and event type, visible in the UI's Status Log."
  status: failed
  reason: "User reported: I dont see no config_changed in the \"Status Log\". Only in the server logs."
  severity: major
  test: 16
  artifacts: []
  missing: []

## Deferred Follow-Ups

- test: 18
  idea: "Config Error UI indication is confirmed still absent client-side. Already tracked as a todo, not spawned as a new gap: .planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md"
  deferred_at: 2026-08-28
