---
phase: 02-observability
plan: 13
subsystem: api
tags: [docker, compose, digest-comparison, update-images, gap-closure]

# Dependency graph
requires:
  - phase: 02-observability
    provides: DockerExecutor.imageDigest() (local image store digest lookup, already used by UpdateChecker) and jobs/update-checker.ts's buildImageRefFromService()/normalizeImageRef() ref-spelling convention
provides:
  - "server/src/domain/image-update-detection.ts — pure toImageRef()/detectNoUpdates() digest comparison"
  - "StackService.updateImages() decides noUpdates from before/after local image digests instead of scraping composePull's stdout/stderr text"
affects: [stack-service, update-images, uat-gap-closure]

actuals:
  tokens: 4383
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Domain-layer digest comparison (image-update-detection.ts) kept pure — no I/O, no imports from repositories/infrastructure/jobs — with a parity test guarding a deliberately duplicated small ref-normalization helper against drift from jobs/update-checker.ts, mirroring the precedent in infrastructure/registry-client.ts"
    - "updateImages() splits into two guarded phases: a total pre-transition ref-collection helper (collectImageRefs, never throws) and a guarded pull/digest-snapshot phase, so a malformed compose file or a digest lookup failure can never strand the stack in UPDATING"

key-files:
  created:
    - server/src/domain/image-update-detection.ts
    - server/test/unit/domain/image-update-detection.test.ts
  modified:
    - server/src/application/stack-service.ts
    - server/test/unit/application/stack-service.test.ts

key-decisions:
  - "noUpdates is now decided from DockerExecutor.imageDigest() (local image store, no network call) read before and after the pull, never from parsing composePull's combined stdout/stderr — that free-text vocabulary was the confirmed root cause of G-02-11"
  - "detectNoUpdates() requires positive evidence only: non-empty comparison list, every entry has a non-empty before digest that strictly equals after; any null/empty/missing digest or empty list reports false (an update happened / unknown), never true — an unknown must never be mistaken for 'nothing changed'"
  - "toImageRef() duplicates buildImageRefFromService()'s normalization instead of importing jobs/update-checker.ts, to keep the domain layer free of jobs/node-cron/semver/registry-client in its module graph; a parity test asserts both functions produce identical strings across a shared case table"
  - "collectImageRefs() runs before the UPDATING transition and is total (catches every failure, logs a [StackService] warning, returns []) so a compose file that cannot be read or parsed degrades the answer to the generic message instead of ever escaping unguarded"
  - "snapshotDigests() wraps each per-ref imageDigest() call individually so one unexpectedly-rejecting lookup cannot fail the whole Promise.all and take the in-flight update down with it"

patterns-established:
  - "Digest-based no-op detection: compare a content-addressed identifier before/after an operation rather than pattern-matching a CLI's free-text progress output, which is not a stable interface"

requirements-completed: [UPD-04]

coverage:
  - id: D1
    description: "Clicking Update Images on a stack whose service images are all already the newest ones reports that nothing was updated"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#updateImages > reports noUpdates: true when every service's local image digest is unchanged before and after the pull"
        status: pass
      - kind: unit
        ref: "server/test/unit/domain/image-update-detection.test.ts#detectNoUpdates > is true when the digest is unchanged"
        status: pass
    human_judgment: false
  - id: D2
    description: "Clicking Update Images when a newer image really was pulled still reports a successful update"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#updateImages > reports noUpdates: false when a service's local image digest changed across the pull"
        status: pass
    human_judgment: false
  - id: D3
    description: "The no-update decision comes from before/after local image digests, never from parsing the pull command's free-text output"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "grep verification: pullOutput/toLowerCase/'up to date' absent from server/src/application/stack-service.ts (see Task 1 acceptance criteria)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A stack whose compose file cannot be read or parsed still completes an Update Images run and never gets stranded in UPDATING"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#updateImages > does not reject out of digest collection, and still ends in ERROR (not stuck in UPDATING) when the compose file cannot be read"
        status: pass
    human_judgment: false
  - id: D5
    description: "The noUpdates true branch has unit coverage, which it never had before"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#updateImages > reports noUpdates: true when every service's local image digest is unchanged before and after the pull"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 13: Digest-Based Update Detection Summary

