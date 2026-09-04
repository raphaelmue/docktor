---
created: 2026-08-28T00:00:00Z
title: No way to manually trigger an image update check
area: observability
severity: minor
files:
  - server/src/jobs/update-checker.ts
  - server/src/routes/stacks.ts
---

## Problem

Found while verifying plan 02-12's checkpoint. `UpdateChecker`'s stagger
window is `6 hours / (number of tracked images)` — with few tracked
images (e.g. a single-stack deployment), that's up to a full 6-hour wait
between checks for a given image, and there's no UI/API action to force
an immediate check. The only way to unblock a stale/incorrect
`ImageUpdateCheck` row right now is a direct DB edit (set
`lastCheckedAt = NULL`, which `getNextImageToCheck()` always prioritizes
over the stagger cutoff).

This matters beyond just testing convenience: any time the check logic
itself changes (as it did today across plans 02-09/02-10), previously
stored results become stale and there's no way for a real user to refresh
them without waiting out the stagger window.

## Solution

TBD — add a "Check for updates now" action (per-service or per-stack)
that calls `UpdateChecker.checkImage()` directly for the addressed
image(s), bypassing the stagger gate for an explicit user-initiated
request (the stagger logic should still apply to the background cron;
this is only about giving users an escape hatch).
