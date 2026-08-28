---
phase: 02-observability
plan: 11
subsystem: infra
tags: [docker-compose, yaml, image-upgrade, update-checker, stack-lifecycle]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "RegistryClient.listTags(), persisted availableTags on ImageUpdateCheck, GET /api/stacks/:id/services/:serviceName/tags (02-10)"
provides:
  - "server/src/lib/compose-editor.ts — setServiceImageTag()/getServiceImageTag(), a format-preserving YAML edit of a single service's image tag"
  - "StackService.upgradeServiceImage() — rewrites the compose file, deploys through the existing UPDATING/RUNNING lifecycle, restores on failure"
  - "POST /api/stacks/:id/services/:serviceName/upgrade — authenticated, user-initiated version upgrade endpoint"
  - "shared upgradeServiceSchema/dockerTagSchema — the Docker-tag-grammar validation boundary that keeps an attacker-supplied tag out of the YAML document"
affects: ["02-12 (version-selection dialog calls this endpoint to persist the chosen tag)"]

# Actuals (#2632)
actuals:
  tokens: 8295
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compose-editor.ts restates the colon-vs-port tag-splitting rule locally (private splitImageRef) instead of importing jobs/update-checker.ts's splitImageRef — lib/ sits below jobs/ in this project's layering, and jobs/update-checker.ts already imports a singleton at module scope, so importing back risks the same bottom-of-file-singleton TDZ crash documented in 02-10's summary"
    - "Format-preserving YAML edits use parseDocument() + mutate the existing Scalar node's .value in place (not doc.setIn with a plain value, which creates a fresh default-styled scalar) — the only way to keep the node's original quoting style"
    - "ComposeEditError carries a `reason` discriminant (no-services/service-not-found/no-image/digest-pinned) so the application layer can translate one error class into either a 404 or a 400 without parsing message text"

key-files:
  created:
    - server/src/lib/compose-editor.ts
    - server/test/unit/lib/compose-editor.test.ts
  modified:
    - shared/src/validation/stacks.ts
    - shared/test/unit/validation/stacks.test.ts
    - server/src/application/stack-service.ts
    - server/src/routes/stacks.ts
    - server/test/unit/application/stack-service.test.ts

key-decisions:
  - "getServiceImageTag() was added to compose-editor.ts alongside setServiceImageTag() (only the latter is named in the plan's artifact list) — StackService needs the current tag both for the idempotency check and for the returned previousTag, and reusing the same internal splitImageRef/readServiceImage logic avoids re-implementing the colon-vs-port disambiguation a second time in stack-service.ts"
  - "guardTransition() runs before the idempotency short-circuit in upgradeServiceImage(), not after — this is a pure validation call (no side effects), so running it first guarantees a second concurrent request is rejected by the status guard even if its target tag happens to already match what an in-flight request wrote to disk"
  - "The route resolves the service from the addressed stack's own DB service list (mirroring the GET .../tags route from 02-10) before delegating to upgradeServiceImage(), which independently also validates the service exists in the compose file itself — belt-and-suspenders, since the DB and the compose file are two different sources that could in principle drift"
  - "Verified the yaml package's Document API behavior (quote preservation, comment preservation, anchor/alias round-tripping, mutating a Scalar node's .value) against a live script before writing the implementation, rather than assuming it from documentation — confirmed exact-byte output equality for every case the plan's must_haves require"

requirements-completed: [UPD-04]

