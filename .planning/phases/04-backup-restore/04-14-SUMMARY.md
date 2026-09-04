---
phase: 04-backup-restore
plan: 14
subsystem: backup-restore
tags: [backup, restic, bugfix, TDD]
dependency_graph:
  requires: [04-10, 04-11]
  provides: [circular-backup-fix]
  affects: [backup-service, restic-executor]
tech_stack:
  added: []
  patterns: [TDD, exclusion-pattern]
key_files:
  created: []
  modified:
    - server/src/infrastructure/restic-executor.ts
    - server/test/unit/infrastructure/restic-executor.test.ts
decisions:
  - Added second --exclude flag to buildBackupArgs() for /backups directory
  - Maintains existing pattern of multiple --exclude flags for different directories
key_metrics:
  duration_minutes: 5
  tasks_completed: 2
  files_modified: 2
  tests_added: 1
  commits: 2
completed_date: "2026-04-01"
---

# Phase 04 Plan 14: Fix Circular Backup Issue Summary

**One-liner:** Prevent restic from backing up its own repository directory by excluding ${stackPath}/backups from backup operations

## What Was Built

Fixed circular backup issue where restic was backing up its own repository directory (`${stackPath}/backups`) into itself, causing snapshot corruption and incorrect retention behavior.

**Implementation:**
- Added `--exclude ${stackPath}/backups` flag to `buildBackupArgs()` method
- Added test coverage verifying the exclusion is present in backup arguments
- Followed TDD approach: RED (failing test) → GREEN (implementation) → commit

**Technical approach:**
The fix adds a second `--exclude` flag to the restic backup arguments array, positioned after the source path but before the `--tag` and `--json` flags. This prevents restic from reading its own repository data as backup source content, which was causing snapshots to be identified as duplicates and pruned incorrectly.

## Deviations from Plan

None - plan executed exactly as written. Both tasks completed following TDD protocol.

## Testing

**Test coverage:**
- Added test: "includes --exclude <stackPath>/backups to prevent circular backup"
- Test verifies both `--exclude` flag and `/stacks/myapp/backups` path are present in args array
- All 19 restic-executor tests pass
- TypeScript compilation succeeds with no errors

**TDD flow:**
1. RED: Test added and confirmed failing (missing exclusion in buildBackupArgs())
2. GREEN: Implementation added and test passes
3. Both states committed separately per TDD protocol

**Out of scope:**
- One pre-existing test failure in `backup-service.test.ts` ("stops the stack before restoring") - unrelated to this change, involves call ordering in runRestore() method

## Impact

**Before fix:**
- First backup: Creates snapshot of stackPath including empty `/backups` subdirectory
- Second backup: Includes `/backups` with first snapshot's data → restic detects as duplicate → overwrites previous snapshot
- Retention policy operates on corrupted data → snapshots pruned incorrectly
- Result: Only 0-1 snapshots survive instead of accumulating

**After fix:**
- Backups exclude the `/backups` repository directory entirely
- Each backup creates a distinct snapshot with unique content hash
- Snapshots accumulate normally according to retention policy (keepDaily, keepWeekly, keepMonthly)
- Repository integrity maintained across backup and prune operations

**Affected requirements:**
- **BCK-02**: "User can trigger a manual backup" - now creates uncorrupted snapshots
- **BCK-04**: "User can configure retention policy" - retention now works correctly with accumulated snapshots

## Files Changed

**Modified:**
1. `server/src/infrastructure/restic-executor.ts` (226 lines)
   - buildBackupArgs() now returns 7-element array with two --exclude flags
   - Updated JSDoc comment to reflect new format

2. `server/test/unit/infrastructure/restic-executor.test.ts` (305 lines)
   - Added test case for /backups exclusion in "backup args" describe block

## Known Stubs

None. No hardcoded values or placeholders introduced.

## Verification

**Automated:**
- ✅ All restic-executor tests pass (19/19)
- ✅ TypeScript compilation succeeds
- ✅ Exclusion present in buildBackupArgs() implementation

**Manual verification needed:**
To fully verify the fix resolves the snapshot corruption issue:
1. Clear existing repository: `rm -rf /path/to/stack/backups`
2. Trigger 3 consecutive backups via UI
3. Verify 3 distinct snapshots listed: `restic -r /path/to/stack/backups snapshots`
4. Check snapshot content excludes backups directory: `restic -r /path/to/stack/backups ls <snapshot-id>`
5. Verify Snapshots section in UI lists all 3 snapshots (not just 1)
6. Wait for retention policy to trigger prune
7. Confirm snapshots are retained per policy instead of being pruned to 0-1

## Commits

| Hash    | Type | Message |
|---------|------|---------|
| 75139ad | test | Add failing test for backups directory exclusion (TDD RED) |
| 3488e7c | feat | Exclude /backups directory from restic backup operations (TDD GREEN) |

## Self-Check: PASSED

**Files created:** None expected, none created.

**Files modified:**
- ✅ FOUND: server/src/infrastructure/restic-executor.ts (--exclude flag for /backups added)
- ✅ FOUND: server/test/unit/infrastructure/restic-executor.test.ts (test added at line 247-252)

**Commits exist:**
- ✅ FOUND: 75139ad (test commit)
- ✅ FOUND: 3488e7c (implementation commit)

All claims verified successfully.
