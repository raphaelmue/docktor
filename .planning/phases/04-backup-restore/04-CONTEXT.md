# Phase 4: Backup & Restore - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Configure restic repositories, trigger manual and scheduled encrypted backups for any stack, view backup history and restic snapshots, and restore from any snapshot. Also wires NOTF-05 (backup failure notification) into the existing notification system from Phase 3. Scheduling UI, hooks, and the backup detail page are all in scope. No new stack management capabilities.

</domain>

<decisions>
## Implementation Decisions

### Backup progress display
- Backup runs in the **background** — triggering a backup shows a toast ("Backup started") and returns immediately; no blocking modal
- The stack detail page gains a new **Backups tab** (5th tab: Overview / Compose / Environment / Logs / **Backups**)
- A dedicated **backup detail page** exists at `/stacks/:id/backups/:backupId`:
  - Shows live SSE-streamed restic output during an active backup
  - Once complete: static log lines + status badge (IN_PROGRESS / COMPLETED / FAILED), start time, duration, size
- Manual Backup button is **disabled** (not hidden) while the stack is in BACKING_UP state, with label "Backup in progress…"

### Stack detail header — action bar refactor
- The header action bar is being cleaned up as part of this phase (too many buttons once Backup Now is added)
- **Primary button:** Deploy only (or "Redeploy" when already running)
- **Dropdown menu (ellipsis/kebab):** Stop, Restart, Update Images, Backup Now, Delete
- Destructive actions (Delete) remain visually distinct inside the dropdown (e.g., red text)

### Settings — Backup tab
- Settings page gains a third tab: **General | Notifications | Backup**
- Backup tab contains two cards:
  1. **Repository** card: repo type selector (Local / SFTP / S3-compatible) with conditional fields revealed on selection:
     - Local: path field only
     - SFTP: host, username, private key or password
     - S3: endpoint URL, bucket name, access key, secret key
     - Restic password field (stored AES-encrypted with `Setting.encrypted = true`, same as SMTP password)
  2. **Defaults** card: global default backup schedule (cron expression input) and global default retention policy (daily/weekly/monthly count inputs) — inherited by stacks that don't override
- Conditional field reveal is in-place (no page reload, show/hide fields based on selected type)

### Backups tab — per-stack configuration
- Backups tab in stack detail has three sections from top to bottom:
  1. **Backup Configuration** card: schedule override (cron input or "Use global default" toggle), retention override (or "Use global default"), pre-backup hook (optional shell command), post-backup hook (optional shell command)
  2. **Backup History** section: list of Docktor `Backup` records (status badge, trigger type MANUAL/SCHEDULED, date, duration, size, link to detail page)
  3. **Snapshots** section: live list from `restic snapshots` (snapshot ID, date, size, tags) with a **Restore** button per row

### Restore flow
- **Confirmation:** Destructive confirm dialog — shows what will happen (stop stack → overwrite files → redeploy), user must **type the stack name** to unlock the Restore button (same pattern as GitHub repo deletion)
- **Progress:** Restore creates a new Backup record (with a RESTORE trigger type), stack transitions to RESTORING state, toast links to the restore detail page (same `/stacks/:id/backups/:backupId` pattern)
- **On failure:** Stack transitions to ERROR state with a clear error message. Restore button remains accessible in ERROR state so the user can retry or choose a different snapshot. No automatic rollback.

### Backup failure notification (NOTF-05)
- Wire NOTF-05 into the existing NotificationService from Phase 3
- Notification includes: stack name, backup trigger type (manual/scheduled), backup target (local/SFTP/S3), error message
- Deduplication: once per incident (same pattern as other notification triggers — suppress until stack recovers from ERROR)
- Toggle for backup failure notifications added to the Notification Triggers card in Settings > Notifications tab

### Claude's Discretion
- Restic CLI invocation details (spawn args, env var injection for credentials vs stdin, RESTIC_PASSWORD env var approach)
- SSE endpoint design for backup/restore log streaming (reuse existing log SSE pattern or new endpoint)
- Retention policy input format (separate fields for daily/weekly/monthly counts vs single JSON input)
- Cron expression input — whether to provide a human-readable preview ("runs every day at 3am") or just accept raw cron
- `restic snapshots` call timing (on tab open vs cached with manual refresh button)
- Exact RESTORE trigger enum value in Prisma schema (may require adding RESTORE to BackupTrigger)
- Error boundary / loading states for the Snapshots section (restic call can fail if repo is unreachable)
- How to display the absolute-path volume warning (BCK-07) — inline in the Backup Configuration card when detected

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backup requirements
- `.planning/REQUIREMENTS.md` §Backup & Restore — BCK-01 through BCK-11 (all requirements for this phase)
- `.planning/REQUIREMENTS.md` §Notifications — NOTF-05 (backup failure notification, wired in this phase)

