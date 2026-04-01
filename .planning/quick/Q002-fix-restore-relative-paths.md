# Quick Task: Fix Restic Backup/Restore to Use Relative Paths

**Status:** Planning
**Created:** 2026-04-01
**Estimated Time:** 20 minutes

## Problem

After Q001 fix, restore still fails with:
```
failed to restore timestamp of "C:\\Users\\D070307\\workspace\\docktor\\server\\dev-data\\stacks\\memos\\C\\Users": Access is denied.
```

**Root Cause:** Restic is backing up with **absolute paths** (`/full/path/to/stack`), so when restoring to a target directory, it creates nested paths like `target/C/Users/...`.

## Solution

Change backup to use **relative paths** by:
1. Setting `cwd` (current working directory) to the stack directory when spawning restic
2. Backing up `.` (current directory) instead of absolute path
3. Restoring to `.` from the stack directory

This ensures backups contain relative paths like `./docker-compose.yml` instead of absolute paths.

## Files to Modify

1. **`server/src/infrastructure/restic-executor.ts`**
   - Add `cwd?: string` parameter to `run()` method
   - Pass `cwd` to `spawn()` options
   - Update `buildBackupArgs()` to use `"."` instead of `stackPath`
   - Update `buildRestoreArgs()` to restore to `"."` and accept optional `cwd`

2. **`server/src/application/backup-service.ts`**
   - Pass `cwd: stack.hostPath` to all `resticExecutor.run()` calls in `runBackup()`
   - Pass `cwd: stack.hostPath` to restore call in `runRestore()`
   - Update backup args to use `"."` instead of `stack.hostPath`

## Implementation Details

### ResticExecutor.run() signature change:
```typescript
async run(
    args: string[],
    env: Record<string, string>,
    onLine?: (line: string) => void,
    cwd?: string  // NEW parameter
): Promise<ResticRunResult>
```

### Backup args change:
```typescript
// Before:
["backup", "/full/path/to/stack", "--exclude", "/full/path/to/stack/logs", ...]

// After (run with cwd="/full/path/to/stack"):
["backup", ".", "--exclude", "./logs", "--exclude", "./backups", ...]
```

### Restore args change:
```typescript
// Before:
["restore", snapshotId, "--target", "/full/path/to/stack"]

// After (run with cwd="/full/path/to/stack"):
["restore", snapshotId, "--target", "."]
```

## Test Plan

1. Verify TypeScript compilation
2. Check unit tests for signature changes
3. Manual test: backup and restore a stack
4. Verify restored files have correct paths (no nested C:\Users\...)

## Risk Assessment

**Medium risk** — Changes both backup and restore. Existing backups with absolute paths will need special handling or re-creation.

## Notes

- Existing backups created with absolute paths will still have absolute paths stored
- Users may need to create new backups after this fix
- Consider adding migration logic or documentation about re-backing up
