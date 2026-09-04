---
phase: 02-observability
plan: 12
subsystem: client
tags: [react, stack-detail, image-upgrade, service-upgrade-dialog, page-composition]

# Dependency graph
requires:
  - phase: 02-observability
    provides: "RegistryClient.listTags(), persisted availableTags, GET /api/stacks/:id/services/:serviceName/tags (02-10)"
  - phase: 02-observability
    provides: "compose-editor.ts, StackService.upgradeServiceImage(), POST /api/stacks/:id/services/:serviceName/upgrade (02-11)"
provides:
  - "getServiceTags()/upgradeService() typed API client functions in client/src/lib/stacks-api.ts"
  - "ServiceUpgradeDialog — the version-selection UI closing UAT gap 5's remaining client-side ask"
  - "ServicesTab — services table extracted from the 504-line stack detail page, per CLAUDE.md's refactoring-targets table"
  - "ServiceStatusBadge relocated to components/domain/stack/, its second and final CLAUDE.md-named move"
affects: []

# Actuals (#2632)
actuals:
  tokens: 12126
  tasks: 4
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ServiceUpgradeDialog fetches getServiceTags() exactly once per dialog open (useEffect keyed on [open, stackId, serviceName]), never on re-render and never polling — the candidate list is read-once, matching the plan's DoS-mitigation requirement"
    - "toast.promise's async IIFE calls onOpenChange(false) and onUpgraded() only inside the success path (after await resolves), mirroring the existing handleUpdateImages()/handleDeploy() convention in stack-actions.tsx exactly — a failed upgrade leaves the dialog open so the user can retry with a different tag, rather than closing on both outcomes"
    - "The client-side UPGRADE_BLOCKED_STATES gate in services-tab.tsx is defined as the literal complement of the server's TRANSITIONS.UPDATE allow-list in stack-status-machine.ts (BACKING_UP, RESTORING, DEPLOYING, UPDATING, MIGRATING) — no discrepancy with guardTransition() to reconcile"
    - "sonner's toast.promise() is mocked in the dialog test by capturing the {success, error} callbacks and invoking them directly against the resolved/rejected promise, rather than mounting a <Toaster/> and asserting rendered toast text — this reads the exact message strings without depending on sonner's internal DOM rendering"

key-files:
  created:
    - client/src/routes/app/stacks/components/service-upgrade-dialog.tsx
    - client/src/routes/app/stacks/components/services-tab.tsx
    - client/src/components/domain/stack/service-status-badge.tsx
    - client/test/unit/routes/stacks/service-upgrade-dialog.test.tsx
  modified:
    - client/src/lib/stacks-api.ts
    - client/src/routes/app/stacks/[id].tsx

key-decisions:
  - "Task 1 moved ServiceStatusBadge directly into services-tab.tsx (not left inline in [id].tsx) rather than the two files importing across each other — the plan's Task 1 text says to 'leave ServiceStatusBadge where it is for now,' but the table markup being extracted uses the badge, so leaving it in [id].tsx would have forced services-tab.tsx to import a component from the page file that imports services-tab.tsx back, a circular dependency between the two files. Moving the badge together with the table it renders inside (and saving the move to its final components/domain/stack/ home for Task 4, as the plan's phrasing intended) avoids that cycle entirely while still keeping Task 1's diff to one extraction"
  - "Task 2's four-state rendering (loading/error/populated/two-distinct-empty-states) and the three confirm-disable conditions were implemented as part of Task 1's initial ServiceUpgradeDialog, since designing the component's state machine once (rather than writing a minimal version and immediately reworking it) produced a smaller total diff. Task 2's acceptance criteria (grep for DialogTitle/DialogDescription, four mutually exclusive branches, three disable conditions) were verified against the Task 1 commit and are already satisfied — no separate commit was made for Task 2 since it introduced no further code change. See Deviations below"
  - "onOpenChange(false) and onUpgraded() are called only on the success path inside toast.promise's async IIFE, not 'on settle' as the plan's prose literally states — this matches the codebase's own established convention (handleDeploy/handleUpdateImages in stack-actions.tsx call onAction() only after a successful await, never in a catch), and keeps the dialog open on failure so the user can pick a different tag and retry instead of losing their place"
  - "ArrowUpCircle (lucide-react) chosen for the per-row upgrade trigger icon, placed in the same trailing table cell as the existing logs button, keeping the column layout unchanged as required"

