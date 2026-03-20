# Remaining Backup Issues

## Issue #1: Logs Not Streaming to UI (Task #5)

**Problem:** Backend logs show backup working, but UI shows "no output yet"

**What Works:**
- Backend captures logs: `[BackupService] Log line: ...`
- Logs are saved to database: `logLines: lines`
- SSE endpoint exists: `/api/backups/:id/stream`

**What to Check:**
1. Is restic actually outputting to stdout? (Run manual test)
2. Are logs actually in database after backup completes?
3. Is SSE connection established? (check browser Network tab)
4. Is `onLine` callback being invoked?

**Debug Steps:**
```bash
# Manual restic test
cd /path/to/stack
set RESTIC_REPOSITORY=./backups
set RESTIC_PASSWORD=test123
restic init
restic backup . --exclude logs --tag stackid --json

# Check if output appears - if not, restic might not be installed or PATH issue
```

**Likely Causes:**
- Restic not installed or not in PATH
- Restic not outputting anything (silent success)
- Repository already exists and backup is very fast (no output)
- SSE connection issue on client side

## Issue #3: No Snapshots Created (Task #7)

**Problem:** Backups complete but no snapshots shown

**Related to Issue #1** - If restic isn't running properly, no snapshots are created.

**What to Check:**
```bash
# After a backup completes, check manually
cd /path/to/stack
set RESTIC_REPOSITORY=./backups
set RESTIC_PASSWORD=test123
restic snapshots --tag stackid

# Should show list of snapshots. If empty, backup didn't work.
```

**Likely Causes:**
- Same as Issue #1 (restic not running)
- Wrong repository path
- Snapshot ID not being parsed from JSON output

**Snapshot ID Parsing:**
The code expects JSON output from restic with `snapshot_id` field.
Check if `parseSnapshotId()` is finding it in the log lines.

## Quick Test Plan

1. **Test restic manually:**
   ```bash
   restic version  # Should show version
   cd C:\Users\D070307\dev-data\stacks\memos  # or your stack path
   mkdir backups
   set RESTIC_REPOSITORY=./backups
   set RESTIC_PASSWORD=test123
   restic init
   restic backup . --exclude logs --tag memos --json
   restic snapshots --tag memos
   ```

2. **Check database:**
   ```sql
   SELECT id, status, "resticSnapshotId", array_length("logLines", 1) as line_count
   FROM "Backup"
   ORDER BY "startedAt" DESC
   LIMIT 5;
   ```

3. **Check SSE in browser:**
   - Open DevTools > Network
   - Trigger backup
   - Look for request to `/api/backups/{id}/stream`
   - Should stay open (EventSource)
   - Check if messages are received

## Next Actions

Once we identify which part is failing:
- **If restic not found:** Install restic and add to PATH
- **If no output:** Check why restic is silent (maybe add --verbose flag)
- **If SSE broken:** Debug client-side EventSource connection
- **If parsing broken:** Fix snapshot ID extraction

## Code Locations

- Log capture: `server/src/infrastructure/restic-executor.ts:63-77`
- SSE streaming: `server/src/routes/backups.ts:122-175`
- Client hook: `client/src/hooks/use-backup-stream.ts`
- Snapshot parsing: `server/src/application/backup-service.ts:546-556`
