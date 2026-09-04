# Backup Process Diagnosis Guide

## Symptom
When clicking "Backup Now", nothing happens. No logs appear except:
```
[BackupScheduler] Registered 0 backup schedule(s)
```

## Diagnostic Steps

### 1. Check if Request Reaches Backend

**Action:** Click "Backup Now" button and check backend console

**Expected logs:**
```
[backups] POST /api/stacks/{stackId}/backup - initiating backup
[backups] Backup initiated with ID: {backupId}
[backups] Fetching backup dependencies for {backupId}
[backups] Dependencies fetched. repoConfig exists: true/false
```

**If you DON'T see these logs:**
- ❌ Request isn't reaching the backend at all
- Check browser dev tools Network tab - is the POST request sent?
- Check for CORS errors in browser console
- Verify backend is running on port 3000
- Check if authentication is working (session valid)

**If you see logs but repoConfig is false/null:**
- ❌ Backup repository not configured
- Go to Settings > Backup tab
- Configure repository (Local/SFTP/S3)
- Set repository password
- Save settings
- Try backup again

### 2. Check Backup Repository Configuration

**Action:** Navigate to Settings > Backup tab

**Required configuration:**
- Repository type selected (Local/SFTP/S3)
- Repository path/host configured
- Repository password set (encrypted in database)
- Restic installed (green status indicator)

**Test restic availability:**
```bash
restic version
```

**Expected:** `restic 0.17.0` or higher

**If restic is not installed:**
```bash
# Windows (via Chocolatey)
choco install restic

# macOS
brew install restic

# Linux
apt-get install restic  # Debian/Ubuntu
yum install restic       # RHEL/CentOS
```

### 3. Check Restic Repository Initialization

**Action:** For local repos, check if repository exists

```bash
# Set environment variables
export RESTIC_REPOSITORY=/path/to/backup/repo
export RESTIC_PASSWORD=your-password

# Check repository
restic snapshots
```

**Expected:** List of snapshots (or empty list if new)

**If error "Is there a repository at the following location?":**
```bash
# Initialize repository
restic init
```

### 4. Check Stack State

**Action:** Verify stack can transition to BACKING_UP state

**Check current stack status:**
- Stack must be in a state that allows BACKUP transition
- Valid source states: RUNNING, STOPPED, ERROR
- Invalid states: DEPLOYING, STOPPING, etc.

**In backend logs, look for:**
```
assertTransition(stack.status, "BACKUP")
```

**If assertion fails:**
- Stack is in a transitional state
- Wait for current operation to complete
- Try backup again

### 5. Check Database Backup Records

**Action:** Query database to see if backup records are created

```sql
SELECT id, "stackId", status, "startedAt", "completedAt", "errorMessage" 
FROM "Backup" 
ORDER BY "startedAt" DESC 
LIMIT 10;
```

**If records exist with status=IN_PROGRESS but never complete:**
- runBackup() is failing silently
- Check for exceptions in backend logs
- Verify restic binary is accessible
- Check file permissions on backup paths

### 6. Check Permissions

**Action:** Verify process has permissions

**For local repositories:**
```bash
# Check directory permissions
ls -la /path/to/backup/repo

# Check parent directory is writable
touch /path/to/backup/repo/test.txt
rm /path/to/backup/repo/test.txt
```

**For stack directories:**
```bash
# Verify read access to stack directory
ls -la /path/to/stack/directory
```

### 7. Enable Verbose Restic Logging

**Action:** Temporarily modify ResticExecutor to capture stderr

In `server/src/infrastructure/restic-executor.ts`:

```typescript
child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    console.error(`[ResticExecutor] stderr: ${text}`)
    stderrBuf += text
})
```

**This will show restic errors in real-time**

## Common Issues & Fixes

### Issue: "No logs at all"
**Cause:** Request not reaching backend
**Fix:** Check authentication, CORS, network connectivity

### Issue: "repoConfig exists: false"
**Cause:** Backup settings not configured
**Fix:** Go to Settings > Backup and complete configuration

### Issue: "Restic not installed"
**Cause:** Binary not found in PATH
**Fix:** Install restic via package manager

### Issue: "Repository not found"
**Cause:** Repository not initialized
**Fix:** Run `restic init` with correct env vars

### Issue: "Permission denied"
**Cause:** Process lacks file system access
**Fix:** Adjust directory permissions or run with elevated privileges

### Issue: "Stack in wrong state"
**Cause:** Stack status doesn't allow BACKUP transition
**Fix:** Wait for current operation to complete

## Next Steps After Diagnosis

Once you identify the issue, update this document with:
1. What the actual problem was
2. How you fixed it
3. Any additional logging/checks that should be added

This will help future debugging sessions.
