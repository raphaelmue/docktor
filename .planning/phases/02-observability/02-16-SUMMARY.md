---
phase: 02-observability
plan: 16
subsystem: ui
tags: [react, sse, stack-events, event-log, gap-closure]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "GET /api/stacks/:id/events (plan 02-15) — the StackEventRepository.findRecentByStack() read path this plan consumes"
  - phase: 02-observability
    provides: "The initial-versus-background fetch split and SSE-driven refresh pattern established for useStack (plan 02-14), mirrored here for useStackEvents"
provides:
  - "getStackEvents() client function and StackEvent/StackEventType types in stacks-api.ts"
  - "useStackEvents(stackId) — the hook owning event-log server state, with the same isRefreshing/loading split as useStack"
  - "ConfigErrorEvent declared on the StateEvent union so any consumer can react to the config_error SSE event the server has published since plan 02-03"
  - "EventLogCard — the StackEvent audit trail rendered as its own titled, described section, separate from StatusLogCard"
  - "StatusLogCard — the status transition log extracted out of [id].tsx as a peer component"
affects: [stack-detail-page, uat-gap-closure]

actuals:
  tokens: 8606
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "useStackEvents mirrors useStack's fetchMode('initial' | 'background') pattern verbatim: SSE-triggered refreshes set isRefreshing and never clear loaded entries or touch loading/error"
    - "Pure entry-description helper (describeStackEvent) exported from the card file and unit-tested directly, separating presentation-mapping logic from JSX so the malformed-payload case is testable without rendering"
    - "CardTitle given role='heading' aria-level={2} (a prop passthrough, not an edit to components/ui/card.tsx) so sibling cards are queryable and distinguishable by accessible heading in tests"

key-files:
  created:
    - client/src/hooks/use-stack-events.ts
    - client/src/routes/app/stacks/components/event-log-card.tsx
    - client/src/routes/app/stacks/components/status-log-card.tsx
    - client/test/unit/hooks/use-stack-events.test.ts
    - client/test/unit/routes/stacks/event-log-card.test.tsx
  modified:
    - client/src/lib/stacks-api.ts
    - client/src/hooks/use-container-events.ts
    - client/src/routes/app/stacks/[id].tsx

key-decisions:
  - "getStackEvents(stackId, limit?) omits the query parameter entirely when limit is undefined, so the server's own default (20, set in plan 02-15's route schema) governs — no client-side default invented"
  - "describeStackEvent() badge variants: config_changed -> default, update_available -> secondary, config_error -> destructive — three distinct Badge variants so no two of the three event types share a look, not just config_error standing out from an undifferentiated pair"
  - "EventLogCard's error branch renders only when events === null (i.e. the initial load never succeeded); once entries exist, a later background-refresh failure leaves them on screen and the card never reverts to the error view, matching the 'must not clear rendered entries' constraint"
  - "The retry control on a failed initial load is wired to the hook's refetch() (background mode) rather than re-invoking the initial load — a successful retry populates events, which flips the card's render branch away from the error state without needing the hook to expose a second entry point"
  - "Tracer feedback gate (Task 1): verify is fully automated (yarn test:unit, yarn build, grep) with no visual/UI step, matching plan 02-14's precedent — ran and passed inline, no blocking checkpoint raised, since this is a sequential single-agent run with no orchestrator continuation path"

patterns-established:
  - "Second hand-rolled hook (useStackEvents) following the loading/isRefreshing split now exists alongside useStack — this is the established shape for any future hook that both mounts and receives SSE-triggered background refreshes"

requirements-completed: [FW-02, UPD-03]

