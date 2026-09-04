# Q001: Fix Restic Restore Target Path

**Status:** ✅ COMPLETED
**Duration:** 10 minutes
**Commits:** 75b8db2, 8ee75cc

## Problem

Restore operations were failing on Windows with the error:
```
Restore failed: restic exited with code 1: ignoring error for \C\Users:
error restoring creation time for: C:\C\Users : Access is denied.
error restoring file attributes for: C:\C\Users : Access is denied.
Fatal: There were 1 errors
```

**Root Cause:** The restore code used `--target /` which on Windows translates to the root of the C: drive. Restic attempted to restore files to system directories like `C:\Users`, triggering permission errors.

## Solution Implemented

Changed the restore target from hardcoded `/` to the stack's `hostPath`:

1. **ResticExecutor.buildRestoreArgs()** — Added `targetPath` parameter
   - Before: `buildRestoreArgs(snapshotId: string)`
   - After: `buildRestoreArgs(snapshotId: string, targetPath: string)`

2. **BackupService.runRestore()** — Pass stack directory as target
   - Before: `["restore", snapshotId, "--target", "/"]`
   - After: `["restore", snapshotId, "--target", stack.hostPath ?? "."]`

## Testing

- ✅ TypeScript compilation passes with zero errors
- ✅ No unit tests required updating (none directly call `buildRestoreArgs`)
- ⏳ Manual testing pending (requires actual restore operation)

## Files Changed

- `server/src/infrastructure/restic-executor.ts` (signature update)
- `server/src/application/backup-service.ts` (restore logic fix)
- `.planning/quick/Q001-fix-restore-target.md` (task documentation)
- `.planning/STATE.md` (quick task tracking)

## Impact

- **Risk Level:** Low (restore was broken, this fixes it)
- **Backward Compatibility:** N/A (restore was non-functional)
- **Side Effects:** None — backup operations unchanged

## Next Steps

User should retry the restore operation from the Backups tab. Files will now restore to the correct stack directory with appropriate permissions.
