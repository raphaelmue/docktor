---
phase: 03-notifications
plan: 03
subsystem: jobs
tags: [notifications, cron, node-cron, state-broadcaster, disk-monitoring, statfs]

# Dependency graph
requires:
  - phase: 03-01
    provides: notification infrastructure (NotificationService, DB schema, crypto)
  - phase: 03-02
    provides: NotificationService.notify(), NotificationRepository, settings-service SMTP config
provides:
  - NotificationWatcher: StateBroadcaster subscriber fires stack_error/stack_unhealthy notifications with deduplication
  - DiskChecker: 24h cron job monitors /var/lib/docker disk space, fires disk_warning with deduplication
  - jobs/index.ts: Updated registry with both jobs in startJobs/stopJobs
affects: [phase-04, phase-05, phase-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NotificationWatcher uses two Maps for incident deduplication: activeIncidents + unhealthyTimers"
    - "DiskChecker uses lazy dynamic import for statfs to keep module graph clean in tests"
    - "Both jobs use positional constructor args (not deps object) matching test scaffold expectations"

key-files:
  created:
    - server/src/jobs/notification-watcher.ts
    - server/src/jobs/disk-checker.ts
  modified:
    - server/src/jobs/index.ts

key-decisions:
  - "NotificationWatcher constructor takes two positional args (notificationService, broadcaster) — matches test scaffold; no stackRepo needed as tests don't require displayName lookup"
  - "DiskChecker constructor takes two positional args (notificationService, settings) with combined settings object holding getMany + findLastDiskAlert + setDiskAlertActive — matches test mock structure"
  - "Singleton import path uses ../application/index.js not individual module files — NotificationService singleton lives there alongside SettingsRepository"
  - "UNHEALTHY timer checks activeIncidents again in callback before adding — prevents notification if recovery happened during the 2-minute grace window"

patterns-established:
  - "Job pattern: positional DI args for testability, lazy production singleton via dynamic import"
  - "Incident deduplication: Map<stackId, Set<triggerType>> cleared on recovery"

requirements-completed: [NOTF-03, NOTF-04]

# Metrics
duration: 10min
completed: 2026-03-17
---

# Phase 03 Plan 03: Notification Trigger Jobs Summary

**StateBroadcaster subscriber (NotificationWatcher) + daily disk-space cron (DiskChecker) wired into job registry, providing deduped notifications for stack ERROR/UNHEALTHY and low disk space**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-17T21:05:55Z
- **Completed:** 2026-03-17T21:15:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- NotificationWatcher subscribes to StateBroadcaster, fires stack_error immediately on ERROR, stack_unhealthy after 2-minute grace period, both with per-incident deduplication and recovery clearing
- DiskChecker runs daily at midnight, reads /var/lib/docker stats via statfs, compares against configurable percent and byte thresholds, fires disk_warning once per incident and clears on recovery
- Both jobs registered in startJobs/stopJobs in jobs/index.ts
- All 11 unit tests (6 watcher + 5 disk) pass GREEN, zero TypeScript errors, no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: NotificationWatcher** - `402f7fb` (feat)
2. **Task 2: DiskChecker + jobs/index.ts** - `03c5cb4` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `server/src/jobs/notification-watcher.ts` - StateBroadcaster subscriber with deduplication and UNHEALTHY 2-minute grace period
- `server/src/jobs/disk-checker.ts` - 24h cron job (0 0 * * *) checking disk free space via statfs with percent+bytes thresholds
- `server/src/jobs/index.ts` - Added diskChecker and notificationWatcher imports and start/stop registration

## Decisions Made
- NotificationWatcher constructor takes two positional args (notificationService, broadcaster) to match test scaffold — tests don't use a stackRepo so displayName falls back to stackId in notification subject/message
- DiskChecker constructor takes two positional args (notificationService, combined-settings) where settings mock combines getMany, findLastDiskAlert, setDiskAlertActive in one object
- Production singleton imports from `../application/index.js` (where the NotificationService singleton lives) rather than individual module files which lacked singleton exports
- UNHEALTHY timer re-checks activeIncidents in the setTimeout callback before firing — correctly suppresses notification if recovery happened during the 2-minute window

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type errors on production singleton imports**
- **Found during:** Task 2 (after running tsc --noEmit)
- **Issue:** Initial implementation imported `notificationService` from `../application/notification-service.js` and `settingsRepository` from `../repositories/settings-repository.js` — neither file exports a singleton with those names
- **Fix:** Changed import path to `../application/index.js` which is the actual source of the singletons
- **Files modified:** server/src/jobs/notification-watcher.ts, server/src/jobs/disk-checker.ts
- **Verification:** `npx tsc --noEmit` exits 0 with zero errors
- **Committed in:** 03c5cb4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - wrong import path for singletons)
**Impact on plan:** Fix required for correct compilation. No scope creep.

## Issues Encountered
None beyond the import path deviation documented above.

## Next Phase Readiness
- Notification trigger layer is complete: email delivery (03-02) + triggers (03-03)
- Phase 03 notifications subsystem is fully implemented
- Phase 04 (backup/restore) can proceed independently

---
*Phase: 03-notifications*
*Completed: 2026-03-17*
