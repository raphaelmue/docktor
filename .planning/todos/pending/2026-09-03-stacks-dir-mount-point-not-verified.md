---
created: 2026-09-03T00:00:00Z
title: ensureStacksDir() cannot distinguish a real bind mount from a plain container-layer directory
area: deployment
severity: major
files:
  - server/src/lib/stacks-dir.ts
  - server/src/index.ts
---

## Problem

`ensureStacksDir()` (added to close gap G-05.1-3) calls
`fs.mkdir(getStacksDir(), {recursive: true})` at server boot to guarantee
the managed stacks directory exists. That satisfies G-05.1-3's literal
truth criterion — the directory is provably present after boot — but
`mkdir` cannot tell the difference between two very different situations:

1. The bind mount declared in `docker-compose.yml` actually attached, so
   the target path already existed as a mount point, and `mkdir` was a
   safe no-op.
2. The bind mount never attached at all (the exact condition G-05.1-3's
   diagnosis investigated, e.g. Docker Desktop's WSL2-integration
   divergence from native Linux dockerd for a bare Linux absolute path
   with no host-mappable location), so `mkdir` creates a perfectly
   ordinary directory inside the **container's own writable layer**.

The second case is silent and looks identical to success: the server
boots, the directory exists, stacks can be created, everything appears to
work — until the container is recreated (image update, `docker compose up`
after a config change, host reboot with `restart: unless-stopped` losing
its layer, etc.), at which point every stack's compose files, `.env`
files, and any data written directly under the stacks directory vanish
with no warning, because none of it was ever actually persisted to the
host.

This is a distinct, more severe failure mode than "missing on first boot"
— it is silent data loss on container recreation — and closing G-05.1-3
does not close it. See
`.planning/debug/stacks-dir-not-created-on-boot.md` (Evidence entry
"Whether a defensive `fs.mkdir` ... is sufficient given the DooD
architecture") for the full analysis this was deferred from, and
`.planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-11-PLAN.md`
for the plan that intentionally scoped it out.

## Solution

TBD. Suggested direction from the diagnosis: after `ensureStacksDir()`
creates or confirms the directory, verify the resolved path is genuinely
a mount point rather than part of the container's own writable layer —
for example by reading `/proc/mounts` (or `/proc/self/mountinfo`) and
checking whether `getStacksDir()`'s resolved path (or an ancestor of it)
appears as a mount source, or by writing a persistence marker file on
first successful boot and failing loudly if a later boot finds the
directory present but the marker missing (which would indicate the
directory was recreated from scratch on the container's ephemeral layer
rather than surviving via the host-backed mount). Whichever mechanism is
chosen should fail or warn loudly at boot — consistent with
`ensureStacksDir()`'s own fail-fast policy — rather than allowing the
server to start silently in a state where managed-stack data will not
survive container recreation.
