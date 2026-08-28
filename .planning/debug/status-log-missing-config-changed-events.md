---
status: diagnosed
trigger: "Investigate issue: status-log-missing-config-changed-events — config_changed StackEvents are broadcast via SSE and persisted to the database, but they don't show up in the stack detail page's Status Log UI — only in server logs."
created: 2026-08-28T16:30:00Z
updated: 2026-08-28T16:45:00Z
---

## Current Focus

hypothesis: CONFIRMED — see Resolution
test: n/a (root cause confirmed via static trace, no further test needed)
expecting: n/a
next_action: return ROOT CAUSE FOUND to caller (goal: find_root_cause_only)

## Symptoms

expected: config_changed, config_error, and update_available events are recorded (StackEventRepository.createEvent, per 02-02-SUMMARY.md) and queryable per stack with a timestamp and event type, and are visible to the user in the stack detail page's "Status Log" section.
actual: "I dont see no config_changed in the \"Status Log\". Only in the server logs."
errors: None reported
reproduction: Test 16 in .planning/phases/02-observability/02-UAT.md — trigger a config file change on a stack, then check that stack's "Status Log" in the UI
started: Discovered during UAT re-verification of phase 02-observability (2026-08-28)

## Eliminated

- hypothesis: The write path is broken — FileWatcher never actually calls createEvent()/persists StackEvent rows.
  evidence: |
    server/src/jobs/file-watcher.ts:159-183 calls `repo.createStackEvent(...)` for both
    the config_error and config_changed branches. `repo` resolves (via `getRepo()`,
    file-watcher.ts:33-38) to the real `stackRepository` singleton at runtime.
    `stackRepository.createStackEvent()` (server/src/repositories/stack-repository.ts:349-363)
    does `prisma.stackEvent.create({data: {...}})` — a real, unconditional write to the
    StackEvent table. UAT Test 3 and Test 4 (both "pass") independently confirm the SSE
    broadcast fires correctly immediately after this write, which corroborates the write
    path executes on every file-watch detection. Write path is NOT the problem.
  timestamp: 2026-08-28T16:35:00Z

- hypothesis: The dedicated StackEventRepository (createEvent/findRecentByStack, built per 02-02-SUMMARY.md) is the one being used and its findRecentByStack() has a bug.
  evidence: |
    `grep -rn "stackEventRepository|findRecentByStack" server/src --include=*.ts` (excluding
    its own definition file) returns ZERO matches. StackEventRepository
    (server/src/repositories/stack-event-repository.ts) is entirely unreferenced dead code —
    nothing calls `createEvent()` or `findRecentByStack()` anywhere in the running
    application. FileWatcher instead calls a separate, ad-hoc `createStackEvent()` method
    bolted onto StackRepository (stack-repository.ts:349) that duplicates the same
    `prisma.stackEvent.create()` write. So there are two parallel, never-unified
    implementations of "write a StackEvent" — but neither is what's broken; the *read*
    side simply doesn't exist for either of them (see Resolution).
  timestamp: 2026-08-28T16:38:00Z

## Evidence

- timestamp: 2026-08-28T16:32:00Z
  checked: client/src/routes/app/stacks/[id].tsx (the "Status Log" Card, lines 282-323)
  found: |
    The card titled "Status Log" renders `stack.statusLogs`, mapping each entry as
    `{log.fromStatus && <>{log.fromStatus} → </>}{log.toStatus}` plus optional
    `log.message`. Fields used: id, createdAt, fromStatus, toStatus, message.
    There is no `type` field rendered, and no code path anywhere in this file references
    `stackEvent`, `StackEvent`, `config_changed`, `config_error`, or `update_available`.
  implication: |
    The "Status Log" UI is rendering StackStatus state-machine transitions
    (e.g. RUNNING → STOPPED), not the StackEvent audit-trail entity at all. Confirms
    this is a different data model, not a filtering/display bug on the same data.