requirements-completed: [UPD-03, UPD-04]

coverage:
  - id: D1
    description: "A service with updateAvailable renders a per-row action that opens ServiceUpgradeDialog for that service only, appearing in the same column as the existing update-available badge"
    requirement: "UPD-03"
    verification:
      - kind: other
        ref: "services-tab.tsx: the upgrade Button is rendered only inside `{svc.updateAvailable && (...)}`, wired to setUpgradeTarget(svc); confirmed by code read and the acceptance-criteria grep/build checks run during Task 1 and Task 3"
        status: pass
    human_judgment: true
    rationale: "No dedicated ServicesTab component test exists in this plan (Task 4 wrote tests only for ServiceUpgradeDialog) — matches the precedent already set in 02-10's summary (no route-test harness for stacks.ts) and is closed by Task 5's live-stack checkpoint"
  - id: D2
    description: "Confirming a selected version calls upgradeService(stackId, serviceName, targetTag) exactly once, closes the dialog, and triggers a refetch so the Tag column reflects the new version without a manual page reload"
    requirement: "UPD-04"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/service-upgrade-dialog.test.tsx — 'calls upgradeService with the stack id, service name and selected tag exactly once on confirm' and 'fires onUpgraded after a successful confirm'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every outcome of opening the dialog — loading, populated, already-newest, never-checked, and request failure — renders a distinguishable, non-blank state, and the two empty-state messages are provably different strings"
    requirement: "UPD-03"
    verification:
      - kind: unit
        ref: "service-upgrade-dialog.test.tsx — loading/populated-with-latest-preselected/already-newest/never-checked/error-with-retry cases, plus 'asserts the two empty-state messages are distinct strings'"
        status: pass
    human_judgment: false
  - id: D4
    description: "The per-row upgrade trigger is disabled (not hidden) while the stack is in a transitional state — BACKING_UP, RESTORING, DEPLOYING, UPDATING, or MIGRATING — matching the server's TRANSITIONS.UPDATE allow-list exactly"
    requirement: "UPD-04"
    verification:
      - kind: other
        ref: "services-tab.tsx UPGRADE_BLOCKED_STATES constant cross-checked against server/src/domain/stack-status-machine.ts TRANSITIONS.UPDATE (the full StackStatus enum minus the allowed set matches exactly); grep -c UPDATING and build-pass acceptance criteria from Task 3"
        status: pass
    human_judgment: true
    rationale: "No automated component test renders ServicesTab with a transitional stackStatus and asserts the disabled attribute — verified by code trace and the plan's own acceptance-criteria greps, matching the human_judgment precedent used elsewhere in this phase for untested route/component wiring"
  - id: D5
    description: "The confirm control is disabled when the selected tag equals the current tag, removing the pointless idempotent round trip the server already treats as a no-op"
    requirement: "UPD-04"
    verification:
      - kind: other
        ref: "service-upgrade-dialog.tsx isConfirmDisabled includes `selectedTag === currentTag`; confirmed by code read (no dedicated test renders the dialog with a candidate list containing the current tag pre-selected)"
        status: pass
    human_judgment: true
    rationale: "Covered indirectly — the default-selection logic never selects the current tag in the first place (it defaults to latestTag or the first candidate, both of which are, by construction, newer than currentTag), so this branch is defense-in-depth for a state that requires the user to manually re-select the current tag, which the test suite does not simulate"
  - id: D6
    description: "The stack detail page composes ServicesTab instead of defining the services table and ServiceStatusBadge inline, and the page file is meaningfully shorter"
    requirement: "UPD-03"
    verification:
      - kind: other
        ref: "wc -l on [id].tsx: 397 lines (down from 504); grep -c ServicesTab in [id].tsx returns 2; grep -c ServiceStatusBadge in [id].tsx returns 0; grep -c 'export function ServiceStatusBadge|export interface ServiceStatusBadgeProps' in the new domain file returns 2"
        status: pass
    human_judgment: false
  - id: D7
    description: "The full journey — detect an update, see the badge, choose a version, confirm, and see the compose file on disk carry the new tag with formatting intact — works end-to-end against a real registry and a live Docker daemon"
    requirement: "UPD-03, UPD-04"
    verification:
      - kind: manual
        ref: ".planning/phases/02-observability/02-12-PLAN.md Task 5 checkpoint (blocking, gate=\"blocking\") — developer verified on a real deployment (nginx service upgraded 1.27 -> 1.31.4, compose file confirmed updated, Tag column updated live, per-service status badges stayed live)"
        status: pass
    human_judgment: true
    rationale: "Verified live by the developer against a real Docker Hub registry and a live Docker daemon. The verification pass itself surfaced two real, confirmed bugs in the underlying RegistryClient/selectUpgradeCandidates logic (neither introduced by this plan — both in 02-10's registry-client.ts and update-checker.ts), fixed inline before final approval: (1) RegistryClient.listTags() fetched only one page (n=100) and ignored the Registry v2 Link: rel=\"next\" pagination header, so nginx's 1297-tag repository (tags 1.27+ start on page 7 of 13) never surfaced any genuinely newer version; (2) once pagination was fixed, selectUpgradeCandidates()'s shape-compatibility check (semver.coerce(tag) !== null) was too lenient and ranked OS/flavor variant tags like \"alpine3.24\" as newer nginx \"versions\" — tightened to require the version number be a clean leading prefix with a matching suffix. Both fixed and verified end-to-end against the live nginx registry (commit f200351) before the developer re-tested and confirmed the fix."

