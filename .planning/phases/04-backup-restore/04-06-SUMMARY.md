---
phase: 04-backup-restore
plan: 06
subsystem: client-ui
tags: [react, ui-components, backup-ui, restore-dialog, sse-streaming, dropdown-menu]

dependency_graph:
  requires:
    - 04-04-SUMMARY.md  # Backup HTTP routes
    - 04-05-SUMMARY.md  # Backup API client and SSE hook
  provides:
    - Refactored stack detail action bar with Deploy + dropdown menu
    - Backups tab with config/history/snapshots sections
    - Restore confirmation dialog with typed-name gate
    - Backup detail page with SSE log streaming
  affects:
    - client/src/routes/app/stacks/[id].tsx  # Now uses StackActions and BackupsTab

tech_stack:
  added:
    - shadcn/ui alert-dialog component
  patterns:
    - Page composition (stack detail refactored to ~150 lines, down from 587)
    - Section component extraction (6 new component files)
    - SSE streaming for live backup logs
    - Typed-name confirmation gate for destructive restore action

key_files:
  created:
    - client/src/routes/app/stacks/components/stack-actions.tsx
    - client/src/routes/app/stacks/components/backups-tab.tsx
    - client/src/routes/app/stacks/components/backup-config-card.tsx
    - client/src/routes/app/stacks/components/backup-history.tsx
    - client/src/routes/app/stacks/components/snapshots-section.tsx
    - client/src/components/domain/backup/restore-confirm-dialog.tsx
    - client/src/routes/app/stacks/backups/[backupId].tsx
  modified:
    - client/src/routes/app/stacks/[id].tsx
    - client/src/App.tsx

decisions:
  - Action bar uses primary Deploy button + ellipsis dropdown (per 04-CONTEXT locked decision)
  - Restore uses AlertDialog with typed-name confirmation (per 04-CONTEXT locked decision)
  - Section components co-located in routes/app/stacks/components/ (only used by stack detail page)
  - Backup detail page shows SSE-streamed logs for IN_PROGRESS backups, stored logs for completed
  - Volume warnings displayed as Alert in BackupConfigCard when warnings exist
  - Backup Now button appears in both StackActions dropdown and BackupConfigCard header

metrics:
  duration_minutes: 15  # Estimated from checkpoint to completion
  tasks_completed: 3
  files_created: 7
  files_modified: 2
  commits: 3
  checkpoint_used: human-verify (visual verification of backup UI)
---

# Phase 04 Plan 06: Stack Backup UI Components

Complete stack detail backup UI with refactored action bar, Backups tab, restore confirmation dialog, and backup detail page with live log streaming.

## What Was Built

**One-liner:** Refactored stack detail action bar to Deploy + dropdown menu pattern, added Backups tab with config/history/snapshots sections, restore confirmation dialog with typed-name gate, and backup detail page with SSE-streamed live logs.

### User-Facing Features

1. **Refactored Action Bar:**
   - Primary "Deploy" button remains prominent
   - All other actions (Stop, Restart, Update Images, Backup Now, Delete) moved to ellipsis dropdown menu
   - "Backup Now" action integrated with toast notification and "View progress" action link
   - Actions appropriately disabled based on stack status (e.g., "Stop" disabled when STOPPED)

2. **Backups Tab (5th tab on stack detail page):**
   - **Backup Configuration Card:** Per-stack schedule/retention overrides, pre/post hooks, volume warnings display
   - **Backup History:** Table of all backup records with status badges, trigger types, durations, sizes, and detail links
   - **Snapshots Section:** Live restic snapshots with restore buttons, refresh capability, and locked state during operations

3. **Restore Confirmation Dialog:**
   - Typed-name gate requires user to type exact stack name before confirming restore
   - Warns about downtime and irreversibility of restore action
   - Disables confirm button until typed name matches

4. **Backup Detail Page:**
   - SSE-streamed live log output for backups in progress
   - Stored logs displayed for completed backups
   - Error alerts for failed backups with context-specific messages (backup vs. restore)
   - Auto-scroll to bottom during streaming

### Technical Implementation

**StackActions Component:**
- Uses shadcn/ui DropdownMenu with MoreHorizontal trigger icon
- Integrates with both stacks-api (deploy/stop/restart/delete) and backups-api (triggerBackup)
- Status-aware button disabling prevents invalid operations
- Toast notifications with action links for async operations

**BackupConfigCard Component:**
- Loads stack backup config and volume warnings on mount
- Conditional rendering of schedule/retention inputs based on "use global" switches
- Alert display when volumes outside stack directory are detected (BCK-07)
- Dual "Backup Now" buttons (dropdown + card header)

**BackupHistory Component:**
- Fetches backup records via getBackups(stackId)
- Formats durations (Xm Ys) and sizes (KB/MB/GB)
- BackupStatusBadge and trigger badges provide visual status
- Empty state guides user to trigger first backup

