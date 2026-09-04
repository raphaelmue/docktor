# Quick Task: Fix Restic Restore Target Path

**Status:** Planning
**Created:** 2026-04-01
**Estimated Time:** 10 minutes

## Problem

Restore is failing with:
```
Restore failed: restic exited with code 1: ignoring error for \C\Users:
error restoring creation time for: C:\C\Users : Access is denied.
error restoring file attributes for: C:\C\Users : Access is denied.
Fatal: There were 1 errors
```

Root cause: `backup-service.ts:255` uses `--target /` which on Windows causes restic to restore to the root drive (`C:\`), leading to permission errors trying to restore system directories.

## Solution

Change the restore target from `--target /` to `--target <stackPath>` to restore files directly into the stack's directory where Docktor has write permissions.

## Files to Modify

1. `server/src/application/backup-service.ts` (line 255)
   - Change: `["restore", snapshotId, "--target", "/"]`
   - To: `["restore", snapshotId, "--target", stack.hostPath ?? "."]`

2. `server/src/infrastructure/restic-executor.ts` (line 151)
   - Update `buildRestoreArgs(snapshotId: string)` signature to accept target path
   - Change to: `buildRestoreArgs(snapshotId: string, targetPath: string): string[]`
   - Return: `["restore", snapshotId, "--target", targetPath]`

## Test Plan

1. Verify TypeScript compilation succeeds
2. Manually test restore operation on a test stack
3. Verify restored files appear in the correct stack directory

## Risk Assessment

**Low risk** — restore is currently broken, this fixes it. No impact on backup operations.
