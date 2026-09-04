---
created: 2026-08-28T00:00:00Z
title: Restic is installed via apt, pinning it to a 3+ year old version (0.14.0)
area: deployment
severity: minor
files:
  - Dockerfile
---

## Problem

User observation: the Docktor image ships restic 0.14.0. Confirmed —
`Dockerfile` installs restic via `apt-get install restic` on `node:22-slim`
(Debian 12 "bookworm"), and bookworm's apt repo only carries
`restic 0.14.0-1+b5` (released October 2022). Current restic is well past
that (0.18.x+ as of writing), missing 3+ years of bug fixes, performance
work, and repository-format improvements.

Docker CLI and the compose plugin are already handled correctly in this
same Dockerfile — both are pinned to an explicit, current version via a
direct binary download (`curl` + `docker-compose` release asset) rather
than relying on the OS package manager. Restic doesn't get the same
treatment.

## Solution

TBD — pin restic to a specific current release the same way docker-compose
already is, e.g. download the official Linux binary from
`https://github.com/restic/restic/releases/download/vX.Y.Z/restic_X.Y.Z_linux_amd64.bz2`,
decompress, `chmod +x`, and place it on `PATH`, instead of `apt-get install
restic`. Pick a version and keep it pinned explicitly (not "latest") for
build reproducibility, matching the project convention already used for
docker-compose's pinned `v2.33.1`.
