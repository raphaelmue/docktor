# Session Handoff: Backup Issues

## Current Status

**Session Date:** 2026-03-20
**Branch:** feature/mvp-implementation
**Latest Commit:** 30de4a9

### Issues Fixed ✅
1. Backup settings not persisting (schema validation + null handling)
2. Breadcrumbs now show active tab
3. Backups stored per-stack in `{stackPath}/backups/`
4. Request logging disabled
5. URL-accessible stack tabs

### Issues Remaining 🔧
1. **Logs not streaming to UI** - Backend shows logs captured, UI shows "no output yet"
2. **No snapshots created** - Likely related to issue #1

## Critical Information

### Architecture Changes
- Backups now stored in `{stackPath}/backups/` instead of central repo
- Only password needed in settings (repo type field kept for future features)
- Each stack has isolated restic repository

### Debug Logging Added
- `[BackupService]` logs show backup start, repo path, log lines, completion
- `[ResticExecutor]` logs show process spawn, stdout chunks, line emission
- `[backups]` route logs show request handling and settings save

### Test Commands Ready
```bash
# Manual restic test to verify installation
restic version

# Test backup manually
cd C:\Users\D070307\dev-data\stacks\memos
set RESTIC_REPOSITORY=./backups
set RESTIC_PASSWORD=test123
restic init
restic backup . --exclude logs --tag memos --json
restic snapshots --tag memos
```

## Next Session Tasks

### Priority 1: Identify Root Cause
Run manual restic test above and check:
- [ ] Does restic output appear?
- [ ] Are snapshots created?
- [ ] What's in backend console during backup?

### Priority 2: Fix Based on Findings

**If restic outputs nothing:**
- Restic might need --verbose flag
- Or restic not installed/not in PATH
- Check stderr output

**If restic works manually but not via Node:**
- Check spawn environment variables
- Verify PATH is inherited
- Check stderr in ResticExecutor

**If logs captured but UI doesn't show:**
- Check database: `SELECT "logLines" FROM "Backup" ORDER BY "startedAt" DESC LIMIT 1;`
- Check SSE connection in browser DevTools Network tab
- Verify client hook is receiving events

**If no snapshots:**
- Check if backup actually completes successfully
- Verify snapshot ID parsing logic
- Check restic JSON output format

## Key Files

### Backend
- `server/src/application/backup-service.ts` - Orchestration, buildEnv modified for per-stack repos
- `server/src/infrastructure/restic-executor.ts` - Spawns restic, captures output
- `server/src/routes/backups.ts` - SSE streaming endpoint
- `server/src/repositories/backup-repository.ts` - Database operations

### Frontend
- `client/src/hooks/use-backup-stream.ts` - SSE hook
- `client/src/routes/app/stacks/backups/[backupId].tsx` - Log viewer page
- `client/src/components/common/log-output.tsx` - Reusable log display

### Diagnostic Docs
- `.planning/phases/04-backup-restore/BACKUP-DIAGNOSIS.md` - Full troubleshooting guide
- `.planning/phases/04-backup-restore/REMAINING-ISSUES.md` - Detailed issue analysis

## Commits This Session

1. `b2b6e3b` - Disable verbose HTTP request logging
2. `d01685b` - Add backup process debug logging
3. `7e5eb81` - Make stack detail tabs URL-accessible
4. `7e50a50` - Add reusable LogOutput component
5. `8a034d8` - Fix backup settings schema (allow nullable fields)
6. `3acbee4` - Fix null value handling in settings save
7. `c77d609` - Store backups per-stack (major change)
8. `5d20849` - Fix breadcrumbs
9. `30de4a9` - Document remaining issues

## Quick Context Refresh

User reported 4 issues after Phase 04 implementation:
1. URL-accessible tabs → **Fixed**
2. Request log spam → **Fixed**
3. Backup logs not visible → **Investigating**
4. Backup location unclear → **Fixed (per-stack now)**

The backup feature is 95% working - backups can be triggered, state machine works, database updates correctly. The only issues are:
- Visual feedback (logs) not showing
- Snapshots list empty (likely same root cause)

Most likely cause: restic not in PATH or not outputting anything. Quick manual test will confirm.

## How to Resume

1. Review this document
2. Run manual restic test
3. Share results
4. We'll fix based on findings
5. Complete Phase 04 verification
