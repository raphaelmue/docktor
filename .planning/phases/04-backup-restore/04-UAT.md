---
status: complete
phase: 04-backup-restore
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md]
started: 2026-03-20T00:00:00Z
updated: 2026-03-31T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: [pass]

### 2. Configure Backup Repository Settings
expected: Navigate to Settings > Backup tab. Select a repository type (Local/SFTP/S3-compatible). Fill conditional fields that appear per type. Enter restic password. Save settings. Confirmation toast appears. Reload page shows saved values (credentials shown as "has*" indicators, not actual values).
result: [pass]

### 3. Configure Global Backup Defaults
expected: In Settings > Backup tab, set default cron schedule and retention policy (keep-daily, keep-weekly, keep-monthly). Save changes. Confirmation toast appears. Reload page shows saved defaults.
result: [pass]

### 4. Enable Backup Failure Notifications
expected: In Settings > Notifications tab, toggle "Backup Failure" notification trigger on. Save. Confirmation toast appears. Reload page shows toggle in enabled state.
result: [pass]

### 5. Configure Per-Stack Backup Settings
expected: Navigate to any stack detail page. Click Backups tab (5th tab). In Backup Configuration card, toggle off "Use global defaults". Schedule and retention fields appear. Set custom values. Save. Confirmation toast appears. Reload page shows custom config.
result: [pass]
note: Fixed validation error by adding .nullable() to schema fields (commit ed2ce5b)

### 6. View Volume Warnings
expected: On a stack with volumes outside its directory, navigate to Backups tab. Backup Configuration card shows an Alert listing volumes that won't be backed up. Alert includes volume names and explains the limitation.
result: [pass]
note: Fixed missing getStackDirectory method (commit e55cae5) and tilde path detection (commit d15c78f)

### 7. Trigger Manual Backup from Dropdown Menu
expected: On stack detail page, click ellipsis (three dots) action menu. Select "Backup Now". Toast notification appears with "View progress" action link. Stack status transitions to BACKING_UP.
result: [pass]

### 8. Trigger Manual Backup from Backups Tab
expected: In Backups tab, Backup Configuration card has a "Backup Now" button in header. Click it. Toast notification appears with progress link. Backup record appears in Backup History table with IN_PROGRESS status badge.
result: [pass]
note: Fixed polling race condition with enhanced polling (commits b1996ad + 080bf4c)

### 9. View Backup History
expected: In Backups tab, Backup History table shows all backup records for the stack. Each row displays: status badge (IN_PROGRESS/COMPLETED/FAILED), trigger type (MANUAL/SCHEDULED/RESTORE), timestamp, duration, size, and "View" link. Completed backups show formatted duration (e.g., "2m 15s") and size (e.g., "45 MB").
result: pass

### 10. Stream Live Backup Logs
expected: Click "View" link on an IN_PROGRESS backup from Backup History. Backup detail page opens. Log output streams in real-time from restic. Auto-scrolls to bottom as new lines appear. Status badge updates when backup completes or fails.
result: issue
reported: "it always says: No output yet..."
severity: major

### 11. View Completed Backup Logs
expected: Click "View" link on a COMPLETED backup. Backup detail page displays stored log lines from the backup. No streaming occurs (backup already finished). All restic output visible.
result: issue
reported: "it just shows: No output yet..."
severity: major

### 12. View Failed Backup Error
expected: Click "View" link on a FAILED backup. Backup detail page shows error alert with context-specific message. Log output shows where failure occurred.
result: issue
reported: "I can see the error message alert, but no logs."
severity: major

### 13. View Available Snapshots
expected: In Backups tab, Snapshots section lists all restic snapshots for the stack. Each snapshot shows date, paths backed up. Refresh button allows manual snapshot list refresh.
result: issue
reported: "It says \"No snapshots found\", although there were successful backups."
severity: blocker

### 14. Initiate Restore from Snapshot
expected: In Snapshots section, click "Restore" button on any snapshot. Restore confirmation dialog opens. Dialog warns about downtime and irreversibility. Text input requires typing exact stack name to enable confirm button.
result: skipped
reason: skip since no snapshots were created.

### 15. Complete Restore Confirmation
expected: In restore dialog, type exact stack name into confirmation input. "Confirm" button becomes enabled. Click "Confirm". Dialog closes. Toast notification appears. Navigate to backup detail page showing RESTORING status. Stack status transitions to RESTORING.
result: skipped
reason: skip, there were no snapshots created to test this.

### 16. View Restore Logs
expected: During restore operation, backup detail page streams restic restore output via SSE. Auto-scrolls to bottom. When complete, status updates to COMPLETED.
result: skipped
reason: skip, there were no snapshots created to test this.

### 17. Snapshots Section Locks During Operations
expected: When stack status is BACKING_UP or RESTORING, Snapshots section displays locked state message. Restore buttons are disabled. Prevents concurrent backup/restore operations.
result: skipped
reason: skip, there were no snapshots created to test this.