- timestamp: 2026-08-28T16:33:00Z
  checked: server/prisma/schema/status-log.prisma vs server/prisma/schema/stack-event.prisma
  found: |
    Two entirely separate Prisma models exist:
    - `StatusLog` { fromStatus StackStatus?, toStatus StackStatus, message, output } —
      records stack status transitions (RUNNING/STOPPED/DEPLOYING/etc.)
    - `StackEvent` { type: config_changed|config_error|update_available, message, payload } —
      the audit-trail entity described in 02-02-SUMMARY.md.
    `stack.prisma:39` relates Stack to `statusLogs StatusLog[]` only; StackEvent has its
    own `stack` relation field but is not aggregated onto any Stack "include" used by the
    detail page.
  implication: |
    "Status Log" (client label) and "StatusLog" (Prisma model) are a naming coincidence
    that masks the real gap — the UI section was purpose-built for status transitions,
    never for the StackEvent audit trail, despite the similar name suggesting otherwise.

- timestamp: 2026-08-28T16:34:00Z
  checked: server/src/repositories/stack-repository.ts:16-29 (findByIdWithRelations) and
    server/src/application/stack-service.ts:50-52 (getStack)
  found: |
    `findByIdWithRelations()` — the only method backing `GET /api/stacks/:id` — includes
    `services`, `deployments` (take 10), and `statusLogs` (take 20). It does NOT include
    `stackEvents` in any form. `stackService.getStack()` is a direct passthrough to this
    repository method with no additional field composition.
  implication: |
    The API response the client actually consumes for the stack detail page never
    contains StackEvent data under any key.

- timestamp: 2026-08-28T16:35:00Z
  checked: server/src/routes/stacks.ts (all registered routes, full file)
  found: |
    Full route list: GET /api/stacks, POST /api/stacks, GET /api/stacks/:id,
    PUT /api/stacks/:id, DELETE /api/stacks/:id, POST /api/stacks/:id/deploy,
    POST /api/stacks/:id/stop, POST /api/stacks/:id/restart, POST /api/stacks/:id/update,
    GET /api/stacks/:id/compose, GET /api/stacks/:id/env, GET /api/stacks/:id/containers,
    GET /api/stacks/:id/services/:serviceName/tags,
    POST /api/stacks/:id/services/:serviceName/upgrade, GET /api/stacks/:id/logs.
    None of these reference `stackEvent`, `StackEvent`, or `findRecentByStack`. There is
    no `GET /api/stacks/:id/events` (or any equivalent) route anywhere in the codebase.
  implication: |
    Confirms hypothesis #2 from the task brief: there is no backend route exposing
    StackEvent data to the client at all — not a bug in an existing route, a route that
    was simply never built (or built repository-side per 02-02 and never wired to HTTP).

## Resolution

root_cause: |
  Three compounding gaps, not one:
  (1) Missing backend route — StackEvent data (config_changed/config_error/update_available,
      persisted correctly by FileWatcher -> stackRepository.createStackEvent() ->
      prisma.stackEvent.create()) has no HTTP endpoint exposing it. GET /api/stacks/:id
      (stackService.getStack -> stackRepository.findByIdWithRelations) only includes
      services, deployments, and statusLogs — never stackEvents. No dedicated
      GET /api/stacks/:id/events route exists either.
  (2) Missing client wiring — consequently, the client has no code anywhere that fetches
      or renders StackEvent data; there is nothing to wire even if the route existed.
  (3) The "Status Log" UI section that the user expected to show these events was never
      designed to show them in the first place — it renders the unrelated `StatusLog`
      Prisma model (StackStatus state-machine transitions: fromStatus -> toStatus), a
      different entity that happens to share a near-identical name with "StackEvent" /
      "Status Log" label, creating the appearance of a single missing feature when it's
      actually two separate features (status-transition log vs. event audit trail) and
      only one was ever built end-to-end.
  Secondary finding (architectural, not the direct cause of the UAT symptom): the
  dedicated `StackEventRepository.createEvent()`/`findRecentByStack()` built per
  02-02-SUMMARY.md is unreferenced dead code. FileWatcher instead writes StackEvent rows
  through a duplicate, ad-hoc `StackRepository.createStackEvent()` method
  (stack-repository.ts:349, using `type: args.type as any`), so the write path works but
  bypasses the intended repository, and the intended read method
  (`findRecentByStack`) was never connected to any route.
fix: (not applied — goal is find_root_cause_only)
verification: (not applicable — diagnosis only)
files_changed: []