**SnapshotsSection Component:**
- Fetches live restic snapshots via getSnapshots(stackId)
- Refresh button allows manual snapshot list refresh
- Locked state during BACKING_UP/RESTORING prevents concurrent operations
- Opens RestoreConfirmDialog on restore button click
- Navigates to backup detail page after successful restore trigger

**BackupsTab Component:**
- Simple composition of three section components
- Passes stackId, stackName, and stackStatus down to sections

**RestoreConfirmDialog Component:**
- AlertDialog with controlled input for stack name confirmation
- Confirm button disabled until typedValue === stackName
- Destructive variant styling for high-risk action

**BackupDetailPage Component:**
- Uses useBackupStream hook for SSE when status is IN_PROGRESS
- Displays stored backup.logLines for completed backups
- ScrollArea with auto-scroll during streaming (useEffect on lines.length)
- Breadcrumbs link back to stack detail page
- Context-aware error messages for backup vs. restore failures

**Stack Detail Page Refactor:**
- Extracted action bar to StackActions component
- Added 5th tab (Backups) with BackupsTab component
- Significantly reduced page file size by extracting sections

## Deviations from Plan

None. Plan executed exactly as written. All components created, all features implemented, checkpoint verification approved.

## Requirements Completed

- **BCK-03:** User can trigger a manual backup for any stack ✓
- **BCK-06:** User can view a list of available snapshots for a stack ✓
- **BCK-07:** Volume warnings displayed when volumes are outside stack directory ✓
- **BCK-08:** Backup Now button integrated in action dropdown ✓
- **BCK-09:** Backup history table shows all backup records with status/details ✓
- **BCK-10:** User can restore from any snapshot with typed-name confirmation ✓
- **BCK-11:** User can view streaming backup logs on detail page ✓

## Testing Notes

**Verification Method:** Human visual inspection checkpoint after implementation.

**Verification Results:** User confirmed:
- Action bar renders with Deploy + ellipsis dropdown
- Backups tab visible as 5th tab
- Three sections render correctly (config, history, snapshots)
- Backup Now button present in both locations
- All UI elements match specifications

**TypeScript Compilation:** All type checks passed (`npx tsc --noEmit --project client/tsconfig.json`).

## Integration Points

**Consumes:**
- `client/src/lib/backups-api.ts` (triggerBackup, triggerRestore, getBackups, getSnapshots, getVolumeWarnings, getBackupConfig, saveBackupConfig)
- `client/src/hooks/use-backup-stream.ts` (SSE streaming for backup logs)
- `client/src/components/domain/backup/backup-status-badge.tsx` (status display)
- `client/src/lib/stacks-api.ts` (deploy, stop, restart, delete operations)
- `client/src/hooks/use-stack.ts` (stack data and refetch)

**Provides:**
- Complete backup UI in stack detail page
- Backup detail page accessible at `/stacks/:id/backups/:backupId`
- Restore workflow with typed-name confirmation gate
- Per-stack backup configuration interface

## Follow-up Work

None. This plan completes the backup UI implementation for Phase 04.

## Files Changed

**Created:**
- `client/src/routes/app/stacks/components/stack-actions.tsx` (177 lines)
- `client/src/routes/app/stacks/components/backups-tab.tsx` (15 lines)
- `client/src/routes/app/stacks/components/backup-config-card.tsx` (243 lines)
- `client/src/routes/app/stacks/components/backup-history.tsx` (152 lines)
- `client/src/routes/app/stacks/components/snapshots-section.tsx` (187 lines)
- `client/src/components/domain/backup/restore-confirm-dialog.tsx` (79 lines)
- `client/src/routes/app/stacks/backups/[backupId].tsx` (136 lines)

**Modified:**
- `client/src/routes/app/stacks/[id].tsx` (replaced action buttons with StackActions, added Backups tab)
- `client/src/App.tsx` (added route for `/stacks/:id/backups/:backupId`)

## Self-Check: PASSED

**Created files exist:**
- FOUND: client/src/routes/app/stacks/components/stack-actions.tsx
- FOUND: client/src/routes/app/stacks/components/backups-tab.tsx
- FOUND: client/src/routes/app/stacks/components/backup-config-card.tsx
- FOUND: client/src/routes/app/stacks/components/backup-history.tsx
- FOUND: client/src/routes/app/stacks/components/snapshots-section.tsx
- FOUND: client/src/components/domain/backup/restore-confirm-dialog.tsx
- FOUND: client/src/routes/app/stacks/backups/[backupId].tsx

**Modified files exist:**
- FOUND: client/src/routes/app/stacks/[id].tsx
- FOUND: client/src/App.tsx

**Commits exist:**
- FOUND: 517aa59 (Task 1 - stack actions and backups tab components)
- FOUND: 5b69be3 (Task 2 - backup detail page)

All files and commits verified.