### Existing DB schema
- `server/prisma/schema/backup.prisma` — Backup model (resticSnapshotId, trigger, status, errorMessage, sizeBytes)
- `server/prisma/schema/stack.prisma` — Stack fields: backupPreHook, backupPostHook, backupSchedule, backupRetention, previousStatus; StackStatus enum includes BACKING_UP, RESTORING

### Prior phase patterns used in this phase
- `.planning/phases/03-notifications/03-CONTEXT.md` — AES encryption pattern for sensitive settings, NotificationService interface, NOTF-05 deferral note
- `.planning/phases/01-mvp-completion/01-CONTEXT.md` — SSE pattern (log streaming endpoint design, StateBroadcaster usage)

No external specs — requirements fully captured in REQUIREMENTS.md and decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/application/notification-service.ts`: NotificationService — extend with backup failure trigger (NOTF-05); reuse `logAndSend()` pattern
- `server/src/repositories/settings-repository.ts`: `upsertSetting()` with `encrypted` flag — use for restic password and all backup settings
- `server/src/application/settings-service.ts`: `getSetting`/`upsertSetting` — extend with backup settings key constants
- `server/src/infrastructure/stack-filesystem.ts`: StackFilesystem — extend with `getStackPath()` for restic source path
- `server/src/lib/state-broadcaster.ts`: StateBroadcaster — reuse for backup/restore progress SSE events
- `server/src/jobs/disk-checker.ts`: Background job with node-cron — backup scheduler follows same structure
- `client/src/routes/app/stacks/[id].tsx`: Existing Tabs (Overview / Compose / Environment / Logs) — add Backups as 5th tab here
- `client/src/hooks/use-log-stream.ts`: Log SSE hook — adapt for backup log SSE stream on the detail page
- `client/src/lib/notifications-api.ts`: API client pattern — new `backups-api.ts` follows same structure

### Established Patterns
- Settings stored as key-value rows: `backup.repoType`, `backup.repoPath`, `backup.repoHost`, `backup.repoUser`, `backup.repoKey` (encrypted), `backup.password` (encrypted), `backup.defaultSchedule`, `backup.defaultRetention`
- Toast + background for async operations: `toast.promise()` with loading/success/error messages
- SSE log streaming: `writeHead` 200 with text/event-stream, write keepalive, close on request.raw 'close'
- Confirmation before destructive operations: already used for stack delete — extend to typed-name confirm for restore
- Background jobs: registered in `server/src/jobs/index.ts` `startJobs()` function

### Integration Points
- New route file: `server/src/routes/backups.ts` — registered in `server/src/app.ts`
- New application service: `server/src/application/backup-service.ts`
- New repository: `server/src/repositories/backup-repository.ts`
- New job: `server/src/jobs/backup-scheduler.ts` (runs per-stack cron schedules)
- New client route: `client/src/routes/app/stacks/backups/[backupId].tsx` (detail page)
- New client API client: `client/src/lib/backups-api.ts`
- Settings page: add Backup tab to `client/src/routes/app/settings.tsx` tabs
- Stack detail header: refactor action bar in `client/src/routes/app/stacks/[id].tsx` to dropdown pattern
- Notification triggers card in Settings > Notifications: add backup failure toggle (NOTF-05)

</code_context>

<specifics>
## Specific Ideas

- Header action bar refactor: Deploy stays primary button, all others (Stop, Restart, Update Images, Backup Now, Delete) move to a dropdown. This cleans up the currently overloaded header and should be done as part of this phase since Backup Now would otherwise make it worse.
- Restore confirmation uses typed stack name (like GitHub repo delete) — intentionally high friction for a destructive operation.
- After a restore failure, the Restore button in the Backups tab remains accessible while the stack is in ERROR state — user can retry a restore or pick a different snapshot to recover from.
- NOTF-05 backup failure notification: same deduplication pattern as other triggers (once per incident, suppress until recovery). Includes backup target type in the email so the user knows which repo was involved.
- The backup detail page at `/stacks/:id/backups/:backupId` is the same page for both backups and restores — restores just create a Backup record with a different trigger type.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-backup-restore*
*Context gathered: 2026-03-18*
