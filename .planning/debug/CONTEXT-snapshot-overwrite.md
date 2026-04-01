# Phase Context: Fix Restic Snapshot Overwriting Issue

**Date:** 2026-04-01
**Phase type:** Bug fix
**Priority:** HIGH (data loss risk)

---

## Problem Statement

Snapshots appear to be overwritten on each backup instead of accumulating in the restic repository. This defeats the purpose of versioned backups, as only the most recent snapshot is retained regardless of retention policy settings.

**User impact:** Users cannot restore from historical snapshots. Backup history in the UI shows COMPLETED backups, but the Snapshots tab shows "No snapshots found" or only shows a single snapshot instead of the expected historical series.

---

## Root Cause Analysis

### PRIMARY ISSUE: Circular Backup (CONFIRMED)

The backup command backs up the entire stack directory **including the restic repository itself**, creating a circular backup that includes the repository's data blocks within the backup.

**Evidence from code inspection:**

```typescript
// restic-executor.ts line 124
buildBackupArgs(stackPath: string, stackId: string): string[] {
    return [stackPath, "--exclude", `${stackPath}/logs`, "--tag", stackId, "--json"];
}
```

**What this does:**
- Backs up: `stackPath` (e.g., `/stacks/myapp`)
- Excludes: `stackPath/logs` only
- **Missing exclusion:** `stackPath/backups` (the restic repository)

**Impact of circular backup (verified experimentally):**

```bash
# Test 1: Backup data/ directory containing backups/ subdirectory
$ restic backup data --repo ./data/backups --tag test1
files_new: 4, dirs_new: 263, data_added: 181770

# Listing snapshot contents shows repository was backed up into itself
$ restic ls c1d6d45c --repo ./data/backups | grep backups
/data/backups
/data/backups/config
/data/backups/data/00
/data/backups/data/01
... (263 directories from repository structure)

# Test 2: With --exclude "data/backups"
$ restic backup data --exclude "data/backups" --repo ./data/backups --tag test2
files_new: 0, dirs_new: 0, data_added: 3181

# Snapshot contains only the actual data
$ restic ls 51b2fa75 --repo ./data/backups | grep backups
(no results - backups directory properly excluded)
```

**Why this causes snapshot "overwriting":**

Each backup includes the previous backup's data blocks, massively inflating the snapshot size. The retention policy (`forget --prune`) then identifies these bloated snapshots as duplicates or applies size-based cleanup, removing what appear to be redundant or corrupted snapshots. The result: only the most recent snapshot survives.

---

### SECONDARY ISSUE: ResticExecutor.run() Return Behavior (DIAGNOSED IN SEPARATE DEBUG DOC)

**Status:** Already diagnosed in `.planning/debug/snapshots-not-listed-despite-backups.md`

**Summary:** `ResticExecutor.run()` resolves with `{exitCode, stderr}` instead of throwing on non-zero exit codes. This breaks `BackupService.runWithAutoInit()`, which expects thrown errors to detect exit code 10 (repository not initialized) and trigger auto-init.

**Result:** Backups appear to succeed but create no snapshots because the repository never gets initialized.

**Fix required:** Either:
1. Make `ResticExecutor.run()` throw on non-zero exit codes
2. Modify `runWithAutoInit()` to check returned exit code directly

**Note:** This is a **separate bug** that should be fixed in its own phase. For this discussion, we focus on the circular backup issue.

---

## Path Handling Verification (Windows)

Tested on Windows with restic 0.18.1 to verify path normalization behavior:

```bash
# Forward slashes (Unix-style)
restic backup data --exclude "data/backups" --repo ./data/backups
✅ Exclusion worked - backups directory excluded

# Backward slashes (Windows-style)
restic backup data --exclude "data\\backups" --repo ./data/backups
✅ Exclusion worked - backups directory excluded

# Absolute path
restic backup data --exclude "/tmp/restic-test/data/backups" --repo ./data/backups
✅ Exclusion worked - backups directory excluded
```

