---
created: 2026-08-28T12:01:53.982Z
title: Redesign UI/UX — service colors, tab layout, mobile support
area: ui
severity: minor
files:
  - client/src/routes/app/stacks/[id].tsx
  - client/src/components/domain/stack/log-viewer.tsx
---

## Problem

User feedback: the current UI is "very basic and not very ux friendly."
Specific asks bundled here (split out from a larger request — see also
[[2026-08-28-add-yaml-env-editor]], [[2026-08-28-redesign-dashboard-statistics]],
[[2026-08-28-frontend-refactor-audit]], [[2026-08-28-configurable-compose-linting]]):

- Assign each service in a stack a consistent color, and carry that color
  through into the log viewer (`log-viewer.tsx`) so log lines are visually
  attributable to their service at a glance.
- Redesign the stack detail page's tab layout (`[id].tsx` — currently
  Overview/Compose/Environment/Logs/Backups via shadcn `Tabs`).
- Support mobile devices — current layout has not been designed/tested for
  small viewports.

## Solution

TBD. Needs a design pass (colors: derive from a fixed palette keyed by
service name, or let users pick per-service; tabs: consider whether all 5
tabs still make sense post-redesign; mobile: audit current layout's
responsiveness component by component).
