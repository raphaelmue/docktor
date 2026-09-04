---
phase: 03-notifications
plan: 02
subsystem: api
tags: [nodemailer, smtp, notifications, email, fastify, prisma, crypto, zod]

# Dependency graph
requires:
  - phase: 03-notifications/03-01
    provides: "Prisma notification schema (Notification, StackIncident models), AES-256-GCM crypto module, test scaffolds"
  - phase: 01-mvp-completion
    provides: "Fastify app structure, settings-repository, SettingsService, auth middleware, db.ts"
provides:
  - "NotificationRepository: create, markEmailSent, findRecent, findLastDiskAlert, setDiskAlertActive"
  - "NotificationService: notify(), testSmtp(), getSmtpConfig() with nodemailer email delivery"
  - "NotificationSettings interface for DI (getSetting + getSmtpConfig)"
  - "GET/PUT /api/settings/smtp (password encrypted at rest, masked on read)"
  - "POST /api/settings/smtp/test (SMTP connection verification)"
  - "GET/PUT /api/settings/notification-triggers (stackError, diskWarning, disk thresholds)"
  - "GET /api/notifications (last 100 entries)"
affects: [03-notifications/03-03, 03-notifications/03-04]

# Tech tracking
tech-stack:
  added: [nodemailer@8.0.2, "@types/nodemailer"]
  patterns:
    - "NotificationSettings interface for duck-typed DI allowing settings mock in tests"
    - "vi.hoisted() + vi.mock() pattern for ESM module mocking in vitest"
    - "SMTP password stored with encrypted:true field on Setting model"
    - "settingsRepository exported as singleton from application/index.ts for direct key-value ops"

key-files:
  created:
    - server/src/repositories/notification-repository.ts
    - server/src/application/notification-service.ts
    - server/src/routes/notifications.ts
  modified:
    - server/src/application/settings-service.ts
    - server/src/application/index.ts
    - server/src/routes/settings.ts
    - server/src/app.ts
    - server/package.json
    - server/test/unit/application/notification-service.test.ts

key-decisions:
  - "NotificationService.notify() delegates to this.settings.getSmtpConfig() rather than its own getSmtpConfig() — matches test scaffold mock expectations and separates config retrieval from business logic"
  - "getSmtpConfig() added to SettingsService (not NotificationService) — SMTP config retrieval with decryption is a settings concern, keeps crypto logic co-located with settings"
  - "NotificationSettings interface defined in notification-service.ts for DI — allows settings mock to satisfy type without extending SettingsService"
  - "vi.hoisted() used for nodemailer mock refs — ESM hoisting requires refs to be created before vi.mock factory executes"
  - "settingsRepository exported as singleton from application/index.ts — settings routes need getMany() for batch key reads that SettingsService doesn't expose"

patterns-established:
  - "Notification email send errors are caught and logged, never thrown — watcher jobs and routes remain resilient"
  - "SMTP password: encrypted on PUT (AES-256-GCM), never returned in GET (hasPassword:boolean only)"
  - "Notification toggle default is enabled (notify.stackError !== 'false') — opt-out model"

requirements-completed: [NOTF-01, NOTF-02, NOTF-06]

# Metrics
duration: 10min
completed: 2026-03-17
---

# Phase 3 Plan 02: Notification Backend Infrastructure Summary

**NotificationRepository + NotificationService with nodemailer email delivery, 6 API routes for SMTP config, notification triggers, and notification log**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-17T21:57:00Z
- **Completed:** 2026-03-17T22:02:00Z
- **Tasks:** 2 of 2
- **Files modified:** 10

## Accomplishments