coverage:
  - id: D1
    description: "setServiceImageTag() rewrites a service's image tag using the yaml package's Document API, preserving every other line (comments, key order, quoting style, unrelated services) byte-for-byte"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/compose-editor.test.ts#setServiceImageTag — basic rewrite with comment preservation, multi-service isolation, anchor/alias round-trip, no-regex-substitution guard"
        status: pass
    human_judgment: false
  - id: D2
    description: "The name/tag split correctly treats a registry port as part of the name (not a tag) for both tagged and untagged registry-with-port references, and appends a tag when the image carries none"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/compose-editor.test.ts#setServiceImageTag — registry-with-port (tagged/untagged), ghcr.io, no-tag-append cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "A digest-pinned image (@sha256:...) is rejected with ComposeEditError naming the digest pin as unsupported, rather than guessing a rewrite"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/lib/compose-editor.test.ts#setServiceImageTag and #getServiceImageTag — digest-pinned cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "upgradeServiceImage() rewrites the compose file on disk, deploys through UPDATING->RUNNING, and replaces Service rows with the new tag — a real version upgrade that survives a restart"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#upgradeServiceImage — 'rewrites the compose file, deploys, and returns the new tag'"
        status: pass
    human_judgment: false
  - id: D5
    description: "Requesting an upgrade to the tag already in the compose file is an idempotent no-op: no write, no status transition, no docker call"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#upgradeServiceImage — 'is a no-op when the target tag equals the tag already in the compose file'"
        status: pass
    human_judgment: false
  - id: D6
    description: "A service name not belonging to the addressed stack returns NotFoundError and rewrites nothing; a strictly-invalid Docker tag is rejected at the shared-schema validation boundary before the service layer is reached"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#upgradeServiceImage — 'throws NotFoundError for a service absent...'; shared/test/unit/validation/stacks.test.ts#dockerTagSchema and #upgradeServiceSchema"
        status: pass
    human_judgment: false
  - id: D7
    description: "A second upgrade request while the stack is already UPDATING is rejected by the same status guard used elsewhere, and does not disturb the in-flight upgrade"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#upgradeServiceImage — 'rejects a second upgrade while the stack is already UPDATING...'"
        status: pass
    human_judgment: false
  - id: D8
    description: "When composePull or up fails after the compose file was rewritten, the original content is restored on disk and the stack transitions to ERROR with the deploy error (not a masking restore error) propagated"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "server/test/unit/application/stack-service.test.ts#upgradeServiceImage — pull-failure restore, up-failure restore, and failing-restore-still-surfaces-deploy-error cases"
        status: pass
    human_judgment: false
  - id: D9
    description: "Upgrades remain strictly user-initiated: no job, cron, or background path (jobs/, infrastructure/) references upgradeServiceImage"
    requirement: "UPD-04"
    verification:
      - kind: other
        ref: "grep -rn upgradeServiceImage server/src/jobs/ server/src/infrastructure/ — no matches"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 11: Persist a Chosen Image Version Into the Compose File Summary

**Added a format-preserving YAML compose editor (`setServiceImageTag`/`getServiceImageTag`), a `StackService.upgradeServiceImage()` orchestration with pull/up rollback, and an authenticated `POST /api/stacks/:id/services/:serviceName/upgrade` endpoint — so picking a version rewrites `docker-compose.yml` and survives a restart, instead of a pull-and-deploy whose effect disappears on the next redeploy.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-28T14:20:00Z (approx.)
- **Completed:** 2026-08-28T14:40:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- `compose-editor.ts` uses the `yaml` package's Document API (`parseDocument` + mutate the existing `Scalar` node's `.value` + `toString({lineWidth: 0})`) rather than parse-and-restringify, so comments, key order, quoting style, and unrelated services survive an edit byte-for-byte — verified against a live script before writing the implementation, not assumed
- The name/tag split treats a colon as a tag separator only when no slash follows it, matching the rule 02-09 established in `jobs/update-checker.ts`'s `splitImageRef` — restated locally in `lib/` rather than imported, to avoid the bottom-of-file-singleton circular-import risk documented in 02-10's summary
- A digest-pinned image (`nginx@sha256:...`) is rejected with a typed `ComposeEditError` rather than guessing a rewrite; the error carries a `reason` discriminant so the application layer can translate it into a 404 (service not found) or 400 (everything else) without string-matching the message
- `StackService.upgradeServiceImage()` mirrors `updateImages()`'s UPDATING→RUNNING lifecycle: guards the transition, rewrites the compose file, pulls and recreates, replaces Service rows, and clears the config-changed flag on success
- Idempotency: requesting the tag already in the compose file returns `{changed: false}` with no write, no status transition, and no docker call
- Concurrency: `guardTransition` runs as a pure check before the idempotency short-circuit, so a second concurrent upgrade request is rejected by the existing status guard even if its target tag happens to already match what an in-flight request wrote to disk
- Rollback: if `composePull` or `up` fails after the file was rewritten, the original content captured at the start is restored on disk before the ERROR transition; if the restore write itself fails, it's logged and the original deploy error (not the restore error) is still what propagates
- `dockerTagSchema` in the shared package constrains `targetTag` to the real Docker tag grammar (`[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}`) — the security control (T-02-11-01) that keeps whitespace, quotes, and YAML metacharacters out of the document before the edit ever runs
- `POST /api/stacks/:id/services/:serviceName/upgrade` resolves the service from the addressed stack's own DB service list (mirroring the 02-10 `.../tags` route) before delegating — no job, cron, or background path references `upgradeServiceImage`, confirmed by grep

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end version upgrade for one service — rewrite, deploy, persist** - `fff0074` (feat)
2. **Task 2: Harden the compose edit against real-world image forms** - `319d364` (test)
3. **Task 3: Roll back the compose file when the upgrade deploy fails** - `052fa07` (fix)

