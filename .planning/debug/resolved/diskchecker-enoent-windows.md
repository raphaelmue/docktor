---
status: resolved
trigger: "DiskChecker crashes with ENOENT on Windows - hardcoded path doesn't exist"
created: 2026-03-20T00:00:00.000Z
updated: 2026-03-20T14:55:14Z
---

## Current Focus

hypothesis: CONFIRMED - Path hardcoded as `/var/lib/docker` doesn't exist on Windows. Node's `statfs()` from Windows cannot access WSL2 paths.
test: Confirmed by code reading - no env var override and createProductionChecker() doesn't pass path
expecting: N/A - root cause confirmed
next_action: Implement fix - add DOCKER_DATA_PATH env var with platform-appropriate defaults

## Symptoms

expected: DiskChecker job runs daily at midnight and checks Docker disk usage
actual: Job crashes with ENOENT error on Windows
errors: "[server] [DiskChecker] statfs failed: Error: ENOENT: no such file or directory, statfs 'C:\\var\\lib\\docker'"
reproduction: Run DiskChecker on Windows system
started: Reported by user - Windows environment

## Eliminated

## Evidence

- timestamp: 2026-03-20T00:01:00.000Z
  checked: server/src/jobs/disk-checker.ts:23
  found: `this.monitorPath = monitorPath ?? "/var/lib/docker"` - hardcoded Linux path as default
  implication: Constructor accepts optional monitorPath parameter, but createProductionChecker() doesn't pass any value, so it always defaults to "/var/lib/docker"

- timestamp: 2026-03-20T00:02:00.000Z
  checked: server/src/jobs/disk-checker.ts:97-110
  found: createProductionChecker() creates DiskChecker with no monitorPath argument
  implication: Production instance always uses hardcoded "/var/lib/docker" path which doesn't exist on Windows

- timestamp: 2026-03-20T00:03:00.000Z
  checked: .env.example and grep for env vars
  found: Project uses env vars for paths (DOCKTOR_STACKS_DIR, DOCKTOR_DATA_DIR, DOCKTOR_BACKUP_DIR) but no DOCKER_DATA_PATH or DISK_MONITOR_PATH
  implication: Need to add new env var for configurable disk monitoring path

- timestamp: 2026-03-20T00:04:00.000Z
  checked: Windows Docker Desktop architecture
  found: Docker Desktop on Windows uses WSL2; data stored in WSL2 virtual disk. Path `/var/lib/docker` exists inside WSL2 distro, not on Windows filesystem. `statfs()` called from Windows Node process cannot access WSL2 paths directly
  implication: Need different approach - either monitor Windows drive or disable feature on Windows

## Resolution

root_cause: DiskChecker hardcodes `/var/lib/docker` as monitorPath default (line 23). On Windows, this path doesn't exist on the Windows filesystem. Docker Desktop stores data in WSL2, and Node's statfs() from Windows cannot access WSL2 paths directly, causing ENOENT error. createProductionChecker() doesn't pass a monitorPath argument, so it always uses the hardcoded default.

fix: Added DOCKER_DATA_PATH environment variable with platform-specific defaults. Updated createProductionChecker() in disk-checker.ts line 109 to read process.env.DOCKER_DATA_PATH and fall back to "." on Windows (process.platform === "win32") or "/var/lib/docker" on Linux. Updated .env.example to document the new variable.

verification: TypeScript compiles successfully. All existing tests pass plus 2 new tests added: (1) custom monitor path via constructor, (2) default path is /var/lib/docker. Tests run successfully (7 passed). Code follows DDD principles - infrastructure concern handled in createProductionChecker(), domain logic unchanged.
files_changed: ["server/src/jobs/disk-checker.ts", ".env.example", "server/test/unit/jobs/disk-checker.test.ts"]