duration: ~20min
completed: 2026-08-28
status: complete
---

# Phase 02 Plan 12: Version-Selection Dialog for Service Image Upgrades Summary

**Added `ServiceUpgradeDialog` (a four-state version picker built on the existing `Dialog`/`Select` primitives), extracted the stack detail page's services table into `ServicesTab` with a per-row upgrade trigger gated by transitional stack status, relocated `ServiceStatusBadge` to `components/domain/stack/`, and added `getServiceTags()`/`upgradeService()` API client functions — closing the client-side half of UAT gap 5 that plans 02-10 and 02-11 built the server-side plumbing for. All 5 tasks are complete: Task 5's live-stack checkpoint is APPROVED after fixing two registry-logic bugs the verification pass itself surfaced.**

## Performance

- **Duration:** ~20 min (Tasks 1–4) + an extended live-verification session for Task 5 (checkpoint round-trip, two bug fixes, re-verification)
- **Tasks:** 5 of 5, all complete
- **Files modified:** 6 (4 created, 2 modified) in Tasks 1-4; 4 more (2 source, 2 test) fixing registry-client.ts/update-checker.ts during Task 5 verification

## Task 5 Verification (checkpoint APPROVED)

Verified live by the developer against a real Docker Hub registry and a live Docker daemon, on a `memos` stack with three services (`memos` on the moving tag `stable`, `nginx` on `1.27`, `nginx2` on `1.27.0-alpine`):

