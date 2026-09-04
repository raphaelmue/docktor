---
phase: 02-observability
reviewed: 2026-08-28T20:52:31Z
depth: standard
files_reviewed: 47
files_reviewed_list:
  - client/src/components/domain/stack/service-status-badge.tsx
  - client/src/components/domain/stack/stack-list.tsx
  - client/src/hooks/use-container-events.ts
  - client/src/hooks/use-stack-events.ts
  - client/src/hooks/use-stacks.ts
  - client/src/hooks/use-stack.ts
  - client/src/lib/stacks-api.ts
  - client/src/routes/app/stacks/components/event-log-card.tsx
  - client/src/routes/app/stacks/components/services-tab.tsx
  - client/src/routes/app/stacks/components/service-upgrade-dialog.tsx
  - client/src/routes/app/stacks/components/status-log-card.tsx
  - client/src/routes/app/stacks/[id].tsx
  - client/test/unit/hooks/use-stack-events.test.ts
  - client/test/unit/hooks/use-stack.test.ts
  - client/test/unit/routes/stacks/event-log-card.test.tsx
  - client/test/unit/routes/stacks/service-upgrade-dialog.test.tsx
  - docker-compose.yml
  - server/package.json
  - server/prisma/schema/image-update-check.prisma
  - server/prisma/schema/stack-event.prisma
  - server/prisma/schema/stack.prisma
  - server/src/application/index.ts
  - server/src/application/stack-service.ts
  - server/src/app.ts
  - server/src/domain/image-update-detection.ts
  - server/src/infrastructure/compose-analyzer.ts
  - server/src/infrastructure/docker-executor.ts
  - server/src/infrastructure/registry-client.ts
  - server/src/jobs/file-watcher.ts
  - server/src/jobs/index.ts
  - server/src/jobs/update-checker.ts
  - server/src/lib/auth.ts
  - server/src/lib/compose-editor.ts
  - server/src/lib/compose-parser.ts
  - server/src/lib/state-broadcaster.ts
  - server/src/repositories/image-update-check-repository.ts
  - server/src/repositories/stack-event-repository.ts
  - server/src/repositories/stack-repository.ts
  - server/src/routes/stacks.ts
  - server/test/unit/application/stack-service.test.ts
  - server/test/unit/domain/compose-config.test.ts
  - server/test/unit/domain/image-update-detection.test.ts
  - server/test/unit/infrastructure/brownfield-scanner.test.ts
  - server/test/unit/infrastructure/compose-analyzer.test.ts
  - server/test/unit/infrastructure/registry-client.test.ts
  - server/test/unit/jobs/file-watcher.test.ts
  - server/test/unit/jobs/update-checker.test.ts
  - server/test/unit/lib/compose-editor.test.ts
  - server/test/unit/lib/compose-parser.test.ts
  - shared/src/validation/stacks.ts
  - shared/test/unit/validation/stacks.test.ts
findings:
  critical: 0
  warning: 7
  info: 3
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-28T20:52:31Z
**Depth:** standard
**Files Reviewed:** 47 (union of key-files across plans 02-01 through 02-16, gap-closure included)
**Status:** issues_found

## Summary

The observability phase (stack events, service upgrade flow, image-update-detection, SSE-driven
refresh hooks, file watcher, registry client) is generally well-engineered: the domain/application
layer has strong unit-test coverage of edge cases (digest comparisons, version-tag shape
filtering, registry pagination/auth-challenge handling, compose-file targeted rewrites), and most
background-job failure paths are carefully guarded against leaving a stack stuck in a transitional
status. No critical/security-blocking defects were found in this batch.

That said, several real correctness and architecture-hygiene issues surfaced on close reading:
a route-layer breadcrumb link that silently loses the active tab because it targets a query
string against a path-parameter route; an unguarded `JSON.parse` in the services table that can
crash the whole Overview tab on any row with a malformed `ports` column; dead code in
`UpdateChecker.triggerUpdate()` that broadcasts an event shape outside the declared `StateEvent`
union via an unexplained `as any` cast; a direct violation of this repo's documented
routes-never-touch-repositories/Prisma layering in `routes/stacks.ts`; and a runtime dependency
(`semver`) that is used directly by server code but never declared in `server/package.json`.

## Warnings

