---
phase: 02-observability
plan: 14
subsystem: ui
tags: [react, sse, use-stack, stack-detail-page, gap-closure]

# Dependency graph
requires:
  - phase: 02-observability
    provides: useContainerEvents SSE hook and the config_changed/update_available event types it forwards to useStack
provides:
  - "useStack() distinguishes an initial load (loading) from a background refresh (isRefreshing), so an SSE-triggered fetch never re-enters the loading state"
  - "StackDetailPage gates its full-page placeholder on having no stack yet, so a background refresh no longer unmounts/remounts the mounted tree"
  - "A muted RefreshCw indicator in PageActions surfaces an in-flight background refresh instead of hiding it"
affects: [stack-detail-page, uat-gap-closure]

actuals:
  tokens: 3684
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Explicit fetch-mode parameter (initial | background) inside a hand-rolled hook, rather than a second ad-hoc boolean, so the mount effect and every SSE handler share one function with mode-dependent effects on loading/error vs isRefreshing"
    - "Background failures degrade silently to stale-but-rendered (console.warn only); only the initial load may set the hook's error state, because the page's error branch replaces the whole mounted tree exactly like the loading branch did"
    - "Node-identity assertion (DOM element reference equality across an SSE event) as a regression pin for 'did React remount the subtree', with a deliberate control case proving the assertion is not vacuously true"

key-files:
  created: []
  modified:
    - client/src/hooks/use-stack.ts
    - client/src/routes/app/stacks/[id].tsx
    - client/test/unit/hooks/use-stack.test.ts

key-decisions:
  - "fetchStack(mode) replaces the single fetch() — 'initial' sets loading/clears error/sets error on failure exactly as before; 'background' sets isRefreshing only and never touches loading or error, logging a console.warn on failure instead"
  - "refetch() (exposed to StackActions.onAction and ServicesTab.onUpgraded, both invoked with zero arguments) now always performs a background refresh — those callers already hold rendered data, so a background refresh is correct for every existing call site without changing the callback signature"
  - "StackDetailPage's placeholder early-return changed from `if (loading)` to `if (loading && !stack)`, so it is reachable only before the first successful load; the error branch (`error || !stack`) is unchanged since a background failure never sets error"
  - "The refresh indicator is always rendered in PageActions with opacity toggled by isRefreshing (not conditionally mounted), so its appearance/disappearance causes no layout shift in the flex row"

patterns-established:
  - "Loading vs. refreshing separation for hand-rolled data hooks: a hook that services both a mount effect and SSE-triggered background refetches must expose two independent flags, and the consuming page must gate any full-tree-swap early return on the data-presence flag, not the loading flag alone"

requirements-completed: [FW-02]

coverage:
  - id: D1
    description: "Editing a compose file on disk while the stack detail page is open updates the page in place — no more page-refresh flash"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-stack.test.ts#useStack — mounted tree survives a config_changed event > keeps the same DOM node identity across an SSE-driven refresh"
        status: pass
      - kind: unit
        ref: "client/test/unit/hooks/use-stack.test.ts#useStack > a config_changed event sets isRefreshing while in flight and never touches loading"
        status: pass
    human_judgment: false
  - id: D2
    description: "The full-page loading placeholder appears only when there is no stack data yet, never during a background refresh"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "grep verification: `if (loading && !stack)` gate in client/src/routes/app/stacks/[id].tsx (see Task 1 acceptance criteria)"
        status: pass
      - kind: other
        ref: "yarn workspace @docktor/client build"
        status: pass
    human_judgment: false
  - id: D3
    description: "A background refresh that fails leaves the page rendered with the data it already had, instead of replacing it with the error screen"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-stack.test.ts#useStack > a background refresh failure leaves the previous stack and error untouched"
        status: pass
    human_judgment: false
  - id: D4
    description: "An update_available event refreshes the same way, since it goes through the same refetch path"
    requirement: "FW-02"
    verification:
      - kind: unit
        ref: "client/test/unit/hooks/use-stack.test.ts#useStack > an update_available event behaves like config_changed, without touching loading"
        status: pass
    human_judgment: false
  - id: D5
    description: "A refresh in flight is visible to the user (muted indicator in PageActions), rather than silently hidden"
    requirement: "FW-02"
    verification: []
    human_judgment: true
    rationale: "The indicator's visual appearance (no layout shift, legible at small size, correct placement next to the status badge) is a rendering/CSS concern not provable by a jsdom unit test; needs a human glance at the running page."

