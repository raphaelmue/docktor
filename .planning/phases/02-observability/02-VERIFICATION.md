---
phase: 02-observability
verified: 2026-03-16T15:10:00Z
status: human_needed
score: 7/7 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 6/7
  gaps_closed:
    - "Unit test suite passes for FileWatcher (file-watcher.test.ts) — replaceServices mock added, compose-parser/compose-config tests updated to expect throws; 125 tests pass, 2 todo, 0 failures"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Edit a docker-compose.yml via SSH while Docktor is running"
    expected: "Stack card on dashboard shows 'config changed' badge within ~60 seconds without page refresh"
    why_human: "Requires live filesystem interaction and real-time SSE observation"
  - test: "Check stack detail page for a stack whose image has an update available in the registry"
    expected: "Service row shows 'update available' badge; optionally with a tag like '-> 1.26'"
    why_human: "Requires a real registry image with a newer version to be detected"
  - test: "Click 'Update Images' on stack detail page when images are already current"
    expected: "Toast reads 'Images are already up to date'"
    why_human: "Requires live Docker environment to exercise the pull output path"
  - test: "Click 'Update Images' on stack detail page when a newer image exists"
    expected: "Stack enters UPDATING state, pulls images, recreates containers, returns to RUNNING/HEALTHY; toast reads 'Images updated successfully'"
    why_human: "Requires live Docker daemon, real images, and container lifecycle"
---

# Phase 2: Observability Verification Report

**Phase Goal:** Users are passively informed when compose files change externally and when newer container images are available
**Verified:** 2026-03-16T15:10:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure via plan 02-07

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When compose file edited via SSH, "config changed" badge appears without page refresh | VERIFIED | FileWatcher broadcasts `config_changed` SSE; `useStack`/`useStacks` hooks refetch; `stack-list.tsx` renders badge when `stack.configChanged` is true |
| 2 | Stack detail page shows "update available" badge when newer image found | VERIFIED | `GET /api/stacks/:id` augments each service with `updateAvailable` + `latestTag`; `[id].tsx` line 361-365 renders badge |
| 3 | User can trigger pull + recreate from detail page; never automatic | VERIFIED | `POST /api/stacks/:id/update` → `stackService.updateImages()` → `composePull` + `up`; button only enabled when `canUpdate` |
| 4 | Registry polling does not hit Docker Hub rate limits (results cached, checks staggered) | VERIFIED | `getNextImageToCheck()` stagger over 6h window; `upsertImageUpdateCheck` caches results; one image checked per 5-min cron tick |
| 5 | Unit test suite passes (file-watcher.test.ts, compose-parser.test.ts, compose-config.test.ts) | VERIFIED | `npm run test:unit -w server` exits 0; 125 passed, 2 todo, 0 failed (127 total) |
| 6 | All 7 phase requirements have substantive implementation | VERIFIED | FW-01/02/03 + UPD-01/02/03/04 all substantively implemented |
| 7 | Dashboard card shows "config changed" indicator | VERIFIED | `dashboard.tsx` → `StackList` → `stack-list.tsx` renders "config changed" badge when `stack.configChanged` is true |