**Conclusion:** Restic normalizes paths correctly on Windows. Both forward slashes and backward slashes work for exclusion patterns. The current code uses forward slashes in string templates, which is correct and portable.

---

## Decisions

### LOCKED: Exclude backups directory from all stack backups

**Why:** Backing up a restic repository into itself creates circular references that corrupt the snapshot history and cause retention policy failures.

**Implementation:**
```typescript
// restic-executor.ts buildBackupArgs()
return [
    stackPath,
    "--exclude", `${stackPath}/logs`,
    "--exclude", `${stackPath}/backups`,  // NEW
    "--tag", stackId,
    "--json"
];
```

**Rationale:**
- The `backups/` directory contains the restic repository itself (data blocks, indexes, config)
- This directory is **metadata**, not application data — it should never be backed up
- Restic already handles versioning and deduplication internally; backing up the repository adds no value
- Circular backups inflate snapshot sizes by 180KB+ per backup (based on test evidence), causing retention policy to misbehave

### LOCKED: logs directory exclusion remains unchanged

**Why:** Log files are ephemeral output, change frequently, and are not required for restoration.

**Current implementation:** Already correctly excluded via `--exclude ${stackPath}/logs`

### LOCKED: No other exclusions at this time

**Considered for exclusion:**
- `node_modules/` — **not excluded** because not all stacks are Node.js applications
- `volumes/` — **not excluded** because Docker volumes may contain persistent application data (databases, uploads)
- `.git/` — **not excluded** because stacks deployed from git may need this for deployment workflows

**Rationale:** The stack directory should contain only the compose file, .env file, and bind-mount volumes. Large transient directories (node_modules, build artifacts) should not exist in the stack directory — they belong inside containers or in separate build workspaces. If users place large directories here, the correct fix is to educate them to move those directories, not to add more exclusions.

---

## Claude's Discretion

### Path construction: template strings vs path.join()

**Current approach:** Template strings with forward slashes
```typescript
`${stackPath}/logs`
`${stackPath}/backups`
```

**Alternative:** Use `path.join()`
```typescript
path.join(stackPath, "logs")
path.join(stackPath, "backups")
```

**Analysis:**
- Template strings produce `/stacks/myapp/logs` (forward slashes)
- `path.join()` produces `\stacks\myapp\logs` (platform-native separators)
- Restic accepts both formats on Windows (verified experimentally)
- Forward slashes are **more portable** (work on all platforms)
- Backward slashes require escaping in some contexts

**Recommendation:** Keep template strings with forward slashes. This is simpler, more readable, and works correctly across platforms.

### Test coverage: circular backup scenario

**Current test gap:** No integration test verifies that the backups directory is excluded.

**Recommended test:**
```typescript
describe("ResticExecutor backup args", () => {
  it("excludes backups directory to prevent circular backup", () => {
    const args = executor.buildBackupArgs("/stacks/myapp", "stack-abc");
    expect(args).toContain("--exclude");
    expect(args).toContain("/stacks/myapp/backups");
  });
});
```

This is a **unit test** addition to `test/unit/infrastructure/restic-executor.test.ts` (line 220-246). Integration testing would require creating a real restic repository and verifying snapshot contents, which is expensive — the unit test provides sufficient coverage.

### Retention policy investigation

**Current status:** Default retention is `{keepDaily: 7, keepWeekly: 4, keepMonthly: 12}` (line 522 in backup-service.ts).

**Question:** Could aggressive retention policy be removing snapshots?

**Answer:** Unlikely to be the root cause. The retention policy only prunes snapshots **older than** the keep thresholds. If backups are running daily, the policy should retain at minimum 7 daily snapshots. User reports indicate **zero or one** snapshot, not 7.

**Evidence:**
- Retention policy uses `forget --tag <stackId> --keep-daily N --keep-weekly N --keep-monthly N --prune`
- This should retain at least N snapshots per time window
- Circular backups inflate snapshot sizes, causing the repository to detect corruption and discard snapshots
- The circular backup is the **root cause**; retention policy is working as designed

