---
phase: 04-backup-restore
plan: 10
subsystem: backup-restore
type: gap-closure
tags: [restic, backup, logging, error-handling, stderr]
completed: 2026-04-01T09:13:00Z
duration_minutes: 7

dependencies:
  requires: []
  provides:
    - stderr-capture-in-backup-logs
  affects:
    - backup-log-viewer
    - backup-failure-diagnosis

tech_stack:
  added: []
  patterns:
    - Line buffering for stderr streaming
    - Prefixed stderr lines for clear identification

key_files:
  created: []
  modified:
    - server/src/infrastructure/restic-executor.ts
    - server/test/unit/infrastructure/restic-executor.test.ts

decisions:
  - Prefix stderr lines with "[stderr]" for clear distinction from stdout in UI
  - Use separate line buffer (stderrLineBuf) for stderr to avoid corrupting accumulated stderrBuf
  - Trim partial lines on flush to remove trailing whitespace from error messages
  - Keep existing stderrBuf accumulation for error message and return value compatibility

metrics:
  tasks_completed: 3
  commits: 2
  files_modified: 2
  tests_added: 4
  tests_passing: 208
---

# Phase 04 Plan 10: Capture stderr in Backup Logs Summary

**One-liner:** ResticExecutor now emits stderr lines with [stderr] prefix to onLine callback, enabling failed backup diagnosis from UI log viewer.

## What Was Built

### Core Feature
Modified `ResticExecutor.run()` to stream restic stderr output to the `onLine` callback, prefixed with `[stderr]` for clear identification in the UI. Previously, stderr was captured in a buffer but never emitted to the callback, leaving backup log lines empty or missing critical error information when backups failed.

### Implementation Details

**stderr Line Buffering** (matching stdout pattern):
- Added `stderrLineBuf` variable for line assembly
- Split stderr chunks on newlines, keeping partial lines in buffer
- Emit complete lines to `onLine` callback with `[stderr]` prefix
- Flush remaining partial line on process close (trimmed)

**Backward Compatibility:**
- Existing `stderrBuf` accumulation preserved for error message and return value
- `ResticRunResult.stderr` field still contains full stderr text
- Error rejection behavior unchanged (non-zero exit code throws with stderr in message)
- All existing tests continue to pass

**TDD Approach:**
- Task 1: Added 4 failing tests (RED state) covering stderr emission, interleaving, buffering, and flush
- Task 2: Implemented feature to make tests pass (GREEN state)
- Task 3: Verified TypeScript compilation and full test suite

## Deviations from Plan

None - plan executed exactly as written. All three tasks completed successfully with TDD discipline maintained throughout.

## Verification Results

✅ TypeScript compilation: No errors
✅ All restic-executor tests: 208 passed (4 new tests added)
✅ Test coverage: stderr emission, interleaved stdout/stderr, partial line buffering, flush on close
✅ Backward compatibility: All existing tests pass, no breaking changes

### UAT Impact
**Test 11 (Backup Failure Handling):** Should now PASS - failed backup log lines will include diagnostic stderr output prefixed with `[stderr]`, enabling users to diagnose backup failures from the UI without accessing server logs.

## Integration Points

### Upstream Dependencies
- `BackupService.runBackup()` passes `onLine` callback that pushes lines to array
- That array is persisted to `Backup.logLines` field in database

### Downstream Impact
- **Backup log viewer** (Backups tab > detail modal): Will now display stderr content for failed backups
- **Error diagnosis**: Users can see restic error messages (e.g., "Fatal: repository does not exist", "connection timeout") directly in UI
- **Support workflow**: Reduced need for SSH access to check server logs

## Known Stubs

None - this is a pure infrastructure fix with no UI changes or stub dependencies.

## Files Modified

### server/src/infrastructure/restic-executor.ts
**Changes:**
- Added `stderrLineBuf` variable for line buffering
- Modified `child.stderr.on("data")` handler to emit lines to `onLine` with `[stderr]` prefix
- Modified `child.on("close")` handler to flush remaining stderr buffer

**Key Code:**
```typescript
let stderrLineBuf = "";  // Line buffer for stderr

child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderrBuf += text;  // Accumulate for error message

    // Emit lines to onLine callback
    stderrLineBuf += text;
    const lines = stderrLineBuf.split("\n");
    stderrLineBuf = lines.pop() ?? "";
    for (const line of lines) {
        if (line.trim()) {
            onLine?.(`[stderr] ${line}`);
        }
    }
});

child.on("close", (code) => {
    if (lineBuf.trim()) onLine?.(lineBuf.trim());
    if (stderrLineBuf.trim()) onLine?.(`[stderr] ${stderrLineBuf.trim()}`);
    // ... rest of close logic
});
```

### server/test/unit/infrastructure/restic-executor.test.ts
**Changes:**
- Added 4 new test cases in `run()` describe block:
  1. `emits stderr lines to onLine callback with [stderr] prefix`
  2. `captures both stdout and stderr lines via onLine`
  3. `buffers partial stderr lines until newline`
  4. `flushes remaining stderr buffer on close`

**Test Coverage:**
- Basic stderr emission with prefix
- Interleaved stdout and stderr capture
- Partial line buffering behavior
- Buffer flush on process close

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| db8baed | test | Add failing test for stderr emission to onLine callback |
| d4f8901 | feat | Emit stderr lines to onLine callback in ResticExecutor |

## Technical Decisions

### 1. Separate Line Buffer for stderr
**Decision:** Use `stderrLineBuf` for line assembly, keep existing `stderrBuf` for accumulation.
**Rationale:** Prevents corrupting the full stderr text that gets included in error messages and return values. Line buffering is a presentation concern; error message accumulation is a diagnostic concern - they should not interfere.

### 2. [stderr] Prefix
**Decision:** Prefix all stderr lines with `[stderr]` when emitting to `onLine`.
**Rationale:** Makes stderr lines clearly distinguishable from stdout in the UI log viewer. Restic writes normal progress to stdout and errors to stderr - users need to know which is which.

### 3. Trim on Flush
**Decision:** Trim partial lines before emitting on close (both stdout and stderr).
**Rationale:** Removes trailing whitespace from the last line, providing cleaner display. Consistent with the loop behavior that checks `line.trim()` before emission.

## Next Steps

1. **Run UAT Test 11** - Verify failed backup log lines show stderr output in UI
2. **Monitor production backups** - Confirm error messages appear in backup history for actual failures
3. **Consider UI enhancement** - Potentially style `[stderr]` lines in red or with warning icon for better visibility

## Self-Check: PASSED

✅ Files created: None (modifications only)
✅ Files modified:
  - server/src/infrastructure/restic-executor.ts (exists, contains stderrLineBuf)
  - server/test/unit/infrastructure/restic-executor.test.ts (exists, contains 4 new stderr tests)

✅ Commits exist:
  - db8baed (test: Add failing test for stderr emission)
  - d4f8901 (feat: Emit stderr lines to onLine callback)

✅ TypeScript compilation: No errors
✅ Test suite: 208 tests passing
✅ Plan objective achieved: Failed backup log lines now include stderr diagnostic information
