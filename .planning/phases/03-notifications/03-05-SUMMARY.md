---
phase: 03-notifications
plan: 05
subsystem: notifications
tags: [gap-closure, uat, smtp, disk-checker, sse, windows-support]
dependency_graph:
  requires: [03-01, 03-02, 03-03, 03-04, 03-UAT]
  provides: [uat-gap-fixes, windows-disk-monitoring, notification-sse-refresh]
  affects: [smtp-settings, notification-triggers, notification-log, disk-checker, notification-watcher]
tech_stack:
  added: []
  patterns: [platform-specific-defaults, sse-auto-refresh, env-var-configuration]
key_files:
  created: []
  modified:
    - server/src/routes/settings.ts
    - server/src/jobs/disk-checker.ts
    - server/src/jobs/notification-watcher.ts
    - client/src/routes/app/settings.tsx
    - server/src/lib/state-broadcaster.ts
    - server/src/application/notification-service.ts
    - server/src/application/index.ts
    - client/src/hooks/use-container-events.ts
    - client/src/hooks/use-stack.ts
    - server/test/unit/jobs/disk-checker.test.ts
    - server/test/unit/application/notification-service.test.ts
    - .env.example
decisions:
  - "DOCKER_DATA_PATH env var for platform-specific disk monitoring (Windows: '.', Linux: '/var/lib/docker')"
  - "notification_created SSE event type for real-time notification log updates"
  - "NotificationWatcher startup/stop logging for observability"
  - "SMTP 'from' field saved before password encryption to avoid silent save failures"
metrics:
  duration: "52 minutes"
  completed_date: "2026-03-20"
  task_count: 2
  file_count: 12
---

# Phase 03 Plan 05: UAT Gap Closure Summary

**One-liner:** Closed 7 UAT gaps: SMTP storage, Windows disk checker, threshold inputs, and notification log SSE auto-refresh with startup logging.

## Objective Achievement

**Goal:** Address 7 UAT issues (Tests 3, 4, 5, 11, 12, 16, 18) from Phase 03 verification, commit all fixes.

**Result:** ✓ Complete. All 7 UAT gaps closed and verified working by human tester.

## Tasks Completed

### Task 1: Add NotificationWatcher startup logging and commit all gap fixes
**Status:** ✓ Complete
**Commit:** `8474df7`

**Changes:**
1. Added startup/stop logging to NotificationWatcher
2. Committed all gap fixes from debug sessions:
   - SMTP from field saved before password encryption
   - DiskChecker Windows support via DOCKER_DATA_PATH
   - Disk warning threshold input fields
   - Notification log SSE auto-refresh
   - Test fixes for DiskChecker and NotificationService

**Files Modified:** 12 files (see frontmatter)

**Verification:** TypeScript compilation and unit tests passed.

### Task 2: Verify all UAT gap closures work correctly
**Status:** ✓ Complete (Human Verification)
**Type:** checkpoint:human-verify

**Verification Results:**
- Test 1: SMTP Storage (Tests 3, 4, 5) ✓
- Test 2: DiskChecker Windows (Tests 11, 12) ✓
- Test 3: Disk Threshold Inputs (Test 16) ✓
- Test 4: Notification Log Auto-Refresh (Test 18) ✓

User confirmed all 4 test scenarios passed.

## Gap Closures Implemented

### Gap 1: SMTP From Address Not Stored (Tests 3, 4, 5)
**Root Cause:** Missing ENCRYPTION_KEY env var caused password encryption to throw. The 'from' field was saved AFTER password encryption block, so when encryption failed, 'from' never got saved.

**Fix:**
- Moved `smtp.from = data.fromEmail` statement BEFORE password encryption block in `server/src/routes/settings.ts`
- Added ENCRYPTION_KEY to `.env.example` with generation instructions

**Result:** SMTP settings (including from address and password) now persist correctly.

