---
created: 2026-09-16T00:00:00Z
title: Windows CI check fails on real platform bugs — blocks all merges to main
area: testing
severity: blocker
files:

  - server/src/lib/stacks-dir.ts
  - server/test/unit/lib/stacks-dir.test.ts
  - server/src/infrastructure/brownfield-scanner.ts
  - server/test/unit/infrastructure/brownfield-scanner.test.ts
  - server/src/jobs/proxy-cert-poller.ts
  - server/test/unit/jobs/proxy-cert-poller.test.ts

completed: 2026-09-18
status: completed
---

## Problem

Phase 09 plan 02 added a `cross-platform-unit` CI job (windows-latest +
macos-latest matrix) and made both platforms required status checks on the
`main` branch protection rule (D-07). The first real run
(https://github.com/raphaelmue/docktor/actions/runs/35063784652, draft PR
#6) found `cross-platform-unit (windows-latest)` genuinely red — not a CI
config flake, not the Pitfall-5 zero-tests signature (the server unit
tests step ran for a real 10 seconds, 06:32:50Z–06:33:00Z) — but three
real, previously-uncaught Windows platform bugs:

1. **`server/test/unit/lib/stacks-dir.test.ts`** (failing assertions at
   lines 212, 265, 284, 341, 363) — the mount-point detection logic
   assumes POSIX `/proc/mounts`-style parsing and cannot find a
   Windows-style drive path such as `D:\opt\docktor\stacks`.
2. **`server/test/unit/infrastructure/brownfield-scanner.test.ts`**
   (failing assertions at lines 95, 141, 153, 166, 182) — path
   normalization assumes POSIX separators (observed failure:
   `expected '\opt\myapp' to be '/opt/myapp'`), with a related
   duplicate-stack-detection miscount downstream of the same path-format
   assumption.
3. **`server/test/unit/jobs/proxy-cert-poller.test.ts`** (failing
   assertion at line 120) — a mock-call assertion failure
   (`expected "vi.fn()" to be called with... Number of calls: 0`), likely
   a timezone/date-comparison sensitivity. Not yet root-caused.

Because `cross-platform-unit (windows-latest)` is a required check
(D-07) and there was no exemption carved out for it, **no pull request —
including the PR that added this very check (#6) — can currently merge to
`main`** until these are fixed or the check otherwise passes.
`cross-platform-unit (macos-latest)` passed cleanly (8s, real suite, no
failures), so this is Windows-specific.

Fixing these was explicitly out of scope for phase 09 plan 02, whose job
was only to add the CI job and make it required — not to make the
existing suites pass on a platform they were never previously run on. See
`.planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md`'s
Resolution section for the full run details.

## Solution

For each of the three files:

1. **`stacks-dir.ts`** — make mount-point detection platform-aware (e.g.
   branch on `process.platform === 'win32'` and either skip
   `/proc/mounts`-based detection or use an equivalent Windows signal),
   or normalize both the target path and the parsed mount source to a
   common comparable form before matching.
2. **`brownfield-scanner.ts`** — normalize path separators (e.g. via
   `path.posix` conversion or a shared `toPosixPath()` helper) before
   comparing/asserting expected path strings, so scan results are
   platform-independent; re-check the duplicate-stack-detection logic
   once separator normalization is fixed, since the miscount may resolve
   as a side effect.
3. **`proxy-cert-poller.ts`** — root-cause the zero-calls assertion
   failure; likely candidates are a `Date`/timezone comparison that
   differs on the Windows runner's default locale/timezone, or a mock
   setup that behaves differently under Windows' event-loop timing.
   Investigate with the actual CI run logs before guessing further.

Re-run the `cross-platform-unit (windows-latest)` check (push to this
branch or open a new PR) after each fix to confirm; all three failures
should be fixed together before the check is expected to go green, since
partial fixes still leave `main` unmergeable.

## Resolution

All three genuinely root-caused (not papered over) and fixed on
`feature/phase-09-deployment-and-release-readiness`. `server/test/unit/lib/stacks-dir.test.ts`
and `server/test/unit/infrastructure/brownfield-scanner.test.ts` were unchanged
since the CI run that produced this report (confirmed via `git diff 4ce8f8f`), so
the originally-reported line numbers matched the current tree exactly.
`server/test/unit/jobs/proxy-cert-poller.test.ts` had since gained a whole new
"custom-sourced rows" describe block (phase 09-07, after this todo was filed), so
its "line 120" was stale against the current tree; root-caused instead by checking
out `4ce8f8f` — the exact commit the failing CI run (35063784652) actually tested —
to find what line 120 corresponded to there.

1. **`stacks-dir.ts`** — two independent bugs, not one:
   - `findMountEntryForPath()`'s ancestor-boundary check used `path.sep` to build
     the `mountPoint + path.sep` prefix it tests `resolvedPath` against. Every
     mount point this function ever sees comes from `/proc/self/mountinfo`, which
     is exclusively POSIX-formatted regardless of host OS — `path.sep` is `"\\"`
     on win32, so this silently stopped matching any deeper-than-root mount point
     whenever the *test process* (not the deployment) ran on Windows. Fixed by
     hardcoding `"/"` instead of `path.sep`.
   - `assertStacksDirIsMounted()` passed `getStacksDir()`'s output straight to
     `findMountEntryForPath()`. `getStacksDir()` uses native `path.resolve()`,
     which on win32 turns a POSIX-style env value like `/opt/docktor/stacks` into
     a drive-qualified, backslash-separated path (`D:\opt\docktor\stacks`) that
     could never structurally match a POSIX mountinfo entry. Added a win32-only
     `toMountinfoComparablePath()` helper (strips a drive prefix, backslash to
     forward slash) applied before matching — a genuine no-op in production,
     where the server only ever runs inside a Linux container and
     `process.platform` is never `"win32"`.
   - Verified both under simulated win32 semantics via Node's `path.win32`/`path.posix`
     submodules (available on any host, no real Windows machine needed) rather than
     guessing.

2. **`brownfield-scanner.ts`** — also two independent bugs, and this one had a
   trap: the naive fix (switch the whole module to `path.posix`) broke an
   *already-passing*, deliberately-Windows-behavior-pinning test file,
   `brownfield-scanner-windows-paths.test.ts` (added in phase 05.1, mocks
   `node:path` to its win32 implementation and asserts the scanner returns
   *host-native* backslash-separated paths on a real Windows host — a
   deliberate G-05.1-4 design contract, not a bug). The correct fix had to
   preserve that contract:
   - The `SYSTEM_DIRS` (`/proc`, `/sys`, `/dev`) comparison is a fixed
     Linux-only literal list — meaningless on Windows regardless of host —
     so it alone was switched to `path.posix.normalize()`. This was
     genuinely broken in production too: on a real Windows host,
     `path.normalize("/proc")` never equals the POSIX literal, so a
     directory this scanner must never touch could have slipped straight
     through to fast-glob.
   - The `path`/`directory` fields the scanner returns stayed host-native
     (unchanged, per the pinned contract above). Instead,
     `brownfield-scanner.test.ts`'s own POSIX-hardcoded assertions —
     written against real, unmocked `node:path`, which correctly becomes
     win32 on a windows-latest host — were the actual defect: normalized
     to a POSIX-comparable form (`toPosixComparable()`, backslash to
     forward slash) at each assertion site, including the `mockReadFile`
     `filePath` matcher that was silently never matching on Windows and
     would have produced 2 stacks instead of 1 (the real cause of the
     reported "duplicate-stack-detection miscount," which turned out to be
     a false-negative permission-skip match, not the Set-based dedup
     itself — the dedup logic was never actually broken).

3. **`proxy-cert-poller.ts`** — root-caused (was explicitly "not yet
   root-caused" when this todo was filed) as a test-only bug, no production
   change needed. `hasCertificateFile()`'s second candidate path is built via
   `path.join(this.certsDir, domain, "fullchain.pem")`, which joins with the
   host-native separator (`\` on win32) — correct, since this candidate is a
   real filesystem path passed to `fs.access`. The "reports issued when the
   fullchain.pem path exists instead of the .crt path" test's mock hardcoded a
   `` `${row.domain}/fullchain.pem` `` suffix with a literal forward slash,
   which never matched the real candidate on Windows; `fs.access` always threw
   `ENOENT` for it, `hasCertificateFile()` always returned `false`, and the
   computed status stayed `"pending"` — already equal to the row's stored
   `"pending"` — so `applyStatus()`'s no-op-when-unchanged guard skipped
   `repo.updateCertStatus` entirely. That is the exact "Number of calls: 0"
   failure the CI run reported. Not a timezone/date issue at all — the
   `Date`/timezone hypothesis in this todo's Solution section was a red
   herring; `classifyCertificateExpiry()` only ever does UTC-epoch-ms
   arithmetic and was never at risk. Fixed by building the expected suffix
   with `path.join(row.domain, "fullchain.pem")` instead of a hardcoded
   template literal, keeping the test's expectation in lockstep with
   production on every platform.

Verification: full `yarn workspace @docktor/server test:unit` (44 files, 706
tests, 2 todo) and `yarn typecheck` both pass on Linux. The three fixes were
also individually verified under simulated win32 path semantics via
`path.win32`/`path.posix`, since no real Windows machine was available in this
session — final confirmation is the real `cross-platform-unit (windows-latest)`
CI run after pushing this branch.
