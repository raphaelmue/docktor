---
completed: 2026-09-01
---
created: 2026-08-28T00:00:00Z
title: No redirect to /setup wizard on first run
area: onboarding
severity: major
files:
  - client/src/routes/setup.tsx
  - client/src/lib/setup-api.ts
---

## Problem

Discovered during plan 02-08 Task 3 Docker verification. A fresh instance
does not get routed to `/setup` (the onboarding wizard at
`client/src/routes/setup.tsx`, gated by `checkSetupStatus()` in
`client/src/lib/setup-api.ts`). Not yet investigated further — user asked
to defer and continue the planned checkpoint verification instead.

See `.planning/phases/02-observability/deferred-items.md` for the original
write-up.

## Solution

TBD — needs a look at whatever route guard is (or isn't) calling
`checkSetupStatus()` on app load, and whether it's wired into the router
correctly.

## Resolution

Resolved by Phase 05-09 (`05-09-PLAN.md`): `FirstRunGate`
(`client/src/components/domain/auth/first-run-gate.tsx`) wraps `/`,
`/login`, and other unauthenticated entry points in `main.tsx`, using
`useSetupStatus()` to redirect to `/setup` whenever the instance has no
users yet. Confirmed still wired and covering both `/` and `/login` as of
2026-09-01 (during `/gsd-plan-phase 05.1` staleness check).