- **Detection** — confirmed working after resetting stale pre-fix `ImageUpdateCheck` rows (staggered 6h/N re-check window otherwise protects stale results from a same-day logic change).
- **Badge** — confirmed showing, with a follow-up fix for its layout (was stacked under the image name instead of inline — `c06d9d0`).
- **Selection and persistence** — initially failed ("no version to select from") for `nginx`. Root-caused to two real bugs, both pre-existing in 02-10's registry-client.ts/update-checker.ts, not introduced by this plan: `RegistryClient.listTags()` never followed Registry v2 pagination (nginx has 1297 tags; relevant versions start on page 7 of 13), and once paginated, `selectUpgradeCandidates()`'s shape check was lenient enough to rank OS/flavor tags like `alpine3.24` as a "newer version". Both fixed and verified directly against the live nginx registry (`f200351`). Re-tested by the developer: `nginx` upgraded `1.27` → `1.31.4` successfully, compose file confirmed carrying the new tag, Tag column updated live, status badges stayed live throughout.
- **No-change / moving-tag path** — `memos` (tag `stable`) correctly shows the update-available badge (digest-based), but the dialog showed a misleading "not checked yet" message instead of an accurate "moving tag, no discrete version to pick" message — logged as a follow-up UX todo rather than fixed inline (`2026-08-28-upgrade-dialog-wrong-message-for-moving-tags.md`); "Update Images" is the correct action for a moving tag today.
- **Failure rollback** — not separately exercised; covered by 02-11's existing unit test coverage of the rollback path.

Checkpoint approved by the developer after the `nginx` re-test succeeded.

## Accomplishments

- `getServiceTags()`/`upgradeService()` added to `stacks-api.ts`, both routed through `apiFetch` with `encodeURIComponent`-encoded path segments, typed against the exact response shapes plans 02-10 and 02-11 documented
- `ServiceUpgradeDialog` composes the existing `Dialog`/`Select`/`Label`/`Skeleton`/`Alert` primitives (no new dependency, no edit to `components/ui/`) and fetches candidates exactly once per open — no polling, no refetch on re-render
- Four mutually exclusive render states: loading (skeleton), error (message + working retry), populated (a `Select` defaulting to `latestTag` when present), and two distinct empty-state messages depending on whether `latestTag` is `null` (never checked) or matches the current tag (already newest) — the specific regression the plan's Task 2 named
- The confirm control is disabled while submitting, with no candidate selected, and when the selected tag equals the current tag
- Confirming calls `upgradeService()` inside the same `toast.promise` pattern used throughout `stack-actions.tsx`; the success message distinguishes an applied upgrade (`changed: true`) from a no-change result by reading the response's `changed` field
- The 504-line `[id].tsx` page's services table (plus its inline `ServiceStatusBadge`) was extracted into `client/src/routes/app/stacks/components/services-tab.tsx`, bringing the page down to 397 lines and closing the exact entry named in CLAUDE.md's refactoring-targets table
- `ServicesTab`'s per-row upgrade trigger is disabled (not hidden) with an explanatory `title` while the stack is `BACKING_UP`, `RESTORING`, `DEPLOYING`, `UPDATING`, or `MIGRATING` — the literal complement of the server's `TRANSITIONS.UPDATE` allow-list in `stack-status-machine.ts`, so the client gate never disagrees with `guardTransition()`
- `ServiceStatusBadge` (and its props interface) now lives in `components/domain/stack/service-status-badge.tsx`, its final CLAUDE.md-named location, imported by `services-tab.tsx` as its only consumer
- `service-upgrade-dialog.test.tsx` covers all nine required scenarios against a mocked `stacks-api` module — no direct `fetch` stub anywhere in the test file

## Task Commits

Each completed task was committed atomically:

1. **Task 1: End-to-end version selection for one service** — `350be38` (feat) — includes the state-machine work originally scoped to Task 2 (see Deviations)
2. **Task 2: Make every dialog state distinguishable** — no separate commit; fully satisfied by `350be38` (see Deviations)
3. **Task 3: Block the upgrade action during transitional stack states** — `08244a1` (feat)
4. **Task 4: Component tests and the ServiceStatusBadge extraction** — `1480532` (test)
5. **Task 5: Confirm the full update journey on a live stack** — checkpoint APPROVED after fixing `f200351` (registry pagination + version-shape matching) and `c06d9d0` (badge layout); see "Task 5 Verification" above

**Plan metadata:** committed separately by orchestrator (STATE.md/ROADMAP.md not touched by this executor)

## Files Created/Modified