### WR-01: Breadcrumb link targets a query string against a path-parameter route, silently dropping the active tab

**File:** `client/src/routes/app/stacks/[id].tsx:174`
**Issue:** The route is registered as `/stacks/:id/:tab?` (a path segment — see
`client/src/main.tsx:62`), and tab navigation elsewhere in the same file correctly uses the path
form (`navigate(\`/stacks/${id}/${v}\`)` at line 223). But the breadcrumb link for the stack's
display name builds a **query string** instead:
```tsx
<Link to={`/stacks/${id}${activeTab !== 'overview' ? `?tab=${activeTab}` : ''}`}>{stack.displayName}</Link>
```
`useParams<{ id: string; tab?: string }>()` never reads `?tab=`, only the `:tab?` path segment.
So while viewing e.g. the "Compose" tab and clicking the stack-name breadcrumb, the user is sent
to `/stacks/:id?tab=compose`, `tab` resolves to `undefined`, and `activeTab` silently falls back
to `"overview"` — contradicting the apparent intent of preserving tab context, and leaving a dead
`?tab=...` query string in the address bar that no code ever reads.
**Fix:**
```tsx
<Link to={`/stacks/${id}${activeTab !== 'overview' ? `/${activeTab}` : ''}`}>{stack.displayName}</Link>
```

### WR-02: Unguarded `JSON.parse` on the `ports` column can crash the Services tab

**File:** `client/src/routes/app/stacks/components/services-tab.tsx:92-104`
**Issue:**
```tsx
{svc.ports
    ? JSON.parse(svc.ports)
        .map((p: {host: number; container: number}) => `${p.host}:${p.container}`)
        .join(", ")
    : "-"}
```
`svc.ports` is a raw string column read straight from the DB with no validation at the render
boundary. Every other place in this phase that parses a persisted JSON string defensively wraps
the parse in `try`/`catch` and degrades gracefully — `EventLogCard`'s `describeStackEvent()`
(`event-log-card.tsx:53-62`) and `decodeUpgradeCandidates()` (`routes/stacks.ts:30-36`) both do
this explicitly, with comments stating a malformed payload "must never throw". This one call site
does not follow that pattern: a single row with a corrupted or legacy-shaped `ports` value throws
synchronously during render and, absent an error boundary around this tree, takes down the whole
Overview tab rather than just that cell.
**Fix:**
```tsx
{svc.ports ? formatPorts(svc.ports) : "-"}

// helper, colocated or in a small util:
function formatPorts(raw: string): string {
    try {
        const parsed = JSON.parse(raw) as {host: number; container: number}[];
        return parsed.map((p) => `${p.host}:${p.container}`).join(", ");
    } catch {
        return "-";
    }
}
```

### WR-03: `triggerUpdate()` broadcasts an event type outside the declared `StateEvent` union via an unexplained `as any` cast; the method itself is dead code

