---
created: 2026-08-28T12:01:53.982Z
title: Redesign dashboard with richer statistics
area: ui
severity: minor
files:
  - client/src/routes/app/dashboard.tsx
---

## Problem

User feedback: wants the dashboard redesigned "with statistics etc." —
called out explicitly as probably a separate task from the rest of the UI
redesign request (see [[2026-08-28-redesign-ui-ux-service-colors-mobile]]).
`dashboard.tsx` currently renders basic stat cards (Total, Running,
Stopped, Errors) inline — already flagged in CLAUDE.md's "Known
Refactoring Targets" table as needing extraction to a reusable
`StatCard`/`StackStatCards` component, which this redesign should do as
part of the rework rather than leaving the inline cards in place.

## Solution

TBD — needs a design pass on what statistics matter (resource usage over
time? deploy frequency? update lag?) before implementation.
