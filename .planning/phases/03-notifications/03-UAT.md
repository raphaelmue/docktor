---
status: complete
phase: 03-notifications
source:
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
started: 2026-03-20T00:00:00Z
updated: 2026-03-20T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Prisma Models Available
expected: Prisma client has Notification and StackIncident models accessible. TypeScript autocomplete shows NotificationType enum with stack_error, stack_unhealthy, disk_warning values. Running `prisma generate` completes successfully.
result: pass

### 3. AES-256-GCM Encryption
expected: SMTP password encryption works: saving SMTP settings with a password encrypts it using AES-256-GCM. Reading SMTP settings returns hasPassword:true but never the plaintext password. TestSmtp() successfully decrypts and uses the password to connect.
result: issue
reported: "the from address is not stored, as well as the password."
severity: major

### 4. SMTP Settings API
expected: GET /api/settings/smtp returns current SMTP config with hasPassword flag (no plaintext password). PUT /api/settings/smtp saves host, port, user, password, fromEmail, fromName; password is encrypted on save. Settings persist across server restarts.
result: issue
reported: "GET works, I could not test PUT, only via the ui."
severity: minor

### 5. SMTP Test Endpoint
expected: POST /api/settings/smtp/test attempts SMTP connection using saved credentials. Returns success with connection verified message, or error with detailed failure reason (auth failed, connection refused, etc).
result: issue
reported: "probably not since it does not work through the ui."
severity: major

### 6. Notification Triggers API
expected: GET /api/settings/notification-triggers returns stackError and diskWarning boolean flags plus diskWarningPercent and diskWarningBytes thresholds. PUT updates these settings and they persist.
result: pass

### 7. Notification Log API
expected: GET /api/notifications returns last 100 notification entries sorted by newest first. Each entry shows type (stack_error, stack_unhealthy, disk_warning), stackId (if applicable), subject, message, emailSent boolean, and timestamp.
result: skipped
reason: couldn't test

### 8. Stack Error Notification
expected: When a stack transitions to ERROR state, NotificationWatcher immediately creates a stack_error notification in the database. If SMTP is configured and stackError trigger is enabled, an email is sent. Notification appears in log without page refresh.
result: skipped
reason: couldn't test

### 9. Stack Unhealthy Notification with Grace Period
expected: When a stack transitions to UNHEALTHY state, NotificationWatcher waits 2 minutes before firing stack_unhealthy notification. If stack recovers to RUNNING within those 2 minutes, no notification is sent. If still UNHEALTHY after 2 minutes, notification fires.
result: pass

### 10. Notification Deduplication
expected: Multiple ERROR or UNHEALTHY events for the same stack don't create duplicate notifications. First event fires notification, subsequent events are suppressed until stack recovers (returns to RUNNING state), then the incident is cleared and future errors fire again.
result: pass

### 11. Disk Space Warning
expected: DiskChecker job runs daily at midnight (or can be triggered manually). It checks /var/lib/docker disk usage. If free space falls below configured percent OR bytes threshold, fires disk_warning notification once. Subsequent checks don't re-notify until space recovers above both thresholds.
result: issue
reported: "Diskchecker did not run: [server] [DiskChecker] statfs failed: Error: ENOENT: no such file or directory, statfs 'C:\\var\\lib\\docker'"
severity: blocker

### 12. Notification Jobs Registered
expected: After server startup, NotificationWatcher and DiskChecker jobs are running. NotificationWatcher is subscribed to StateBroadcaster. DiskChecker cron schedule is active. No crash logs or uncaught exceptions related to notification jobs.
result: issue
reported: "DiskChecker failed and NotificationWatcher I didnt see any logs."
severity: major

### 13. Settings Page Tabs
expected: Navigate to /app/settings. Page shows two tabs: General and Notifications. General tab shows existing timezone settings. Notifications tab shows SMTP Config, Notification Triggers, and Notification Log cards. Switching tabs preserves unsaved form state.
result: pass

