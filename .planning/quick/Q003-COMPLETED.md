# Q003: Complete Restore Operation

**Status:** ✅ COMPLETED
**Duration:** 30 minutes
**Commit:** 5f4839c
**Builds on:** Q001, Q002

## Problems Addressed

User identified three issues with the restore operation:

1. **Compose file not backed up** — User concerned compose file wasn't included
2. **No restore logging** — Restore operations didn't log to notification system
3. **No service lifecycle management** — Restore didn't stop containers before restoring files or redeploy after

## Root Causes

1. **Compose file issue**: False alarm — backup already includes compose file (we backup "." which includes docker-compose.yml). Only logs/ and backups/ are excluded.
2. **Logging gap**: `runRestore()` didn't call `notificationService.notify()` for start/success events
3. **Service lifecycle**: The TODO comment at line 250 acknowledged this — "Wrap restore with docker compose down/up"

## Solution Implemented

### 1. Verified Compose File is Backed Up

No code change needed. Current backup args:
```typescript
buildBackupArgs() {
    return [".", "--exclude", "./logs", "--exclude", "./backups", ...]
}
```

Since we backup "." (entire directory) and only exclude logs/backups, the compose file is already included.

### 2. Added Restore Notification Logging

Added three notification events in `runRestore()`:
- **Start**: "Restore started for stack X from snapshot Y"
- **Success**: "Restore completed successfully"
- **Failure**: Already existed, kept as-is

Reuses `backup_failure` notification type for all restore events (type system doesn't distinguish backup vs restore).

### 3. Implemented Stop/Restore/Deploy Cycle

Updated `runRestore()` to orchestrate full lifecycle:

```typescript
async runRestore(stackId: string, snapshotId: string) {
    // 1. Stop containers
    await this.docker.stop(stackId)

    // 2. Restore files via restic
    await this.resticExecutor.run(["restore", ...], env, onLine, stackPath)

    // 3. Redeploy containers
    await this.docker.up(stackId)
}
```

**Error Handling**: Wrapped in try/finally to ensure containers restart even if restore fails partially. If stop() fails (stack already stopped), continues anyway.

**Dependency Injection**: Added `DockerExecutor` to `BackupService` constructor to avoid circular dependency with `StackService`.

## Files Changed

1. **`server/src/application/backup-service.ts`**
   - Import DockerExecutor type
   - Add `docker: DockerExecutor` to constructor
   - Updated `runRestore()` to call `docker.stop()` before restore
   - Added `docker.up()` after restore
   - Added notification calls for start/success
   - Added try/finally to restart containers on error

2. **`server/src/application/index.ts`**
   - Pass `docker` to BackupService constructor

3. **`server/test/unit/application/backup-service.test.ts`**
   - Created `createMockDockerExecutor()` helper
   - Added `mockDockerExecutor` to test suite
   - Updated test expectations to verify stop/up calls
   - Fixed restore target expectation ("." instead of "/")

## Testing

- ✅ TypeScript compilation passes
- ✅ All 29 unit tests pass
- ✅ Coverage: 75.98% statements, 54.01% branches for backup-service.ts
- ⏳ Manual testing pending

## Impact

- **Risk Level:** Medium (changes critical restore path)
- **Backward Compatibility:** Fully compatible — only adds behavior
- **Side Effects:** Restores now temporarily stop containers (expected behavior)

## Next Steps

1. **Create a new backup** with the Q002 relative paths fix
2. **Try restore operation** — should now:
   - Stop containers first
   - Restore files (including compose file)
   - Restart containers automatically
   - Log all events to notification system
3. Verify containers are running after restore completes
