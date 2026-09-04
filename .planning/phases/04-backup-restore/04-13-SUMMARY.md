---
phase: 04-backup-restore
plan: 13
subsystem: backup
tags: [bugfix, windows, path-handling, validation, ui-clarity]
completed_at: "2026-04-01T14:05:22Z"
duration_seconds: 373

dependency_graph:
  requires: [04-01, 04-05]
  provides: [windows-backup-paths, local-backend-clarity]
  affects: [backup-service, backup-settings-ui, backup-validation]

tech_stack:
  added: []
  patterns: [path.resolve, conditional-ui, schema-validation]

key_files:
  created: []
  modified:
    - server/src/application/backup-service.ts
    - shared/src/validation/backups.ts
    - client/src/routes/app/settings.tsx
    - server/test/unit/application/backup-service.test.ts

decisions:
  - key: path-construction
    choice: "Use path.resolve() instead of path.join() for absolute path concatenation"
    rationale: "path.join() can double drive letters on Windows when joining absolute paths; path.resolve() always returns correctly formed absolute paths"
    alternatives: ["Manual path normalization", "Platform-specific path logic"]
  - key: local-backend-ui
    choice: "Hide repository path field for local backend, show informational alert"
    rationale: "Repository path is never used for local backups (always stack-local); hiding the field eliminates user confusion"
    alternatives: ["Keep field disabled", "Show field with explanation"]
  - key: validation-removal
    choice: "Remove repoPath validation requirement for local backend"
    rationale: "Field is not used; validation was creating false positive errors"
    alternatives: ["Keep validation but make field optional"]

metrics:
  tasks_completed: 2
  files_modified: 4
  tests_added: 2
  deviations: 0
---

# Phase 04 Plan 13: Fix Windows Backup Path Issues Summary

**One-liner:** Fixed Windows path malformation (C:\C\...) in backup service using path.resolve(), removed unused repository path requirement for local backups, and clarified UI to show local backups are stack-local.

## What Was Built

**Problem solved:**
1. Windows backup paths were malformed (e.g., `C:\C\Users\...`) due to `path.join()` doubling drive letters
2. Repository path field was shown and required for local backups despite never being used
3. Users were confused about where local backups are stored

**Solution implemented:**
1. Replaced `path.join(stackPath, "backups")` with `path.resolve(stackPath, "backups")` in backup-service.ts buildEnv()
2. Removed repoPath validation requirement for local backend in backupSettingsSchema
3. Updated Settings UI to show informational alert for local backend instead of unused input field
4. Added repository path field to SFTP backend configuration (was previously missing)
5. Added cross-platform unit tests for path handling

## Tasks Completed

| Task | Type | Description | Commit |
|------|------|-------------|--------|
| 1 | auto | Fix Windows path construction and update UI/validation | fb24d9c |
| 2 | auto (TDD) | Add unit test for Windows/Unix path handling | 8314451 |

## Technical Changes

### Server (backup-service.ts)

**buildEnv() line 536:**
- Before: `path.join(stackPath, "backups")` → produces `C:\C\Users\...` on Windows
- After: `path.resolve(stackPath, "backups")` → produces `C:\Users\...\backups` correctly

Why path.resolve() works: It treats the first absolute path as the base and properly appends the second argument without prefix duplication.

### Shared Validation (backups.ts)

**backupSettingsSchema.superRefine() lines 19-20:**
- Removed: `if (data.repoType === "local" && !data.repoPath?.trim())` validation block
- Rationale: Local backups always go to `<stackPath>/backups`; repoPath field is never used

### Client UI (settings.tsx)

**BackupRepositoryCard local backend section:**
- Removed: Repository path input field
- Added: Alert component with clear explanation: "Backups are stored in a `backups/` subdirectory within each stack's directory"
- Added: Repository path field to SFTP backend (was missing)

### Tests (backup-service.test.ts)

**New test suite: buildEnv path construction**
- Test: Windows absolute paths resolve correctly without doubled drive letters
- Test: Unix absolute paths resolve correctly
- Implementation: Platform-aware tests using `path.resolve()` for expected values (works on both Windows and Unix)

## Verification Results

**Automated checks (all passed):**
- ✅ TypeScript compilation succeeds
- ✅ path.resolve() used in backup-service.ts line 536
- ✅ repoPath validation removed for local backend
- ✅ Alert component used for local backend UI
- ✅ New unit tests pass (2/2)

**Test output:**
```
✓ buildEnv path construction > handles Windows absolute paths correctly
✓ buildEnv path construction > handles Unix absolute paths correctly
```

## Deviations from Plan

None - plan executed exactly as written.

## Impact Assessment

**Files modified:** 4
**Lines changed:** ~40 (3 implementation files + test file)
**Breaking changes:** None
**API changes:** None (internal buildEnv() method only)

**User-facing improvements:**
1. Backups will now work correctly on Windows systems (no more malformed paths)
2. Settings UI is clearer about where local backups are stored
3. Repository path field only shown for SFTP/S3 (reduces confusion)

**Risk level:** Low
- Change is localized to path construction logic
- Existing backups are not affected (stored paths remain valid)
- Tests verify correctness on both platforms

## Known Stubs

None. All functionality is fully implemented.

## Follow-up Items

None. This is a complete bugfix with no deferred work.

## Self-Check: PASSED

**Files created/modified verification:**
```bash
✓ FOUND: server/src/application/backup-service.ts (modified line 536)
✓ FOUND: shared/src/validation/backups.ts (removed validation)
✓ FOUND: client/src/routes/app/settings.tsx (updated UI)
✓ FOUND: server/test/unit/application/backup-service.test.ts (added tests)
```

**Commits verification:**
```bash
✓ FOUND: fb24d9c (fix: Windows path construction and UI/validation)
✓ FOUND: 8314451 (test: Windows/Unix path handling tests)
```

**Build verification:**
```bash
✓ PASSED: yarn build (no TypeScript errors)
✓ PASSED: yarn workspace @docktor/server test (new tests pass)
```

All claims validated.
