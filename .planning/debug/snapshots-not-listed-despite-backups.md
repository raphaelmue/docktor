---
status: diagnosed
trigger: "Snapshots not listed despite successful backups"
created: 2026-03-31T16:54:00Z
updated: 2026-03-31T17:02:00Z
---

## Current Focus

hypothesis: CONFIRMED - BackupService.buildEnv() uses different RESTIC_REPOSITORY path for backups vs snapshots queries
test: trace RESTIC_REPOSITORY path construction in buildEnv() method
expecting: backup writes to stack-local directory, snapshots reads from configured repo (mismatch)
next_action: document root cause and file locations

## Symptoms

expected: In Backups tab, Snapshots section lists all restic snapshots for the stack. Each snapshot shows date, paths backed up. Refresh button allows manual snapshot list refresh.
actual: Snapshots section shows "No snapshots found" even though Backup History shows COMPLETED backups
errors: Server logs show "restic snapshots --tag memos --json" failing with exit code 10 (repeated)
reproduction: Test 13 in UAT (.planning/phases/04-backup-restore/04-UAT.md) - navigate to Backups tab after successful backup
started: Discovered during UAT

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-03-31T16:54:00Z
  checked: ResticExecutor.buildEnv() method (lines 152-167)
  found: This method builds env using buildRepoUrl() which respects repoType configuration (local/sftp/s3)
  implication: ResticExecutor has standard env building for general restic operations

- timestamp: 2026-03-31T16:55:00Z
  checked: BackupService.buildEnv() method (lines 531-552)
  found: ALWAYS overrides RESTIC_REPOSITORY with stack-local path: `path.join(stackPath, "backups")` when stackPath is provided (line 538). Only falls back to configured repo when stackPath is undefined (line 541-549).
  implication: Backups write to <stackPath>/backups, NOT to the configured repository

- timestamp: 2026-03-31T16:56:00Z
  checked: BackupService.runBackup() method (lines 136-213)
  found: Calls `this.buildEnv(repoConfig, stack.hostPath ?? undefined)` on line 148. Since stack.hostPath is always present for deployed stacks, backups write to stack-local directory.
  implication: Successful backups are creating snapshots in <stackPath>/backups directory

- timestamp: 2026-03-31T16:57:00Z
  checked: BackupService.getSnapshots() method (lines 409-415)
  found: Calls `this.buildEnv(repoConfig, stack.hostPath ?? undefined)` on line 413. Same signature as runBackup.
  implication: getSnapshots() SHOULD use same directory as runBackup() since both pass stackPath

- timestamp: 2026-03-31T16:58:00Z
  checked: ResticExecutor.snapshots() method (lines 133-146)
  found: Returns empty array [] on exit code 10 (line 141). Does NOT throw or auto-init. Exit code 10 means "repository not found or not initialized"
  implication: Repository exists but is not initialized, OR pointing to wrong location

- timestamp: 2026-03-31T16:59:00Z
  checked: BackupService.runBackup() uses runWithAutoInit() (line 164)
  found: runWithAutoInit() catches exit code 10 and runs `restic init` automatically (lines 456-476). This initializes the repository on first backup.
  implication: Backup succeeds because runWithAutoInit auto-initializes the repo. But getSnapshots() calls resticExecutor.snapshots() directly WITHOUT auto-init logic.

- timestamp: 2026-03-31T17:00:00Z
  checked: Code path comparison
  found:
    - runBackup: buildEnv(config, stackPath) → runWithAutoInit → restic init (if needed) → restic backup → SUCCESS
    - getSnapshots: buildEnv(config, stackPath) → resticExecutor.snapshots → restic snapshots → EXIT 10 (repo not initialized)
  implication: Both use same RESTIC_REPOSITORY path, but getSnapshots fails because it doesn't trigger auto-init

- timestamp: 2026-03-31T17:05:00Z
  checked: ResticExecutor.run() return behavior (lines 85-91)
  found: Line 89 ALWAYS resolves: `resolve({exitCode: code ?? 1, stderr: stderrBuf})`. Line 83 only rejects on spawn errors (`child.on("error", reject)`), NOT on non-zero exit codes.
  implication: run() never throws for exit code 10, it returns it in the result object

- timestamp: 2026-03-31T17:06:00Z
  checked: BackupService.runWithAutoInit() (lines 456-476)
  found: Line 462 calls `await this.resticExecutor.run(args, env, onLine)` but does NOT capture or check the return value. Try-catch only catches thrown errors. Exit codes are returned, not thrown.
  implication: runWithAutoInit's catch block (lines 463-475) NEVER executes for exit code 10, so auto-init logic never runs

- timestamp: 2026-03-31T17:07:00Z
  checked: ResticExecutor.snapshots() method (lines 133-146)
  found: Line 141 checks `if (exitCode === 10) return []` after calling run(). Line 142 throws on other non-zero codes. This method DOES handle exit codes properly.
  implication: snapshots() is implemented correctly (checks returned exitCode), but runWithAutoInit is not (expects thrown error)

## Resolution

root_cause: ResticExecutor.run() does not throw on non-zero exit codes — it resolves with {exitCode, stderr} (line 89 in restic-executor.ts). BackupService.runWithAutoInit() expects run() to throw when exitCode=10 so it can catch the error and run `restic init` (lines 463-471 in backup-service.ts). But since run() never throws, the catch block never executes, auto-init never happens, and backups "succeed" without creating any snapshots. The repository at `<stackPath>/backups` remains uninitialized, causing all subsequent `restic snapshots` queries to return exit code 10 (repository not found).

fix: Modify ResticExecutor.run() to throw an error object containing exitCode and stderr when exitCode is non-zero (except exit 0). This will allow runWithAutoInit's catch block to detect exit code 10 and trigger repository initialization. Alternative: modify runWithAutoInit to check the returned exitCode directly instead of relying on thrown errors.

verification:
1. Clear any existing backup directories
2. Configure backup repository settings
3. Trigger a backup
4. Verify server logs show "restic init" being run on first backup
5. Verify backup completes successfully with snapshot ID
6. Query snapshots API endpoint
7. Confirm snapshots are listed (not empty)
8. Verify Backups tab Snapshots section displays the snapshot

files_changed:
  - server/src/infrastructure/restic-executor.ts (run method - throw on non-zero exitCode)
  - OR server/src/application/backup-service.ts (runWithAutoInit - check returned exitCode)