**"Update Images" now decides noUpdates from before/after local image digests via a new pure domain module, replacing the free-text scan of `docker compose pull` output that made the up-to-date branch effectively unreachable (G-02-11, UPD-04).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-28T19:56:00Z
- **Completed:** 2026-08-28T20:21:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- New pure domain module `server/src/domain/image-update-detection.ts` (`toImageRef()`, `detectNoUpdates()`, `ImageDigestComparison`) with full unit coverage including a parity test against `buildImageRefFromService()` in `jobs/update-checker.ts`
- `StackService.updateImages()` rewritten to snapshot each service's local image digest before and after the pull (via two new private helpers, `collectImageRefs()` and `snapshotDigests()`) and derive `noUpdates` from `detectNoUpdates()` — the lowercased phrase-scan of `composePull`'s combined stdout/stderr is gone entirely
- Both the `noUpdates: true` and `noUpdates: false` branches now have unit coverage, closing the gap the debug session identified (previously only the false branch was ever tested)
- Degraded-path coverage added: unreadable/unparseable compose file (never rejects out of digest collection before the UPDATING transition, still ends in ERROR not stuck in UPDATING), build-only services (never call `imageDigest`, report `noUpdates: false`), all-null digests (report `noUpdates: false`), and `composePull` rejecting (unchanged ERROR + propagate behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Decide noUpdates from image digests, end to end through the service** - `df86c73` (feat)
2. **Task 2: Prove the degraded paths cannot strand a stack or lie to the user** - `0594e45` (test)

**Plan metadata:** committed together with this SUMMARY (see final commit below)

## Files Created/Modified
- `server/src/domain/image-update-detection.ts` — pure `toImageRef()` (image-ref reconstruction, mirrors `buildImageRefFromService`) and `detectNoUpdates()` (positive-evidence-only digest comparison)
- `server/test/unit/domain/image-update-detection.test.ts` — full truth table plus ref-spelling parity test against `jobs/update-checker.ts`
- `server/src/application/stack-service.ts` — `updateImages()` rewritten to snapshot digests via `collectImageRefs()`/`snapshotDigests()`; trailing free-text scan deleted
- `server/test/unit/application/stack-service.test.ts` — `imageDigest: vi.fn()` added to the docker mock; 6 new test cases covering both branches plus 4 degraded-path scenarios

## Decisions Made
- `toImageRef()` duplicates the small ref-normalization logic from `jobs/update-checker.ts` rather than importing it, to keep `domain/` free of `jobs/`'s module graph (node-cron, semver, registry-client singleton). A parity test is the drift guard, following the precedent already documented at the top of `infrastructure/registry-client.ts`.
- `detectNoUpdates()`'s bias is deliberately conservative: any unknown/missing digest reports "an update happened" (the safe default), never "nothing changed" — this is the exact defect being fixed, so the default must never be flipped back.
- `collectImageRefs()` is total and runs strictly before the UPDATING transition; `snapshotDigests()` wraps each per-ref lookup individually so no single failure can escape unguarded and strand the stack.

## Deviations from Plan

None — plan executed exactly as written. One verification note: the Task 1 acceptance criterion `grep -ci 'already exists' server/src/application/stack-service.ts` returns `1`, not `0`. On inspection this is a pre-existing, unrelated occurrence — the `ConflictError` message in `createStack()` (`` `Stack "${id}" already exists"` ``) — which predates this plan and has nothing to do with the removed pull-output text scan. The actual target of the criterion (the free-text scan block, its phrase lists, `toLowerCase`, `pullOutput`, and the `up to date` phrase) is confirmed fully removed by the other four grep checks in the same acceptance list, all of which pass as specified.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-02-11 (UPD-04) is closed: the "Update Images" toast will now correctly distinguish "already up to date" from "images updated" based on real Docker digest evidence rather than unreachable text phrases.
- No blockers for subsequent work. The `imageDigest()` local-store lookup already existed and is unmodified; no new dependencies or schema changes were introduced.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