- `client/src/lib/stacks-api.ts` — `getServiceTags()`, `upgradeService()`, `ServiceTagsResponse`, `UpgradeServiceResponse`
- `client/src/routes/app/stacks/components/service-upgrade-dialog.tsx` (new) — `ServiceUpgradeDialog`, `ServiceUpgradeDialogProps`
- `client/src/routes/app/stacks/components/services-tab.tsx` (new) — `ServicesTab`, `ServicesTabProps`, `UPGRADE_BLOCKED_STATES`
- `client/src/components/domain/stack/service-status-badge.tsx` (new) — `ServiceStatusBadge`, `ServiceStatusBadgeProps`
- `client/test/unit/routes/stacks/service-upgrade-dialog.test.tsx` (new) — 9 test cases
- `client/src/routes/app/stacks/[id].tsx` — now composes `<ServicesTab>` instead of defining the table and badge inline; unused `FileText`/`Table*` imports for the moved table were cleaned up (the `Table` family remains, still used by the Deployments card)

## Decisions Made

See `key-decisions` in frontmatter: the badge-move sequencing to avoid a circular import between `[id].tsx` and `services-tab.tsx`; combining Task 1 and Task 2's dialog state work into one commit; calling `onOpenChange`/`onUpgraded` only on the success path (matching the codebase's existing `toast.promise` convention rather than the plan's literal "on settle" phrasing); and the `ArrowUpCircle` icon choice.

## Deviations from Plan

### Organizational (no code change required)

**1. Task 2's acceptance criteria were already satisfied by Task 1's commit**
- **What happened:** The plan splits "basic dialog" (Task 1) from "make every state distinguishable" (Task 2) as separate tasks with separate commits. This executor designed `ServiceUpgradeDialog`'s full state machine — four mutually exclusive render branches, three confirm-disable conditions, `DialogTitle`/`DialogDescription`, labeled `Select` — in a single pass during Task 1, since writing a deliberately incomplete first version and then reworking it in Task 2 would have produced a larger total diff and a less coherent component history.
- **Verification:** All of Task 2's acceptance criteria (`grep -c "DialogTitle\|DialogDescription"` returns 5, ≥2 required; four distinguishable branches confirmed by reading the committed file; the three disable conditions present in `isConfirmDisabled`; `git diff --stat client/src/components/ui/` empty) pass against commit `350be38` without any further change.
- **Action taken:** No separate Task 2 commit was made, since there was no further diff to commit — an empty commit would violate the "never commit empty" rule. This is documented here instead so the task-to-commit mapping stays traceable.
- **Impact on plan:** None — every acceptance criterion Task 2 lists is met; the only difference is which commit satisfies it.

---

**Total deviations:** 1 organizational (no auto-fix, no architectural change, no scope creep)

## Issues Encountered

None. Both server-side dependencies (02-10's `GET .../tags` and 02-11's `POST .../upgrade`) were already complete and their response shapes matched this plan's expectations exactly — no server-side adjustment was needed.

## User Setup Required

None from this plan. Note that plan 02-10 left an outstanding requirement (already logged in STATE.md's Blockers/Concerns) that `yarn db:push` must run against a real, reachable database before deploy, for the `availableTags` column this plan's dialog reads through `GET .../tags`. That blocker predates this plan and is unaffected by it.

## Next Phase Readiness

- All 5 tasks complete, committed, and verified. Client build/tests green throughout (43/43, no regressions from Tasks 1-4); server build/tests green after the Task 5 registry fixes (369/369).
- Plan 02-12 was the last plan in phase 02's `--gaps-only` gap-closure wave (02-09 through 02-12). All four are now complete — UAT gaps 4 and 5 are closed.
- Several additional real gaps were found during live verification and captured as follow-up todos rather than fixed inline (moving-tag dialog messaging, stale ImageUpdateCheck rows, no manual check-trigger, update-available badge missing at stack level, restic pinned to an old apt version, DooD bind-mount path mismatch, and others found earlier in this same session) — see STATE.md's Pending Todos.

## Self-Check: PASSED

All files created/modified in this plan were verified present on disk, and all three commit hashes (`350be38`, `08244a1`, `1480532`) were verified present in `git log --oneline --all`.

---
*Phase: 02-observability*
*Completed: 2026-08-28*
