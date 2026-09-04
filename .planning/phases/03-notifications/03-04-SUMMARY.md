---
phase: 03-notifications
plan: 04
subsystem: ui
tags: [react, shadcn, tabs, switch, smtp, notifications, settings]

# Dependency graph
requires:
  - phase: 03-02
    provides: SMTP and notification trigger API routes (GET/PUT /api/settings/smtp, GET/PUT /api/settings/notification-triggers, GET /api/notifications)
  - phase: 03-03
    provides: NotificationWatcher and DiskChecker background jobs that produce notification log entries
provides:
  - Tabbed Settings page (General + Notifications tabs) in client/src/routes/app/settings.tsx
  - notifications-api.ts with typed API functions for all 6 notification endpoints
  - shadcn Switch component for toggle controls
  - SMTP configuration card with 6 fields, save, and test-send
  - Notification Triggers card with optimistic-update toggles
  - Notification Log card with type badges and empty state
affects: [04-updates-ui, 05-backups-ui, 06-deployment]

# Tech tracking
tech-stack:
  added: ["@radix-ui/react-switch (via shadcn Switch)"]
  patterns:
    - "Optimistic update + rollback pattern for immediate-save toggle controls"
    - "Inline sub-components (SmtpCard, NotificationTriggersCard, NotificationLogCard) defined in same file as parent route"
    - "hasPassword boolean from API prevents displaying stored password; password field placeholder reflects existing credential"

key-files:
  created:
    - client/src/lib/notifications-api.ts
    - client/src/components/ui/switch.tsx
  modified:
    - client/src/routes/app/settings.tsx

key-decisions:
  - "Sub-components (SmtpCard, NotificationTriggersCard, NotificationLogCard) defined inline in settings.tsx — no other route needs them, keeping them co-located avoids premature abstraction"
  - "Optimistic update + rollback for trigger toggles — toggle feels instant; API failure reverts state and shows error toast"
  - "Password field shows placeholder only when hasPassword is true — never displays decrypted value from server"

patterns-established:
  - "Optimistic toggle: set state immediately, await API, revert + toast.error on failure"
  - "Skeleton loading per card: each card manages its own loading state independently"

requirements-completed: [NOTF-01, NOTF-06]

# Metrics
duration: ~35min
completed: 2026-03-18
---

# Phase 03 Plan 04: Notifications Settings UI Summary

**Tabbed Settings page with SMTP config card, optimistic-update trigger toggles, and notification log table using shadcn Switch and Badge components**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-03-17
- **Completed:** 2026-03-18
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments

- Installed shadcn Switch component and created `notifications-api.ts` with typed functions for all 6 notification API endpoints
- Refactored Settings page from single-card to tabbed layout (General / Notifications) preserving all existing general settings behavior
- Notifications tab ships three cards: SMTP form (6 fields + save + test-send), Notification Triggers (2 toggles with immediate save + optimistic rollback), Notification Log (table with type badges + empty state)
- Human-verified: UI renders correctly in browser, toggles update immediately with toast feedback, SMTP settings persist on refresh

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Switch component + create notifications-api.ts** - `bb7f9c3` (feat)
2. **Task 2: Refactor Settings page with Tabs + Notifications tab** - `ff582dd` (feat)
3. **Task 3: Visual verification of Notifications tab** - checkpoint approved (no code changes)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `client/src/lib/notifications-api.ts` - Typed API functions: getSmtpSettings, saveSmtpSettings, testSmtp, getNotificationTriggers, updateNotificationTriggers, getNotifications
- `client/src/components/ui/switch.tsx` - shadcn Switch component for toggle controls
- `client/src/routes/app/settings.tsx` - Refactored to tabbed layout; adds SmtpCard, NotificationTriggersCard, NotificationLogCard inline sub-components

## Decisions Made

- Sub-components defined inline in settings.tsx (no separate files) — they are only used by this route, and extracting them adds indirection without benefit at this scale
- Optimistic update + rollback for toggle controls — the toggle switches state immediately on click, the API call runs async, and on failure the toggle reverts and shows an error toast
- SMTP password field uses a placeholder (`••••••••`) when `hasPassword` is true from the API — the decrypted value is never sent to the client

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Notifications UI is fully wired to the API layer from plans 03-01 and 03-02
- Background watchers from 03-03 will populate the Notification Log as events fire
- Phase 03 is complete — ready to proceed to Phase 04 (Updates)

---
*Phase: 03-notifications*
*Completed: 2026-03-18*
