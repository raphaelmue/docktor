---
completed: 2026-09-02
---
created: 2026-08-30T00:00:00Z
title: ".env.example's DOCKTOR_STACKS_DIR silently breaks the docker-compose deployment"
area: deployment
severity: major
files:
  - .env.example
  - .env.local
  - docker-compose.yml
  - Dockerfile
---

## Problem

Found while unblocking Phase 02 UAT on a second machine (see
`.planning/phases/02-observability/02-UAT.md`, "Out-of-Phase Blocker" section): a stack created
through the app never appeared under `dev-data/docktor/stacks/` on the host, even though the app
itself reported the stack as created successfully.

`.env.example` (line 11, the template `.env.local` is normally copied from) sets:

```
DOCKTOR_STACKS_DIR=./dev-data/stacks
```

That's the correct value only for running the server directly on the host (`yarn dev`). The
Dockerfile already bakes in the correct container-side default for the docker-compose deployment
(`ENV DOCKTOR_STACKS_DIR=/stacks`), matching the bind mount in `docker-compose.yml`
(`./dev-data/docktor/stacks:/stacks`).

But `docker-compose.yml` loads `env_file: - .env.local`, and Docker Compose `env_file` entries
override the image's baked-in `ENV` default. So any `.env.local` copied from `.env.example`
without editing this line silently redirects `DOCKTOR_STACKS_DIR` to a relative path
(`./dev-data/stacks`, resolved inside the container, e.g. relative to `/app`) that has **no bind
mount at all**. The app writes stack files there without error — they're just never persisted and
never visible on the host. Worse: since that path isn't on any volume, the data is lost entirely
if the container is ever recreated (not just restarted).

I could not fix this directly — `.env*` files are excluded from this session's file access, so I
couldn't read or edit `.env.example`/`.env.local` even though the change is a one-line fix.

## Suggested fix

Pick one:
- Remove the `DOCKTOR_STACKS_DIR` line from `.env.example` entirely, so docker-compose deployments
  fall through to the Dockerfile's correct `/stacks` default. (Dev mode would then need
  `DOCKTOR_STACKS_DIR` set some other way — e.g. in `.env.development`, which already has the
  correct dev-mode value.)
- Or split `.env.example` into two templates (host-dev vs. docker-compose) so this class of
  variable can't silently mismatch between the two deployment modes again.

## Resolution (Phase 05.1 Plan 08)

Resolved by rewriting `.env.example` (and `.env.production`, given the same treatment) so
`DOCKTOR_STACKS_DIR` is a live, docker-compose-correct line (`/opt/docktor/stacks`, matching
plan 05.1-03's canonical path), with the `yarn dev` host-run alternative
(`./dev-data/stacks`) present only as a commented-out line directly beneath it — so copying
`.env.example` to `.env.local` without editing anything can no longer silently redirect stack
data to an unmounted path. The template also now sets the companion
`DOCKTOR_STACKS_HOST_DIR` (introduced by plan 05.1-03) to the same canonical path, which both
drives `docker-compose.yml`'s stacks volume and enables `assertStacksDirMatchesHost()`'s
startup mismatch check. See `.env.example`, `.env.production`, and `docs/deployment.md`'s
dedicated stacks-directory section.
