---
phase: 02-observability
plan: 09
subsystem: infra
tags: [docker, update-checker, digest-comparison, image-ref-parsing]

# Dependency graph
requires:
  - phase: 02-observability
    provides: ImageUpdateCheck schema (currentDigest column), UpdateChecker cron job, GET /api/stacks/:id badge join (02-01..02-07)
provides:
  - "DockerExecutor.imageDigest() — local-only repo digest resolution, no registry traffic"
  - "UpdateChecker.checkImage() persists currentDigest and decides hasUpdate on the first check via registry-vs-local digest comparison"
  - "splitImageRef() — correct tag/port disambiguation for image references"
  - "buildImageRefFromService() — single canonical imageRef spelling shared by findAllImageRefs() and the stack detail route's badge lookup"
  - "GET /api/stacks/:id badge lookup keyed on the tag-qualified imageRef, matching what UpdateChecker persists"
affects: ["02-10 (activates the latestTag/semver comparison branch that this plan left structurally intact)"]

# Actuals (#2632)
actuals:
  tokens: 4915
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildImageRefFromService() as the single canonical imageRef-reconstruction helper, shared between UpdateChecker's production repo and the stacks route to prevent a second spelling drifting out of sync"
    - "DockerExecutor.imageDigest() mirrors manifestInspect()'s try/catch-returns-null convention for 'not found locally' as a normal condition, not an error"

key-files:
  created: []
  modified:
    - server/src/infrastructure/docker-executor.ts
    - server/src/jobs/update-checker.ts
    - server/src/routes/stacks.ts
    - server/test/unit/jobs/update-checker.test.ts

key-decisions:
  - "currentDigest is resolved fresh via docker.imageDigest() on every checkImage() run rather than reused from the prior row — this is what makes the digest verdict decidable on the very first check (no prior observation required)"
  - "The dead latestTag/semver comparison branch (defect #1 in the plan's gap findings — manifestInspect always returns latestTag: null in production) was left structurally untouched per plan instruction; 02-10 activates it"
  - "buildImageRefFromService() extracted as an exported pure function rather than duplicating the image+imageTag reconstruction in both findAllImageRefs() and the stacks route — the plan explicitly prohibits a second spelling of an image reference"

patterns-established:
  - "When a bug-fix plan touches the same file across multiple tasks (docker-executor.ts + update-checker.ts + test file span two tasks), commit atomicity was preserved by temporarily reverting the later task's hunks, committing the earlier task, then reapplying — avoiding a single combined commit that would blur task boundaries"

requirements-completed: [UPD-01, UPD-02, UPD-03]

coverage:
  - id: D1
    description: "ImageUpdateCheck rows for a tagged, deployed service carry a non-null currentDigest resolved from the local image store"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > resolves imageDigest() from the local image store, not the registry"
        status: pass
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > persists a non-null currentDigest and latestDigest on a successful check"
        status: pass
    human_judgment: false
  - id: D2
    description: "hasUpdate is correctly decided as true on the very first check when the registry digest differs from the locally deployed digest (no prior observation needed)"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > sets hasUpdate=true on the very first check when the registry digest differs from the local digest"
        status: pass
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > sets hasUpdate=false and publishes no event when the registry digest equals the local digest"
        status: pass
    human_judgment: false
  - id: D3
    description: "Repeated checks against unchanged registry/local state produce the same verdict and target the same imageRef key (idempotency)"
    requirement: "UPD-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > produces the same hasUpdate verdict and the same imageRef key on a repeated check against unchanged state"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failed/interrupted check (manifestInspect returns null) records hasUpdate=false with a checkError naming the image, clearing any previously stored hasUpdate=true"
    requirement: "UPD-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > records hasUpdate=false with a checkError naming the image and clears a previously stored hasUpdate=true when manifestInspect returns null"
        status: pass
    human_judgment: false
  - id: D5
    description: "Build-only services (no image field) are excluded from the checked image set and never produce a registry lookup"
    requirement: "UPD-02"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#buildImageRefFromService() (UPD-02 imageless filter) > returns null for a build-only service with no image"
        status: pass
    human_judgment: false
  - id: D6
    description: "Image references with a registry host and port split into name/tag on the tag separator, never mistaking the port for a tag"
    requirement: "UPD-01"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#splitImageRef() (UPD-01) — 5 cases covering tagged/untagged/registry-path/port-with-tag/port-without-tag"
        status: pass
      - kind: unit
        ref: "server/test/unit/jobs/update-checker.test.ts#checkImage() digest comparison (UPD-01, UPD-02) > uses the true tag (not the registry port) for a port-qualified ref with no explicit tag"
        status: pass
    human_judgment: false
  - id: D7
    description: "The update-available badge lookup in GET /api/stacks/:id resolves against the same canonical imageRef UpdateChecker persists (tag-qualified, not the bare untagged image column)"
    requirement: "UPD-03"
    verification:
      - kind: unit
        ref: "server/test/unit/*.test.ts full suite — 304 tests pass after the stacks.ts route change (no dedicated route-level unit test exists for this handler in this codebase; verified via full build + suite pass and manual trace against buildImageRefFromService)"
        status: pass
    human_judgment: true
    rationale: "No existing unit test harness covers the GET /api/stacks/:id route handler directly (no route test file for stacks.ts). Correctness was verified by manual trace (buildImageRefFromService('nginx','1.25') === the key findAllImageRefs would store for the same service) and by the grep acceptance criteria confirming no untagged lookup key remains, but an end-to-end/integration assertion that the badge actually reaches the client for a real tagged service was not exercised in this plan."

