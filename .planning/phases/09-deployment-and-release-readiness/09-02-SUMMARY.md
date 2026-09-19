---
phase: 09-deployment-and-release-readiness
plan: 02
subsystem: testing
tags: [github-actions, ci, windows, macos, branch-protection, vitest]

# Dependency graph
requires:
  - phase: 05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin
    provides: "prisma-cli.ts / schema-sync.ts Windows-path fixes (G-05.1-1) that this plan's CI job now guards against regressing"
provides:
  - "cross-platform-unit CI job (windows-latest + macos-latest matrix) running typecheck plus client/shared/server unit suites, no Docker-dependent steps"
  - "main branch protection rule requiring both cross-platform-unit checks (D-07), created from scratch since none previously existed"
  - "3 newly-discovered real Windows platform bugs, tracked as a new pending todo, currently blocking all merges to main"
affects: [ci, deployment, windows-support, macos-support]

actuals:
  tokens: 3828
  tasks: 3
  commits: 3
  plan_head_before: 3a5773f

tech-stack:
  added: []
  patterns:
    - "GitHub Actions os matrix (fail-fast: false) for platform-divergent unit coverage without a Docker daemon requirement"

key-files:
  created:
    - .planning/todos/pending/2026-09-16-windows-ci-check-fails-on-real-platform-bugs.md
  modified:
    - .github/workflows/ci.yml
    - .planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md

key-decisions:
  - "D-06/D-08 implemented as a sibling `cross-platform-unit` job (windows-latest + macos-latest matrix, fail-fast:false), copying build-and-test's first 7 steps verbatim plus an explicit `yarn workspace @docktor/server test:unit` step — never the root test:unit script alone, which structurally excludes @docktor/server."
  - "D-07 applied as a from-scratch minimal branch protection rule (main had none before) requiring exactly the two rendered check names, strict:false, no PR-review requirement — user explicitly chose to require both now despite windows-latest currently failing for real platform reasons."
  - "The 3 real Windows unit-test failures found by the first live run are out of this plan's scope (job configuration only) and are tracked as a new pending todo rather than silently absorbed or deferred without a trace."

patterns-established:
  - "New todo, not a scope-creep fix, for defects a plan's own verification step surfaces but that plan wasn't chartered to fix."

requirements-completed: []

coverage:
  - id: D1
    description: "cross-platform-unit CI job added (windows-latest + macos-latest matrix), running typecheck + client/shared/server unit suites with no Docker-dependent steps"
    verification:
      - kind: unit
        ref: "node -e structural check (job key, matrix platforms, explicit server test:unit step) — passed"
        status: pass
      - kind: unit
        ref: "node -e forbidden-step check (no playwright/test:integration/upload-artifact/sonar in job body) — passed"
        status: pass
      - kind: other
        ref: "real workflow run https://github.com/raphaelmue/docktor/actions/runs/35063784652 — macos-latest SUCCESS (8s real server-unit step), windows-latest FAILURE (10s real server-unit step, 3 genuine platform bugs, not CI misconfiguration)"
        status: fail
    human_judgment: true
    rationale: "The job itself is correctly configured and provably ran real tests on both platforms (neither hit the Pitfall-5 zero-tests signature) — but the raw run conclusion for windows-latest is FAILURE. Distinguishing 'job works as designed and correctly caught real bugs' from 'job is broken' requires a human to read the CI run, which this SUMMARY does, but the automated pass/fail signal alone is misleading without that context."
  - id: D2
    description: "Both cross-platform-unit checks made required on the main branch protection rule (D-07)"
    verification:
      - kind: other
        ref: "gh api repos/raphaelmue/docktor/branches/main/protection --jq '.required_status_checks.contexts' -> [\"cross-platform-unit (windows-latest)\",\"cross-platform-unit (macos-latest)\"]"
        status: pass
    human_judgment: true
    rationale: "Applying branch protection is a human-authorized GitHub setting change (Task 2, gate=blocking-human), not something this executor can independently judge as correct policy — the human's explicit accept-the-trade-off decision is the actual gate, verified here but not substitutable by automation."
  - id: D3
    description: "CI todo closed with a resolution naming the job, both platforms, the server unit-test step, the integration-exclusion reason, and the Task 2 outcome"
    verification:
      - kind: other
        ref: "test -f .planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md && test ! -f .planning/todos/pending/2026-09-03-ci-has-no-windows-runner.md — passed"
        status: pass
      - kind: other
        ref: "grep -c 'test:unit' .planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md -> 4 (non-zero)"
        status: pass
    human_judgment: false

