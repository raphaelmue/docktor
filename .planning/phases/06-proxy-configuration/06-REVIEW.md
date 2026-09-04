---
phase: 06-proxy-configuration
reviewed: 2026-09-04T00:00:00Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - client/src/components/domain/stack/cert-status-badge.tsx
  - client/src/hooks/use-container-events.ts
  - client/src/hooks/use-proxy-status.ts
  - client/src/lib/proxy-api.ts
  - client/src/lib/setup-api.ts
  - client/src/lib/stacks-api.ts
  - client/src/routes/app/settings/components/proxy-settings-card.tsx
  - client/src/routes/app/settings.tsx
  - client/src/routes/app/stacks/components/proxy-tab.tsx
  - client/src/routes/app/stacks/components/stack-actions.tsx
  - client/src/routes/app/stacks/[id].tsx
  - client/src/routes/setup/components/brownfield-step.tsx
  - client/src/routes/setup/components/proxy-step.tsx
  - client/src/routes/setup/components/wizard-stepper.tsx
  - client/src/routes/setup.tsx
  - client/test/integration/proxy.spec.ts
  - client/test/integration/setup-wizard.spec.ts
  - client/test/unit/components/domain/stack/cert-status-badge.test.tsx
  - client/test/unit/hooks/use-proxy-status.test.ts
  - client/test/unit/routes/proxy-settings-card.test.tsx
  - client/test/unit/routes/proxy-step.test.tsx
  - client/test/unit/routes/proxy-tab.test.tsx
  - client/test/unit/routes/stacks/stack-actions.test.tsx
  - server/prisma/schema/proxy.prisma
  - server/prisma/schema/stack.prisma
  - server/src/application/index.ts
  - server/src/application/onboarding-service.ts
  - server/src/application/proxy-service.ts
  - server/src/application/settings-service.ts
  - server/src/application/stack-service.ts
  - server/src/app.ts
  - server/src/infrastructure/dockerode-client.ts
  - server/src/jobs/index.ts
  - server/src/jobs/proxy-cert-poller.ts
  - server/src/lib/compose-proxy-editor.ts
  - server/src/lib/keyed-mutex.ts
  - server/src/lib/proxy-stack-compose.ts
  - server/src/lib/state-broadcaster.ts
  - server/src/repositories/proxy-repository.ts
  - server/src/repositories/stack-repository.ts
  - server/src/routes/proxy.ts
  - server/src/routes/setup.ts
  - server/test/integration/proxy.test.ts
  - server/test/unit/application/onboarding-service.test.ts
  - server/test/unit/application/proxy-service.test.ts
  - server/test/unit/application/settings-service.test.ts
  - server/test/unit/application/stack-service.test.ts
  - server/test/unit/jobs/index.test.ts
  - server/test/unit/jobs/proxy-cert-poller.test.ts
  - server/test/unit/lib/compose-proxy-editor.test.ts
  - server/test/unit/lib/keyed-mutex.test.ts
  - server/test/unit/lib/proxy-stack-compose.test.ts
  - shared/src/validation/index.ts
  - shared/src/validation/proxy.ts
  - shared/src/validation/wizard.ts
findings:
  critical: 0
  warning: 7
  info: 3
  total: 10
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues_found

## Summary

This phase adds the Docktor-managed reverse-proxy stack (nginx-proxy + acme-companion), per-service domain assignment, TLS certificate status polling, and the wizard's terminal "Proxy" step. The implementation is generally careful — the keyed-mutex serialization, the YAML surgical-edit helpers, the ACME-email-injection defence in `renderProxyStackCompose`, and the rollback-on-failure logic in `assignDomain`'s new-row path are all well-reasoned and well-tested.

No Critical-severity findings were confirmed. However, several Warning-level correctness/consistency gaps were found, concentrated in two areas: (1) failure-path handling in `ProxyService` that leaves the database and the on-disk compose file inconsistent in narrower-but-real edge cases, and (2) a domain-format validation path (`adoptUnmanagedDomains`) that silently bypasses the hostname regex the codebase's own comments describe as "the security boundary" for domain values written into compose files. Client-side, there's a reproducible form-state bug and misleading static error copy in the proxy-deploy failure UI.

