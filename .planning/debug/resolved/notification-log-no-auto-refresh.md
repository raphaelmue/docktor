---
status: resolved
trigger: "Notification log doesn't auto-refresh - requires manual page refresh"
created: 2026-03-20T00:00:00.000Z
updated: 2026-03-20T14:55:15Z
---

## Current Focus

hypothesis: Fix implemented and TypeScript compiles successfully
test: Need human verification
expecting: User will test that notification log auto-refreshes without manual page refresh when new notification fires
next_action: Request human verification

## Symptoms

expected: With Settings > Notifications tab open, when a new notification fires, the notification log refreshes automatically and new entry appears at top without manual page refresh
actual: Logs only update when manually refreshing the page
errors: None reported
reproduction: 1. Open Settings > Notifications tab, 2. Trigger a notification (e.g., deploy a stack), 3. Observe that notification log does not update automatically, 4. Manually refresh page, 5. New notification now appears
started: Unknown - reported as current behavior

## Eliminated

## Evidence

- timestamp: 2026-03-20T00:01:00.000Z
  checked: NotificationLogCard component (lines 430-501 in settings.tsx)
  found: Component fetches notifications only once in useEffect on mount (line 434-443). No polling mechanism, no SSE subscription, no interval-based refresh. State is set once and never updated.
  implication: Component has no way to detect new notifications after initial load - confirms hypothesis

- timestamp: 2026-03-20T00:02:00.000Z
  checked: Server SSE infrastructure (StateBroadcaster, /api/events endpoint)
  found: StateBroadcaster only emits stack/container/config/update events (ContainerStateEvent, StackStatusEvent, ConfigChangedEvent, ConfigErrorEvent, UpdateAvailableEvent). No notification event type defined. Client has useContainerEvents hook for SSE but it's stack-focused.
  implication: No SSE mechanism exists for broadcasting notification creation events to clients

- timestamp: 2026-03-20T00:03:00.000Z
  checked: Server notification routes (server/src/routes/notifications.ts)
  found: Only one route exists: GET /api/notifications which returns notificationRepository.findRecent(100). No SSE endpoint for notifications.
  implication: Server doesn't provide any real-time notification stream

- timestamp: 2026-03-20T00:04:00.000Z
  checked: NotificationService.notify() method (server/src/application/notification-service.ts line 37-72)
  found: When a notification is created (line 47-52), it only saves to DB via repo.create() and sends email. No event broadcasting to StateBroadcaster or any other pub/sub mechanism.
  implication: Server-side notification creation is completely isolated from the SSE event stream - clients have no way to be notified

## Resolution

root_cause: Notification creation is not broadcast via SSE. NotificationService.notify() creates notifications in DB but doesn't emit events. StateBroadcaster has no notification event type. NotificationLogCard has no way to detect new notifications (no SSE subscription, no polling). The architecture exists (StateBroadcaster + useContainerEvents) but notifications aren't integrated into it.
fix: 1. Added NotificationCreatedEvent to StateBroadcaster event types (server/src/lib/state-broadcaster.ts) 2. Injected StateBroadcaster into NotificationService and emit notification_created event after creating notification (server/src/application/notification-service.ts, server/src/application/index.ts) 3. Updated useContainerEvents to include NotificationCreatedEvent type (client/src/hooks/use-container-events.ts) 4. Updated NotificationLogCard to subscribe to SSE and call loadNotifications() when notification_created event received (client/src/routes/app/settings.tsx) 5. Added type guard in use-stack.ts to skip notification_created events (client/src/hooks/use-stack.ts)
verification: TypeScript compilation passed successfully. Ready for human verification - user needs to test that notification log auto-refreshes when new notification fires.
files_changed: [
  "server/src/lib/state-broadcaster.ts",
  "server/src/application/notification-service.ts",
  "server/src/application/index.ts",
  "client/src/hooks/use-container-events.ts",
  "client/src/routes/app/settings.tsx",
  "client/src/hooks/use-stack.ts"
]