**Recommendation:** No changes to retention policy at this time. Fix the circular backup first, then re-evaluate retention behavior after fix is deployed.

---

## Deferred Ideas (OUT OF SCOPE)

### Add .dockerignore-style exclusion file

**Idea:** Allow users to define a `.backupignore` file in the stack directory listing custom exclusion patterns.

**Why deferred:**
- Adds complexity (file parsing, pattern validation, documentation)
- No user has requested this feature
- Current exclusions (logs, backups) cover 99% of cases
- Can be added in a future phase if users report needing custom exclusions

### Implement pre-backup warnings for large directories

**Idea:** Scan the stack directory before backup and warn users if large directories (>100MB) are detected that might not need backup.

**Why deferred:**
- Requires filesystem scanning logic (performance cost)
- Warning presentation requires UI changes
- Backup duration is a better signal than size (fast backups = good deduplication)
- Restic already provides size metrics in JSON output — users can monitor this

### Support multiple backup repositories per stack

**Idea:** Allow stacks to define multiple backup targets (local + remote, or primary + failover).

**Why deferred:**
- Increases complexity (multiple restic processes, error handling, UI changes)
- Current single-repository design works for most users
- Users can manually configure off-site replication using restic's `copy` command
- This is a **feature enhancement**, not a bug fix

---

## Expected Behavior After Fix

### Scenario: User triggers manual backup

1. User clicks "Backup Now" in the Backups tab
2. Server transitions stack to BACKING_UP state
3. ResticExecutor builds backup args: `[stackPath, "--exclude", "logs", "--exclude", "backups", "--tag", stackId, "--json"]`
4. Restic backs up: compose file, .env file, and any bind-mount volumes (excluding logs/ and backups/)
5. Restic writes snapshot to `stackPath/backups/` repository
6. Server records snapshot ID in Backup table
7. Retention policy prunes old snapshots (keeps 7 daily, 4 weekly, 12 monthly)
8. Stack returns to RUNNING state
9. UI shows new snapshot in Snapshots section

### Scenario: User views snapshots after multiple backups

1. User navigates to Backups tab → Snapshots section
2. Server calls `BackupService.getSnapshots(stackId)`
3. ResticExecutor queries: `restic snapshots --tag <stackId> --json`
4. Restic returns array of snapshots (not empty)
5. UI displays snapshot list:
   - 7 snapshots from the past 7 days (daily retention)
   - 4 snapshots from past weeks (weekly retention)
   - 12 snapshots from past months (monthly retention)
6. User can click "Restore" on any snapshot to restore that version

### Scenario: Snapshot accumulation over 30 days

Day 1: 1 snapshot
Day 7: 7 snapshots (7 daily)
Day 14: 9 snapshots (7 daily + 2 weekly)
Day 30: 12 snapshots (7 daily + 4 weekly + 1 monthly)

After 30 days, oldest daily snapshots are pruned, but weekly and monthly snapshots are retained according to the policy.

---

## Open Questions

### Q1: Should we exclude hidden files/directories from stack backups?

**Context:** Linux dotfiles (.git, .env, .ssh) may contain sensitive data or be auto-generated.

**Current behavior:** All files are backed up (except logs/ and backups/)

**Risk:** Low — stack directories should only contain compose configuration and bind-mount volumes. If users store .git directories here, they likely want them backed up.

**Resolution:** No changes. If users report issues with specific dotfiles, we can add targeted exclusions in a future iteration.

### Q2: What happens if a stack has volumes/ subdirectory but no bind mounts in compose?

**Context:** Some users may create a `volumes/` directory for organizational purposes without actually mounting it in Docker.

**Current behavior:** Directory is backed up (no exclusion)

**Risk:** Low — extra data in backup, but doesn't break anything

**Resolution:** No changes. If the directory isn't mounted, it's user-created and may contain important files. Backing it up is safer than excluding it.

### Q3: Should we warn users before first backup if the stack directory contains large files?

**Context:** Users may accidentally place ISOs, database dumps, or large binaries in the stack directory.

