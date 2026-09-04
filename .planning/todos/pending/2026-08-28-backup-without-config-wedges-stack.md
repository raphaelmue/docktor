---
created: 2026-08-28T12:00:00.000Z
title: Backup can be triggered without a configured repo, wedging the stack in BACKING_UP forever
area: backup
severity: major
files:
  - server/src/application/backup-service.ts
  - server/src/routes/backups.ts
---

## Problem

User report: "I was able to start a backup, without having the backups
configured in the settings. This should not be possible. Now the status
is backing up like for ever."

Root-caused to two compounding defects:

1. `BackupService.initiateBackup()` (`backup-service.ts:115-136`)
   unconditionally creates an `IN_PROGRESS` `Backup` row and transitions
   the stack to `BACKING_UP` — with no check that a backup repository is
   even configured.
2. `POST /api/stacks/:id/backup` (`backups.ts:27-59`) does the actual
   work in a fire-and-forget block: it fetches `repoConfig` via
   `getBackupRepoConfig()` and, if `repoConfig` is `null` (not
   configured), the `else` branch (`backups.ts:50-52`) only logs to the
   console and does nothing else — it never calls `runBackup()`. Nothing
   ever transitions the `Backup` row out of `IN_PROGRESS` or the `Stack`
   out of `BACKING_UP`.

This is the same class of bug as the deploy/update-images stuck-state
issue fixed in plan 02-08 (see `.planning/todos/pending/2026-08-28-manual-actions-dont-broadcast-sse.md`
and the `Blockers/Concerns` note in STATE.md about `StatePoller`'s
unconditional transitional-state skip): `BACKING_UP` is not in any
action's allowed-from list in `stack-status-machine.ts`, and
`StatePoller` unconditionally skips transitional statuses forever — so
once wedged, there is no in-app recovery path, only a manual DB edit.

## Solution

TBD — two independent fixes:
1. `initiateBackup()` should validate a backup repo is configured
   (`getBackupRepoConfig()` returns non-null) and throw a `BadRequestError`
   *before* creating the `Backup` row or transitioning the stack, so an
   unconfigured backup request fails fast with a clear error instead of
   silently wedging.
2. Defense in depth: the fire-and-forget block's `else` branch (missing
   repoConfig) should still resolve the stack out of `BACKING_UP` (e.g.
   transition to `ERROR` and mark the `Backup` row `FAILED`) rather than
   leaving both permanently stuck — mirroring the `catch` block's cleanup
   behavior just below it.
