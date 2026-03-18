---
phase: 04-backup-restore
plan: "05"
subsystem: client
tags: [backup, api-client, sse, settings-ui, notifications]
dependency_graph:
  requires: [04-01]
  provides: [client-backup-api, backup-sse-hook, backup-status-badge, settings-backup-tab]
  affects: [client/src/routes/app/settings.tsx, client/src/lib/notifications-api.ts]
tech_stack:
  added: []
  patterns: [EventSource-SSE-hook, toast.promise-save-pattern, conditional-field-reveal]
key_files:
  created:
    - client/src/lib/backups-api.ts
    - client/src/hooks/use-backup-stream.ts
    - client/src/components/domain/backup/backup-status-badge.tsx
  modified:
    - client/src/routes/app/settings.tsx
    - client/src/lib/notifications-api.ts
decisions:
  - "BackupRepositoryCard and BackupDefaultsCard defined inline in settings.tsx following the established inline sub-component pattern (SmtpCard, NotificationTriggersCard) — no other route uses them"
  - "saveBackupSettings and saveBackupDefaults accept Record<string, unknown> to avoid coupling client to server schema changes for optional/conditional fields"
  - "BackupStatusBadge uses inline span (not shadcn Badge) per plan spec — allows direct semantic color classes without variant mapping"
metrics:
  duration_seconds: 171
  completed_date: "2026-03-18"
  tasks_completed: 2
  files_created: 3
  files_modified: 2
---

# Phase 4 Plan 5: Client Foundation — API, SSE Hook, BackupStatusBadge, Settings Backup Tab Summary

**One-liner:** Backup API client (13 endpoints), SSE log-streaming hook, BackupStatusBadge, and Settings Backup tab with conditional repository fields and default retention config.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create backups-api client, SSE hook, and BackupStatusBadge | d997625 | client/src/lib/backups-api.ts, client/src/hooks/use-backup-stream.ts, client/src/components/domain/backup/backup-status-badge.tsx |
| 2 | Add Backup tab to Settings page with Repository and Defaults cards + NOTF-05 toggle | b7af9d5 | client/src/routes/app/settings.tsx, client/src/lib/notifications-api.ts |

## What Was Built

### `client/src/lib/backups-api.ts`
Typed API client covering all backup endpoints: trigger backup/restore, list backups, get backup record, list snapshots, get volume warnings, read/write global backup settings, read/write backup defaults, read/write per-stack backup config, and fetch restic binary status. All functions use `apiFetch<T>()` with proper Content-Type headers on mutations.

### `client/src/hooks/use-backup-stream.ts`
SSE hook `useBackupStream(backupId, active)` that opens an EventSource to `/api/backups/:id/stream`, accumulates log lines in state, and transitions status to `"done"` or `"error"` when the server signals completion. Properly closes the connection on unmount.

### `client/src/components/domain/backup/backup-status-badge.tsx`
Reusable `BackupStatusBadge` component rendering `IN_PROGRESS` (blue), `COMPLETED` (green), `FAILED` (red) with dark-mode variants using inline span pattern.

### Settings Backup Tab
Added `"backup"` to `VALID_TABS` and a third `TabsTrigger`/`TabsContent`. Two inline card components:
- **BackupRepositoryCard**: Select for repo type (Local/SFTP/S3-compatible) with conditional field reveal per type, universal Restic password field, restic-not-installed Alert warning, and restic version badge in footer.
- **BackupDefaultsCard**: Cron schedule input with helper text and a 3-column grid for keep-daily/weekly/monthly retention numbers.

### Notification Triggers — backupFailure (NOTF-05)
Extended `NotificationTriggers` interface with `backupFailure: boolean`. Added the corresponding toggle row to `NotificationTriggersCard` with optimistic update and rollback on error.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit --project client/tsconfig.json` passes with zero errors
- All 13 exported API functions present in backups-api.ts
- `useBackupStream` uses EventSource with cleanup on unmount
- `BackupStatusBadge` handles IN_PROGRESS, COMPLETED, FAILED with correct semantic colors
- Settings page has three tabs; Backup tab shows repository + defaults cards
- `NotificationTriggers.backupFailure` added to interface and UI toggle

## Self-Check: PASSED

Files created:
- FOUND: client/src/lib/backups-api.ts
- FOUND: client/src/hooks/use-backup-stream.ts
- FOUND: client/src/components/domain/backup/backup-status-badge.tsx

Commits:
- FOUND: d997625
- FOUND: b7af9d5
