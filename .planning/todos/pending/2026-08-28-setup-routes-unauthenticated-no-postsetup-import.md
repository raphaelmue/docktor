---
created: 2026-08-28T00:00:00Z
title: Setup routes are unauthenticated post-setup, and brownfield import/adopt is unreachable after the wizard closes
area: security
severity: blocker
files:
  - server/src/routes/setup.ts
  - client/src/routes/setup.tsx
  - client/src/routes/app/stacks/index.tsx
---

## Problem

User feedback: "there must be a way to also import or migrate existing
stacks after the initial setup." Investigating surfaced two compounding
issues, best fixed together:

1. **Security bug (the more serious one):** `server/src/routes/setup.ts`
   registers `/api/setup/scan`, `/api/setup/adopt`, and the migration
   preview/execute endpoints with **no `requireAuth` hook and no
   "setup already complete" guard**. Only `/api/setup/step1` (account
   creation) checks `userCount > 0` before proceeding. The comment above
   `/api/setup/step2` literally says "requires auth after step 1," but no
   such check exists anywhere in the file, and `app.ts:105`
   (`await app.register(setupRoutes)`) registers the whole plugin with no
   wrapping auth hook either. Right now, **any unauthenticated caller, at
   any time** (not just during initial setup) can call `/api/setup/scan`
   to enumerate/read arbitrary directories the server process can access,
   and `/api/setup/adopt` to read an arbitrary compose file and register
   it as a new stack in the database.

2. **Feature gap:** even setting aside the auth issue, there is no UI
   entry point to reach brownfield scan/adopt after the wizard closes —
   `client/src/routes/setup.tsx` is the only place that renders the
   `BrownfieldStep` component; `stacks/index.tsx` and the dashboard have
   no equivalent "Import Existing Stack" action.

## Solution

TBD — the natural fix addresses both at once:
- Add `requireAuth` (and drop the setup routes' implicit reliance on
  "nobody's logged in yet during setup") to every setup route except
  `/api/setup/status` and `/api/setup/step1` (which must stay reachable
  pre-auth to create the first account) — or, cleaner, move scan/adopt/
  migration to authenticated routes under `/api/stacks/...` and leave
  `setup.ts` solely for the pre-auth first-run flow.
- Add a post-setup UI entry point (e.g. an "Import Existing Stack" action
  on `stacks/index.tsx` or the dashboard) that reuses the existing
  `BrownfieldStep` component/flow against the now-authenticated route.
