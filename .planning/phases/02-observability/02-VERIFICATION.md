---
phase: 02-observability
verified: 2026-08-30T16:20:25Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 7/7
  gaps_closed:
    - "G-02-11: bulk 'Update Images' toast now derived from local image digests before/after pull (server/src/domain/image-update-detection.ts), not pull-output text scraping — resolved 02-13-PLAN.md"
    - "G-02-12: config_changed/update_available SSE refresh no longer remounts the stack detail page (client/src/hooks/use-stack.ts loading/isRefreshing split) — resolved 02-14-PLAN.md"
    - "G-02-12b: config-changed toast and detail-page Alert now render in yellow, matching the stack-list badge — resolved directly in commit 1f49d8c"
    - "G-02-16: StackEvent audit trail (config_changed/config_error/update_available) is now readable via GET /api/stacks/:id/events and rendered in a new Event Log card, separate from the Status Log — resolved 02-15-PLAN.md, 02-16-PLAN.md"
  gaps_remaining: []
  regressions: []
---

# Phase 2: Observability Verification Report

**Phase Goal:** Users are passively informed when compose files change externally and when newer container images are available
**Verified:** 2026-08-30T16:20:25Z
**Status:** passed
**Re-verification:** Yes — full fresh goal-backward verification against the grown 16-plan scope (previous VERIFICATION.md from 2026-03-16 covered only the original 5-plan scope and is superseded by this report)

## Context