### 18. Deploy Button Remains Prominent
expected: On stack detail page, action bar shows primary "Deploy" button and ellipsis dropdown menu. Deploy button is always visible and prominent. Other actions (Stop, Restart, Update Images, Delete, Backup Now) are in dropdown.
result: pass

### 19. Action Menu Disables Invalid Operations
expected: In stack action dropdown menu, actions are disabled based on stack status. When stack is STOPPED, "Stop" action is disabled. When stack is RUNNING, "Deploy" might be disabled (or remains for redeployment). Status-aware enabling/disabling prevents invalid operations.
result: pass

### 20. Restic Not Installed Warning
expected: If restic binary is not installed on server, Settings > Backup tab shows Alert warning that restic is not available. Warning persists until restic is installed and server detects it.
result: pass

### 21. Restic Version Display
expected: In Settings > Backup tab, when restic is installed, Backup Repository card footer shows restic version badge (e.g., "restic 0.16.2"). Provides visibility into installed version.
result: pass

### 22. Scheduled Backup Execution
expected: Configure a per-stack backup schedule (e.g., "*/5 * * * *" for every 5 minutes). Wait for cron schedule to trigger. After scheduled time, new backup record appears in Backup History with trigger type SCHEDULED. Backup runs automatically.
result: issue
reported: "Backup was not triggered automatically or failed. Also did not appear in the backup history: [server] [ResticExecutor] Running: restic [ 'snapshots', '--tag', 'memos', '--json' ]\n[server] [ResticExecutor] Process exited with code 10\n[server] [ResticExecutor] Running: restic [ 'snapshots', '--tag', 'memos', '--json' ]\n[server] [ResticExecutor] Process exited with code 10"
severity: blocker

### 23. Retention Policy Enforcement
expected: Configure retention policy (e.g., keep-daily: 7, keep-weekly: 4, keep-monthly: 3). Trigger multiple backups over time to exceed retention limits. Verify old snapshots are pruned according to policy. Snapshot count stabilizes at retention limits.
result: skipped
reason: skip, there were no snapshots created to test this.

## Summary

total: 23
passed: 13
issues: 5
pending: 0
skipped: 5

## Gaps

### Gap 1: stackBackupConfigSchema rejects null values ✓ FIXED
**Test:** 5 (Configure Per-Stack Backup Settings)
**Symptom:** Validation error when saving per-stack backup config with custom settings disabled
**Root cause:** `stackBackupConfigSchema` defines `schedule` and `retention` as `.optional()`, which accepts `undefined` but not `null`. Client explicitly sends `null` when toggling to global defaults.
**Impact:** Users cannot save per-stack backup config when switching back to global defaults
**Fix:** Change `schedule` and `retention` from `.optional()` to `.nullable().optional()` in `shared/src/validation/backups.ts` (lines 51-53)
**Files:**
- `shared/src/validation/backups.ts` (schema definition)
**Severity:** High (blocks core user workflow)
**Status:** Fixed in commit ed2ce5b
**Re-test:** Verified in Test 5 retry — now passes