duration: 21min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 09: Update-Checker Digest Fix + Badge Join-Key Fix Summary

**Fixed three independent behavioral defects that kept Docker image update detection dead: currentDigest was never persisted, the digest comparison couldn't decide on a first check, and the stack detail badge looked up the wrong (untagged) key against what UpdateChecker actually stored.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-28T11:40:00Z (approx.)
- **Completed:** 2026-08-28T12:00:54Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added `DockerExecutor.imageDigest()` — resolves the local repo digest via `docker image inspect` (local-only, no registry traffic, cannot consume Docker Hub rate limit)
- `UpdateChecker.checkImage()` now resolves and persists `currentDigest` on every successful check, and the digest verdict compares the registry digest against the freshly-resolved *local* digest instead of a previously stored observation — decidable on the very first check
- `findAllImageRefs()` excludes build-only services (no `image` field) via the new `buildImageRefFromService()` pure helper, preventing a guaranteed-failure ref of just a colon and a tag
- Added `splitImageRef()` — correctly disambiguates a trailing colon as a tag separator vs. a registry port (`registry.example.com:5000/app` no longer mis-parses `5000` as a tag)
- Fixed the `GET /api/stacks/:id` badge lookup to key off the same tag-qualified imageRef `UpdateChecker` persists, using `buildImageRefFromService()` as the single canonical reconstruction shared by both call sites

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end update detection for one tagged image, with both digest operands populated** - `2b17128` (feat)
2. **Task 2: Split image references on the tag separator, not the port separator** - `0cecf71` (fix)
3. **Task 3: Key the update-available badge lookup on the tag-qualified image reference** - `379ad63` (fix)

**Plan metadata:** committed separately by orchestrator (STATE.md/ROADMAP.md not touched by this executor)

_Note: Task 1 and Task 2 both touch `update-checker.ts` and its test file. To keep commits atomic per task despite the shared files, Task 2's `splitImageRef()` addition and call-site substitution were written, then temporarily reverted before the Task 1 commit, then reapplied and committed separately as Task 2 — see "Patterns Established" in frontmatter._

## Files Created/Modified
- `server/src/infrastructure/docker-executor.ts` - Added `imageDigest(imageRef): Promise<string | null>`, local-only repo digest resolution
- `server/src/jobs/update-checker.ts` - Added `buildImageRefFromService()` and `splitImageRef()` pure helpers; widened `UpdateChecker.docker` type; `checkImage()` resolves/persists `currentDigest` and fixes the digest-branch verdict; `findAllImageRefs()` filters imageless services
- `server/src/routes/stacks.ts` - `GET /api/stacks/:id` badge lookup now keys off `buildImageRefFromService(svc.image, svc.imageTag)` instead of `normalizeImageRef(s.image)` alone
- `server/test/unit/jobs/update-checker.test.ts` - 22 new test cases covering the digest comparison, `splitImageRef`, and `buildImageRefFromService`

## Decisions Made
- `currentDigest` is resolved fresh on every check (via `this.docker.imageDigest(imageRef)`) rather than read from the previous row, since reading a stale prior observation was the root cause of the first-check-undecidable defect
- The dead `latestTag`/semver comparison branch (defect #1 from the plan's gap findings — `manifestInspect` always returns `latestTag: null` in production) was left structurally intact and untouched, per the plan's explicit instruction; plan 02-10 activates it by adding registry tag listing
- `buildImageRefFromService()` was extracted as a single exported pure helper reused by both `findAllImageRefs()` (production repo) and the `stacks.ts` route, satisfying the plan's prohibition against a second spelling of an image reference

## Deviations from Plan

None - plan executed exactly as written. All behavior, acceptance criteria, and prohibitions in the plan were satisfied without needing Rule 1-4 auto-fixes.

## Issues Encountered
- One test ("persists a non-null currentDigest and latestDigest on a successful check") initially triggered an uncaught `TypeError: stacks is not iterable` inside `checkImage()`'s broadcast fan-out, because `mockRepo.findStacksByImageRef` had no default mock return value and the test's `hasUpdate: true` path reached `for (const stack of stacks)` with `stacks === undefined`. Fixed by adding a safe default (`mockResolvedValue([])`) in the test file's `beforeEach`, which tests asserting broadcast behavior override explicitly. This was a test-harness issue, not a production code defect — caught and fixed during self-verification before the Task 1 commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02-10 can now activate the `latestTag`/semver comparison branch (registry tag listing) on top of a correctly-populated `currentDigest` and a fixed digest fallback
- The badge join-key fix (Task 3) means any update detected by 02-10's future work will actually reach the client UI instead of being silently dropped by a key mismatch
- No blockers. Full server unit suite (304 tests, 2 pre-existing todo) and build pass clean after all three commits.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