The phase grew from an original 5-plan scope (02-01 through 02-05) to 16 plans through two
rounds of gap closure: plans 02-06 through 02-12 closed gaps found in a first UAT pass (compose
service-sync, digest-comparison edge cases, registry tag discovery, per-service upgrade dialog);
plans 02-13 through 02-16 closed four further gaps (G-02-11, G-02-12/12b, G-02-16) found in a
second, more thorough UAT pass conducted 2026-08-28 through 2026-08-30 (`02-UAT.md`: 16/18 passed,
2 skipped for reasons unrelated to this phase's scope — see below). This report verifies the
actual, current state of all 16 plans' output against the codebase, not the SUMMARY.md narrative.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When a compose file is edited via SSH while Docktor is running, the stack's "config changed" badge appears without the user refreshing the page | ✓ VERIFIED | `file-watcher.ts` chokidar watcher (line 102) + 60s cron reconcile (line 142) detect the change, hash-compare, call `syncServicesFromCompose`, write a `config_changed` `StackEvent` via `createFileWatcherRepo`, and broadcast SSE. Client: `use-stack.ts` and `use-stacks.ts` handle `config_changed` via background refresh (`isRefreshing`, not `loading`) — confirmed non-remounting by `client/test/unit/hooks/use-stack.test.ts` ("... never touches loading", single-named-test run: 1 passed). `stack-list.tsx` renders the yellow badge; `[id].tsx:213-221` renders the yellow Alert. UAT test 3/5/12 (live SSH edit, live Windows/Docker-Desktop edit, live SSE without page-reload feel): all pass. |
| 2 | Stack detail page shows an "update available" badge when a newer image version is found in the registry | ✓ VERIFIED | `GET /api/stacks/:id` (routes/stacks.ts:76-84) merges `imageUpdateCheckRepository.findByImageRefs()` results keyed on the canonical `imageRef` into each service (`updateAvailable`, `latestTag`). `services-tab.tsx:81-85` renders the badge from `svc.updateAvailable`/`svc.latestTag`. Full data-flow trace: DB (`ImageUpdateCheck.hasUpdate`) → repository → route merge → API client type → component render, no static/mocked link in the chain. UAT test 6/7/13 (live registry newer-tag detection, genuinely-newer version filtering, SSE badge appearance): all pass. |
| 3 | User can trigger an image pull and container recreate from the stack detail page; the update is never applied automatically | ✓ VERIFIED | `POST /api/stacks/:id/update` and `POST /api/stacks/:id/services/:serviceName/upgrade` are the only call sites of `stackService.updateImages()`/`upgradeServiceImage()` in the entire server source tree (`grep -rnF "updateImages(\|upgradeServiceImage(" server/src` excluding tests returns only `routes/stacks.ts`) — no job, cron, or background code path calls either method. Both routes sit behind the plugin-wide `app.addHook("onRequest", requireAuth)` (stacks.ts:40). Client: "Update Images" button and the per-service upgrade dialog fire only on explicit click (`stack-actions.tsx`, `service-upgrade-dialog.tsx`). UAT test 8/10/11 (live pull+recreate, upgrade blocked during transitional states, contextual toast): all pass. |
| 4 | Registry polling does not hit Docker Hub rate limits during normal operation (results cached, checks staggered) | ✓ VERIFIED | `CHECK_INTERVAL_MS = 6h`; `getNextImageToCheck()` divides the 6h window by image count and selects only the oldest-checked image past its stagger cutoff, one per 5-minute cron tick (`update-checker.ts:16,204-221,342-375`). Results persisted via `imageUpdateCheckRepository.upsert()` and read by the UI without any registry round trip. Tag discovery (RegistryClient) explicitly runs only inside this same staggered check, never per page load (02-10 prohibition, confirmed: no call site of `registry-client.ts` outside `update-checker.ts`). `docker manifest inspect`/local digest lookups never use `docker pull`. |

**Score:** 4/4 roadmap Success Criteria verified

### Additional Must-Have Truths (from gap-closure plan frontmatter, most-recent/highest-risk)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 5 | Clicking Update Images when all images are already newest reports "nothing updated" instead of always claiming success (G-02-11) | ✓ VERIFIED | `detectNoUpdates()` (domain/image-update-detection.ts) returns true only when every service's local digest is unchanged before/after pull — pure, no I/O. `stack-service.ts:253-328` wires before/after `snapshotDigests()` around `composePull`+`up`. Behavioral test run singly: `"reports noUpdates: true when every service's local image digest is unchanged..."` — 1 passed. |
| 6 | A compose file that cannot be read/parsed still completes Update Images and never strands the stack in UPDATING (G-02-11) | ✓ VERIFIED | `collectImageRefs()` catches read/parse failure and degrades to an empty ref list (never throws before the UPDATING transition); the post-pull sync/transition block is wrapped in its own try/catch that transitions to ERROR on failure rather than leaving UPDATING unresolved (`stack-service.ts:292-313`). |
| 7 | Editing a compose file while the stack detail page is open updates the page in place without remounting (G-02-12) | ✓ VERIFIED | `use-stack.ts` splits `loading` (initial only) from `isRefreshing` (SSE-triggered background fetch); `[id].tsx:62` gates the full-page placeholder on `loading && !stack`. Behavioral test run singly: `"...never touches loading"` — 1 passed. UAT test 12: pass. |
| 8 | config_changed, config_error and update_available events are readable per stack over HTTP, newest first, and require auth (G-02-16) | ✓ VERIFIED | `GET /api/stacks/:id/events` (routes/stacks.ts:209-215) → `stackService.getStackEvents()` → `stackEventRepository.findRecentByStack()`; route sits under the same `requireAuth` `onRequest` hook as the rest of the plugin; a nonexistent stack id raises `NotFoundError` via `repo.findByIdOrThrow()` (stack-service.ts:87) before the events query runs. |
| 9 | StackEvent rows are written through one repository, not two competing write paths (G-02-16) | ✓ VERIFIED | The old ad-hoc `StackRepository.createStackEvent()` (with its `as any` enum cast) no longer exists in `stack-repository.ts` (grep returns zero matches). `FileWatcher` now writes exclusively through `createFileWatcherRepo(stackRepository, stackEventRepository)` → `stackEventRepository.createEvent()` (file-watcher.ts:45-58). |
| 10 | Config-changed and config-error events are visible in a new Event Log card, separate from the Status Log card (G-02-16) | ✓ VERIFIED | `[id].tsx` imports and renders both `<StatusLogCard statusLogs={stack.statusLogs}/>` and `<EventLogCard stackId={id}/>` as two distinct `CardTitle`s (`role="heading" aria-level={2}`, confirmed in 02-UI-REVIEW.md's audit). `event-log-card.tsx` maps all three `StackEventType` values to distinct labels/badges via `describeStackEvent()`. UAT test 16: pass. |
| 11 | The config-changed toast and detail-page alert render in yellow, matching the stack-list badge (G-02-12b) | ✓ VERIFIED | `use-stack.ts:78-80` — `toast.warning(...)` with `!bg-yellow-100 !text-yellow-800 dark:!bg-yellow-900 dark:!text-yellow-200`; `[id].tsx:214` — `Alert className="bg-yellow-100 text-yellow-800 ... dark:bg-yellow-900 dark:text-yellow-200 ..."`. UAT test 12 retest (`34dbc12`): pass. |

**Score:** 11/11 must-haves verified (4 roadmap Success Criteria + 7 highest-risk gap-closure truths spot-checked at code+test level)

---

### Required Artifacts (representative sample across all 16 plans)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/jobs/file-watcher.ts` | chokidar watch + 60s cron reconcile + typed FileWatcherRepo with single StackEvent write path | ✓ VERIFIED | 251+ lines; `createFileWatcherRepo()` factory composes `StackRepository` + `StackEventRepository`; no dead `as any` cast |
| `server/src/jobs/update-checker.ts` | UpdateChecker + compareVersions + normalizeImageRef + stagger logic | ✓ VERIFIED | `CHECK_INTERVAL_MS`, `getNextImageToCheck()`, cron `*/5 * * * *`, semver→date→digest fallback all present |
| `server/src/infrastructure/registry-client.ts` | RegistryClient.listTags() with WWW-Authenticate bearer negotiation | ✓ VERIFIED | Exists, unit-tested (`registry-client.test.ts`), no call site outside `update-checker.ts` |
| `server/src/domain/image-update-detection.ts` | Pure digest-comparison logic, no I/O | ✓ VERIFIED | 72 lines, zero imports from repositories/infrastructure/jobs; 100% branch coverage per server coverage report |
| `server/src/lib/compose-editor.ts` | Format-preserving YAML edit for version upgrades | ✓ VERIFIED | Referenced and exercised by `upgradeServiceImage()`; unit-tested |
| `server/src/routes/stacks.ts` | POST /update, POST /:id/services/:serviceName/upgrade, GET /:id/services/:serviceName/tags, GET /:id/events | ✓ VERIFIED | All four routes present, all under `requireAuth`, all delegate to `stackService` |
| `server/src/repositories/stack-event-repository.ts` | Single write/read path for StackEvent | ✓ VERIFIED | `createEvent()`/`findRecentByStack()`; now the only writer (dead-code status from earlier UAT gap resolved) |
| `server/src/repositories/image-update-check-repository.ts` | upsert/find/findDueForCheck/findByImageRefs | ✓ VERIFIED | All four present and called from update-checker.ts / routes/stacks.ts |
| `client/src/hooks/use-stack.ts` | initial vs. background-refresh split | ✓ VERIFIED | `loading`/`isRefreshing` states independently gated; toast.warning yellow styling present |
| `client/src/hooks/use-stack-events.ts` | Dedicated hook for the Event Log card, mirroring use-stack's split | ✓ VERIFIED | Same initial/background pattern; SSE-triggered background refresh on all three event types |
| `client/src/routes/app/stacks/components/event-log-card.tsx` | Audit-trail UI section | ✓ VERIFIED | Renders all 3 StackEventType values distinctly; loading/error/empty states present |
| `client/src/routes/app/stacks/components/status-log-card.tsx` | Status transition UI section, extracted from page | ✓ VERIFIED | Extracted per CLAUDE.md page-composition rule |
| `client/src/routes/app/stacks/components/services-tab.tsx` | Services table extracted from page, renders update-available badge | ✓ VERIFIED | Extracted; badge wired to `svc.updateAvailable`/`svc.latestTag` |
| `client/src/routes/app/stacks/components/service-upgrade-dialog.tsx` | Version-selection dialog with 4 distinguishable states | ✓ VERIFIED | loading/populated/two distinct empty states/error — unit-tested (`service-upgrade-dialog.test.tsx`) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `file-watcher.ts` handleFileChange | `stack-event-repository.ts` | `createFileWatcherRepo` adapter → `createEvent()` | ✓ WIRED | Single write path confirmed; old ad-hoc `StackRepository.createStackEvent` removed |
| `jobs/index.ts` | `app.ts` | `startJobs()` in onReady hook | ✓ WIRED | Confirmed present (unchanged from prior verification) |
| `update-checker.ts` checkImage | `registry-client.ts` listTags | Staggered check only | ✓ WIRED | No call site outside the 5-min cron tick |
| `stack-service.ts` updateImages | `image-update-detection.ts` detectNoUpdates | before/after digest comparison | ✓ WIRED | Behavioral test passes singly |
| `routes/stacks.ts` GET /:id/events | `stack-service.ts` getStackEvents | direct method call, no Prisma in route | ✓ WIRED | Confirmed no `prisma`/repository import used by this specific handler |
| `[id].tsx` | `EventLogCard` / `StatusLogCard` | component composition | ✓ WIRED | Both rendered as visually distinct, separately-headed cards |
| `use-stack-events.ts` | `GET /api/stacks/:id/events` | `getStackEvents()` API client call | ✓ WIRED | `stacks-api.ts` exports typed `getStackEvents()`, called from the hook |
| `services-tab.tsx` | `POST /:id/services/:serviceName/upgrade` | `ServiceUpgradeDialog` → `upgradeService()` | ✓ WIRED | Confirmed in 02-12 summary and UI-REVIEW.md file audit |
| `routes/stacks.ts` POST /update, POST /upgrade | jobs/cron | *(absence check)* | ✓ WIRED (never-automatic invariant holds) | Zero call sites of `updateImages(`/`upgradeServiceImage(` in `server/src/jobs/**` |

---

### Data-Flow Trace (Level 4)

| Rendered Value | Source | Flows | Status |
|---|---|---|---|
| `svc.updateAvailable` / `svc.latestTag` badge (services-tab.tsx) | `ImageUpdateCheck.hasUpdate`/`latestTag` DB rows | route merges by canonical imageRef → API response → component prop | ✓ FLOWING |
| `stack.configChanged` badge (stack-list.tsx, [id].tsx) | `Stack.configChanged` DB column, set by FileWatcher | repository → route → API → component | ✓ FLOWING |
| Event Log card entries | `StackEvent` table rows | `stackEventRepository.findRecentByStack()` → route → `getStackEvents()` client fn → `useStackEvents` hook | ✓ FLOWING |
| Service version-picker candidates | `ImageUpdateCheck.availableTags` | `decodeUpgradeCandidates()` → `GET /:id/services/:serviceName/tags` → dialog | ✓ FLOWING |

No static/mocked/hardcoded terminus found in any traced chain.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Server unit suite passes fully | `yarn workspace @docktor/server test` | 30 test files, 409 tests passed, 2 todo, 0 failed | ✓ PASS |
| Client unit suite passes fully | `yarn workspace @docktor/client test` | 10 test files, 77 tests passed, 3 todo, 0 failed | ✓ PASS |
| Server TypeScript build is clean | `yarn workspace @docktor/server exec tsc --build --force` | No output (0 errors) | ✓ PASS |
| Client TypeScript build is clean | `yarn workspace @docktor/client exec tsc --build --force` | No output (0 errors) | ✓ PASS |
| G-02-11 noUpdates:true branch behaviorally proven | single named test: `"reports noUpdates: true when every service's local image digest is unchanged..."` | 1 passed | ✓ PASS |
| G-02-12 no-remount invariant behaviorally proven | single named test: `"...a config_changed event sets isRefreshing... never touches loading"` | 1 passed | ✓ PASS |
| updateImages/upgradeServiceImage never called from a background job | `grep -rnF "updateImages(" \| "upgradeServiceImage(" server/src/jobs` | zero matches | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| FW-01 | 01, 03, 05, 06, 08 | Background process watches `/stacks/*/docker-compose.yml` using chokidar | ✓ SATISFIED | `file-watcher.ts` chokidar watcher on stacks root; 24 unit tests; UAT tests 3/5/17 pass |
| FW-02 | 01–03, 05, 06, 08, 14, 15, 16 | Compose change → re-hash, DB update, "config changed" flag | ✓ SATISFIED (server + config-changed UI fully wired; config-error UI is a documented, deliberately out-of-scope deferral — see below) | `handleFileChange()` hashes, syncs services, sets `configChanged`, writes `StackEvent`, broadcasts SSE; badge/alert render on the client. UAT tests 3, 4, 12, 14, 16 pass |
| FW-03 | 01, 03, 08 | 60s polling fallback re-hashes all compose files | ✓ SATISFIED | `reconcile()` cron `*/60 * * * * *`; UAT test 17 pass |
| UPD-01 | 01, 04, 07, 09, 10 | Registry polling: semver/date-tag/digest comparison | ✓ SATISFIED | `compareVersions()` fallback chain; `registry-client.ts` tag discovery; UAT tests 6, 7 pass |
| UPD-02 | 01, 02, 04, 07, 09 | Rate-limit safe: cached, staggered | ✓ SATISFIED | 6h stagger window, one check per 5-min tick, results cached in `ImageUpdateCheck` |
| UPD-03 | 02, 05, 07, 09, 10, 12, 15, 16 | "Update available" badge on stack detail page | ✓ SATISFIED | Service-row badge + version-picker dialog; UAT tests 6, 7, 9, 13 pass |
| UPD-04 | 01, 04, 05, 07, 11, 12, 13 | User-triggered pull+recreate / per-service upgrade — never automatic | ✓ SATISFIED | Absence-check confirms no background caller; contextual toast (G-02-11 fix); UAT tests 8, 9, 10, 11 pass |

**All 7 requirements (FW-01, FW-02, FW-03, UPD-01, UPD-02, UPD-03, UPD-04) satisfied. No orphaned requirements** — REQUIREMENTS.md maps exactly these 7 IDs to Phase 2, and each is claimed by at least one plan's frontmatter `requirements` field.

**Note on FW-02 scope boundary:** The roadmap's literal FW-02 wording ("stack flagged as 'config changed'") and the phase's own success criteria only require the `config_changed` badge to be visible — which is fully implemented and UAT-confirmed (tests 3, 12, 14). A related but distinct capability — a client-side visual indicator for `config_error` (invalid compose YAML) — has no UI representation (only an Event Log row). This is a real, tracked gap (`.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md`, also flagged in `02-UI-REVIEW.md` as the top priority fix), but plan 02-16 explicitly and deliberately excluded it from this phase's scope ("Must not add a config error badge, alert or error state to the stack header or status area — that is a separately tracked deferred item and is not in this plan's scope"), and it does not appear in any must_haves truth across all 16 plans or in any roadmap Success Criterion. Treated here as an intentionally deferred item, not a phase-blocking gap.

---

### Anti-Patterns Found

No unresolved debt markers (TBD/FIXME/XXX) in any file modified across the 16 plans. No stub returns, no hardcoded empty data flowing to render, no console.log-only implementations found in the artifacts checked.

Three **Warning-level** (non-blocking) architecture/hygiene issues were identified by the phase's own code review (`02-REVIEW.md`, status: `issues_found`, explicitly "No critical/security-blocking defects were found") and remain unresolved as of this verification:

| File | Issue | Severity | Impact |
|------|-------|----------|--------|
| `server/src/routes/stacks.ts` (GET /:id, GET /:id/services/:serviceName/tags, GET /:id/logs) | Routes call `imageUpdateCheckRepository`/`prisma` directly instead of going through `StackService`, violating CLAUDE.md's routes-only-call-services rule | ⚠️ Warning | Maintainability/layering debt; does not affect observable correctness — the merge logic is correct and tested via UAT/data-flow trace above |
| `server/package.json` | `semver` is used directly (`update-checker.ts`) but not declared as a direct dependency — currently resolves only as a phantom transitive dependency | ⚠️ Warning | Latent breakage risk if the transitive provider changes or the project moves to Yarn PnP; does not affect current runtime behavior (confirmed working via passing tests) |
| `server/src/jobs/update-checker.ts:483-504` | `triggerUpdate()` is unreachable dead code that broadcasts an `"update_error"` event type outside the declared `StateEvent` union via an unexplained `as any` cast | ℹ️ Info | No production caller exists; nothing consumes the malformed event; zero observable impact |

These are recorded for follow-up but do not block the phase goal — none of them are referenced by any must_haves truth, key_link, or prohibition in the 16 plans, and the phase's own security audit (`02-SECURITY.md`) independently confirms `threats_open: 0` across 53 identified threats.

---

### Human Verification Required

None outstanding. All live-environment behaviors (SSH compose edits, live registry newer-tag detection, real Docker pull/recreate, SSE propagation without page-reload feel, per-service upgrade against a real stack) were already exercised by a human tester and recorded in `02-UAT.md` (16/18 tests passed; the 2 skips — "UpdateChecker on a stopped/error stack" for lack of a test fixture, and "config_error UI indication" as a knowingly out-of-scope deferred item — are not roadmap Success Criteria and do not block this verification). This report's independent code/test verification corroborates every one of those UAT results rather than merely trusting them.

### Gaps Summary

None. All 4 roadmap Success Criteria and all 7 phase requirements (FW-01/02/03, UPD-01/02/03/04) are backed by wired, tested, and (for the highest-risk behavior-dependent truths) behaviorally-proven code. Both server (409/409) and client (77/77) unit test suites pass; both TypeScript builds are clean; the phase's own retrospective security audit found 0 open threats across 53 identified. The one client-visible feature gap (`config_error` has no UI indicator) is real but explicitly out of this phase's declared scope per its own gap-closure plan's prohibitions, and is already tracked as a standalone todo for separate follow-up work.

---

_Verified: 2026-08-30T16:20:25Z_
_Verifier: Claude (gsd-verifier)_
