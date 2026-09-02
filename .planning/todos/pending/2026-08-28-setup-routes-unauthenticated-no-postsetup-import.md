---
created: 2026-08-28T00:00:00Z
title: Brownfield import/adopt is unreachable after the wizard closes (no post-setup UI entry point)
area: onboarding
severity: major
files:
  - server/src/routes/setup.ts
  - client/src/routes/setup.tsx
  - client/src/routes/app/stacks/index.tsx
---

## Problem

User feedback: "there must be a way to also import or migrate existing
stacks after the initial setup." Investigating originally surfaced two
compounding issues:

1. ~~**Security bug:** `server/src/routes/setup.ts` registered
   `/api/setup/scan`, `/api/setup/adopt`, and the migration
   preview/execute endpoints with no auth/completion guard, so any
   unauthenticated caller could reach them forever.~~ **Fixed by Phase
   05's T-05-09** (see `server/src/routes/setup.ts` top-level
   `preHandler`, CR-01/T-05-09 comment): every `/api/setup/*` route
   except `/api/setup/status` and `/api/setup/step1` now 410s once
   `onboardingService.isWizardComplete()` is true. Confirmed still wired
   as of 2026-09-01 — the acute "reachable forever" exposure is closed.
   Downgraded from `blocker` to `major` and re-scoped to the remaining
   feature gap only.

2. **Feature gap (still open):** there is no UI entry point to reach
   brownfield scan/adopt after the wizard closes — `client/src/routes/setup.tsx`
   is the only place that renders the `BrownfieldStep` component;
   `stacks/index.tsx` and the dashboard have no equivalent "Import
   Existing Stack" action. Confirmed still missing as of 2026-09-01
   (`grep -rn "Import Existing\|BrownfieldStep" client/src/routes/app`
   returns no matches).

## Solution

Add a post-setup UI entry point (e.g. an "Import Existing Stack" action on
`stacks/index.tsx` or the dashboard) that reuses the existing
`BrownfieldStep` component/flow, calling `/api/setup/scan` and
`/api/setup/adopt` while the wizard is still incomplete is a non-issue now
that those routes 410 post-completion — so this needs its own
authenticated route (or to move scan/adopt under `/api/stacks/...`)
rather than relying on the pre-completion setup routes at all.