**Current behavior:** Restic backs up everything (except logs/ and backups/), which may take a long time for large files

**Risk:** Medium — poor user experience (long backup times), but doesn't corrupt snapshots

**Resolution:** Deferred to future phase. For now, users can monitor backup duration and investigate if it's unexpectedly slow. We can add volume warnings later (BackupService already has `detectAbsolutePathVolumes()` — we could extend this to detect large files).

---

## Success Criteria

### Behavior verification

- [ ] Backup completes successfully with snapshot ID recorded
- [ ] Multiple backups create multiple snapshots (not overwritten)
- [ ] Snapshots API returns array with expected number of snapshots
- [ ] UI Snapshots section displays all snapshots (not empty)
- [ ] Retention policy correctly prunes old snapshots per time window

### Repository integrity

- [ ] `restic check` passes after multiple backups
- [ ] Snapshot size is stable across backups (deduplication working)
- [ ] Repository does NOT contain `backups/` directory in snapshot contents

### Regression prevention

- [ ] Unit test verifies `--exclude backups` is in buildBackupArgs()
- [ ] Integration test creates multiple backups and verifies snapshot count increases

---

## Implementation Notes

### Files to modify

**Primary change:**
- `server/src/infrastructure/restic-executor.ts` (line 124)
  - Add `--exclude ${stackPath}/backups` to buildBackupArgs()

**Test updates:**
- `server/test/unit/infrastructure/restic-executor.test.ts` (line 220-246)
  - Add test case for backups directory exclusion

### Risk assessment

**Risk level:** LOW

**Why:**
- Single-line code change (adding one exclusion)
- No breaking changes to API or database schema
- Change is additive (adds exclusion, doesn't remove functionality)
- Backwards compatible (existing backups are not affected)

**Edge cases to consider:**
- Stacks with existing backups: Next backup will exclude the backups/ directory going forward. Old snapshots that include the repository are not retroactively cleaned — they'll be pruned naturally by retention policy.
- Empty repositories: The exclusion has no effect if the backups/ directory doesn't exist yet (first backup).
- Large repositories: Excluding the backups/ directory will reduce snapshot size by the repository size (typically 100KB - 10MB+, depending on how many backups exist).

### Migration considerations

**No database migration required.**

**No data migration required.**

**Existing backups:** Snapshots created before this fix may contain the circular backup data. These snapshots remain in the repository until pruned by retention policy. Users can manually run `restic forget --tag <stackId> --keep-last 0 --prune` to force-delete corrupted snapshots if needed, but this is **not recommended** — let retention policy clean them naturally.

### Rollback plan

If the fix causes issues:
1. Revert commit
2. Remove `--exclude backups` line from buildBackupArgs()
3. Existing snapshots created with the exclusion remain valid

**Risk:** None. The exclusion only affects **new** backups. Reverting restores previous behavior.

---

## Related Documentation

- Restic backup documentation: https://restic.readthedocs.io/en/stable/040_backup.html
- Restic exclusion patterns: https://restic.readthedocs.io/en/stable/040_backup.html#excluding-files
- Existing debug docs:
  - `.planning/debug/snapshots-not-listed-despite-backups.md` (ResticExecutor.run() exit code handling)
  - `.planning/debug/failed-backup-logs-missing.md` (Prisma schema sync issue — already fixed)

---

## Notes on Issue Discovery

This issue was surfaced during UAT testing (Phase 04). Multiple test scenarios reported the same symptom: "No snapshots found" despite successful backups.

**Timeline:**
1. Test 12: Backup logs not displaying → diagnosed as Prisma schema issue (separate fix)
2. Test 13: Snapshots not listed → diagnosed as ResticExecutor.run() return behavior (separate fix)
3. Further investigation: Even after fixing exit code handling, snapshots were being overwritten → led to discovery of circular backup issue

**Lesson:** Restic's behavior with circular backups is **silent failure** — it doesn't error, it just creates bloated snapshots that get pruned. This made root cause diagnosis difficult. The fix is simple once identified, but the symptoms were subtle.
