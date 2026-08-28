---
status: diagnosed
trigger: "config-changed-sse-looks-like-refresh: On the stack detail page, when a compose file change is detected and a config_changed SSE event fires, the UI update looks like a full page refresh rather than a smooth in-place update of just the changed data."
created: 2026-08-28T16:10:00Z
updated: 2026-08-28T16:10:00Z
---

## Current Focus

hypothesis: CONFIRMED - useStack's fetch() toggles the same `loading` boolean for both the initial page load and every SSE-triggered background refetch, and StackDetailPage unconditionally swaps in a full-page "Loading..." skeleton whenever `loading` is true — causing a full unmount/remount of the entire page tree on every config_changed/update_available event.
test: traced useStack.fetch() and StackDetailPage loading branch
expecting: root cause identified
next_action: return ROOT CAUSE FOUND (goal is find_root_cause_only)

## Symptoms

expected: With the stack detail page open, modify the compose file on disk. Within seconds, a config_changed SSE event triggers a refetch and the UI shows the yellow "config changed" state without a manual page refresh — i.e. only the affected data patches in, not a full remount/reload feel.
actual: "pass, however it looks like the page was refreshed. Can this be prevented?"
errors: None reported
reproduction: Test 12 in .planning/phases/02-observability/02-UAT.md — with the stack detail page open, edit the compose file on disk and observe the SSE-triggered update
started: Discovered during UAT re-verification of phase 02-observability (2026-08-28)

## Eliminated

- hypothesis: The SSE handler broadly invalidates a react-query cache key, causing a query-library-driven full remount.
  evidence: Docktor's stack detail data is NOT managed by react-query/TanStack Query here — `useStack` (client/src/hooks/use-stack.ts) is a hand-rolled hook using plain useState/useCallback/useEffect. There is no query cache invalidation involved; the mechanism is a manually-toggled `loading` boolean.
  timestamp: 2026-08-28T16:15:00Z

## Evidence

- timestamp: 2026-08-28T16:12:00Z
  checked: client/src/hooks/use-container-events.ts
  found: Thin wrapper around a single shared `EventSource` at `/api/events`; parses each SSE message and calls the caller-supplied `onEvent` callback. Properly closes the EventSource in the effect cleanup. Not implicated in the bug — this layer is fine.
  implication: The problem is downstream, in how consumers of useContainerEvents react to events.

- timestamp: 2026-08-28T16:13:00Z
  checked: client/src/hooks/use-stack.ts (lines 6-63)
  found: >
    `fetch()` (lines 11-22) is the single function used for BOTH the initial page load (called once via useEffect on mount, line 24-26) AND every subsequent refetch. It unconditionally calls `setLoading(true)` before the async `getStack(id)` call and `setLoading(false)` in the finally block — with no distinction between "first load" and "background refresh".
    The `useContainerEvents` handler (lines 28-60) calls this same `fetch()` for both `config_changed` (line 56) and `update_available` (line 58) events. By contrast, `container_state` and `stack_status` events (lines 31-53) merge the new data into the existing `stack` state in place via `setStack(prev => ...)` WITHOUT touching `loading` at all — those two event types behave correctly (matches UAT Test 13 passing for update-badge... actually update_available also calls fetch(), see below).
    Re-checking: `update_available` (line 57-58) also calls `fetch()`, which would trigger the same full-loading flash — but UAT Test 13 for update_available passed without the "looks like a refresh" complaint being raised, likely because the user didn't consciously watch for the flash on that event, not because it doesn't happen. The mechanism is the same for both config_changed and update_available.
  implication: Every `config_changed` (and `update_available`) SSE event drives `loading` from false -> true -> false, exactly mirroring the initial page-load loading cycle.

- timestamp: 2026-08-28T16:14:00Z
  checked: client/src/routes/app/stacks/[id].tsx (lines 33-117)
  found: >
    `const {stack, loading, error, refetch} = useStack(id)` (line 36). Immediately after, `if (loading) { return <Page>...minimal "Loading..." breadcrumb/title/paragraph...</Page> }` (lines 59-86) is an early return that renders a COMPLETELY DIFFERENT, much smaller JSX tree than the fully-populated page (breadcrumbs, StackStatusBadge, StackActions, Tabs with Overview/Compose/Environment/Logs/Backups, ServicesTab, Recent Deployments card, Status Log card, ScrollAreas, etc. — lines 157-396).
    Because React reconciles by comparing tree shape, and these two branches produce structurally unrelated trees, every time `loading` flips to `true` mid-session (i.e., every SSE-triggered `fetch()` call from config_changed/update_available), React unmounts the entire real page tree and mounts the tiny "Loading..." placeholder, then unmounts that and remounts the full tree again once the fetch resolves ~milliseconds later.
    This full unmount+remount cycle is what visually reads as "the page was refreshed" — Tabs reset their internal open state momentarily, ScrollAreas reset scroll position, ARIA/DOM nodes are destroyed and recreated, and there's a visible flash of the loading placeholder — even though no actual browser navigation or reload occurred.
  implication: >
    Root cause confirmed: StackDetailPage has no distinction between "initial load" (no data yet, full skeleton appropriate) and "background refresh triggered by SSE" (data already present, should update in place). The single boolean `loading` from useStack conflates both cases, and the page's early-return-on-loading pattern amplifies that into a full remount every time.

## Resolution

root_cause: >
  `useStack` (client/src/hooks/use-stack.ts) uses one `loading` boolean for both the initial fetch and every subsequent SSE-triggered refetch (config_changed and update_available both call the same `fetch()`, which does `setLoading(true)` ... `setLoading(false)`). `StackDetailPage` (client/src/routes/app/stacks/[id].tsx, lines 59-86) unconditionally early-returns a structurally different, minimal "Loading..." tree whenever `loading` is true instead of only doing so before the first successful load. Because the loading-branch JSX tree is unrelated to the fully-rendered page tree, React unmounts the entire page (Tabs, ScrollAreas, breadcrumbs, all cards) and remounts it moments later on every config_changed/update_available SSE event, which is visually indistinguishable from a full page refresh even though no navigation/reload occurred.

fix: (not applied — goal is find_root_cause_only; diagnosis handed back to caller)
verification: (not applicable — diagnose-only mode)
files_changed: []

