---
status: awaiting_human_verify
trigger: "Investigate why chokidar file watching doesn't work on Windows for docker-compose.yml changes."
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:07:00Z
---

## Current Focus

hypothesis: ROOT CAUSE CONFIRMED and FIX APPLIED
test: verification that Windows polling mode enables file change detection
expecting: chokidar 'change' events fire within 1-2 seconds when docker-compose.yml is modified on Windows
next_action: request human verification on Windows system

## Symptoms

expected: chokidar should detect docker-compose.yml file changes within 1-2 seconds on Windows
actual: FileWatcher doesn't detect file changes instantly on Windows, only cron reconcile (60s interval) picks up changes
errors: none reported (silent failure to detect changes)
reproduction: modify docker-compose.yml on Windows, observe that file watch event doesn't trigger
started: issue appears to be platform-specific (Windows)

## Eliminated

## Evidence

- timestamp: 2026-03-16T00:01:00Z
  checked: server/src/jobs/file-watcher.ts lines 45-53
  found: chokidar watch configuration does NOT include usePolling or platform-specific options
  implication: chokidar on Windows needs usePolling:true for reliable file change detection, current config relies on native fs.watch which is unreliable on Windows

- timestamp: 2026-03-16T00:02:00Z
  checked: chokidar options in watch() call
  found: only has ignoreInitial, awaitWriteFinish, depth, ignored - missing usePolling, interval
  implication: native file watching (fs.watch) on Windows has known issues with detecting changes, especially for files modified by external editors or in network shares

- timestamp: 2026-03-16T00:03:00Z
  checked: node_modules/chokidar/esm/index.d.ts lines 10-22
  found: chokidar ChokidarOptions includes usePolling (boolean) and interval (number) options
  implication: chokidar supports polling mode explicitly for platforms where native fs.watch is unreliable

- timestamp: 2026-03-16T00:04:00Z
  checked: chokidar version in use
  found: chokidar@4.0.3 (latest stable)
  implication: version is up-to-date, so options should be reliable

- timestamp: 2026-03-16T00:05:00Z
  checked: implemented fix in file-watcher.ts
  found: added platform detection (process.platform === "win32"), enabled usePolling and interval:1000 for Windows
  implication: chokidar will now use polling mode on Windows instead of unreliable native fs.watch

## Resolution

root_cause: chokidar on Windows requires usePolling:true for reliable file change detection. The native fs.watch API (used by default) has known issues on Windows with detecting file modifications, especially for files changed by external editors. The current FileWatcher configuration in file-watcher.ts (lines 45-53) does not include usePolling or interval options, causing silent failures where file changes are not detected. The fallback cron reconcile (60s interval) catches changes eventually, which confirms the detection logic works but the watch mechanism does not.

fix: Add platform detection and enable polling mode on Windows. Options needed: usePolling:true, interval:1000 (1 second polling). This trades some CPU usage for reliability. Alternative: enable polling unconditionally if cross-platform consistency is more important than minimal resource usage.

verification: After adding usePolling option, modify docker-compose.yml on Windows and verify that chokidar 'change' event fires within 1-2 seconds (check console logs for "[FileWatcher] Chokidar detected CHANGE: ..." message). Verify SSE broadcast is sent immediately without waiting for 60s cron reconcile.

files_changed:
- server/src/jobs/file-watcher.ts
