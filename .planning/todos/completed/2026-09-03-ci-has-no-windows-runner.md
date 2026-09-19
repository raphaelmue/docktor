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

completed: 2026-09-16
status: completed
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

## Resolution

Closed by phase 09 plan 02 (commit `4ce8f8f`). Added a new top-level
`cross-platform-unit` job to `.github/workflows/ci.yml`, a sibling of the
existing `build-and-test` job, with `strategy.fail-fast: false` and
`strategy.matrix.os: [windows-latest, macos-latest]` (D-08: both platforms,
neither cancels the other on failure). Scope is exactly typecheck plus all
three unit suites — client, shared (via `yarn test:unit`), and server (via
the explicit `yarn workspace @docktor/server test:unit` step). That last
step is not optional: root `test:unit` is
`yarn workspaces foreach -A --exclude @docktor/server run test:unit`, which
excludes the `@docktor/server` workspace by design, so without the explicit
step this job would build, typecheck, and run client/shared tests while
executing zero server-side tests — a required check structurally incapable
of failing on a server regression.

Integration and E2E tests are deliberately excluded from both platforms:
no server integration suite (testcontainers-based, requires a Docker
daemon), no Playwright browser install, no client E2E run — GitHub-hosted
Windows and macOS runners have no Docker Engine. This matches this todo's
own stated fallback ("scope out to a unit-tests-only Windows job first if
a Windows Docker runner proves impractical") rather than narrowing it
further; both platforms got the unit-only treatment, not just Windows.

The real workflow run
(https://github.com/raphaelmue/docktor/actions/runs/35063784652, triggered
by pushing this branch and opening draft PR #6) found this job doing
exactly the job it was added to do:

- `cross-platform-unit (macos-latest)`: SUCCESS. Server unit tests step ran
  8s (06:28:59Z–06:29:07Z) — a real suite executed, not the Pitfall-5
  zero-tests signature.
- `cross-platform-unit (windows-latest)`: FAILURE. Server unit tests step
  ran 10s (06:32:50Z–06:33:00Z) — also a real suite, not a config flake —
  and surfaced three genuine Windows-only defects that ubuntu-only CI had
  never been able to see: POSIX-only mount-point parsing in
  `server/test/unit/lib/stacks-dir.test.ts`, POSIX-only path-separator
  assumptions in
  `server/test/unit/infrastructure/brownfield-scanner.test.ts`, and an
  unrooted mock-call/timezone assertion failure in
  `server/test/unit/jobs/proxy-cert-poller.test.ts`. Filed as a new todo,
  `.planning/todos/pending/2026-09-16-windows-ci-check-fails-on-real-platform-bugs.md`,
  since fixing them is outside this plan's scope (adding the CI job) but
  they now block merges — see the branch-protection outcome below.

Branch-protection outcome (D-07, Task 2): **applied**. The `main` branch
previously had no protection rule at all (the GitHub API returned 404
"Branch not protected" before this change — there was nothing to add to,
so "leave existing required checks as-is" was vacuously true). A minimal
new rule was created via the GitHub API
(`required_status_checks.contexts`) requiring exactly
`cross-platform-unit (windows-latest)` and
`cross-platform-unit (macos-latest)` — matching the two expected rendered
check names exactly, confirmed via
`gh api repos/raphaelmue/docktor/branches/main/protection --jq '.required_status_checks.contexts'`.
`strict` is `false`, `enforce_admins` is `false`, and no PR-review
requirement was added — a minimal check-only rule, not a fuller protection
policy. The user explicitly chose to require both checks now despite
windows-latest currently failing for real reasons, accepting the D-07
trade-off as originally scoped.

**Live consequence, not yet resolved:** because `cross-platform-unit
(windows-latest)` is both required and currently red, no pull request —
including this plan's own PR #6 — can merge to `main` until the three
Windows bugs above are fixed or the check otherwise passes. The new todo
filed above exists to make that visible rather than silent.