## Warnings

### WR-01: `removeDomain` deletes the DB row before the compose write is confirmed, with no rollback on failure

**File:** `server/src/application/proxy-service.ts:291-299`
**Issue:** `removeDomain` calls `this.proxyRepo.delete(row.id)` and only afterward calls `this.syncServiceComposeProxy(row.stackId, row.serviceName)`, which reads/edits/writes the compose file and redeploys. If `syncServiceComposeProxy` throws (a `ComposeProxyEditError`, a filesystem failure, or a `deployStack` failure), the row has already been permanently deleted from the database, but the compose file may still contain the domain's `VIRTUAL_HOST`/`LETSENCRYPT_HOST` entry (if the failure occurred before or during the write) or the redeploy may simply not have happened (if `deployStack` itself failed) — an already-running nginx-proxy container keeps routing/serving that domain. The caller sees a failed request and no exception is caught here to restore the row, so the UI now shows the domain as "removed" while it may still be live. This is the asymmetric counterpart to `assignDomain`'s new-row rollback (`proxy-service.ts:262-269`), which *does* handle this case for row creation but has no equivalent for row deletion.
**Fix:** Either re-create the row on `syncServiceComposeProxy` failure (mirroring `assignDomain`'s rollback), or reorder so the compose write/redeploy happens before the DB delete and the delete is skipped/rolled back on failure:
```typescript
async removeDomain(proxyConfigId: string) {
    const initial = await this.proxyRepo.findByIdOrThrow(proxyConfigId);

    return withKeyedLock(initial.stackId, async () => {
        const row = await this.proxyRepo.findByIdOrThrow(proxyConfigId);
        await this.proxyRepo.delete(row.id);
        try {
            await this.syncServiceComposeProxy(row.stackId, row.serviceName);
        } catch (err) {
            // best-effort: surface the row again so the DB doesn't claim a
            // domain removal that never actually took effect
            await this.proxyRepo.create({
                stackId: row.stackId, serviceName: row.serviceName,
                domain: row.domain, internalPort: row.internalPort, tlsEnabled: row.tlsEnabled,
            }).catch(() => {});
            throw err;
        }
    });
}
```

### WR-02: `assignDomain`'s port-repoint side effect on sibling rows has no rollback on sync failure

**File:** `server/src/application/proxy-service.ts:224-240`, `262-269`
**Issue:** When re-assigning an existing domain to a new `internalPort`, every other row for the same `(stackId, serviceName)` pair is also repointed to the new port via `updateConfig` (lines 234-240), *before* `syncServiceComposeProxy` is called. The failure handler at line 264-269 only rolls back a brand-new row (`!existingRow` branch) — it never rolls back the sibling rows that were repointed as a side effect of the `existingRow` branch. If the subsequent `syncServiceComposeProxy` call fails, those sibling rows now have `internalPort` values in the database that were never actually written to the compose file, leaving DB and file state out of sync for domains the caller didn't even ask to change.
**Fix:** Track the sibling rows' previous ports and restore them in the catch block, or perform the repoint DB writes only after `syncServiceComposeProxy` has succeeded.

### WR-03: `adoptUnmanagedDomains` persists hand-written domains with no hostname format validation

**File:** `server/src/application/proxy-service.ts:351-399`
**Issue:** `assignDomain`'s primary path validates every user-submitted domain against `hostnamePattern` in `assignDomainSchema` — the codebase's own comment in `shared/src/validation/proxy.ts:3-9` calls this regex "the security boundary between an untrusted request body and a value written into a service's compose `environment` block." `adoptUnmanagedDomains`, however, reads `VIRTUAL_HOST`/`LETSENCRYPT_HOST` directly out of the compose file (`fileEnv.virtualHost.split(",").map(d => d.trim()).filter(Boolean)`, lines 364-367) and persists each entry as a `ProxyConfig.domain` value with **no regex validation at all** before calling `this.proxyRepo.create(...)` (lines 377-398). Any string in a hand-written `VIRTUAL_HOST` (including one containing `/`, `..`, or other non-hostname characters) is silently adopted. That value is later used directly in filesystem path construction by the cert poller:
```typescript
// server/src/jobs/proxy-cert-poller.ts:166-169
const candidates = [
    path.join(this.certsDir, `${domain}.crt`),
    path.join(this.certsDir, domain, "fullchain.pem"),
];
```
A domain value containing `../` segments would cause `path.join` to escape `certsDir`. The `fs.access` call is existence-only (no read), and exploiting this requires the attacker to already have write access to a stack's `docker-compose.yml` on the host — a very high trust bar — but this still directly contradicts the single-validation-point claim the codebase makes for domain values, and is worth closing for defence in depth.
**Fix:** Validate each adopted domain against `hostnamePattern` (imported from `@docktor/shared`) before calling `create`, and skip (with the same warning-log treatment already used for the P2002 collision case) any domain that doesn't match.

### WR-04: `assignDomain` has no guard preventing a domain from being assigned to the managed proxy stack itself

**File:** `server/src/application/proxy-service.ts:208-273`
**Issue:** Nothing in `assignDomain` rejects `stackId === PROXY_STACK_ID`. If a user navigates to `/stacks/docktor-proxy/proxy` (the tab is not itself hidden for protected stacks) and assigns a domain to, say, the `nginx-proxy` service, the call succeeds: a `ProxyConfig` row is created and the proxy stack's own compose file is edited via `setServiceProxyEnv`. However, `renderProxyStackCompose` (`server/src/lib/proxy-stack-compose.ts`) is a full template — `rewriteAndRedeployProxyStack` (`proxy-service.ts:135-140`) regenerates the *entire* compose file from scratch on every subsequent redeploy (e.g. the next ACME-email change, or clicking "Deploy Proxy Stack" again). That regeneration silently discards the manually-added `VIRTUAL_HOST`/`networks` edits, leaving the `ProxyConfig` row in the database pointing at a domain that is no longer routed anywhere, with nothing to inform the user.
**Fix:** Reject `assignDomain` (and ideally hide the Proxy tab client-side) when `stackId === PROXY_STACK_ID`:
```typescript
if (stackId === PROXY_STACK_ID) {
    throw new BadRequestError("Cannot assign a domain to the Docktor-managed proxy stack");
}
```

### WR-05: `ProxyTab.handleAssign` clears the domain field before the assign request resolves, even on failure

**File:** `client/src/routes/app/stacks/components/proxy-tab.tsx:108-116`
**Issue:**
```typescript
function handleAssign(data: AssignDomainInput) {
    if (!serviceName) return;
    toast.promise(assignDomain(stackId, serviceName, data).then(() => reload()), {...});
    form.reset({domain: "", internalPort: data.internalPort, tlsEnabled: data.tlsEnabled});
}
```
`form.reset(...)` runs synchronously immediately after `toast.promise` is *started*, not after the underlying promise settles. On any assign failure (e.g. a 409 domain-conflict or 400 port-conflict from the server), the error toast is shown correctly, but the domain the user just typed has already been wiped from the form — they must retype it. This is 100% reproducible on every failed submission, not just a race window.
**Fix:** Only reset the domain field once the promise resolves successfully:
```typescript
function handleAssign(data: AssignDomainInput) {
    if (!serviceName) return;
    toast.promise(
        assignDomain(stackId, serviceName, data).then(() => {
            reload();
            form.reset({domain: "", internalPort: data.internalPort, tlsEnabled: data.tlsEnabled});
        }),
        {loading: "Assigning domain...", success: "Domain assigned", error: (err: Error) => err?.message ?? "Assign domain failed"},
    );
}
```

### WR-06: Deploy-failure UI hardcodes a "ports 80/443 in use" message for every failure reason

**File:** `client/src/routes/app/settings/components/proxy-settings-card.tsx:159-174`, `client/src/routes/setup/components/proxy-step.tsx:58-71`
**Issue:** Both the Settings > Proxy card and the wizard's Proxy step render this fixed copy whenever `deployError` is non-null:
> "Could not deploy the proxy stack — ports 80/443 are already in use. Free the ports and try again."

But `deployError` is populated from **any** thrown error from `deployProxyStack()`/`submitStep6()` — which on the server can be a `ConflictError` (port conflict, 409) *or* a `BadRequestError` wrapping the real `docker compose` stderr for any other failure (image pull failure, invalid compose syntax, disk full, etc. — see `ProxyService.deployAndSurfaceFailure`). The raw error text is shown below in a scrollable `<pre>` block, but the bolded static sentence above it actively misattributes the cause for every non-port-conflict failure, which will mislead users troubleshooting an unrelated deploy error.
**Fix:** Either use a generic "Could not deploy the proxy stack" lead-in and let the raw message carry the specifics, or branch the copy on whether the message indicates a port conflict.

### WR-07: `proxy-api.ts` does not URL-encode `stackId`/`serviceName` path segments, unlike `stacks-api.ts`

**File:** `client/src/lib/proxy-api.ts:30-46`
**Issue:** `getProxyConfigs` and `assignDomain` interpolate `stackId`/`serviceName` directly into the URL:
```typescript
export async function getProxyConfigs(stackId: string): Promise<ProxyConfig[]> {
    return apiFetch<ProxyConfig[]>(`/api/stacks/${stackId}/proxy-configs`)
}
```
`stacks-api.ts` (`getServiceTags`, `upgradeService`, `getStackEvents`) consistently wraps path segments in `encodeURIComponent`. Stack/service names are slugified/compose-derived and unlikely to contain URL-unsafe characters in practice, but this is an unenforced convention gap that could produce broken requests for edge-case names and is inconsistent with the rest of the codebase.
**Fix:** Wrap `stackId`/`serviceName` in `encodeURIComponent(...)` in both functions, matching `stacks-api.ts`'s convention.

## Info

### IN-01: `adoptUnmanagedDomains`'s inferred port has no upper bound

**File:** `server/src/application/proxy-service.ts:374-375`
**Issue:** `const internalPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fallbackPort;` checks only `> 0`, unlike `assignDomainSchema`'s `z.coerce.number().int().min(1).max(65535)`. A hand-written `VIRTUAL_PORT` value like `999999` would be adopted as-is.
**Fix:** Add a `parsedPort <= 65535` check alongside the existing `> 0` check.

### IN-02: Non-idiomatic cron seconds expression

**File:** `server/src/jobs/proxy-cert-poller.ts:83`
**Issue:** `cron.schedule("*/60 * * * * *", ...)` — a step of 60 over a 0-59 seconds range only ever matches second 0, functionally identical to `"0 * * * * *"` but non-idiomatic and easy to misread as "every 60 seconds starting from an arbitrary offset."
**Fix:** Use `"0 * * * * *"` for clarity (purely cosmetic — behavior is unchanged).

### IN-03: `useContainerEvents`'s `onmessage` handler has no `JSON.parse` error handling

**File:** `client/src/hooks/use-container-events.ts:70-71`
**Issue:** `es.onmessage = (e) => handler.current(JSON.parse(e.data))` — a malformed or partial SSE payload would throw inside the EventSource's message handler, which is unhandled and would surface as an uncaught exception in the browser console (though it would not tear down the EventSource itself). This pre-dates this phase's changes (the file was only extended with the `ProxyCertStatusEvent` variant) but is worth tightening given the new event type now flows through the same path.
**Fix:** Wrap in try/catch and log-and-ignore malformed payloads.

---

_Reviewed: 2026-09-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