**Score:** 7/7 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/jobs/file-watcher.ts` | FileWatcher class with chokidar + 60s cron reconcile | VERIFIED | `start()`, `handleFileChange()`, `reconcile()`, `stop()` all implemented |
| `server/src/jobs/update-checker.ts` | UpdateChecker class + compareVersions + normalizeImageRef | VERIFIED | 350 lines; exports `UpdateChecker`, `updateChecker`, `compareVersions`, `normalizeImageRef`, `getNextImageToCheck` |
| `server/src/jobs/index.ts` | startJobs/stopJobs registry | VERIFIED | Registers statePoller, fileWatcher, updateChecker in both start and stop |
| `server/src/lib/state-broadcaster.ts` | Extended StateEvent with ConfigChangedEvent, ConfigErrorEvent, UpdateAvailableEvent | VERIFIED | All 3 new event interfaces exported; `StateEvent` union includes them |
| `server/src/lib/compose-parser.ts` | Throws errors for invalid compose structure | VERIFIED | Throws `"Compose file missing 'services' key"` and `"Compose file has empty services section"` |
| `server/src/repositories/stack-event-repository.ts` | DB queries for StackEvent | VERIFIED | `createEvent()` and `findRecentByStack()` implemented against `prisma.stackEvent` |
| `server/src/repositories/image-update-check-repository.ts` | DB queries for ImageUpdateCheck | VERIFIED | `upsert()`, `findByImageRef()`, `findDueForCheck()`, `findByImageRefs()` all implemented |
| `server/src/infrastructure/docker-executor.ts` | manifestInspect() with diagnostic logging; composePull returns stdout | VERIFIED | `manifestInspect` logs `err.stderr` on non-404 errors (line 114); `composePull` returns `Promise<string>` (line 66) |
| `server/prisma/schema/stack-event.prisma` | StackEvent model + StackEventType enum | VERIFIED | Enum: `config_changed`, `config_error`, `update_available`; model with stackId, type, message, payload, createdAt |
| `server/prisma/schema/image-update-check.prisma` | ImageUpdateCheck model | VERIFIED | imageRef (unique), lastCheckedAt, latestTag, latestDigest, currentDigest, hasUpdate, checkError |
| `server/src/application/stack-service.ts` | updateImages returns `{noUpdates: boolean}` | VERIFIED | Line 189: `Promise<{noUpdates: boolean}>`; noUpdates at lines 224-226 |
| `server/src/routes/stacks.ts` | POST /api/stacks/:id/update returns `{success, noUpdates}` | VERIFIED | Line 95: `{success: true, noUpdates: result.noUpdates}` |
| `client/src/lib/stacks-api.ts` | updateImages typed to return `{success, noUpdates}` | VERIFIED | Line 108: `apiFetch<{success: boolean; noUpdates: boolean}>` |
| `client/src/routes/app/stacks/[id].tsx` | Contextual toast for Update Images; update available badge; config changed alert | VERIFIED | Lines 288-292: toast.info "already up to date" / toast.success "Images updated successfully"; badge at 361-365; alert at 306-314 |
| `client/src/routes/app/dashboard.tsx` | Config changed indicator on stack cards | VERIFIED | Delegates to `StackList`; badge rendered when `stack.configChanged` is true |
| `server/test/unit/jobs/file-watcher.test.ts` | Unit tests with replaceServices mock + createComposeConfig mock | VERIFIED | Line 38: `replaceServices: vi.fn().mockResolvedValue(undefined)`; line 27: `createComposeConfig` vi.mock block; all tests pass |
| `server/test/unit/lib/compose-parser.test.ts` | Tests assert throws for missing/empty services | VERIFIED | Lines 40, 44: two `toThrow("Compose file missing 'services' key")` assertions |
| `server/test/unit/domain/compose-config.test.ts` | Tests assert throws for invalid content | VERIFIED | Lines 53, 57: two `toThrow("Compose file missing 'services' key")` assertions |
| `server/test/unit/jobs/update-checker.test.ts` | Unit tests for UPD-01/02/04 | VERIFIED | 139 lines; 18 tests pass |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `file-watcher.ts` | `state-broadcaster.ts` | `stateEventBroadcaster.publish()` | WIRED | Line 153: `config_error` broadcast; line 172: `config_changed` broadcast |
| `jobs/index.ts` | `app.ts` | `startJobs()` in onReady hook | WIRED | `app.ts` line 14 imports `startJobs, stopJobs`; line 74 calls `await startJobs()` |
| `update-checker.ts` | `image-update-check-repository.ts` | `upsert()` after each check | WIRED | Line 293: `await repo.upsertImageUpdateCheck(...)` after every successful or failed check |
| `update-checker.ts` | `docker-executor.ts` | `manifestInspect()` for digest comparison | WIRED | Line 263: `await this.docker.manifestInspect(imageRef)` in `checkImage()` |
| `stack-service.ts` | `docker-executor.ts` | `composePull` returns stdout string | WIRED | `composePull(id)` captured into `pullOutput`; `noUpdates` derived from content |
| `routes/stacks.ts` | `client/stacks-api.ts` | POST /update returns `{success, noUpdates}` | WIRED | Route line 95; client line 108 types the response correctly |
| `[id].tsx` | `POST /api/stacks/:id/update` | fetch on Update button click | WIRED | `updateImages(id)` in `stacks-api.ts` line 108; called from button onClick line 284 |
| `[id].tsx` | `useContainerEvents` SSE hook | handles `config_changed`/`update_available` | WIRED | Via `use-stack.ts` lines 53-58; both event types trigger refetch |
| `file-watcher.test.ts` | `file-watcher.ts FileWatcherRepo` interface | mock includes replaceServices | WIRED | Line 38: `replaceServices: vi.fn().mockResolvedValue(undefined)` — mock now matches production interface |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| FW-01 | 02-01, 02-03 | Background process watches `/stacks/*/docker-compose.yml` for changes using chokidar | SATISFIED | `file-watcher.ts` uses chokidar with depth:2, ignoring non-compose files; unit tests pass |
| FW-02 | 02-01, 02-02, 02-03, 02-06 | When compose file changes, stack re-hashed, DB updated, flagged as "config changed" | SATISFIED | `handleFileChange()` calls `hashComposeContent`, `replaceServices`, `updateStackHash`, `createStackEvent({type:"config_changed"})`, broadcasts SSE |
| FW-03 | 02-01, 02-02, 02-03 | 60s polling fallback re-hashes all compose files | SATISFIED | `reconcile()` cron scheduled at `*/60 * * * * *`; reconcile tests pass with createComposeConfig mock |
| UPD-01 | 02-01, 02-04 | Background job polls Docker registries for newer image versions (semver, date-tag, or digest) | SATISFIED | `compareVersions()`: date tag → semver → digest fallback; `checkImage()` runs per cron tick |
| UPD-02 | 02-01, 02-02, 02-04 | Update checks rate-limit safe: results cached, checks staggered | SATISFIED | `getNextImageToCheck()` stagger logic; `CHECK_INTERVAL_MS = 6h`; results written to `ImageUpdateCheck` table |
| UPD-03 | 02-05 | Stack detail page shows "update available" badge when newer images found | SATISFIED | GET /api/stacks/:id adds `updateAvailable`+`latestTag` per service; `[id].tsx` renders badge |
| UPD-04 | 02-01, 02-04, 02-05 | User can trigger update (pull + recreate) from detail page — never automatic | SATISFIED | POST /api/stacks/:id/update → `stackService.updateImages()` → `composePull` + `up`; result carries `noUpdates`; client shows contextual toast |

**All 7 requirements (FW-01, FW-02, FW-03, UPD-01, UPD-02, UPD-03, UPD-04) satisfied. No orphaned requirements.**

---

## Anti-Patterns Found

None. No TODO/FIXME/placeholder patterns found in production or test files modified by plans 02-01 through 02-07. The previously identified test mock gap (missing `replaceServices`) was resolved by plan 02-07.

---

## Human Verification Required

### 1. Compose File Change Detection (FW-01/FW-02)

**Test:** While Docktor is running, SSH into the host and edit `/stacks/<any-stack>/docker-compose.yml` (change an image tag or add a comment)
**Expected:** Within approximately 1 second (chokidar event) or at most 60 seconds (reconcile fallback), the stack card on the dashboard shows the "config changed" badge without a page refresh. The stack detail page shows the config changed alert.
**Why human:** Requires live filesystem and Docker environment; SSE propagation cannot be verified statically

### 2. Image Update Available Badge (UPD-03)

**Test:** Use a stack with a real image that has an available update (e.g., pin to an older tag, verify newer exists). Wait for UpdateChecker to detect it (or trigger `checkNextImage()` manually).
**Expected:** The service row in the stack detail page shows a blue "update available -> X.Y.Z" badge
**Why human:** Requires real registry interaction and a genuinely outdated image; registry state cannot be verified statically

### 3. Update Images — Already Up To Date Toast (UPD-04)

**Test:** From the stack detail page, click "Update Images" when all images are already current
**Expected:** Toast displays "Images are already up to date"
**Why human:** Requires live Docker daemon to produce the `docker compose pull` stdout output containing "up to date"; the branch logic cannot be exercised statically

### 4. Update Images — Successful Pull Toast (UPD-04)

**Test:** From the stack detail page, click "Update Images" when at least one newer image exists
**Expected:** Stack transitions to UPDATING state in the UI, images are pulled, containers recreated, stack returns to RUNNING or HEALTHY. Toast reads "Images updated successfully". Update was not automatic — it only fires on click.
**Why human:** Requires live Docker daemon, real images, container lifecycle, and a genuinely newer image in the registry

---

## Re-verification Summary

**Previous status:** gaps_found (6/7)
**Current status:** human_needed (7/7 automated checks pass)

### Gap Closed

The sole gap from the initial verification — the `FileWatcherRepo` mock divergence in `file-watcher.test.ts` — has been fully resolved by plan 02-07:

- `replaceServices: vi.fn().mockResolvedValue(undefined)` added to `createMockFileWatcherRepo()` (line 38)
- `createComposeConfig` vi.mock block added so reconcile-path tests control compose parsing output (line 27)
- `compose-parser.test.ts` two tests updated to assert `toThrow` (lines 40, 44)
- `compose-config.test.ts` two tests updated to assert `toThrow` (lines 53, 57)

**Test result:** `npm run test:unit -w server` exits 0 — 125 passed, 2 todo, 0 failed (127 total).

### Plan 02-07 Additions (beyond gap closure)

Beyond fixing the test gap, plan 02-07 delivered:

- `composePull` now returns `Promise<string>` (stdout) instead of `Promise<void>`
- `updateImages` returns `{noUpdates: boolean}` derived from pull stdout content
- `POST /api/stacks/:id/update` response includes `{success: true, noUpdates}`
- Client `updateImages()` typed to receive `{success, noUpdates}`
- Update Images button uses a custom inline handler that shows a contextual toast: "Images are already up to date" vs "Images updated successfully"
- `manifestInspect` error logging improved: non-404 errors now log `err.stderr` alongside `err.message`

### No Regressions

TypeScript build is clean (no output from `npm run build -w server 2>&1 | grep -iE "error"`). All 125 previously passing tests continue to pass.

---

_Verified: 2026-03-16T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
