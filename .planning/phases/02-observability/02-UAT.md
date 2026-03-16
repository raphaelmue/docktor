---
status: complete
phase: 02-observability
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
  - 02-04-SUMMARY.md
  - 02-05-SUMMARY.md
started: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Background Jobs Start Successfully
expected: After server startup, StatePoller, FileWatcher, and UpdateChecker jobs are running. No crash logs or uncaught exceptions in console. FileWatcher is watching STACKS_ROOT directory, UpdateChecker cron is scheduled.
result: pass

### 3. Database Models Available
expected: Prisma client has StackEvent and ImageUpdateCheck models accessible. TypeScript autocomplete shows StackEventType enum with config_changed, config_error, update_available values.
result: pass

### 4. Config File Change Detection
expected: Modify a docker-compose.yml file in STACKS_ROOT. Within a few seconds, FileWatcher detects the change, updates the stack's hash in DB, and broadcasts a config_changed SSE event. Yellow "config changed" badge appears in stack list without page refresh.
result: issue
reported: "When changing the e.g. version, this is not reflected in the UI (and also the database). Same applies e.g. for ports. If there are any changes made to the docker compose (regardless whether they are directly changing the file or via the ui), extract all information and update the stack / service."
severity: major

### 5. Config Error Detection
expected: Introduce invalid YAML syntax in a docker-compose.yml file. FileWatcher detects the error, broadcasts a config_error SSE event. Stack shows appropriate error indication.
result: issue
reported: "Change has been detected, but no error message is shown, not even in the logs. Also restrictions (such as e.g. the network or the volumes must be all in the volumes/ directory) are not reflected."
severity: major

### 6. Manual Reconcile Trigger
expected: FileWatcher reconcile() can be triggered manually or runs on cron schedule. It re-hashes all stack compose files and detects any drifted hashes (simulates NFS delay scenario).
result: issue
reported: "the cron schedule works, however, at least on windows, file changes are not detected instantly."
severity: minor

### 7. Update Checker Stagger Logic
expected: With multiple images tracked, UpdateChecker processes one image per 5-minute tick, respecting the 6h/N stagger window. Images are checked in round-robin order, not all at once.
result: pass

### 8. Version Comparison Logic
expected: compareVersions() correctly identifies newer versions using date-first parsing (2024-06-01 > 2024-01-01), then semver (1.2.0 > 1.1.9), then digest fallback. Date tags don't get miscoerced by semver.
result: skipped
reason: There is no possibility to check if there is a newer version. Therefore cannot tell if it is working.

### 9. Docker Registry Manifest Inspection
expected: DockerExecutor.manifestInspect() queries a Docker registry for image manifest (digest). Works with both Docker Hub and custom registries. Handles multi-arch and single-arch manifests.
result: skipped
reason: cannot tell

### 10. Update Available Detection
expected: UpdateChecker polls for image updates, compares current vs latest tag using compareVersions(), stores result in ImageUpdateCheck table, and broadcasts update_available SSE event if newer version found.
result: pass

### 11. Update Available Badge Display
expected: When UpdateChecker detects a newer image version, blue "update available → tag" badge appears next to affected service in stack detail page without page refresh. Badge shows the newer version number.
result: issue
reported: "The update checker is running, but it is not detecting new versions. The latestTag latestDigest and currentDigest are null and the error says: manifest inspect returned null."
severity: blocker

### 12. User-Initiated Update Images
expected: Click "Update Images" button in stack detail PageActions. Stack transitions RUNNING→UPDATING. Docker compose pull executes for all services, then containers recreate via docker compose up -d. Stack returns to RUNNING. Update badges clear.
result: issue
reported: "yes this is working. However the usability is quite bad. When nothing was done because the image was is already up-to-date, it should say that. Also it would be better to upgrade a service if a new version was found and then the ui lets you choose to which version should be upgraded. Then the docker-compose is adjusted automatically. The 'update images' is rather a pull and deploy."
severity: major