coverage:
  - id: D1
    description: "After editing a compose file on disk, the user sees a config_changed entry for that stack in the Event Log, with its timestamp and type"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > renders a config_changed entry naming its type and saying the compose file changed on disk"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-stack-events.test.ts#useStackEvents > a config_changed event for that stack id triggers a background refresh without clearing entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "config_error and update_available entries are shown in the same place as config_changed, each labelled with its own type"
    requirement: "UPD-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > renders a config_error entry with its stored message and a distinct badge variant"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > renders an update_available entry naming its type and the image reference it carries"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > badge variants for the three types are all visibly distinct"
        status: pass
    human_judgment: false
  - id: D3
    description: "The event audit trail (EventLogCard) and the stack status transition log (StatusLogCard) are two visibly separate, separately labelled and described sections"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > is reachable by its accessible heading, distinct from the status log's heading"
        status: pass
      - kind: other
        ref: "grep verification: CardDescription present in both status-log-card.tsx and event-log-card.tsx, StatusLogCard extracted and rendered adjacent to EventLogCard in [id].tsx — see Task 2 acceptance criteria"
        status: pass
    human_judgment: false
  - id: D4
    description: "A new event arriving over SSE appears without a manual page refresh and without the card or page losing its rendered state"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-stack-events.test.ts#useStackEvents > a config_error event for that stack id triggers the same background refresh"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-stack-events.test.ts#useStackEvents > an update_available event for that stack id triggers the same background refresh"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-stack-events.test.ts#useStackEvents > a background refresh that rejects leaves the previous entries in place and leaves error null"
        status: pass
    human_judgment: false
  - id: D5
    description: "A stack with no recorded events says so explicitly, rather than rendering an unexplained empty area; an in-flight load shows a loading state, not the empty message"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > renders an explicit empty message when the stack has no recorded events"
        status: pass
      - kind: unit
        ref: "client/test/unit/routes/stacks/event-log-card.test.tsx#EventLogCard > shows a loading state while the initial load is in flight"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Event Log card's visual placement, spacing and legibility next to the Status Log card on the real running page"
    verification: []
    human_judgment: true
    rationale: "Layout, spacing and readability of two adjacent cards is a rendering/CSS concern not provable by a jsdom unit test; needs a human glance at the running Overview tab."

duration: 25min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 16: Event Log Card — the Audit Trail UAT Test 16 Couldn't Find Summary

**A new `EventLogCard` consumes plan 02-15's `GET /api/stacks/:id/events` endpoint and renders the `StackEvent` audit trail (config_changed / config_error / update_available) as its own titled, described section next to a `StatusLogCard` extracted out of the 408-line page file, closing the visible half of UAT gap G-02-16.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-28T22:20:00Z
- **Completed:** 2026-08-28T22:45:00Z
- **Tasks:** 2
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- `StackEventType`/`StackEvent`/`getStackEvents(stackId, limit?)` added to `stacks-api.ts`, routed through `apiFetch` with `encodeURIComponent` on the stack id path segment; an absent `limit` omits the query parameter entirely so the server's default governs
- `ConfigErrorEvent` declared on the `StateEvent` union in `use-container-events.ts` — the server has published this event since plan 02-03 but no client type existed for it; additive change confirmed safe against `use-stacks.ts` and `settings.tsx` (both branch with if/else, not an exhaustive switch)
- `useStackEvents(stackId)` created, mirroring `useStack`'s (plan 02-14) initial-versus-background fetch split exactly: mount does an initial fetch (`loading`/`error`), the three audit SSE event types (scoped to the addressed stack id) trigger a background refresh (`isRefreshing`, entries never cleared, failures logged via `console.warn` and never surfaced as `error`); `container_state` and other-stack events are ignored
- `EventLogCard` renders the audit trail with per-type presentation: `describeStackEvent()` (a pure, independently-tested helper) maps each entry to a label, description and one of three distinct `Badge` variants (`config_changed` → default, `update_available` → secondary, `config_error` → destructive); a malformed/empty/absent JSON payload is caught and falls back to fixed text, never throwing
- `StatusLogCard` extracted verbatim from `[id].tsx` (identical markup, fields, empty text, scroll height) so it sits as a peer next to `EventLogCard`, addressing the `CLAUDE.md` refactoring-targets entry for this page file; `[id].tsx` drops from 408 to 371 lines
- Both cards gained a `CardDescription` naming their data source ("shows the stack's status transitions" / "shows configuration and image update events detected in the background") and an accessible heading (`role="heading" aria-level={2}` passthrough prop on `CardTitle`, not an edit to `components/ui/card.tsx`) — directly targeting the near-identical-naming confusion that caused UAT gap G-02-16
- Four presentational states handled in `EventLogCard`: loading (skeleton), failed initial load (error message + retry wired to the hook's `refetch`), empty ("No events recorded"), and populated

## Task Commits

Each task's tests and implementation were committed atomically per TDD gate:

1. **Task 1 (TDD RED): failing coverage for useStackEvents** - `9cfe584` (test)
2. **Task 1 (TDD GREEN): stacks-api/use-container-events/useStackEvents/EventLogCard/[id].tsx, one recorded event reaching the page** - `375f18f` (feat)
3. **Task 2 (TDD RED): failing coverage for the Event Log card presentation** - `df52b0c` (test)
4. **Task 2 (TDD GREEN): StatusLogCard extraction + full EventLogCard presentation** - `5af187f` (feat)

**Plan metadata:** committed together with this SUMMARY (see final commit below)

## Files Created/Modified
- `client/src/lib/stacks-api.ts` — `StackEventType`, `StackEvent`, `getStackEvents()`
- `client/src/hooks/use-container-events.ts` — `ConfigErrorEvent` added to `StateEvent`
- `client/src/hooks/use-stack-events.ts` — `useStackEvents(stackId)`, mirrors `use-stack.ts`
- `client/src/routes/app/stacks/components/event-log-card.tsx` — `EventLogCard`, `describeStackEvent()`
- `client/src/routes/app/stacks/components/status-log-card.tsx` — `StatusLogCard`, extracted from the page
- `client/src/routes/app/stacks/[id].tsx` — renders `StatusLogCard` and `EventLogCard` as peers in the Overview tab
- `client/test/unit/hooks/use-stack-events.test.ts` — 11 tests covering every case in Task 1's behavior list
- `client/test/unit/routes/stacks/event-log-card.test.tsx` — 15 tests covering every case in Task 2's behavior list, plus direct tests of `describeStackEvent`

## Decisions Made
- Badge variants deliberately spread across all three Badge variants (`default`/`secondary`/`destructive`) rather than grouping the two non-error types under one shared variant, so every type is visually distinct from every other, not just the error type standing out.
- `EventLogCard`'s error UI is gated on `events === null` rather than on the `error` flag alone, because a background refresh never clears `error` (by the `useStack`-established rule that background failures don't touch it) — gating on `events` presence means a successful retry correctly flips the card out of the error view once entries exist, without the hook needing a second "clear and retry the initial load" entry point.
- `CardTitle role="heading" aria-level={2}` is a prop passthrough (`CardTitle` forwards `...props` to a `div`), not an edit to the shadcn-managed `components/ui/card.tsx` file — satisfies the plan's prohibition on editing that directory while making both cards' headings independently queryable in tests.