### Gap 2: StackFilesystem missing getStackDirectory method
**Test:** 6 (View Volume Warnings)
**Symptom:** Volume warnings never appear, even when stack has absolute-path volumes outside its directory
**Root cause:** `StackFilesystem` class doesn't implement `getStackDirectory()` method. BackupService.getVolumeWarnings() calls `this.filesystem.getStackDirectory?.(stackId) ?? ""`, defaulting to empty string. The volume detection logic checks `!source.startsWith(stackPath)`, but every string starts with `""`, so the condition is always false.
**Impact:** Users cannot see which volumes will be excluded from backups (BCK-07 requirement)
**Fix:** Add `getStackDirectory(stackId: string): string` method to `StackFilesystem` that returns `getStackPath(stackId)` (matching the existing pattern)
**Files:**
- `server/src/infrastructure/stack-filesystem.ts` (add getStackDirectory method)
**Severity:** High (silent data loss risk — users unaware volumes aren't backed up)
**Status:** Fixed in commit e55cae5
**Re-test:** Verified in Test 6 retry — now passes

### Gap 3: Volume detection doesn't handle tilde (~) paths
**Test:** 6 (View Volume Warnings) - retry
**Symptom:** Volume warnings still don't appear for tilde-prefixed paths like `~/.memos/volumes/memos/`
**Root cause:** `detectAbsolutePathVolumes()` checks `path.isAbsolute(source)` which returns false for `~` paths. Docker Compose supports tilde expansion in volume paths, but Node's `path.isAbsolute()` doesn't recognize `~` as absolute until expanded.
**Impact:** Users with home-directory volumes (`~/...`) don't see warnings that these won't be backed up
**Fix:** Expand tilde paths before checking `isAbsolute()`: if source starts with `~`, resolve it to `path.join(os.homedir(), source.slice(1))`
**Files:**
- `server/src/application/backup-service.ts` (detectAbsolutePathVolumes method)
**Severity:** High (common pattern — users frequently use `~/` for data volumes)
**Status:** Fixed in commit d15c78f
**Re-test:** Verified in Test 6 retry — now passes

### Gap 4: BackupHistory doesn't refresh after backup trigger
**Test:** 8 (Trigger Manual Backup from Backups Tab)
**Symptom:** Backup is triggered successfully (toast appears, stack status changes), but the backup record doesn't appear in the Backup History table until page reload
**Root cause:** BackupHistory component fetches backups only once on mount (useEffect with [stackId] dependency). When BackupConfigCard triggers a backup, BackupHistory has no way to know it should refetch.
**Impact:** Users must manually reload the page to see new backup records, poor UX
**Fix:** Add polling to BackupHistory to refetch every N seconds when there are IN_PROGRESS backups, or pass a refresh trigger from parent component
**Files:**
- `client/src/routes/app/stacks/components/backup-history.tsx` (add polling or refresh prop)
**Severity:** Medium (workaround: reload page, but degrades UX)
**Status:** Fixed in commits b1996ad + 080bf4c (enhanced)
**Re-test:** Verified in Test 8 retry — now passes

### Gap 5: Live backup logs not streaming
**Test:** 10 (Stream Live Backup Logs)
**Symptom:** Backup detail page always shows "No output yet..." even when viewing an IN_PROGRESS backup
**Root cause:** Database schema is missing the `logLines` field. Prisma schema was updated to include `logLines String[]`, but the PostgreSQL database was never synced (no migration run). When Prisma queries return backup records, `logLines` is undefined, causing the UI to display "No output yet..."
**Impact:** Users cannot monitor backup progress in real-time; defeats purpose of streaming logs
**Severity:** major
**Fix:** Run `yarn workspace @docktor/server prisma db push` to add logLines column to Backup table
**Debug session:** C:\Users\D070307\workspace\docktor\.claude\worktrees\agent-a0dbfa4d\.planning\debug\completed-backup-logs-not-displaying.md

### Gap 6: Completed backup logs not displaying
**Test:** 11 (View Completed Backup Logs)
**Symptom:** Backup detail page shows "No output yet..." even for COMPLETED backups that should have stored log lines
**Root cause:** Same as Gap 5 - `logLines` column missing from database. Phase 04 Plan 01 explicitly instructed "do NOT run prisma db push", resulting in schema/database mismatch.
**Impact:** Users cannot review what happened during a backup after it completes
**Severity:** major
**Fix:** Run `yarn workspace @docktor/server prisma db push` to sync schema
**Debug session:** C:\Users\D070307\workspace\docktor\.claude\worktrees\agent-a0dbfa4d\.planning\debug\completed-backup-logs-not-displaying.md

### Gap 7: Failed backup logs not displaying
**Test:** 12 (View Failed Backup Error)
**Symptom:** Error alert appears correctly on backup detail page, but log output section shows no logs
**Root cause:** Same as Gaps 5 & 6 - `logLines` column missing from database schema
**Impact:** Users see that a backup failed but cannot diagnose why without logs
**Severity:** major
**Fix:** Run `yarn workspace @docktor/server prisma db push` to sync schema
**Debug session:** .planning/debug/failed-backup-logs-missing.md

### Gap 8: Snapshots not listed despite successful backups
**Test:** 13 (View Available Snapshots)
**Symptom:** Snapshots section shows "No snapshots found" even though Backup History shows COMPLETED backups. Server logs show "restic snapshots" failing with exit code 10.
**Root cause:** ResticExecutor.run() never throws on non-zero exit codes - it always resolves with `{exitCode, stderr}`. BackupService.runWithAutoInit() expects run() to throw when exitCode=10 so it can auto-initialize the repository, but the catch block never executes. Result: first backup runs against uninitialized repo, restic returns exit code 10, but BackupService marks it COMPLETED anyway. Repository is never initialized, so all subsequent operations fail.
**Impact:** Users cannot restore from backups if snapshots aren't visible; blocks entire restore workflow
**Severity:** blocker
**Fix:** Either modify ResticExecutor.run() to throw on non-zero exit codes, or modify runWithAutoInit() to check returned exitCode instead of catching errors
**Debug session:** /c/Users/D070307/workspace/docktor/.planning/debug/snapshots-not-listed-despite-backups.md

### Gap 9: Scheduled backups not executing
**Test:** 22 (Scheduled Backup Execution)
**Symptom:** Scheduled backup doesn't trigger automatically. Server logs show "restic snapshots --tag memos --json" failing with exit code 10. No backup record appears in Backup History.
**Root cause:** Related to Gap 8 - repository not initialized due to ResticExecutor.run() not throwing errors. BackupScheduler likely triggers but fails silently for the same reason (exit code 10 not properly handled).
**Impact:** Automated backups don't work; users must manually trigger every backup
**Severity:** blocker
**Fix:** Same fix as Gap 8 - fix ResticExecutor error handling to properly throw/handle exit code 10
