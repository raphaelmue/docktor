---
created: 2026-08-28T00:00:00Z
title: Docker-outside-of-Docker path mismatch resolves relative bind mounts to the wrong host location
area: deployment
severity: blocker
files:
  - docker-compose.yml
  - Dockerfile
  - server/src/lib/stacks-dir.ts
  - server/src/infrastructure/docker-executor.ts
---

## Problem

User report: added `- ./volumes/data:/var/opt/memos` to a stack's compose
file, redeployed (confirmed via the Recent Deployments card showing
success — not just the toast, which is separately known to always say
"success"), yet `/stacks/memos/volumes/data` does not exist.

Root cause: Docktor runs Docker-outside-of-Docker. `docker-compose.yml`
mounts `/var/run/docker.sock` (Docktor talks to the **host's** Docker
daemon, not a nested one) and maps the host path `./dev-data/docktor/stacks`
to `/stacks` **inside the Docktor container** (`server/src/lib/stacks-dir.ts`'s
`getStacksDir()` defaults to `/stacks`, matching the container-side mount
point, per the `DOCKTOR_STACKS_DIR` Dockerfile `ENV`).

When `DockerExecutor.up()` runs `docker compose up -d --remove-orphans`
with `cwd: getStackPath(stackId)` (i.e. `/stacks/memos`), the `docker
compose` CLI — running **inside** the Docktor container — resolves the
relative `./volumes/data` against its own filesystem view, producing the
absolute path `/stacks/memos/volumes/data`. That absolute path string is
then sent to the **host's** daemon over the socket. The host has no
`/stacks` directory corresponding to Docktor's container-side mount point,
so the daemon creates the bind-mount source directory at the literal host
path `/stacks/memos/volumes/data` (a stray top-level directory on the
host) instead of inside `./dev-data/docktor/stacks/memos/volumes/data`
(or wherever the real host stacks directory actually is in a given
deployment) — silently, with no error, since the container itself starts
fine.

**This affects every relative bind-mount volume for every managed stack**,
not just this one instance. It very likely also affects backups: restic
runs inside the same Docktor container and would back up
`/stacks/memos/volumes` as Docktor sees it (i.e. the *correct* host path
via Docktor's own mount) — which is a different physical location than
where the *actual* container's bind-mounted data landed on the host (the
stray `/stacks/...` path created via the daemon). Backups could be
silently near-empty.

## Solution

TBD. The standard fix for DooD tools is to mount the host stacks
directory at the **same absolute path** on both sides — host and
container — instead of remapping to `/stacks`, so relative-path
resolution inside the container produces a path the host daemon can
actually use. E.g. `docker-compose.yml` should use something like
`/opt/docktor/stacks:/opt/docktor/stacks` (both sides identical) with
`DOCKTOR_STACKS_DIR=/opt/docktor/stacks`, rather than
`./dev-data/docktor/stacks:/stacks`.

This is closely related to
[[2026-08-27-document-deployment-config-clean-env-and-docker-compose]] —
that todo's "clean documented docker-compose.yml" deliverable is the
natural place this fix (and a loud warning in the docs about why the host
and container paths must match) belongs, but this is a functional bug in
the *shipped default* `docker-compose.yml`/Dockerfile, not just a
documentation gap: the default configuration is broken for anyone who
follows it as-is with relative bind mounts. Also worth considering: a
startup sanity check that verifies `DOCKTOR_STACKS_DIR`'s realpath
actually matches what the host daemon would resolve, to fail loudly
instead of silently misplacing data.