**Plan metadata:** committed separately by orchestrator (STATE.md/ROADMAP.md not touched by this executor)

_Note: Task 2 required no `src/` changes — Task 1's implementation already applied the correct colon-vs-port rule and the Document API's targeted-node-mutation approach, which happen to satisfy every Task 2 hardening case. Task 2's commit is test-only, proving and guarding that choice._

## Files Created/Modified
- `server/src/lib/compose-editor.ts` (new) - `setServiceImageTag()`, `getServiceImageTag()`, `ComposeEditError` with a `reason` discriminant
- `server/test/unit/lib/compose-editor.test.ts` (new) - 19 test cases: basic rewrite + comment preservation, all four `ComposeEditError` reasons, registry-port disambiguation (tagged/untagged), ghcr.io, quoting preservation, multi-service isolation, digest-pin rejection, anchor/alias round-trip, no-regex-substitution guard
- `shared/src/validation/stacks.ts` - `dockerTagSchema`, `upgradeServiceSchema`, `upgradeServiceParamsSchema`
- `shared/test/unit/validation/stacks.test.ts` - 15 new test cases for `dockerTagSchema`/`upgradeServiceSchema`
- `server/src/application/stack-service.ts` - `upgradeServiceImage()`, private `translateComposeEditError()` helper
- `server/src/routes/stacks.ts` - `POST /api/stacks/:id/services/:serviceName/upgrade`
- `server/test/unit/application/stack-service.test.ts` - 9 new test cases: success, idempotency, missing-service 404, digest-pin 400, concurrency guard, pull-failure restore, up-failure restore, failing-restore-still-surfaces-deploy-error, success-path-no-extra-write

## Decisions Made
See `key-decisions` in frontmatter: `getServiceImageTag()` added alongside `setServiceImageTag()` to share the tag-splitting logic for the idempotency check; `guardTransition()` ordered before the idempotency short-circuit for correct concurrency behavior; route resolves the service from the DB list before delegating (belt-and-suspenders with the compose-file-level check inside the service layer); yaml Document API behavior verified against a live script before implementation.

## Deviations from Plan

None — plan executed as written. The only notable implementation choice beyond the plan's literal artifact list is `getServiceImageTag()` (documented above as a decision, not a deviation, since it's an internal addition to a file the plan already scoped for Task 1 and doesn't change any external contract).

## Issues Encountered

None. Unlike 02-10, this plan added no new Prisma schema and required no `yarn db:push` — `upgradeServiceImage()` only touches the existing `Service` table via the already-live `replaceServices()` path, so there is no pending database migration blocker from this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02-12's version-selection dialog can now call `POST /api/stacks/:id/services/:serviceName/upgrade` with a `targetTag` from the persisted candidate list (`GET .../tags`, from 02-10) to actually apply a chosen version
- UAT Gap 5's remaining sub-ask — "the docker-compose adjusted automatically" — is closed on the server side; only the client UI to choose a version (02-12) remains
- No blockers carried forward from this plan

## Self-Check: PASSED

All files created/modified in this plan were verified present on disk, and all three commit hashes (`fff0074`, `319d364`, `052fa07`) were verified present in `git log --oneline --all`.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
