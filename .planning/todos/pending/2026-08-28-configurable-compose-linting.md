---
created: 2026-08-28T12:01:53.982Z
title: Add configurable docker-compose linting/formatting checks
area: validation
severity: minor
files:
  - server/src/infrastructure/compose-analyzer.ts
---

## Problem

User feedback: wants Docktor to enforce docker-compose conventions,
configurably, e.g.:
- Only directory-based (bind mount) volumes allowed, if the check is
  enabled — the project already has a "bind mounts only, no named Docker
  volumes" convention (per CLAUDE.md: "all data in ./volumes/ subdir"),
  but nothing currently enforces or flags a compose file that violates it.
- Env vars should always live in the `.env` file, not inlined in
  `docker-compose.yml`.
- A "formatting function" — likely auto-format/normalize a compose file's
  structure.

This is unrelated to the UI-redesign items split out alongside it (see
[[2026-08-28-redesign-ui-ux-service-colors-mobile]]) — this one is
backend validation logic, not a frontend change.

## Solution

TBD. `compose-analyzer.ts` already parses compose files for the
brownfield-adopt compatibility flow (`extractBindMounts`, etc.) and could
be the natural home for these checks, but "configurable" implies a
settings surface (per-check enable/disable) and UI to show violations —
needs a design pass on where these checks run (adopt-time only? every
FileWatcher sync? both?) and how they're surfaced to the user.
