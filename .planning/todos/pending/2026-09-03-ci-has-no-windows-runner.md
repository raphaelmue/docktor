---
created: 2026-09-03T00:00:00Z
title: CI has no Windows runner — platform-divergent defects reach contributors uncaught
area: testing
severity: major
files:
  - .github/workflows/ci.yml
  - server/src/lib/prisma-cli.ts
  - server/src/lib/schema-sync.ts
  - server/test/integration/setup.ts
---

## Problem

`.github/workflows/ci.yml` runs the full test suite (including
`test:integration`) only on `runs-on: ubuntu-latest`. There is no Windows
(or macOS) job in the matrix.

This gap let a genuine cross-platform code defect ship and stay hidden for
as long as it took a Windows contributor to hit it manually. Two call
sites — `server/test/integration/setup.ts`'s `startContainer()` schema
push, and `server/src/lib/schema-sync.ts`'s boot-time schema-sync step —
both hardcoded an extensionless path into the package manager's generated
`node_modules/.bin/` shim directory to launch the Prisma CLI. That
convention resolves to a POSIX symlink on Linux/macOS (which Node's
`execFileSync`/`execFileAsync` can exec directly with no shell), but to
`.cmd`/`.ps1` shim files on native Windows — so the identical code path
threw `spawnSync ... ENOENT` on Windows while passing unconditionally on
CI. Worse, the boot-time call site's failure mode was *silent*:
`syncDatabaseSchema()` catches everything and logs a `failed` outcome
while still starting the server, so a Windows `yarn dev` run would apply
no schema with no obvious cause.

Both call sites were fixed in phase 05.1 plan 09 (gap G-05.1-1) by
resolving the Prisma CLI's JS entrypoint via Node module resolution
(`server/src/lib/prisma-cli.ts`) and launching it through
`process.execPath` instead of the `.bin` shim path — but the underlying
coverage gap that let this ship remains: any future platform-divergent
defect on a Windows (or macOS) contributor path has zero chance of being
caught by CI before a human hits it.

## Solution

Add a Windows job (and consider macOS) to `.github/workflows/ci.yml`'s
test matrix, at minimum covering `server` unit + integration tests.
Windows runners will need Docker Desktop or an equivalent testcontainers-
compatible daemon available for the integration suite (currently gated on
testcontainers/postgresql); scope that out to a unit-tests-only Windows
job first if a Windows Docker runner proves impractical in GitHub Actions.

Out of scope for the plan that filed this todo (05.1-09) — deliberately
deferred as a separate CI-infrastructure change per that plan's stated
scope boundary.
