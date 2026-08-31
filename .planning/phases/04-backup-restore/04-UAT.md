---
status: testing
phase: 04-backup-restore
source: [04-VERIFICATION.md]
started: 2026-08-31T08:47:20Z
updated: 2026-08-31T08:47:20Z
---

## Current Test

number: 1
name: Manual backup with no repository configured is reported as a visible failure, not a crash or stuck state
expected: |
  Configure a per-stack schedule and trigger a backup with no restic repository configured, on
  both the manual route and the scheduled cron path. Expect: a visible FAILED backup with a
  stated reason, and the stack lands in ERROR state — no server crash, no stack permanently
  wedged in BACKING_UP.
awaiting: user response

## Tests

### 1. Backup with no repository configured fails visibly
expected: A visible FAILED backup with a stated reason and the stack in ERROR — no server crash, no permanently wedged BACKING_UP stack.
result: [pending]

### 2. Live restore from a snapshot, including a disconnect/reconnect mid-restore
expected: Restore behaves identically to a backup on the detail page: SSE stream shows live progress while IN_PROGRESS, a reconnect repopulates the full log without duplication, and the terminal toast/alert correctly reflects success vs failure. (Newly observable now that the restore-flow synchronicity fix, commit 35a1c14, makes the SSE-replay mechanism reachable on the restore path.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
