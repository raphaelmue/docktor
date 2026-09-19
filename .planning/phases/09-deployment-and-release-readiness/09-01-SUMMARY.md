---
phase: 09-deployment-and-release-readiness
plan: 01
subsystem: docs
tags: [deployment, docker-compose, env-config, documentation-drift, todo-closure]

requires:
  - phase: 05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin
    provides: "docker-compose.yml's env_file rename from .env.local to .env (05.1-10), .env.example/.env.production creation (05.1-08), canonical stacks-directory pairing (05.1-03)"
provides:
  - "Corrected .env.example header comment pointing operators at .env (matching docker-compose.yml's env_file and docs/deployment.md)"
  - "Fact-by-fact audit of docs/deployment.md against docker-compose.yml/.env.example/Dockerfile, with one additional drift found and fixed (DOCKTOR_FS_POLLING default)"
  - "Closed .planning/todos/completed/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md with a Resolution section tracing every original defect to its fixing plan"
  - "Named remaining gap: .env.production line ~12 still stale, blocked by a workspace secret-file access guard, with the exact edit recorded for a developer with access"
affects: [09-04-prisma-migrate-cutover, deployment-docs]

actuals:
  tokens: 2200
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .env.example
    - docs/deployment.md
    - .planning/todos/completed/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md

key-decisions:
  - "D-01 confirmed NOT a zero-work close: fixed .env.example's stale .env.local header reference (the exact 05.1-10 defect class), matching 09-RESEARCH.md's finding."
  - "Found and fixed a second, previously-undocumented drift during the Task 2 audit: docs/deployment.md's DOCKTOR_FS_POLLING table row stated the default as 'auto-detected', but Dockerfile bakes DOCKTOR_FS_POLLING=true unconditionally into the shipped image — the table now states the actual default."
  - ".env.production could not be edited in this session either — the same workspace secret-file access guard that blocked Phase 05.1-10's identical attempt is still active. Reported as a named remaining gap below rather than silently skipped or falsely claimed done."
  - "Database schema section of docs/deployment.md left byte-identical, per plan scope — plan 09-04 rewrites it after the Prisma migrate cutover."

requirements-completed: []

coverage:
  - id: D1
    description: "An operator following .env.example's own header comment ends up with a file named exactly .env — the same filename docker-compose.yml's env_file entry loads and docs/deployment.md instructs"
    verification:
      - kind: other
        ref: "grep -c 'env\\.local' .env.example -> 0; grep -c 'DOCKTOR_STACKS_HOST_DIR' .env.example -> 4; grep -c 'docs/deployment.md' .env.example -> 3; git diff --stat .env.example confined to header lines"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every factual claim docs/deployment.md makes about docker-compose.yml, .env.example, and Dockerfile is confirmed true, with each checked fact and verdict recorded"
    verification:
      - kind: manual_procedural
        ref: "Section-by-section audit table below; one drift found and fixed (DOCKTOR_FS_POLLING default); Database schema section confirmed byte-identical via git diff"
        status: pass
    human_judgment: true
    rationale: "Fact-matching a prose document against source config is inherently a judgment call on what counts as a material claim; the audit table documents the reasoning per section for a human to spot-check."
  - id: D3
    description: "The deployment-config todo is filed under completed/ with a resolution naming which prior phase shipped each defect, and the one drift this plan itself fixed"
    verification:
      - kind: other
        ref: "test -f .planning/todos/completed/2026-08-27-*.md && test ! -f .planning/todos/pending/2026-08-27-*.md; grep -oE '05\\.1-0[0-9]|07-01' on the moved file matches 05.1-03/05.1-05/05.1-08/07-01; ls .planning/todos/pending/*.md | wc -l dropped from 19 to 18"
        status: pass
    human_judgment: false
  - id: D4
    description: "If the execution environment blocks access to .env.production, that blockage is reported as a named remaining gap with the exact edit, never silently skipped or claimed done"
    verification:
      - kind: other
        ref: "Read tool on .env.production returned 'Secret read guard' error this session, confirmed and recorded below with the exact stale/replacement text from 05.1-10-SUMMARY.md"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-16
status: complete
---

# Phase 9 Plan 1: Deployment Config Documentation Drift-Check and Closure Summary

