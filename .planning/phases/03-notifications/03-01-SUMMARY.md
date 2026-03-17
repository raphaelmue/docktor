---
phase: 03-notifications
plan: 01
subsystem: database
tags: [prisma, crypto, aes-256-gcm, notifications, vitest, tdd]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "StateBroadcaster, SettingsRepository, jobs/index.ts pattern"
provides:
  - "Notification + StackIncident Prisma models with NotificationType enum"
  - "AES-256-GCM encrypt/decrypt module (server/src/lib/crypto.ts)"
  - "RED-state test scaffolds for NotificationService, NotificationWatcher, DiskChecker"
affects: [03-notifications-02, 03-notifications-03, 03-notifications-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AES-256-GCM encrypt/decrypt using Node built-in crypto module (iv+tag+ciphertext hex format)"
    - "RED-state TDD scaffolds with concrete it() assertions ahead of implementation"

key-files:
  created:
    - server/prisma/schema/notification.prisma
    - server/src/lib/crypto.ts
    - server/test/unit/lib/crypto.test.ts
    - server/test/unit/application/notification-service.test.ts
    - server/test/unit/jobs/notification-watcher.test.ts
    - server/test/unit/jobs/disk-checker.test.ts
  modified:
    - server/prisma/schema/stack.prisma

key-decisions:
  - "AES-256-GCM storage format: iv(12 bytes) + tag(16 bytes) + ciphertext, all hex-encoded as single string"
  - "getKey() validates both presence and exact 32-byte length of ENCRYPTION_KEY env var"
  - "prisma db push skipped — no DATABASE_URL configured in dev environment; prisma generate confirmed schema validity"
  - "DiskChecker mock uses Settings.getMany (not getSetting) for batch threshold reads matching Pattern 4 from RESEARCH.md"

patterns-established:
  - "Pattern 1: AES-256-GCM encrypt: randomBytes(12) IV, createCipheriv, concat iv+tag+ciphertext → hex"
  - "Pattern 2: AES-256-GCM decrypt: parse hex, subarray(0,12)=iv, subarray(12,28)=tag, subarray(28..)=data, setAuthTag"
  - "Pattern 3: RED-state test scaffold — concrete it() assertions referencing non-existent implementation files; fail with ERR_MODULE_NOT_FOUND"

requirements-completed: [NOTF-02, NOTF-03, NOTF-04, NOTF-06]

# Metrics
duration: 12min
completed: 2026-03-17
---

# Phase 3 Plan 01: Notification Foundation Summary

**Prisma Notification+StackIncident schema, AES-256-GCM crypto.ts with 5 passing tests, and RED-state test scaffolds for NotificationService/NotificationWatcher/DiskChecker**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-17T21:54:22Z
- **Completed:** 2026-03-17T22:06:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Created notification.prisma with Notification, StackIncident models and NotificationType enum; added relations to Stack model; confirmed `prisma generate` succeeds
- Implemented crypto.ts with AES-256-GCM encrypt/decrypt using Node built-in crypto; all 5 unit tests pass (round-trip, random IV, tamper detection, missing key, invalid key length)
- Created three RED-state test scaffold files with concrete assertions; all fail with `ERR_MODULE_NOT_FOUND` (not syntax errors), confirming proper RED state

## Task Commits

Each task was committed atomically:

1. **Task 1: Prisma schema + crypto module with passing tests** - `3b684f3` (feat)
2. **Task 2: RED-state test scaffolds for NotificationService, NotificationWatcher, DiskChecker** - `8cb83ea` (test)

**Plan metadata:** (to be updated after final commit)

## Files Created/Modified

- `server/prisma/schema/notification.prisma` - Notification + StackIncident models + NotificationType enum
- `server/prisma/schema/stack.prisma` - Added `notifications Notification[]` and `incidents StackIncident[]` relations
- `server/src/lib/crypto.ts` - AES-256-GCM encrypt/decrypt using Node built-in crypto; reads ENCRYPTION_KEY env var
- `server/test/unit/lib/crypto.test.ts` - 5 GREEN tests covering round-trip, random IV, tamper detection, missing/invalid key
- `server/test/unit/application/notification-service.test.ts` - 6 RED test cases for NotificationService.notify() and testSmtp()
- `server/test/unit/jobs/notification-watcher.test.ts` - 6 RED test cases with fake timers for ERROR/UNHEALTHY/recovery logic
- `server/test/unit/jobs/disk-checker.test.ts` - 5 RED test cases with mocked statfs for threshold checks and dedup

## Decisions Made

- AES-256-GCM storage format: `iv(12) + tag(16) + ciphertext` all hex-encoded — matches RESEARCH.md Pattern 1
- `getKey()` validates both presence and exact 32-byte length; error messages match plan spec exactly
- `prisma db push` skipped due to no DATABASE_URL in dev environment; `prisma generate` confirmed schema validity
- DiskChecker test scaffold uses `settings.getMany` (batch read) rather than `getSetting` — matches Pattern 4 from RESEARCH.md which reads all thresholds and toggles in one call

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `prisma generate` initially failed because config path must be explicitly specified with `--config prisma/prisma.config.ts` — the project uses a custom prisma.config.ts rather than the default schema.prisma location. Resolved by providing the flag.
- `prisma db push` was skipped because no `DATABASE_URL` is configured in the dev environment. This is expected for the local workspace (no local Postgres). The schema validity was confirmed by `prisma generate`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Schema is generated; NotificationService, NotificationWatcher, DiskChecker implementations can proceed (Plan 02)
- RED test scaffolds define the exact API contracts for those implementations
- crypto.ts is ready to use for SMTP password encryption in Plan 03

---
*Phase: 03-notifications*
*Completed: 2026-03-17*

## Self-Check: PASSED

All files verified present. All commits verified in git history.
- FOUND: notification.prisma
- FOUND: crypto.ts
- FOUND: crypto.test.ts
- FOUND: notification-service.test.ts
- FOUND: notification-watcher.test.ts
- FOUND: disk-checker.test.ts
- FOUND: 03-01-SUMMARY.md
- FOUND: commit 3b684f3 (feat: schema + crypto)
- FOUND: commit 8cb83ea (test: RED scaffolds)