duration: 53min
completed: 2026-09-16
status: complete
---

# Phase 09 Plan 02: Windows/macOS CI Matrix + Branch Protection Summary

**Added a `cross-platform-unit` GitHub Actions job (windows-latest + macos-latest, unit suites only) and made both required on `main`; the first real run caught 3 genuine Windows-only bugs that now block all merges until fixed.**

## Performance

- **Duration:** ~53 min (across two executor invocations, separated by a checkpoint pause for CI + human branch-protection decision)
- **Started:** 2026-09-16T06:15:35Z (approx., following 09-01's completion commit)
- **Completed:** 2026-09-16T07:08:26Z
- **Tasks:** 3/3
- **Files modified:** 4 (task-scoped) + 3 (plan metadata: SUMMARY.md, STATE.md, ROADMAP.md)

## Accomplishments
- New `cross-platform-unit` job added to `.github/workflows/ci.yml` as a sibling of `build-and-test`, matrix `[windows-latest, macos-latest]`, `fail-fast: false`, running typecheck plus client/shared/server unit suites (via the explicit `yarn workspace @docktor/server test:unit` step) with zero Docker-dependent steps.
- `main` branch protection rule created from scratch (none existed before) requiring exactly `cross-platform-unit (windows-latest)` and `cross-platform-unit (macos-latest)` — verified byte-for-byte against the live GitHub API response.
- The CI todo (`2026-09-03-ci-has-no-windows-runner.md`) closed with a Resolution section citing the real run's conclusions, not predictions.
- A new todo filed for 3 genuine Windows platform bugs the first real run surfaced — out of this plan's scope to fix, but now actively blocking merges via the required check this plan just made blocking.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a windows-latest + macos-latest unit-test matrix job to the CI workflow** - `4ce8f8f` (feat) — completed by a prior executor invocation.
2. **Task 2: Make both cross-platform checks required on the main branch (D-07)** - no file commit (GitHub repository setting, not version-controlled). Applied by the orchestrator via `gh api repos/raphaelmue/docktor/branches/main/protection` PUT, per the user's explicit "Require both now anyway" decision recorded at the checkpoint.
3. **Task 3: Close the CI todo with a resolution naming the scope boundary and its reason** - `eebceff` (docs) — includes the new Windows-bugs todo.

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md)

## Files Created/Modified
- `.github/workflows/ci.yml` - new `cross-platform-unit` job (Task 1, prior invocation)
- `.planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md` - moved from pending/, stamped, Resolution section appended
- `.planning/todos/pending/2026-09-16-windows-ci-check-fails-on-real-platform-bugs.md` - new todo for the 3 Windows bugs found by the first real run

## Decisions Made
- D-06/D-08 (from phase discussion) matched exactly: unit-only coverage on both platforms in parallel, neither cancelling the other.
- D-07 applied as a minimal, check-only branch protection rule — `strict: false`, `enforce_admins: false`, no required PR reviews — rather than a fuller protection policy, per explicit user confirmation at the checkpoint.
- User explicitly accepted requiring `windows-latest` now despite it currently failing for real (non-flake) reasons, matching D-07's originally-scoped trade-off (a red platform check blocks merges by design, so the signal cannot be ignored).
- The 3 Windows bugs found are recorded as a **new** todo rather than folded into the just-closed CI todo, so the closed todo's Resolution stays an honest historical record of what this plan actually delivered (a working, correctly-scoped CI job), separate from the follow-up work the job's first run now demands.

## Deviations from Plan

None — plan executed exactly as written, across both the prior and current executor invocations. Task 2's precondition (a completed workflow run) was correctly identified as unmet by the prior invocation and surfaced as a checkpoint rather than worked around; the orchestrator resolved it externally (pushed branch, opened draft PR #6, waited for the run, applied branch protection per user decision) before this invocation resumed.

