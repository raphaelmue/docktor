---
created: 2026-08-28T00:00:00Z
title: Manual stack actions (deploy/stop/restart/update/backup/restore/compose-save) don't broadcast SSE status updates
area: observability
severity: major
files:
  - server/src/repositories/stack-repository.ts
  - server/src/application/stack-service.ts
  - server/src/lib/state-broadcaster.ts
  - client/src/routes/app/stacks/components/stack-actions.tsx
  - client/src/routes/app/stacks/[id].tsx
---

## Problem

Found during plan 02-08 Task 3 checkpoint verification (item 3, live tag
update check). User report: "when pressing re-deploy, the state on the ui
does not change."

`StackRepository.transitionStatus()` (`stack-repository.ts:80-103`) only
writes the DB (`Stack.status` + a `StatusLog` row) — it never publishes an
SSE event. The only code path that broadcasts `stack_status` is
`StatePoller`'s periodic `reconcile()` (`state-poller.ts:357-361`), which
runs on a 60s cron and explicitly skips stacks in a transitional status
(`TRANSITIONAL_STATES`) — i.e. it skips exactly the status a manual action
just set.

So every `StackService` method that calls `transitionStatus` directly —
`deployStack`, `stopStack`, `restartStack`, `updateImages`, and the
backup/restore flows in `backup-service.ts` — is invisible to any open
browser tab in real time. The client only learns about it via:
- a single `refetch()` called from `onAction` in `stack-actions.tsx`,
  fired only after the whole server-side action (including all status
  transitions) has already finished, so the transitional state (e.g.
  "Deploying") is never actually seen — only the terminal state.
- or coincidentally, the next 60s `StatePoller.reconcile()` tick, if the
  stack is no longer transitional by then.

If the terminal status happens to equal the starting status (e.g.
Redeploy on an already-`RUNNING` stack that redeploys successfully), the
single trailing refetch shows no visible change at all, even though a
full deploy cycle happened.

**Addendum (2026-08-28):** the same gap exists for the config-changed
badge, and it's worse there — no local refetch either, not just no SSE.
User report (clarifying an earlier cut-off message): "the badge that the
stack has changed but not deployed yet" doesn't appear right after
editing the compose YAML via the app's Compose tab and pressing Save —
only after a manual page refresh.

Confirmed: `StackService.updateStack()`'s `composeContent` branch
correctly calls `repo.setConfigChanged()` (DB write happens), but — like
`transitionStatus()` — never publishes any SSE event; `config_changed` is
only ever broadcast from `file-watcher.ts`, never from `stack-service.ts`.
Worse, `handleSaveCompose()`/`handleSaveEnv()` in `[id].tsx:119-145` don't
even call `refetch()` after a successful save (unlike
`stack-actions.tsx`'s `onAction={refetch}` pattern) — they only clear the
local dirty flag. So the badge is stale on the *same* page you just saved
from, not only on other open tabs, until you manually reload.

## Solution

TBD — likely: have `StackService` publish a `stack_status` SSE event
(via `StateBroadcaster`) at each `transitionStatus` call site (or centralize
it inside `transitionStatus` itself / a thin wrapper), so manual actions get
the same live feedback as poller-derived transitions. Needs a decision on
whether `StackRepository` should own broadcasting (it currently has no
broadcaster dependency) or whether each `StackService`/`BackupService`
method should call `stateEventBroadcaster.publish(...)` itself after each
`transitionStatus` call, matching the existing convention in
`file-watcher.ts` and `state-poller.ts`. For the addendum: at minimum add
`refetch()` after a successful `updateStack()` call in
`handleSaveCompose()`/`handleSaveEnv()` (a small, independent fix even
before the broader SSE-broadcast fix lands), and have `updateStack()`
publish `config_changed` the same way `file-watcher.ts` does so other
open tabs pick it up too.
