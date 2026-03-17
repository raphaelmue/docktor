# Phase 3: Notifications - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Alert users on container errors, disk warnings, and backup failures via SMTP. Extends the Settings page with SMTP configuration and per-trigger toggles. Adds a global notification log visible in the UI. NOTF-05 (backup failure) is deferred to Phase 4 — Phase 3 delivers NOTF-01 through NOTF-04 and NOTF-06.

</domain>

<decisions>
## Implementation Decisions

### Notification trigger deduplication
- Each trigger fires **once per incident**: transition to ERROR/UNHEALTHY logs/sends one notification, then suppresses until the stack recovers (RUNNING, HEALTHY, or STOPPED)
- Restart loop / rapid flapping: second ERROR while first is still "active" does NOT re-notify
- UNHEALTHY grace period: only fire if the stack has been continuously UNHEALTHY for >2 minutes — suppresses transient flaps during deploys and restarts
- Disk warning: suppressed until disk recovers above both thresholds
- Track incident state in DB (e.g., a `notificationActive` flag or last-notified-at per stack per trigger type)

### Notification log
- Global notification log stored in DB (new `Notification` table): records event type, stack name, message, timestamp, and whether email was delivered
- Visible in the UI (Notifications tab on Settings page, or dedicated section)
- Written regardless of SMTP configuration — SMTP is a delivery channel only
- Notifications are logged whenever triggers are enabled; no SMTP = UI-only visibility

### Disk space monitoring
- Monitors the Docker data directory (`/var/lib/docker`) only
- New dedicated background job running on a ~24h interval (not piggybacked on StatePoller)
- Two independent triggers: below 10% free OR below 2 GB free — either fires the alert
- Both thresholds are configurable in Settings (stored as key-value pairs like General settings)
- Suppressed until disk recovers above the triggered threshold

### SMTP settings and Settings page structure
- Settings page gains tabbed navigation: **General** | **Notifications** tabs
- Notifications tab contains two cards:
  1. **SMTP** card: host, port, username, password (encrypted), from address, recipient, + Test Send button
  2. **Notification Triggers** card: per-trigger enable/disable toggles (stack error/unhealthy, disk warning)
- Test Send: fires immediately on click, toast on success/failure — no confirmation dialog
- Trigger toggles are always visible and functional regardless of SMTP config; when SMTP is not configured, triggered events are still written to the notification log (UI-only)

### NOTF-05 (backup failure) — deferred
- Skipped in Phase 3; will be delivered as part of Phase 4 (Backup & Restore)
- When implemented in Phase 4: notification includes stack name, backup target (local/SFTP/S3), and error message
- Will use same deduplication pattern (once per incident, suppress until recovery)
- No backup failure toggle in Phase 3 Settings UI

### Email content
- Stack error/unhealthy notification includes: stack name, current state, timestamp, recent log lines
- Disk warning includes: mount point checked, current free space (bytes + percent), which threshold was crossed
- Plain text email acceptable for MVP; HTML not required

### Claude's Discretion
- Exact `Notification` table schema (columns, indexes)
- SMTP library choice (nodemailer is standard for Node.js)
- AES encryption implementation for SMTP password (reuse existing `encrypted` flag pattern in Setting schema)
- Grace period implementation for UNHEALTHY (setTimeout vs. polling check on reconciliation loop)
- Background job interval (default 24h, expressed as cron or ms)
- Notification log UI placement (Settings > Notifications tab, or a top-level nav entry)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/application/settings-service.ts`: `SettingsService` with `getSetting`/`upsertSetting` — extend with SMTP key constants and encryption flag
- `server/src/repositories/settings-repository.ts`: `SettingsRepository` with `upsert`/`findAll`/`getMany` — reuse directly; add `encrypted` field writes for SMTP password
- `server/src/lib/state-broadcaster.ts`: `StateBroadcaster` emitting `StateEvent` union — `container_state` events already carry `stackStatus` transitions; notification job subscribes to these
- `server/src/jobs/state-poller.ts`: StatePoller pattern (event-driven + reconciliation loop) — disk checker follows same structure but at 24h interval
- `server/src/jobs/index.ts`: `startJobs`/`stopJobs` registry — new `diskChecker` job registered here
- `server/prisma/schema/setting.prisma`: `Setting` model already has `encrypted Boolean @default(false)` — SMTP password uses this flag
- `server/prisma/schema/stack.prisma`: `StackStatus` enum has ERROR, UNHEALTHY, RUNNING, HEALTHY, STOPPED — recovery states are RUNNING, HEALTHY, STOPPED

### Settings Pattern
- General settings stored as individual key-value rows: `instanceName`, `baseUrl`, `timezone`
- SMTP settings follow same pattern: `smtp.host`, `smtp.port`, `smtp.username`, `smtp.password` (encrypted=true), `smtp.from`, `smtp.recipient`
- Disk thresholds: `disk.thresholdPercent` (default "10"), `disk.thresholdBytes` (default "2147483648")
- Trigger toggles: `notify.stackError` (default "true"), `notify.diskWarning` (default "true")

### Settings Page
- `client/src/routes/app/settings.tsx`: currently one card (General) — needs tabbed navigation added
- Uses Card/CardHeader/CardContent/CardFooter pattern consistently
- Existing toast pattern: `toast.success()` / `toast.error()` from sonner

### Integration Points
- New DB table: `Notification` (id, type, stackId?, message, emailSent, createdAt)
- New DB table or columns: incident tracking per stack per trigger type (to enforce "once per incident")
- New job: `server/src/jobs/disk-checker.ts`
- New service: `server/src/application/notification-service.ts` (send + log)
- New routes: `GET /api/notifications` (log), `POST /api/settings/smtp`, `GET /api/settings/smtp`, `POST /api/settings/smtp/test`
- StatePoller or StateBroadcaster subscriber: watches for ERROR/UNHEALTHY transitions and calls notification service

</code_context>

<specifics>
## Specific Ideas

- Notification log is always written when triggers are enabled; SMTP determines delivery only — clean separation of concerns
- Tabbed Settings page chosen now that the page has grown to 3+ logical sections
- UNHEALTHY 2-minute grace period prevents alert fatigue during normal deploys and container starts
- Disk checker is its own job (not piggybacked) because 24h cadence is incompatible with StatePoller's 60s loop
- Thresholds configurable — users with larger/smaller servers have different needs
- NOTF-05 deferred: Phase 3 ships notification infrastructure; Phase 4 wires backup failures into it

</specifics>

<deferred>
## Deferred Ideas

- NOTF-05 (backup failure notification) — delivered in Phase 4 when backup system exists
- HTML email templates — plain text sufficient for MVP
- Notification log as top-level nav entry — kept inside Settings for now; revisit if log grows important

</deferred>

---

*Phase: 03-notifications*
*Context gathered: 2026-03-17*