### 13. Config Changed Badge in Dashboard
expected: When FileWatcher detects compose file change, yellow "config changed" badge appears in Status column of stack list (dashboard). Badge persists until stack is restarted, deployed, or updated.
result: pass

### 14. Config Changed Badge Clears on Action
expected: After deploying, restarting, or updating a stack that has configChanged=true, the yellow badge disappears from both detail and list views. Database shows configChanged=false for that stack.
result: pass

### 15. SSE Live Updates for Config Changes
expected: With stack detail page open, modify the compose file on disk. Within seconds, config_changed SSE event triggers refetch, and UI updates to show yellow config changed state without manual refresh.
result: issue
reported: "SSE is working. Only the file watcher is not working at least on windows. When changing the file it is only reflected when the cron job detects it."
severity: major

### 16. SSE Live Updates for Image Updates
expected: With stack detail page open, when UpdateChecker finds a newer image, update_available SSE event triggers refetch, and blue update badge appears on affected service without manual refresh.
result: pass

### 17. Stack Event Audit Trail
expected: StackEventRepository stores config_changed, config_error, and update_available events in StackEvent table. Events include timestamp, stackId, and event type. Can query recent events per stack.
result: pass

### 18. Update Checker Works When Stack Stopped
expected: UpdateChecker polls and detects updates even for stacks in STOPPED or ERROR state. Update Images button is enabled for STOPPED stacks (canUpdate includes STOPPED and ERROR states).
result: skipped

## Summary

total: 18
passed: 9
issues: 6
pending: 0
skipped: 3

## Gaps

- truth: "Modify a docker-compose.yml file in STACKS_ROOT. Within a few seconds, FileWatcher detects the change, updates the stack's hash in DB, and broadcasts a config_changed SSE event. Yellow config changed badge appears in stack list without page refresh."
  status: failed
  reason: "User reported: When changing the e.g. version, this is not reflected in the UI (and also the database). Same applies e.g. for ports. If there are any changes made to the docker compose (regardless whether they are directly changing the file or via the ui), extract all information and update the stack / service."
  severity: major
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Introduce invalid YAML syntax in a docker-compose.yml file. FileWatcher detects the error, broadcasts a config_error SSE event. Stack shows appropriate error indication."
  status: failed
  reason: "User reported: Change has been detected, but no error message is shown, not even in the logs. Also restrictions (such as e.g. the network or the volumes must be all in the volumes/ directory) are not reflected."
  severity: major
  test: 5
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "FileWatcher reconcile() can be triggered manually or runs on cron schedule. It re-hashes all stack compose files and detects any drifted hashes (simulates NFS delay scenario)."
  status: failed
  reason: "User reported: the cron schedule works, however, at least on windows, file changes are not detected instantly."
  severity: minor
  test: 6
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "When UpdateChecker detects a newer image version, blue update available → tag badge appears next to affected service in stack detail page without page refresh. Badge shows the newer version number."
  status: failed
  reason: "User reported: The update checker is running, but it is not detecting new versions. The latestTag latestDigest and currentDigest are null and the error says: manifest inspect returned null."
  severity: blocker
  test: 11
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Click Update Images button in stack detail PageActions. Stack transitions RUNNING→UPDATING. Docker compose pull executes for all services, then containers recreate via docker compose up -d. Stack returns to RUNNING. Update badges clear."
  status: failed
  reason: "User reported: yes this is working. However the usability is quite bad. When nothing was done because the image was is already up-to-date, it should say that. Also it would be better to upgrade a service if a new version was found and then the ui lets you choose to which version should be upgraded. Then the docker-compose is adjusted automatically. The 'update images' is rather a pull and deploy."
  severity: major
  test: 12
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "With stack detail page open, modify the compose file on disk. Within seconds, config_changed SSE event triggers refetch, and UI updates to show yellow config changed state without manual refresh."
  status: failed
  reason: "User reported: SSE is working. Only the file watcher is not working at least on windows. When changing the file it is only reflected when the cron job detects it."
  severity: major
  test: 15
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