### Gap 2: DiskChecker ENOENT on Windows (Tests 11, 12)
**Root Cause:** Hardcoded `/var/lib/docker` path doesn't exist on Windows. Docker Desktop stores data in WSL2, and Node's statfs() called from Windows cannot access those paths.

**Fix:**
- Added `DOCKER_DATA_PATH` env var support with platform-specific default logic
- Windows defaults to `.` (current directory), Linux defaults to `/var/lib/docker`
- Added to `.env.example` with documentation
- Added test coverage for custom path behavior

**Result:** DiskChecker runs without crashing on Windows.

### Gap 3: NotificationWatcher No Startup Logs (Test 12)
**Root Cause:** NotificationWatcher had no startup logging to confirm subscription to StateBroadcaster.

**Fix:**
- Added `console.log("[NotificationWatcher] Started - subscribed to StateBroadcaster")` in `start()` method
- Added `console.log("[NotificationWatcher] Stopped")` in `stop()` method

**Result:** Server logs confirm NotificationWatcher is running and subscribed.

### Gap 4: Disk Warning Threshold Inputs Missing (Test 16)
**Root Cause:** UI component never implemented the threshold input fields - only rendered toggle switches. Backend API fully supported the fields.

**Fix:**
- Added percent input (1-99%) conditionally rendered when disk warning toggle enabled
- Added bytes input with unit suffix (KB/MB/GB/TB) and helper functions
- Both inputs save on blur via API

**Result:** Threshold inputs visible and functional in Settings > Notifications.

### Gap 5: Notification Log No Auto-Refresh (Test 18)
**Root Cause:** NotificationService.notify() created notifications but didn't emit events to StateBroadcaster. NotificationLogCard fetched notifications once on mount but had no SSE subscription.

**Fix:**
- Added `notification_created` event type to StateBroadcaster
- NotificationService broadcasts event after creating notification
- NotificationLogCard subscribes via useContainerEvents hook
- Client hook refreshes notification log on receiving event

**Result:** Notification log auto-refreshes without manual page refresh.

## Deviations from Plan

None - plan executed exactly as written. All gap fixes were already implemented in working directory from debug sessions; Task 1 added logging and committed everything atomically.

## Testing

**Unit Tests:** All passed
- DiskChecker tests with DOCKER_DATA_PATH
- NotificationService tests with broadcaster mocks

**UAT Re-verification:** All 7 failing tests now pass
- Tests 3, 4, 5: SMTP storage works
- Tests 11, 12: DiskChecker runs on Windows, logs visible
- Test 16: Threshold inputs functional
- Test 18: Notification log auto-refreshes

## Artifacts

### Key Commits
- `8474df7`: fix(03-notifications): close UAT gaps for SMTP storage, disk checker, threshold inputs, and SSE refresh

### Configuration Changes
- `.env.example`: Added ENCRYPTION_KEY and DOCKER_DATA_PATH with documentation

### API Changes
None - all endpoints already supported the required functionality.

### SSE Events
- Added: `notification_created` event type for real-time notification log updates

## Next Steps

Phase 03 (Notifications) is now complete with all UAT gaps closed. Continue to Phase 04 (Backup & Restore) execution.

## Self-Check: PASSED

### Files Verified
```
FOUND: server/src/routes/settings.ts
FOUND: server/src/jobs/disk-checker.ts
FOUND: server/src/jobs/notification-watcher.ts
FOUND: client/src/routes/app/settings.tsx
FOUND: server/src/lib/state-broadcaster.ts
FOUND: server/src/application/notification-service.ts
FOUND: server/src/application/index.ts
FOUND: client/src/hooks/use-container-events.ts
FOUND: client/src/hooks/use-stack.ts
FOUND: server/test/unit/jobs/disk-checker.test.ts
FOUND: server/test/unit/application/notification-service.test.ts
FOUND: .env.example
```

### Commits Verified
```
FOUND: 8474df7
```

All key files exist and commit is in git history.
