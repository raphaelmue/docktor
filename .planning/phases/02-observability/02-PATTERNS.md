# Phase 2: Observability (Gap Closure) - Pattern Map

**Mapped:** 2026-08-27
**Mode:** gap_closure — 6 diagnosed UAT gaps
**Files analyzed:** 4 primary artifacts + 1 unscoped UX gap
**Analogs found:** 4 / 4 (all analogs are the file's own sibling methods / existing conventions already in the same codebase — no need to reach outside these modules)

---

## File Classification

| File (from UAT gap) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `server/src/jobs/file-watcher.ts` (`handleFileChange`) | job / event handler | event-driven | `server/src/application/stack-service.ts` (`deployStack`, `updateImages` — both call `createComposeConfig()` + `repo.replaceServices()` after a successful compose read) | exact — same repo, same domain helper, same sequencing |
| `server/src/lib/compose-parser.ts` (`parseComposeContent`) | utility / parser | transform | itself — `throw new Error(...)` already used for missing `services` key (lines 52-54); only the "invalid/non-object services" case needs the same treatment applied consistently | exact — extend existing throw convention |
| `server/src/infrastructure/docker-executor.ts` (`manifestInspect`) | infrastructure adapter | request-response (shell-out) | itself — `ps()` and `composePull()` in the same file for stdout/stderr capture conventions; `console.warn`/`console.error` diagnostic pattern already partially present at lines 100-116 | exact — extend existing logging, no new pattern needed |
| `server/src/jobs/update-checker.ts` (`checkImage` error message) | job / service | event-driven | itself — `checkNextImage()`'s `console.log` template literal style (`` `[UpdateChecker] ...` ``) already used throughout the file | exact — mirror existing log message format |
| `client/src/routes/app/stacks/components/stack-actions.tsx` (`handleUpdateImages`) | component (action handler) | request-response | itself — `toast.promise` pattern already used for all other actions (deploy/stop/restart/backup); `noUpdates` feedback is **already implemented** at lines 82-96 | n/a — no code change needed for "up to date" feedback; only the version-selection/compose-rewrite ask is new scope |

---

## Pattern Assignments

### Gap 1 — `server/src/jobs/file-watcher.ts`: missing `replaceServices()` call (FW-02 regression)

**Root cause (from UAT):** `handleFileChange()` parses the compose content for *validation only* and discards the result. It updates `Stack.lastKnownHash` and creates a `config_changed` `StackEvent`, but never calls `stackRepository.replaceServices()`, so `Service` rows (image, imageTag, ports, volumes) never reflect the edited compose file.

**Current code** (`server/src/jobs/file-watcher.ts` lines 142-178) — note the explicit comment justifying the omission, which the UAT session found to be the wrong tradeoff for this gap:
```typescript
// Try to parse the compose content
try {
    parseComposeContent(content)
} catch (err: any) {
    // Invalid YAML or no services key
    ...
    return
}

// Valid compose file with changed hash — update hash, set configChanged flag and broadcast
// NOTE: We do NOT call replaceServices() here because that would update the service records
// to show the new image versions before deployment. The service records should reflect
// what's currently running, not what's in the compose file. replaceServices() is called
// during deployment when the stack is actually updated.
await repo.updateStackHash({stackId: stack.id, hash: newHash})
await repo.createStackEvent({...})
this.broadcaster.publish({type: "config_changed", stackId: stack.id, newHash})
```

**Analog to copy from** — `server/src/application/stack-service.ts` (`deployStack`, lines 128-141) and `updateImages` (lines 224-227), both of which use the exact `createComposeConfig()` → `repo.replaceServices()` sequence that `FileWatcher` is missing:
```typescript
const composeContent = await this.fs.readCompose(id);
const composeConfig = createComposeConfig(composeContent);

await this.repo.recordDeployment({...});

if (success) {
    // Update service records to match the deployed compose file
    await this.repo.replaceServices(id, composeConfig);
    ...
}
```

**Fix pattern for `FileWatcher.handleFileChange()`:** replace the bare `parseComposeContent(content)` validation call with `createComposeConfig(content)` (already imported at line 8 of `file-watcher.ts`), and call `repo.replaceServices(stack.id, composeConfig)` before/alongside `updateStackHash`. `FileWatcherRepo.replaceServices(stackId, composeConfig)` already exists in the interface (line 15) and delegates to `StackRepository.replaceServices` (`server/src/repositories/stack-repository.ts` lines 105-128, transactional `deleteMany` + `createMany` + `stack.update`). This directly satisfies CONTEXT.md's decision ("extract all information and update the stack / service" per UAT gap reason) — external edits should sync service metadata the same way a deploy does.

**Test analog:** `server/test/unit/jobs/file-watcher.test.ts` already mocks `mockRepo.replaceServices` (line 38) and `createComposeConfig` (lines 26-31) — the test scaffolding for asserting `replaceServices` was called already exists; the assertion itself is presumably the new/updated test to add.

---

### Gap 2 — `server/src/lib/compose-parser.ts`: silent failure on missing/invalid services key

**Root cause (from UAT):** Diagnosed as `parseComposeContent()` returning `[]` instead of throwing. **Current state check:** the file at `server/src/lib/compose-parser.ts` (lines 49-57) already throws for both missing `services` key and empty `services` object:
```typescript
export function parseComposeContent(content: string): ParsedService[] {
    const doc = parseYaml(content);
    const svcMap = doc?.services;
    if (!svcMap || typeof svcMap !== "object") {
        throw new Error("Compose file missing 'services' key");
    }
    if (Object.keys(svcMap).length === 0) {
        throw new Error("Compose file has empty services section");
    }
    ...
}
```
This suggests the throw-based fix was already applied after the gap was diagnosed (or partially). **Verify during planning** whether this still reproduces; if a residual case exists (e.g., `services` present but not a plain object such as an array, or a YAML parse exception from `parseYaml` itself not being caught anywhere upstream), apply the same `throw new Error(...)` convention already established in this function — do not introduce a different error-handling style (no custom error classes here; `FileWatcher.handleFileChange` already catches `Error` generically via `err.message`, lines 145-158).

**Analog for message format:** the two existing throw statements are the pattern to replicate for any additional validation case — short, descriptive, prefixed with "Compose file ...".

**Downstream consumer pattern** (already correct, no change needed) — `server/src/jobs/file-watcher.ts` lines 143-159:
```typescript
try {
    parseComposeContent(content)  // becomes createComposeConfig(content) per Gap 1 fix
} catch (err: any) {
    console.log(`[FileWatcher] Config error for ${stack.id}: ${err.message}`)
    await repo.createStackEvent({stackId: stack.id, type: "config_error", message: err.message})
    this.broadcaster.publish({type: "config_error", stackId: stack.id, message: err.message})
    return
}
```
Note: after the Gap 1 fix swaps `parseComposeContent` for `createComposeConfig`, this catch block still works unchanged since `createComposeConfig` calls `parseComposeContent` internally (`server/src/domain/compose-config.ts` line 12) and will propagate the same thrown `Error`.

**Out of scope note (per UAT `missing` field):** "restrictions such as network or volumes must be all in the volumes/ directory" are user expectations without corresponding requirements in CONTEXT.md/RESEARCH.md — do not implement without a new decision; flag as a deferred idea if raised again.

---

### Gap 3 — `server/src/jobs/file-watcher.ts`: Windows `usePolling` (FW-03 / SSE gap on Windows)

**Current state check:** `server/src/jobs/file-watcher.ts` lines 44-66 **already implements** `process.platform === "win32"` detection and sets `usePolling: isWindows, interval: isWindows ? 1000 : undefined`:
```typescript
const isWindows = process.platform === "win32"
if (isWindows) {
    console.log(`[FileWatcher] Windows detected: enabling polling mode (interval: 1000ms)`)
}

this.watcher = watch(stacksRoot, {
    ignoreInitial: true,
    awaitWriteFinish: {stabilityThreshold: 1000, pollInterval: 100},
    depth: 2,
    ignored: (filePath, stats) => { ... },
    usePolling: isWindows,
    interval: isWindows ? 1000 : undefined,
})
```
This matches RESEARCH.md's anti-pattern guidance ("Don't use `usePolling: true` globally... let native events work, use platform detection instead"). **This fix appears to already be present in the codebase** — the planner should verify via a fresh UAT re-test rather than re-implementing; if the polling interval (1000ms) is still too slow for "instant" detection expectations, the analog to adjust is the same `interval` value and `awaitWriteFinish.stabilityThreshold` (currently 1000ms, contributing additional latency on top of the poll interval). No new analog file needed — this is a tuning change within the same block.

---

### Gap 4 — `server/src/infrastructure/docker-executor.ts` + `server/src/jobs/update-checker.ts`: insufficient diagnostic logging for `manifestInspect` failures

**Root cause (from UAT):** `manifestInspect()` returns `null` on "no such manifest"/"not found" without enough detail to diagnose which `imageRef` is bad or why; `UpdateChecker.checkImage()`'s stored `checkError` doesn't surface the failing `imageRef` distinctly from the generic message.

**Current state check:** `server/src/infrastructure/docker-executor.ts` lines 100-116 **already has** `console.warn`/`console.error` calls including `imageRef` and `err.stderr`:
```typescript
if (!digest) {
    console.warn(`[DockerExecutor] manifestInspect: No digest found for ${imageRef}. Manifest keys: ${Object.keys(manifest).join(', ')}`);
}
return {digest, latestTag: null};
} catch (err: any) {
    if (err.stderr?.includes("no such manifest") || err.stderr?.includes("not found")) {
        console.warn(`[DockerExecutor] manifestInspect: Image not found in registry: ${imageRef}. stderr: ${err.stderr}`);
        return null;
    }
    console.error(`[DockerExecutor] manifestInspect failed for ${imageRef}:`, err.message, err.stderr ?? "");
    throw err;
}
```
And `server/src/jobs/update-checker.ts` line 280 already includes the `imageRef` in its warning:
```typescript
console.warn(`[UpdateChecker] manifestInspect returned null for ${imageRef} - image not found in registry or invalid imageRef`)
await repo.upsertImageUpdateCheck({
    imageRef,
    lastCheckedAt: new Date(),
    hasUpdate: false,
    checkError: `Image not found in registry: ${imageRef}`,
})
```
**This also appears already fixed** relative to the gap description. Root cause per UAT test 11 is more likely a **behavioral** bug, not a **logging** bug: `manifestInspect` returns `null` whenever Docker CLI reports "no such manifest"/"not found" — this happens for perfectly valid public images too (e.g., rate limiting text varies, or the image reference built by `normalizeImageRef`/`findAllImageRefs` doesn't match what `docker manifest inspect` expects, e.g. missing registry namespace or bad tag reconstruction). Analog for correct imageRef reconstruction: `update-checker.ts` lines 165-172 (`findAllImageRefs`) builds `imageRef` as `` `${image}:${imageTag}` `` then runs it through `normalizeImageRef`; if `image` already contains a tag or `imageTag` is malformed, `manifestInspect` will legitimately fail. Planner should treat this as needing an actual behavior investigation (e.g., a debug script exercising `docker manifest inspect nginx:latest` directly), not just a logging tweak — the debug session `.planning/debug/manifest-inspect-null.md` (referenced in UAT) is the primary artifact to consult during planning for the concrete `imageRef` values captured during diagnosis.

**Logging/error-message pattern to copy (if any residual gap remains):** the `` `[ModuleName] context: ${detail}` `` console template used consistently across `file-watcher.ts`, `docker-executor.ts`, and `update-checker.ts` — always prefix with `[ClassName]`, always interpolate the `imageRef`/`stackId`/`filePath` identifier, always include `err.stderr` when available from `execFile`.

---

### Gap 5 (UX) — "Update Images" usability: no analog needed for "already up to date" (already implemented); version-selection UI and compose auto-rewrite are new scope

**Current state check:** `client/src/routes/app/stacks/components/stack-actions.tsx` lines 82-96 already implements exactly the first ask ("it should say that" when nothing changed):
```typescript
function handleUpdateImages() {
    toast.promise(
        (async () => {
            const result = await updateImages(stackId);
            onAction();
            return result;
        })(),
        {
            loading: "Updating images...",
            success: (result) =>
                result.noUpdates ? "Images are already up to date" : "Images updated successfully",
            error: (err: Error) => err?.message ?? "Update images failed",
        },
    );
}
```
This is driven by `server/src/application/stack-service.ts` `updateImages()` (lines 199-253) returning `{noUpdates: boolean}` based on parsing `docker compose pull` stdout/stderr for "up to date"/"already exists" tokens (lines 237-253) — this is the analog/reference implementation for any future "detect no-op" logic (e.g., for a future per-service update check).

**New scope (no existing analog in codebase — greenfield):**
1. **Version-selection UI** ("let the user choose which version to upgrade to") — no existing dropdown/picker component for registry tags exists in the codebase. Closest structural analog for a modal/dialog trigered from `stack-actions.tsx` is the existing `DropdownMenu` + `confirm()`-style flow used for `handleDelete` (line 114-127), but a real implementation should use a shadcn `Dialog` (`components/ui/dialog`) — check `components/ui/` for an existing `Dialog` primitive before building custom UI. **Data source problem:** `manifestInspect()` currently only resolves a single tag/digest, not a full tag list — RESEARCH.md's "Open Question 3" flags that `docker manifest inspect` cannot list registry tags; achieving this ask would require a new registry tags-listing capability (e.g., Docker Hub tags API) that is out of current phase scope per RESEARCH.md. **Flag for planner:** this needs a design decision before implementation — likely too large for a gap-closure task; consider scoping down to "show the single `latestTag` already stored in `ImageUpdateCheck.latestTag` and let the user confirm/deploy that specific tag" rather than a full picker.
2. **Compose file auto-rewrite ("docker-compose is adjusted automatically")** — no existing write-path for compose file mutation from the update flow. Analog for writing compose file content: `StackFilesystem.writeCompose()`, already used in `stack-service.ts` `createStack()` (line 29) and `updateStack()` (line 57) — reuse that same `fs.writeCompose(id, newComposeContent)` call after computing an updated YAML string (e.g., via the `yaml` library already used in `compose-parser.ts`) with the new image tag substituted in.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Version-selection dialog component (new) | component | request-response | No existing tag-picker or registry-list UI in codebase; RESEARCH.md flags tag listing as an open question requiring a new data source (Docker Hub tags API) not yet implemented |
| Compose-file rewrite-on-update helper (new) | service/utility | transform + file-I/O | No existing code mutates compose YAML programmatically to bump an image tag; closest is `StackFilesystem.writeCompose()` for the I/O half only |

## Shared Patterns

### Diagnostic logging convention
**Source:** `server/src/jobs/file-watcher.ts`, `server/src/infrastructure/docker-executor.ts`, `server/src/jobs/update-checker.ts` (all three already follow this)
**Apply to:** any new/modified log line in gap-closure fixes
```typescript
console.warn(`[ClassName] context describing what happened: ${identifierVariable}. stderr: ${err.stderr}`)
```

### Compose sync after successful compose read
**Source:** `server/src/application/stack-service.ts` (`deployStack`, `updateImages`)
**Apply to:** `FileWatcher.handleFileChange()` (Gap 1)
```typescript
const composeConfig = createComposeConfig(composeContent);
await this.repo.replaceServices(id, composeConfig);
```

### Error-throwing convention for parser validation
**Source:** `server/src/lib/compose-parser.ts` lines 52-56
**Apply to:** any additional validation case added to `parseComposeContent`
```typescript
throw new Error("Compose file <specific problem description>");
```

### toast.promise UX feedback for async stack actions
**Source:** `client/src/routes/app/stacks/components/stack-actions.tsx` (all handlers)
**Apply to:** any new update-related client action (e.g., version-selection confirm)
```typescript
toast.promise(
    (async () => { const result = await apiCall(...); onAction(); return result; })(),
    {loading: "...", success: (result) => "...", error: (err: Error) => err?.message ?? "..."},
);
```

## Metadata

**Analog search scope:** `server/src/jobs/`, `server/src/application/`, `server/src/repositories/`, `server/src/infrastructure/`, `server/src/lib/`, `server/src/domain/`, `client/src/routes/app/stacks/components/`, `client/src/lib/`
**Files scanned:** `file-watcher.ts`, `compose-parser.ts`, `compose-config.ts`, `docker-executor.ts`, `update-checker.ts`, `stack-repository.ts`, `stack-service.ts`, `stack-actions.tsx`, `stacks-api.ts`, `file-watcher.test.ts`
**Pattern extraction date:** 2026-08-27
**Important note for planner:** Three of the six diagnosed gaps (Windows polling, compose-parser throw behavior, docker-executor/update-checker logging) already appear to have fixes present in the current codebase state. Re-verify each via UAT before scheduling implementation work — only Gap 1 (`replaceServices` call missing in `FileWatcher`) is unambiguously still present as described. The update-checker "manifest inspect returns null" blocker (Gap 4) likely needs behavioral debugging (imageRef construction correctness), not additional logging, since logging is already present.