**File:** `server/src/jobs/update-checker.ts:483-504`
**Issue:**
```ts
this.broadcaster.publish({
    type: "update_error",
    stackId: stack.id,
    imageRef,
    error: err.message ?? String(err),
} as any)
```
`StateBroadcaster.publish()` is typed to accept `StateEvent` (`server/src/lib/state-broadcaster.ts:59`),
and the `StateEvent` union has no `"update_error"` member — the six variants are
`container_state | stack_status | config_changed | config_error | update_available |
notification_created`. The `as any` cast bypasses that check with no comment justifying why it's
safe (CLAUDE.md: "`as any` is only acceptable with a comment explaining why it is safe"), and it
isn't safe — the client's `StateEvent` union (`client/src/hooks/use-container-events.ts`) also
has no `"update_error"` variant, so nothing on the client ever consumes this event; it is silently
dropped by every registered handler.
Separately, `triggerUpdate()` has no production caller. A repo-wide search finds it referenced
only from within `update-checker.ts` itself and from `server/test/unit/jobs/update-checker.test.ts`
(which calls it via `(checker as any).triggerUpdate(...)`). It is unreachable dead code that
happens to be under test.
**Fix:** Either delete `triggerUpdate()` if it is superseded by `upgradeServiceImage()`
(UPD-04's real, wired-up implementation per the surrounding comments), or if it must stay, add
`update_error` as a proper member of the shared `StateEvent` union (both server and client copies)
and drop the `as any` cast entirely.

### WR-04: `routes/stacks.ts` bypasses the application-service layer — direct repository, Prisma, and business-logic access in the route file

**File:** `server/src/routes/stacks.ts:17,26-37,56-87,230-233`
**Issue:** CLAUDE.md states explicitly: "Routes **only** call application services — never touch
repositories or Prisma directly" and "Do not import Prisma client outside `repositories/` or
`lib/database.ts`". This file violates both:
- `imageUpdateCheckRepository` is imported directly (line 17) and called directly in the
  `GET /:id` handler (`imageUpdateCheckRepository.findByImageRefs(imageRefs)`, line 76) and the
  `GET /:id/services/:serviceName/tags` handler (line 178), bypassing `StackService` entirely.
- `decodeUpgradeCandidates()` (lines 26-37) is a business-logic helper — decoding a persisted
  JSON column into a typed shape with a defined fallback policy — living in the route file
  instead of the application or domain layer.
- The `GET /:id` handler itself contains ~15 lines of merge logic (building `serviceKeys`,
  `imageRefs`, `updateMap`, and re-shaping the response) inline, well past the "extract logic into
  services immediately if more than ~10 lines" rule.
- The `GET /:id/logs` handler (lines 230-233) imports `prisma` directly (line 13) and calls
  `prisma.stack.findUnique(...)` directly rather than going through `StackRepository` /
  `StackService`.
**Fix:** Add a `StackService.getStackWithUpdateInfo(id)` (or extend `getStack`) that internally
composes `StackRepository` + `ImageUpdateCheckRepository` and returns the already-merged shape;
move `decodeUpgradeCandidates` next to it as a private helper or into `domain/`. Route the
`/logs` handler through `StackService`/`StackRepository` rather than `prisma` directly.

### WR-05: `semver` is imported directly by server code but is not a declared dependency

**File:** `server/package.json` (dependencies list), used at `server/src/jobs/update-checker.ts:2`
**Issue:** `update-checker.ts` does `import semver from "semver"` and calls `semver.coerce`,
`semver.gt`, `semver.eq` in `compareVersions()`. `server/package.json` declares
`@types/semver` as a devDependency but never lists `semver` itself under `dependencies`. It is
only present in `yarn.lock` as a *transitive* dependency of other packages
(`semver@npm:^6.3.1`, `semver@npm:^7.3.5, ...`), not as a direct, resolvable entry for
`@docktor/server`. This currently works only because `nodeLinker: node-modules` is configured
(`.yarnrc.yml`) and some other dependency happens to hoist a compatible `semver` into a
resolvable location — a classic phantom dependency. If the transitive package that currently
provides `semver` is ever removed/updated, or if the project switches to Yarn PnP (which strictly
enforces declared dependencies), this import breaks at runtime with no compile-time signal (the
`@types/semver` devDependency lets `tsc --build` pass even though the runtime package isn't
guaranteed).
**Fix:** Add `"semver": "^7.x"` to `server/package.json` `dependencies` (matching the version
implied by `@types/semver": "^7.7.1"`), then run `yarn install`.

### WR-06: `use-stack(id)` can render a previous stack's data under a new id with no loading indicator

**File:** `client/src/hooks/use-stack.ts:18-49`
**Issue:** `fetchStack("initial")` sets `loading=true` and `error=null` but never resets `stack`
to `null`. If the `id` argument changes while the hook stays mounted (React Router reuses the
component instance across param changes on the same route, `/stacks/:id/:tab?`), the effect at
line 47-49 re-fires `fetchStack("initial")` for the new id, but `stack` still holds the *previous*
id's data during the fetch. The page's early-return guard in `[id].tsx` (`if (loading && !stack)`)
only shows a loading state when `stack` is falsy — with stale data present, that guard is
bypassed, and the previously-fetched stack's name/services/status render under the new id's URL
with no "Refreshing" indicator (that indicator is driven by `isRefreshing`, not `loading`, and
`isRefreshing` is never set for an "initial" fetch). This is a real gap in the hook's own
contract rather than a hypothetical: it is not covered by any test in
`use-stack.test.ts` (no test exercises `rerender` with a changed `id` prop), unlike the
adjacent SSE-refresh behavior, which is thoroughly tested.
**Fix:** Reset `stack` (and `error`) to `null` whenever `id` changes before issuing the new
"initial" fetch, e.g. track the previous id in a ref and clear state in the effect when it
differs, or key the whole page component on `id` (`<StackDetailPage key={id} />`) so React
remounts rather than reuses the instance across stacks.

### WR-07: `deleteStack()` silently swallows a `docker down` failure with no logging

**File:** `server/src/application/stack-service.ts:134-139`
**Issue:**
```ts
try {
    await this.docker.down(id);
} catch (err: any) {
    // Continue with deletion even if docker down fails
    // (e.g., containers already removed manually)
}
```
The comment documents the *intent* (continue deletion regardless), which is reasonable, but the
catch block does nothing with `err` at all — not even a `console.warn`. Every other swallowed
error in this same file (`snapshotDigests`, `collectImageRefs`, the restore-write failure in
`upgradeServiceImage`) logs the suppressed error for operability. A genuine `docker down` failure
here (e.g. permission denied on the socket, not just "already removed") is now invisible to an
operator diagnosing why a stack's containers are still running after "deletion".
**Fix:**
```ts
} catch (err: any) {
    console.warn(`[StackService] docker down failed for stack "${id}", continuing with deletion:`, err.message ?? err);
}
```

## Info

### IN-01: `EventLogCard` does not surface `isRefreshing` from `useStackEvents`, unlike the equivalent pattern in `[id].tsx`/`useStack`

**File:** `client/src/routes/app/stacks/components/event-log-card.tsx:67`
**Issue:** `useStackEvents` exposes `isRefreshing` (mirroring `useStack`'s contract, per the
comment at the top of `use-stack-events.ts`), but `EventLogCard` destructures only
`{events, loading, error, refetch}` and never renders a refreshing indicator, whereas the parent
page (`[id].tsx:192-201`) shows an explicit "Refreshing" badge driven by `useStack`'s
`isRefreshing`. This is a minor UI-consistency gap rather than a functional bug — SSE-triggered
background refreshes of the event log happen invisibly to the user.
**Fix:** Optionally render a small inline spinner/opacity-fade using `isRefreshing`, consistent
with the page-level indicator, or drop the unused hook field if it's deliberately not surfaced
here.

### IN-02: Hardcoded local Postgres credentials in `docker-compose.yml`

**File:** `docker-compose.yml:42-43`
**Issue:** `POSTGRES_USER: docktor` / `POSTGRES_PASSWORD: docktor` are hardcoded plaintext.
The file's header comment already states it is "for development / testing purposes, not for
production purposes," which substantially lowers the risk, but a hardcoded credential pattern is
still worth flagging for completeness — an operator who copies this file as a starting point for
a real deployment (a very plausible path for this kind of self-hosting tool) would inherit a
default, publicly-known credential pair bound to a host port (`5432:5432`).
**Fix:** Consider sourcing `POSTGRES_PASSWORD` from `.env.local` (already used for the app
container's `env_file`) even in the dev compose file, so the pattern of "credentials never live
in a committed file" holds everywhere, and a copy-paste into a production compose file doesn't
carry a real secret's shape into the new file with a hardcoded value already filled in.

### IN-03: Redundant duplicate `"close"` listener registration in the SSE log-streaming route

**File:** `server/src/routes/stacks.ts:270-276`
**Issue:**
```ts
request.raw.on("close", () => {
    streams.forEach(s => (s as any).destroy())
})

await new Promise<void>((resolve) => {
    request.raw.on("close", resolve)
})
```
Two separate `"close"` listeners are attached to the same `request.raw` stream instead of one
listener that both destroys the child streams and resolves the promise. Functionally harmless
(both fire), but it's an avoidable duplication that also carries an unexplained `as any` cast
(`(s as any).destroy()` — `NodeJS.ReadableStream` doesn't type `destroy()`, but `Readable` does;
a proper type import would remove the cast).
**Fix:**
```ts
request.raw.on("close", () => {
    streams.forEach(s => s.destroy())
    resolve()
})
```
with `streams: Readable[]` (from `node:stream`) instead of `NodeJS.ReadableStream[]`.

---

_Reviewed: 2026-08-28T20:52:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