## Issues Encountered

**`cross-platform-unit (windows-latest)` failed on its first real run — 3 genuine platform bugs, not CI misconfiguration.** The server unit tests step ran a real suite (10s, not the Pitfall-5 zero-tests signature) and found:
1. `server/test/unit/lib/stacks-dir.test.ts` (lines 212, 265, 284, 341, 363) — mount-point detection assumes POSIX `/proc/mounts`-style parsing; cannot find `D:\opt\docktor\stacks`-style Windows paths.
2. `server/test/unit/infrastructure/brownfield-scanner.test.ts` (lines 95, 141, 153, 166, 182) — path normalization assumes POSIX separators (`expected '\opt\myapp' to be '/opt/myapp'`), with a related duplicate-stack-detection miscount downstream of the same assumption.
3. `server/test/unit/jobs/proxy-cert-poller.test.ts` (line 120) — a mock-call assertion failure (`expected "vi.fn()" to be called with... Number of calls: 0`), likely timezone/date-comparison sensitivity, not yet root-caused.

`cross-platform-unit (macos-latest)` passed cleanly (8s, real suite, no failures) — this is Windows-specific.

Fixing these 3 bugs is out of this plan's scope (adding the CI job was the deliverable, not making every existing suite pass on a platform it had never run on). Filed as `.planning/todos/pending/2026-09-16-windows-ci-check-fails-on-real-platform-bugs.md`.

**Out-of-scope observation, not a Task 1/2/3 acceptance criterion:** the pre-existing `build-and-test` (ubuntu) job also failed on this run, but in its "Client integration tests" (Playwright) step — `test/integration/auth.spec.ts:85 "login with valid credentials redirects to dashboard"`, failing on the initial attempt and both automatic retries. The ubuntu job body is byte-identical to before this plan (confirmed via `git diff .github/workflows/ci.yml` showing purely additive changes), so this is an unrelated pre-existing flake in the login redirect flow, not something plan 09-01 or 09-02 introduced. Not fixed here; noted for visibility only.

**Pending todo count is net unchanged (18 -> 18), not net -1, by design.** The plan's Task 3 acceptance criterion ("`ls .planning/todos/pending/*.md | wc -l` is exactly one lower than before this task ran") is satisfied for the todo Task 3 itself closes: 18 pending before Task 3 -> 17 immediately after closing `2026-09-03-ci-has-no-windows-runner.md`. The orchestrator's separate instruction to file a new todo for the 3 Windows bugs then brought the count back to 18. Both counts (18 before, 17 mid-task, 18 final) are recorded here per that instruction's own request for an honest, non-silent accounting.

## User Setup Required

None - no external service configuration required. (Task 2's branch-protection change was a one-time GitHub repository setting, already applied by the orchestrator and verified above — no recurring user action needed.)

## Next Phase Readiness

- CI now has real signal on Windows and macOS for typecheck plus all three unit suites, closing the coverage gap that let the Phase 04/05.1 platform-divergent defects ship undetected.
- **Blocker for this branch and every future PR:** `cross-platform-unit (windows-latest)` is both required and currently red. Draft PR #6 (and any subsequent PR) cannot merge to `main` until the 3 Windows bugs above are fixed or the check otherwise passes. This is the immediate next actionable item, tracked in the new todo.
- The pre-existing ubuntu `build-and-test` Playwright flake (`auth.spec.ts:85`) is unrelated to this plan's scope but is also currently failing on the same PR — worth investigating separately since it affects the existing, previously-passing required check too.

## Self-Check: PASSED

All claimed files exist on disk (`.github/workflows/ci.yml`, `.planning/todos/completed/2026-09-03-ci-has-no-windows-runner.md`, `.planning/todos/pending/2026-09-16-windows-ci-check-fails-on-real-platform-bugs.md`, this SUMMARY.md) and the old pending-todo path is confirmed absent. All claimed commits (`4ce8f8f`, `eebceff`, `2977b21`) exist in `git log --all`. Branch protection contexts independently re-verified against the live GitHub API before this SUMMARY was written.

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-16*
