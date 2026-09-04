---
created: 2026-08-28T00:00:00Z
title: Service status badges show "unknown" for up to 60s after deploy/redeploy
area: observability
severity: minor
files:
  - server/src/jobs/state-poller.ts
  - server/src/repositories/stack-repository.ts
---

## Problem

Found during plan 02-08 Task 3 checkpoint verification (item 3, live tag
update check). User report: "the status of the containers in the services
list is often unknown although running."

`ServiceStatusBadge` (`client/src/routes/app/stacks/[id].tsx:37-40`) renders
"unknown" whenever `Service.containerState` is null. Three things compound
to make that null window larger than expected after a deploy:

1. `deployStack()`'s success path calls `StackRepository.replaceServices()`
   (`stack-repository.ts:105-114`), which deletes and recreates every
   `Service` row for the stack — by design, since old container IDs are
   stale after a redeploy — which sets `containerState` back to null.
2. `StatePoller.handleEvent()` (the real-time docker-event listener) skips
   any stack whose status is still transitional
   (`state-poller.ts:211: if (TRANSITIONAL_STATES.has(stack.status)) return`).
   The one-shot "start" events Docker emits for newly created containers
   fire *while* the stack is still `DEPLOYING`, so they're silently
   dropped — there is no second event to catch later.
3. The only remaining path that re-populates `containerState` is
   `StatePoller.reconcile()`, a cron running every 60 seconds
   (`state-poller.ts:106: cron.schedule("*/60 * * * * *", ...)`), and it
   also skips transitional stacks (`state-poller.ts:319`) — so it can
   only pick services back up once `deployStack()` has already
   transitioned the stack out of `DEPLOYING`.

Net effect: after every deploy/redeploy, every service in that stack
legitimately shows "unknown" for up to ~60s, with no live event to shorten
that window. Related to [[2026-08-28-manual-actions-dont-broadcast-sse]] —
fixing that todo (broadcasting on `transitionStatus`) does not by itself
fix this one, since the underlying `containerState` data is genuinely
absent from the DB until reconcile runs, not just unbroadcast.

## Solution

TBD — options to consider:
- After a successful `deployStack()`/`updateImages()`, proactively inspect
  and write the fresh `containerState`/`healthStatus` for each service
  (mirroring what `StatePoller.reconcile()` already does for one project)
  instead of waiting for the next cron tick.
- Or shorten the reconcile interval — but that's a blunter fix and doesn't
  address the real-time event being dropped during `DEPLOYING`.
- Or have `deployStack()` trigger an immediate single-project reconcile
  pass right after transitioning back to RUNNING.
