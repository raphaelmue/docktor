---
created: 2026-08-28T00:00:00Z
title: "\"Update available\" is only shown per-service, never aggregated to the stack level"
area: ui
severity: minor
files:
  - client/src/routes/app/stacks/components/services-tab.tsx
  - client/src/routes/app/stacks/[id].tsx
  - client/src/components/domain/stack/stack-list.tsx
  - client/src/routes/app/dashboard.tsx
---

## Problem

User feedback: the blue "update available" badge only appears per-service
in the Services table (`services-tab.tsx`) — confirmed no equivalent
indicator exists anywhere at the stack level (stack detail header,
`stack-list.tsx`, or `dashboard.tsx`). The existing yellow "config
changed" badge already has this pattern (shown on both the stack detail
page and the stack list) — "update available" should get the same
treatment so a user can spot it from the dashboard/list without opening
each stack.

## Solution

TBD — aggregate `services.some(svc => svc.updateAvailable)` (or a count)
at the stack level and render a badge matching the existing
`configChanged` badge's placement/styling in `stack-list.tsx` and the
stack detail page header.
