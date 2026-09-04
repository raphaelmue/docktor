---
status: diagnosed
trigger: "Failed backup logs not displaying"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:17:00Z
---

## Current Focus

hypothesis: CONFIRMED - logLines column doesn't exist in database table
test: Found explicit instruction in 04-01-PLAN.md stating "do NOT run prisma db push"
expecting: Prisma client types include logLines but PostgreSQL table doesn't have the column
next_action: Confirm root cause and document fix needed

## Symptoms

expected: Click "View" link on a FAILED backup. Backup detail page shows error alert with context-specific message. Log output shows where failure occurred.
actual: Error message alert displays correctly, but log output section is empty - shows "No output yet..."
errors: None reported (error alert displays correctly with errorMessage, but logs section empty)
reproduction: Test 12 in UAT (.planning/phases/04-backup-restore/04-UAT.md)
started: Discovered during UAT testing (phase 04)

## Eliminated

- hypothesis: toDto method excluding logLines
  evidence: toDto spreads entire backup object using {...backup} - preserves all fields
  timestamp: 2026-03-31T00:07:00Z

- hypothesis: API route filtering out logLines
  evidence: Route returns backupRepository.toDto(backup) without any field filtering or select clause
  timestamp: 2026-03-31T00:08:00Z

- hypothesis: BackupService not storing logs
  evidence: Line 197 in backup-service.ts correctly passes logLines to backupRepo.update()
  timestamp: 2026-03-31T00:05:00Z

## Evidence

- timestamp: 2026-03-31T00:05:00Z
  checked: BackupService.runBackup error handling (line 194-199)
  found: logLines array is correctly passed to backupRepo.update() on failure
  implication: Backend is storing logs, issue is in the API layer or frontend

- timestamp: 2026-03-31T00:06:00Z
  checked: GET /api/backups/:id route (backups.ts line 118-126)
  found: Route returns `backupRepository.toDto(backup)` after fetching from database
  implication: toDto method is transforming the backup record

- timestamp: 2026-03-31T00:07:00Z
  checked: BackupRepository.toDto implementation (line 112-117)
  found: toDto spreads backup object and only converts sizeBytes to string
  implication: logLines should be preserved in the spread

- timestamp: 2026-03-31T00:10:00Z
  checked: Backup detail page component (line 82 of [backupId].tsx)
  found: displayLines = isStreaming ? streamLines : (backup?.logLines ?? [])
  implication: If backup.logLines is undefined, displayLines becomes empty array, showing "No output yet..."

- timestamp: 2026-03-31T00:12:00Z
  checked: Prisma schema (backup.prisma line 11)
  found: Schema defines logLines String[] field
  implication: Schema has the field defined, but may not be in actual database

- timestamp: 2026-03-31T00:13:00Z
  checked: STATE.md development context
  found: Project uses "prisma db push" instead of migrations (due to schema drift in phase 02)
  implication: Schema changes require manual db push - logLines may never have been pushed to database

- timestamp: 2026-03-31T00:15:00Z
  checked: Phase 04 planning docs (.planning/phases/04-backup-restore/04-01-PLAN.md)
  found: Explicit instruction: "do NOT run `prisma migrate dev` or `prisma db push` -- schema generation only, migration handled separately"
  implication: Prisma schema includes logLines field, but it was never added to the actual PostgreSQL database

- timestamp: 2026-03-31T00:16:00Z
  checked: Git history for backup.prisma (commit 1afe75e)
  found: logLines String[] was in the schema from initial Phase 04 commit
  implication: Field has always been in schema but never synced to database

## Resolution

root_cause: The Backup table in the PostgreSQL database is missing the `logLines` column. During Phase 04 Plan 01 implementation, the Prisma schema (backup.prisma) was created with `logLines String[]`, and `prisma generate` was run to update TypeScript types. However, the planning doc explicitly instructed "do NOT run prisma db push", so the database schema was never updated. When Prisma queries the Backup table, it returns objects without the logLines field (since the column doesn't exist), causing backup?.logLines to be undefined. The frontend then displays an empty array ([]), showing "No output yet..." instead of the stored log lines.

fix: Run `yarn workspace @docktor/server prisma db push` to sync the Prisma schema to the PostgreSQL database, adding the logLines column to the Backup table.

verification: After running db push, trigger a backup (or view an existing one) and verify that log lines appear in the backup detail page.

files_changed:
  - Database schema (PostgreSQL Backup table - adds logLines TEXT[] column)
