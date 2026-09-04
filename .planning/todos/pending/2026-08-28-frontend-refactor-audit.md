---
created: 2026-08-28T12:01:53.982Z
title: Audit frontend for reusable-component refactors
area: ui
severity: minor
files:
  - client/src/components/domain/stack/log-viewer.tsx
  - client/src/routes/app/stacks/[id].tsx
---

## Problem

User feedback: "I also think that the frontend is not as cleanly
implemented since e.g. the log component could be reused in the backup
tab etc." Split out from a larger UI redesign request — see also
[[2026-08-28-redesign-ui-ux-service-colors-mobile]]. The specific example
given: `log-viewer.tsx` (currently used for container logs) has streaming/
filtering/rendering logic that overlaps with what the Backups tab needs
for showing restic output, but isn't currently shared.

## Solution

TBD — needs a broader pass over `client/src/routes/app/stacks/components/`
and `client/src/components/domain/` to find other candidates for
extraction to `components/common/`/`components/domain/`, not just the log
viewer. Check against CLAUDE.md's "Known Refactoring Targets" table for
already-known duplication before scoping new work.
