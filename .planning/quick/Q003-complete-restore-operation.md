# Quick Task: Fix Restore Operation Completeness

**Status:** Planning
**Created:** 2026-04-01
**Estimated Time:** 30 minutes

## Problems

1. **Compose file not backed up** — Current backup excludes `./logs` and `./backups` but doesn't ensure compose file is included
2. **No restore logging** — Restore operation doesn't log to the backup log (database notifications table)
3. **No service lifecycle management** — Restore doesn't stop containers before restoring files or redeploy after

## Root Causes

1. The backup args only exclude directories but don't explicitly include files. Need to verify compose file is included.
2. Restore operation (`runRestore`) doesn't integrate with notification logging like backup does.
3. The TODO comment at line 250-252 of backup-service.ts acknowledges this: "Wrap restore with docker compose down/up"

## Solution

### 1. Ensure Compose File is Backed Up

Review what's actually being backed up. Since we backup "." from the stack directory and only exclude `./logs` and `./backups`, the compose file (`docker-compose.yml`) should already be included. Need to verify this with a test backup.

**If missing:** Add explicit include for compose file or investigate exclusion patterns.

### 2. Add Restore Logging

Create notification log entries for restore operations:
- Start: "Restore started for stack X from snapshot Y"
- Success: "Restore completed successfully"
- Failure: Already sends notification, but should also log to notification table

Update `runRestore()` in backup-service.ts to call `notificationService.notify()` for start/success events.

### 3. Implement Stop/Restore/Deploy Cycle

Inject `StackService` or `DockerExecutor` into `BackupService` to orchestrate:

```typescript
async runRestore(stackId: string, snapshotId: string): Promise<{id: string}> {
    // 1. Stop stack (docker compose down)
    await this.stackService.stopStack(stackId)

    // 2. Restore files via restic
    await this.resticExecutor.run([...], env, onLine, stackPath)

    // 3. Deploy stack (docker compose up -d)
    await this.stackService.deployStack(stackId)
}
```

**Dependency:** Requires adding StackService to BackupService constructor or creating a new orchestration service.

## Files to Modify

1. **`server/src/application/backup-service.ts`**
   - Add `StackService` dependency to constructor
   - Update `runRestore()` to call stop/restore/deploy
   - Add notification logs for restore start/success
   - Remove TODO comment once implemented

2. **`server/src/application/index.ts`**
   - Update BackupService singleton construction to inject StackService

3. **`server/src/routes/backups.ts`**
   - Verify restore endpoint passes through any errors properly

4. **Test backup contents** (manual)
   - Create a test backup
   - List snapshot contents with `restic ls <snapshot-id>`
   - Verify docker-compose.yml is present

## Alternative: Simpler Approach Without DI

If avoiding circular dependencies between services:

1. Use `DockerExecutor` directly (already available)
2. Duplicate stop/deploy logic from StackService inline
3. Trade-off: Some code duplication but simpler dependency graph

## Test Plan

1. Create a backup of a running stack
2. Verify compose file is in the snapshot (restic ls)
3. Modify the compose file locally
4. Trigger restore
5. Verify:
   - Containers stopped before restore
   - Files restored (compose file reverted)
   - Containers restarted after restore
   - Notification logs created for restore events
   - Stack status transitions: RUNNING → RESTORING → RUNNING

## Risk Assessment

**Medium risk** — Touching critical restore path. Errors could leave stacks in stopped state.

**Mitigation:** Wrap in try/finally to ensure stack is restarted even if restore fails partially.