duration: 15min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 14: Stop the Stack Detail Page From Remounting on SSE Events Summary

**`useStack` now separates an initial load from a background refresh (`isRefreshing` vs `loading`), and `StackDetailPage` gates its placeholder on having no data yet, so a `config_changed`/`update_available` SSE event updates the page in place instead of unmounting and remounting the whole tree (G-02-12, FW-02).**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-28T22:00:00Z
- **Completed:** 2026-08-28T22:15:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `useStack()` rewritten around a single `fetchStack(mode)` function with explicit `"initial" | "background"` modes: initial mode behaves exactly as before (sets `loading`, clears/sets `error`); background mode sets a new `isRefreshing` flag and never touches `loading` or `error`, logging a `console.warn` on failure instead of surfacing it
- Both SSE handlers (`config_changed`, keeping its existing toast, and `update_available`) and `refetch()` now go through background mode — `StackActions.onAction` and `ServicesTab.onUpgraded` (both zero-argument callers) get the fix for free with no signature change
- `StackDetailPage`'s loading early-return changed from `if (loading)` to `if (loading && !stack)`, so the placeholder is reachable only before the first successful load; the mounted tree (tabs, scroll areas, cards) now survives every SSE event
- A muted `RefreshCw` indicator was added to `PageActions`, always rendered but opacity-toggled by `isRefreshing`, so an in-flight background refresh is visible without any layout shift
- Regression coverage added at two levels: flag-based assertions for every case in the plan's behavior list, and a node-identity test (`client/test/unit/hooks/use-stack.test.ts`) that renders a local probe component and asserts the same DOM node survives a `config_changed` event — with a control case proving the assertion is not vacuously true across a genuine unmount/remount

## Task Commits

Each task's tests and implementation were committed atomically per TDD gate:

1. **Task 1 (TDD RED): failing coverage for background-refresh state, including the Task 2 node-identity tests** - `0b4eb87` (test)
2. **Task 1 (TDD GREEN) + Task 2: `useStack`/page implementation, all tests passing** - `b72dd57` (feat)

**Plan metadata:** committed together with this SUMMARY (see final commit below)

## Files Created/Modified
- `client/src/hooks/use-stack.ts` — `fetchStack(mode)` replaces `fetch()`; returns `{stack, loading, isRefreshing, error, refetch}`
- `client/src/routes/app/stacks/[id].tsx` — placeholder gated on `loading && !stack`; `RefreshCw` indicator added to `PageActions`
- `client/test/unit/hooks/use-stack.test.ts` — 4 existing tests extended with `isRefreshing` assertions; 6 new tests covering config_changed/update_available/different-stack-id/background-failure/refetch(), plus 2 node-identity tests (probe + remount control)

## Decisions Made
- `fetchStack(mode)` kept as one function with an explicit mode parameter rather than two separate functions, so the mount effect and every SSE handler share identical fetch/catch/finally structure and cannot drift apart on future edits — see `key-decisions` in frontmatter for the full rationale.
- The refresh indicator reserves its layout space at all times (opacity toggle, not conditional mount) specifically to satisfy the plan's "no layout shift" constraint.

## Deviations from Plan

None — plan executed as written, with one process note: Task 1's TDD RED commit also included the Task 2 node-identity tests (both live in the same test file and were authored together), rather than a strictly separate commit per task. Task 2 required no additional source changes — `git diff --stat client/src/` shows no changes from the GREEN commit onward for that task, satisfying its acceptance criterion. All acceptance criteria for both tasks pass; this is a commit-grouping deviation only, not a functional one.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-02-12 (FW-02) is closed: the stack detail page no longer visually "refreshes" on `config_changed`/`update_available` SSE events.
- The tracer feedback gate's `<verify>` block for this plan (`yarn workspace @docktor/client test:unit`, `yarn workspace @docktor/client build`, the `isRefreshing` grep) is fully automated with no visual/UI step; all three were run and confirmed passing during execution. No blocking human-verify checkpoint was raised — this sequential single-agent run has no orchestrator continuation path, and the plan declares no `checkpoint:*` tasks itself.
- No blockers for subsequent work. No new dependencies; `yarn.lock` untouched; `components/ui/` untouched.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