- NotificationRepository with full CRUD for notifications and disk alert state tracking
- NotificationService with notify() (DB write + conditional email), testSmtp(), and getSmtpConfig() via constructor-injected settings
- Six new API routes: GET/PUT smtp settings, POST smtp test, GET/PUT notification triggers, GET notifications log
- SMTP password encrypted with AES-256-GCM on write, hasPassword flag only on read
- All 6 notification-service unit tests pass GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: NotificationRepository + NotificationService + install nodemailer** - `b8c4455` (feat)
2. **Task 2: SMTP settings routes + notification triggers routes + notification log route** - `13f5c0d` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `server/src/repositories/notification-repository.ts` - Notification CRUD + disk alert state via Setting key
- `server/src/application/notification-service.ts` - notify(), testSmtp(), getSmtpConfig() with nodemailer; NotificationSettings interface
- `server/src/routes/notifications.ts` - GET /api/notifications route
- `server/src/routes/settings.ts` - Added 5 new routes (GET/PUT smtp, POST smtp/test, GET/PUT triggers)
- `server/src/application/settings-service.ts` - Added getSmtpConfig() with decrypt support
- `server/src/application/index.ts` - Added settingsRepository + notificationService singletons
- `server/src/app.ts` - Registered notificationRoutes
- `server/package.json` - Added nodemailer dependency
- `server/test/unit/application/notification-service.test.ts` - Fixed ESM mocking with vi.hoisted + vi.mock

## Decisions Made

- **NotificationSettings interface for DI:** `NotificationService` accepts `NotificationSettings` (duck type with `getSetting` + `getSmtpConfig`) rather than the concrete `SettingsService`. This matches the pre-scaffolded test mock shape without requiring `SettingsService` as the only valid type.
- **getSmtpConfig() on SettingsService:** Added `getSmtpConfig()` to `SettingsService` where it belongs semantically (SMTP config is a settings concern). NotificationService delegates to it.
- **settingsRepository exported from index.ts:** Routes need `getMany()` for batch key reads that SettingsService doesn't expose via its public API.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed notification-service.test.ts ESM mocking**
- **Found during:** Task 1 (running tests to verify GREEN)
- **Issue:** Pre-scaffolded tests used `vi.doMock("nodemailer", ...)` inside test bodies, which doesn't intercept ESM top-level imports. Two tests failed: "sends email when SMTP is configured" (markEmailSent not called because sendMail used real nodemailer which failed DNS), "calls transport.verify()" (rejected with ENOTFOUND).
- **Fix:** Replaced `vi.doMock` with `vi.hoisted()` + top-level `vi.mock("nodemailer", ...)` pattern. Moved mock fns to `vi.hoisted()` so refs are available when hoisted mock factory executes.
- **Files modified:** server/test/unit/application/notification-service.test.ts
- **Verification:** All 6 tests pass GREEN
- **Committed in:** b8c4455 (Task 1 commit)

**2. [Rule 2 - Missing] NotificationSettings interface for DI flexibility**
- **Found during:** Task 1 (analyzing test mock shape vs SettingsService interface)
- **Issue:** Test mock for `settings` includes `getSmtpConfig` which `SettingsService` didn't have. Plan called for `notify()` to call `this.getSmtpConfig()` (own method), but tests mock `settings.getSmtpConfig`.
- **Fix:** Defined `NotificationSettings` interface with `getSetting + getSmtpConfig`, added `getSmtpConfig()` to `SettingsService` (with crypto decrypt), updated `notify()` to delegate to `this.settings.getSmtpConfig()`.
- **Files modified:** server/src/application/notification-service.ts, server/src/application/settings-service.ts
- **Verification:** Tests pass, TypeScript compiles clean
- **Committed in:** b8c4455 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 missing critical)
**Impact on plan:** Both fixes necessary for tests to pass and design to match pre-scaffolded tests. No scope creep.

## Issues Encountered

- `vi.doMock` in ESM vitest context cannot intercept already-imported modules — resolved by migrating to `vi.hoisted()` + `vi.mock()` pattern which is properly hoisted before module imports.

## User Setup Required

None - no external service configuration required. ENCRYPTION_KEY env var must be set for SMTP password encryption (already required from Phase 03-01).

## Next Phase Readiness

- NotificationService.notify() ready to be called from watcher jobs (Plan 03-03)
- All API routes ready for UI consumption (Plan 03-04)
- SMTP password encryption/decryption fully working via existing crypto module

---
*Phase: 03-notifications*
*Completed: 2026-03-17*