See `key-decisions` in frontmatter for the full list including the tracer feedback gate handling.

## Deviations from Plan

None — plan executed as written. One process note, matching plan 02-14's precedent: Task 1 is `type="tracer"`, and its `<verify>` block (`yarn workspace @docktor/client test:unit`, `yarn workspace @docktor/client build`, the `getStackEvents` grep) is fully automated with no visual/UI step. It was run inline immediately after the Task 1 GREEN commit and passed; no blocking `checkpoint:human-verify` was raised, since this is a sequential single-agent run with no orchestrator continuation path to resume from a checkpoint. D6 in the coverage table above captures the one genuinely human-judgment item (visual layout of the two adjacent cards) for a later UAT pass.

One pre-existing, unrelated flakiness was observed and left alone (out of scope per the deviation rules' scope boundary): `service-upgrade-dialog.test.tsx`'s "renders one option per candidate with the latest preselected" test intermittently times out at 5000ms under full-suite load, but passes reliably in isolation and on repeat full-suite runs. Confirmed via a stash-and-rerun that this timeout occurs identically with or without this plan's changes present — not caused by this plan.

## Issues Encountered

None beyond the pre-existing test flakiness noted above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-02-16 (FW-02, UPD-03) visible half is closed: `config_changed`, `config_error` and `update_available` entries are now readable in the UI, in their own clearly labelled Event Log section next to the Status Log.
- The `.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md` todo about a header/status-area badge remains intentionally out of this plan's scope (explicit prohibition) and stays open as a separate future item.
- No blockers for subsequent work. No new dependencies; `yarn.lock` untouched; `components/ui/` untouched.

---
*Phase: 02-observability*
*Completed: 2026-08-28*

## Self-Check: PASSED

All created/modified files exist on disk and all task commit hashes (`9cfe584`, `375f18f`, `df52b0c`, `5af187f`) are present in `git log --oneline --all`.