**Fixed the confirmed `.env.example` `.env.local`→`.env` header drift, found and fixed one additional undocumented drift (`DOCKTOR_FS_POLLING`'s stated default), and closed scope item 1's todo with a resolution tracing every original defect to the plan that fixed it — `.env.production`'s equivalent edit remains blocked by a workspace secret-file guard and is reported as a named gap.**

## Performance
- **Duration:** ~25min
- **Started:** 2026-09-16T05:48:00Z (approx)
- **Completed:** 2026-09-16T06:13:23Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 3 (`.env.example`, `docs/deployment.md`, the moved/stamped todo file)

## Accomplishments
- Corrected `.env.example`'s header comment (line 3) from `.env.local` to `.env`, matching `docker-compose.yml`'s `env_file:` entries and `docs/deployment.md`'s own instructions — closing the exact defect class that caused the Phase 05.1-10 stacks-directory mismatch.
- Audited `docs/deployment.md` section by section against `docker-compose.yml`, `.env.example`, and `Dockerfile` (see audit table below). Found and fixed one additional, previously-undocumented drift: the environment-variable table claimed `DOCKTOR_FS_POLLING` defaults to "auto-detected," but the shipped `Dockerfile` bakes it to `true` unconditionally (`ENV DOCKTOR_FS_POLLING=true`), overriding the auto-detection logic the table (and `.env.example`'s own comment) described.
- Closed `.planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md`, moved to `completed/` and frontmatter-stamped via `gsd_run query todo complete`, with a Resolution section mapping all 8 original defects to the phase/plan that fixed each one.
- Confirmed `.env.production` still cannot be accessed in this execution environment (same class of restriction Phase 05.1-10 hit) — recorded below as a named remaining gap with the exact one-line edit.

## Task Commits
1. **Task 1: Correct the env-template header so it names the file Compose actually loads** - `f8091d8` (fix)
2. **Task 2: Audit the deployment guide fact-by-fact against the files it describes, then close the item-1 todo** - `3fe9a96` (docs)
**Plan metadata:** (this commit, following)

## Files Created/Modified
- `.env.example` - Header comment's copy instruction corrected from `.env.local` to `.env`; no other lines touched
- `docs/deployment.md` - `DOCKTOR_FS_POLLING` environment-variable table row corrected to state the actual Dockerfile-baked default (`true`) instead of "auto-detected"; `## Database schema` section left byte-identical
- `.planning/todos/completed/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md` (moved from `pending/`) - Resolution section appended tracing each of the 8 original Problem-section defects to its fixing commit/plan, plus this plan's own two Task fixes

## Audit Table (Task 2)

| Section | Source file(s) checked | Verdict |
|---|---|---|
| Prerequisites | `docker-compose.yml` (docker.sock mount, `/:/host:ro`) | clean |
| Quickstart (clone, copy env, `docker compose up -d`, setup wizard) | `docker-compose.yml`, `.env.example` (post-Task-1) | clean |
| Environment variables table (16 rows) | `.env.example`, `Dockerfile` `ENV` lines | fixed: `DOCKTOR_FS_POLLING` default row corrected from "auto-detected" to `true` (Dockerfile bakes it unconditionally) — every other row (NODE_ENV, PORT, HOST, CLIENT_DIST_PATH, DATABASE_URL, POSTGRES_PASSWORD, DOCKTOR_DB_AUTO_PUSH, BETTER_AUTH_SECRET, BETTER_AUTH_URL, ENCRYPTION_KEY, DOCKTOR_STACKS_DIR, DOCKTOR_STACKS_HOST_DIR, DOCKTOR_STACKS_MOUNT_CHECK, DOCKER_DATA_PATH, RESTIC_BINARY) confirmed clean |
| Stacks directory path pairing (`DOCKTOR_STACKS_DIR`/`DOCKTOR_STACKS_HOST_DIR`) | `docker-compose.yml`, `.env.example` | clean — wording matches `docker-compose.yml`'s own volume/environment comments near-verbatim |
| Stacks directory persistence (`assertStacksDirIsMounted()` description) | describes `server/src/lib/stacks-dir.ts` behavior; consistent with STATE.md's Phase 07-01 accumulated-context entry (not independently re-read this session; outside this task's declared read_first scope) | clean (per STATE.md Phase 07 decision record) |
| Database schema | excluded from audit and edit per plan scope (plan 09-04 rewrites after Prisma migrate cutover) | not audited (out of scope) |
| Backups (no `/backups`/`/data` volume; repo config lives in-app) | `docker-compose.yml` (no such volumes present) | clean |
| Troubleshooting table (10 rows) | `docker-compose.yml`, `.env.example`, `Dockerfile`, historical STATE.md decisions | clean — row 9 (the `.env.local`→`.env` rename note) is itself accurate; only `.env.example`'s own header hadn't been updated, which Task 1 fixed |

**Observation only (not a D-01 drift, no doc statement to contradict):** `package.json` declares `packageManager: yarn@4.13.0` while `Dockerfile` activates `yarn@4.12.0` — a one-minor-version mismatch. `docs/deployment.md` states no yarn version, so this isn't a documentation-drift defect. Not fixed here; `Dockerfile` is plan 09-04's file and this is out of item 1's scope (`git diff --stat Dockerfile` is empty for this plan).

## Remaining Gap: `.env.production`

**Status:** Blocked, not silently skipped. A direct `Read` tool call on `.env.production` this session returned: *"Secret read guard: Read would read '.../.env.production', which matches a protected secret-file pattern... Secret values must not be read into the conversation."* This is the same class of workspace permission restriction Phase 05.1-10 hit for the identical file (see `05.1-10-SUMMARY.md`).

**Exact edit needed** (for a developer with `.env*` access to apply directly, per the text `05.1-10-SUMMARY.md` recorded before it too was blocked):

- **File:** `.env.production`, **line ~12**
  - **Current:** `# unilaterally. Copy this file to \`.env.local\` (docker-compose.yml's`
  - **New:** `# unilaterally. Copy this file to \`.env\` (docker-compose.yml's`

No other line in `.env.production` needs to change. After applying, re-run `grep -c 'env\.local' .env.production` and confirm it prints `0`.

## Decisions Made
- Confirmed D-01's premise was wrong (item 1 was not a zero-work close) and fixed the one drift 09-RESEARCH.md identified, exactly as the plan anticipated.
- During the Task 2 audit, found a second drift not previously documented by research or STATE.md: `docs/deployment.md`'s `DOCKTOR_FS_POLLING` default statement disagreed with `Dockerfile`'s baked `ENV`. Fixed the guide to match the shipped Dockerfile (source-of-truth direction, per the plan's threat model T-09-02).
- Left `.env.example`'s own `DOCKTOR_FS_POLLING` comment untouched — Task 1's scope was explicitly confined to the header filename correction only ("no other change... no default changes"), and `.env.example`'s comment describing auto-detection isn't itself factually false (it explains the underlying file-watcher logic), it's just incomplete about the Dockerfile-level override. Not in this plan's scope to touch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `docs/deployment.md`'s `DOCKTOR_FS_POLLING` table row stated the wrong default**
- **Found during:** Task 2 (fact-by-fact audit)
- **Issue:** The row stated `DOCKTOR_FS_POLLING` defaults to "auto-detected", but `Dockerfile` line 121 (`ENV DOCKTOR_FS_POLLING=true`) bakes it to `true` unconditionally in the shipped image, overriding the file-watcher's own platform-based auto-detection. An operator reading only the table would incorrectly expect inotify to work by default on a native Linux host.
- **Fix:** Corrected the table cell to state the actual default (`true`, forced by the image) and rewrote the Purpose text to explain why, matching the reasoning already in `Dockerfile`'s own comment block.
- **Files modified:** `docs/deployment.md`
- **Verification:** `git diff docs/deployment.md` confined to the single table row; `grep -c 'Database schema' docs/deployment.md` still prints `4` (section untouched)
- **Commit:** `3fe9a96`

**Total deviations:** 1 auto-fixed (Rule 1 — documentation bug). **Impact:** Low — corrects an operator-facing claim about default behavior; no code or config changed, no scope expansion beyond the plan's own audit mandate.

## Issues Encountered
None beyond the anticipated `.env.production` access restriction (see Remaining Gap above, which is not treated as an "issue" — it was explicitly planned for via Task 1's `<precondition>` and fallback).

## User Setup Required
None - no external service configuration required. A developer with `.env*` access should apply the one-line `.env.production` edit documented above at their convenience; it does not block any other Phase 09 work.

## Next Phase Readiness
Scope item 1 (deployment config documentation) is closed. `docs/deployment.md`'s `## Database schema` section is confirmed byte-identical and ready for plan 09-04 to rewrite after the Prisma migrate cutover — no collision risk from this plan's edits. No blockers for 09-02 through 09-08.

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-16*

## Self-Check: PASSED

- FOUND: `.env.example`
- FOUND: `docs/deployment.md`
- FOUND: `.planning/todos/completed/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md`
- FOUND: commit `f8091d8`
- FOUND: commit `3fe9a96`
