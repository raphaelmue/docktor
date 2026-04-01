# Q002: Fix Restic Relative Paths

**Status:** ✅ COMPLETED
**Duration:** 20 minutes
**Commit:** c0302fa
**Builds on:** Q001

## Problem

After Q001 fix, restore still failed with:
```
failed to restore timestamp of "C:\\Users\\D070307\\workspace\\docktor\\server\\dev-data\\stacks\\memos\\C\\Users": Access is denied.
```

**Root Cause:** Restic was backing up with **absolute paths** like `C:\Users\D070307\workspace\docktor\server\dev-data\stacks\memos`, so snapshots contained those absolute paths. When restoring to a target directory, restic placed those absolute paths **under** the target, creating invalid nested paths like `target/C/Users/...`.

## Solution Implemented

Changed backup/restore to use **relative paths** by running restic from the stack directory with `cwd`:

1. **ResticExecutor.run()** — Added optional `cwd` parameter
   - Passed to `spawn()` options to set working directory
   - When `cwd` is set to stack directory, "." resolves to that directory

2. **ResticExecutor.buildBackupArgs()** — Use relative paths
   - Before: `[stackPath, "--exclude", `${stackPath}/logs`, ...]`
   - After: `[".", "--exclude", "./logs", "--exclude", "./backups", ...]`

3. **ResticExecutor.buildRestoreArgs()** — Restore to current directory
   - Before: `["restore", snapshotId, "--target", targetPath]`
   - After: `["restore", snapshotId, "--target", "."]`

4. **BackupService** — Pass `cwd` to all restic operations
   - Extract `stackPath` from `stack.hostPath`
   - Pass `cwd: stackPath` to all `resticExecutor.run()` calls
   - Pass `cwd: stackPath` to `runWithAutoInit()`

## Testing

- ✅ TypeScript compilation passes
- ✅ All 19 unit tests pass (updated test expectations)
- ✅ Test coverage: 72.97% statements, 44.18% branches for restic-executor.ts
- ⏳ Manual testing pending

## Files Changed

- `server/src/infrastructure/restic-executor.ts` (add cwd parameter, use relative paths)
- `server/src/application/backup-service.ts` (pass cwd to all restic calls)
- `server/test/unit/infrastructure/restic-executor.test.ts` (update expectations)
- `.planning/quick/Q002-fix-restore-relative-paths.md` (task documentation)
- `.planning/quick/Q001-COMPLETED.md` (Q001 summary)

## Breaking Changes

**Important:** Existing backups created with absolute paths will still contain absolute paths. Users may need to:
- Delete old backups
- Create new backups after this fix
- Or manually handle restore of old snapshots

Consider adding migration documentation or UI warning about this.

## Impact

- **Risk Level:** Medium (changes both backup and restore logic)
- **Backward Compatibility:** Existing snapshots with absolute paths won't restore correctly
- **Side Effects:** None for new backups/restores

## Next Steps

1. User should **create a new backup** with the fixed code
2. Retry restore operation - files will restore to correct locations
3. Consider cleaning up old backups with absolute paths