### 14. SMTP Configuration Card
expected: In Settings > Notifications tab, SMTP Config card shows 6 fields (host, port, user, password, fromEmail, fromName). Password field shows placeholder (••••••••) when password exists, empty when not set. Save button persists settings. Test Connection button validates SMTP with success/error toast.
result: pass

### 15. Notification Triggers Toggles
expected: In Settings > Notifications tab, Notification Triggers card shows two toggles: Stack Errors and Disk Warnings. Toggles update immediately when clicked (optimistic update). If API call fails, toggle reverts and error toast appears. Changes persist across page refresh.
result: pass

### 16. Disk Warning Thresholds
expected: In Notification Triggers card, disk warning thresholds show two inputs: percent (0-100) and bytes (with unit suffix like GB). Changing values and saving updates the settings. Validation prevents invalid ranges.
result: issue
reported: "i dont see any inputs"
severity: major

### 17. Notification Log Display
expected: In Settings > Notifications tab, Notification Log card shows table with recent notifications. Each row displays type badge (error/unhealthy/disk), stack name (if applicable), subject, timestamp, and email sent indicator. Empty state shows "No notifications yet" when log is empty.
result: pass

### 18. Live Notification Updates
expected: With Settings > Notifications tab open, when a new notification fires (stack error, unhealthy, or disk warning), the notification log refreshes automatically and new entry appears at top of table without manual page refresh.
result: issue
reported: "no, the logs are only updating when manually refreshing."
severity: major

## Summary

total: 18
passed: 9
issues: 7
pending: 0
skipped: 2

## Gaps

- truth: "SMTP password encryption works: saving SMTP settings with a password encrypts it using AES-256-GCM. Reading SMTP settings returns hasPassword:true but never the plaintext password. TestSmtp() successfully decrypts and uses the password to connect."
  status: failed
  reason: "User reported: the from address is not stored, as well as the password."
  severity: major
  test: 3
  artifacts: []
  missing: []

- truth: "GET /api/settings/smtp returns current SMTP config with hasPassword flag (no plaintext password). PUT /api/settings/smtp saves host, port, user, password, fromEmail, fromName; password is encrypted on save. Settings persist across server restarts."
  status: failed
  reason: "User reported: GET works, I could not test PUT, only via the ui."
  severity: minor
  test: 4
  artifacts: []
  missing: []

- truth: "POST /api/settings/smtp/test attempts SMTP connection using saved credentials. Returns success with connection verified message, or error with detailed failure reason (auth failed, connection refused, etc)."
  status: failed
  reason: "User reported: probably not since it does not work through the ui."
  severity: major
  test: 5
  artifacts: []
  missing: []

- truth: "DiskChecker job runs daily at midnight (or can be triggered manually). It checks /var/lib/docker disk usage. If free space falls below configured percent OR bytes threshold, fires disk_warning notification once. Subsequent checks don't re-notify until space recovers above both thresholds."
  status: failed
  reason: "User reported: Diskchecker did not run: [server] [DiskChecker] statfs failed: Error: ENOENT: no such file or directory, statfs 'C:\\var\\lib\\docker'"
  severity: blocker
  test: 11
  artifacts: []
  missing: []

- truth: "After server startup, NotificationWatcher and DiskChecker jobs are running. NotificationWatcher is subscribed to StateBroadcaster. DiskChecker cron schedule is active. No crash logs or uncaught exceptions related to notification jobs."
  status: failed
  reason: "User reported: DiskChecker failed and NotificationWatcher I didnt see any logs."
  severity: major
  test: 12
  artifacts: []
  missing: []

- truth: "In Notification Triggers card, disk warning thresholds show two inputs: percent (0-100) and bytes (with unit suffix like GB). Changing values and saving updates the settings. Validation prevents invalid ranges."
  status: failed
  reason: "User reported: i dont see any inputs"
  severity: major
  test: 16
  artifacts: []
  missing: []

- truth: "With Settings > Notifications tab open, when a new notification fires (stack error, unhealthy, or disk warning), the notification log refreshes automatically and new entry appears at top of table without manual page refresh."
  status: failed
  reason: "User reported: no, the logs are only updating when manually refreshing."
  severity: major
  test: 18
  artifacts: []
  missing: []
