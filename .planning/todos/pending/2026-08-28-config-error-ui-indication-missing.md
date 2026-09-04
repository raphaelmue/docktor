---
created: 2026-08-28T00:00:00Z
title: Show config_error state in the UI (currently backend-only)
area: observability
severity: major
files:
  - client/src/hooks/use-container-events.ts
  - client/src/hooks/use-stacks.ts
  - client/src/hooks/use-stack.ts
  - client/src/routes/app/stacks/[id].tsx
  - client/src/components/domain/stack/stack-list.tsx
  - server/prisma/schema/stack.prisma
  - server/src/jobs/file-watcher.ts
  - server/src/repositories/stack-repository.ts
---

## Problem

Verified during plan 02-08 Task 3 checkpoint (UAT test 5 / Gap 2 re-check).
Introducing a YAML syntax error into a running stack's `docker-compose.yml`
correctly produces:

- `[FileWatcher] Config error for memos: ...` in the server logs
- a `config_error` `StackEvent` row
- `[NotificationWatcher] Received event: config_error` (SSE broadcast fires)

But nothing appears in the Docktor web UI. Root-caused (see
`.planning/debug/config-error-not-shown.md`, "Reopened 2026-08-28" section):
the client has no code path for this event type at all, distinct from the
already-fixed backend issue.

- `client/src/hooks/use-container-events.ts` — `StateEvent` union has no
  `ConfigErrorEvent` variant; the SSE message is delivered and silently
  dropped by every consumer's `if/else if` chain.
- `client/src/hooks/use-stacks.ts` / `use-stack.ts` — only branch on
  `event.type === "config_changed"` to refetch; no `config_error` case.
- `server/prisma/schema/stack.prisma` — `Stack` has `configChanged: Boolean`
  but nothing analogous for errors (no persisted "latest unresolved config
  error" field). `StackEvent` is an append-only audit log only; nothing
  projects the latest error onto the `Stack` row the way `configChanged`
  does.
- `client/src/routes/app/stacks/[id].tsx` and
  `client/src/components/domain/stack/stack-list.tsx` only render a badge
  for `stack.configChanged` — no error-state badge/indicator exists to
  render even once the event is wired up.

## Solution

TBD — likely mirrors the existing `configChanged` pattern:

1. Add `ConfigErrorEvent` to the client `StateEvent` union
   (`use-container-events.ts`), matching the server's
   `ConfigErrorEvent { type: "config_error", stackId, message }`
   (`server/src/lib/state-broadcaster.ts`).
2. Persist the latest error on `Stack` (e.g. `configError: String?`),
   set by `FileWatcher.handleFileChange()`'s catch branch, cleared on the
   next successful parse/sync (config-changed path) or on deploy/restart —
   same lifecycle as `configChanged`.
3. Handle `config_error` in `use-stacks.ts` / `use-stack.ts` to refetch.
4. Add a red/error badge in `[id].tsx` and `stack-list.tsx` alongside the
   existing yellow `configChanged` badge.

Needs a short design decision first: does a config error also clear
`configChanged`, or can both be true simultaneously? Check against the
StackStatus state machine before implementing.
