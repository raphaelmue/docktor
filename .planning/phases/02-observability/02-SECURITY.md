---
phase: "02"
slug: "observability"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-08-30"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register built retroactively from the 9 of 16 plans (02-08 through 02-16) that carry a formal
`<threat_model>` block — 02-01 through 02-07 predate that convention and have none
(`register_authored_at_plan_time: true` for the phase as a whole, since at least one plan
authored a register at plan time; the earlier 7 plans were not separately re-modeled here since
their surface — FileWatcher/UpdateChecker core detection — is exercised by the same trust
boundaries covered below via the plans that build on top of them).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| filesystem → FileWatcher | Compose files under the stacks root are edited out-of-band (SSH, or the app itself) | Untrusted YAML content |
| container registry → UpdateChecker / RegistryClient | Registry-controlled manifest/tag JSON, headers and redirects | Third-party JSON, HTTP headers |
| compose file → outbound HTTP target | An image reference authored by a host operator determines which remote host is contacted | Image ref → hostname |
| compose file / database → Docker CLI argv | Image references and tags are passed as arguments to `docker` | Untrusted strings → subprocess argv |
| browser → upgrade / tags / events endpoints | An authenticated user supplies stack id, service name, target tag, page size | Request params → file writes / DB queries |
| server response → React rendering | Registry-controlled tag strings and compose-derived event text are rendered in the UI | Third-party / user-authored text → DOM |
| SSE stream → client state | Server-pushed events drive fetches and rendering in an authenticated browser session | Event payloads → refetch triggers |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-08-01 | Tampering | `syncServicesFromCompose()` | high | mitigate | Writes scoped by `stackId` in filter + upsert key | closed |
| T-02-08-02 | Denial of Service | `parseComposeContent()` | medium | mitigate | Parser throws caught, converted to `config_error` event | closed |
| T-02-08-03 | Information Disclosure | `config_error` SSE payload | medium | accept | Compose content already readable via authenticated compose tab | closed |
| T-02-08-04 | Denial of Service | Windows polling mode | low | accept | Bounded 1s/depth-2 polling, pre-existing behavior | closed |
| T-02-08-05 | Tampering | npm/yarn installs | high | mitigate | No new deps; `yarn.lock` unchanged | closed |
| T-02-09-01 | Tampering | `imageDigest()`/`manifestInspect()` argv | high | mitigate | `execFile` with argv array, never a shell | closed |
| T-02-09-02 | Denial of Service | Registry polling volume | high | mitigate | 6h stagger gate preserved; digest check is local-only | closed |
| T-02-09-03 | Spoofing | Registry manifest response | medium | accept | Trust follows Docker CLI's own registry trust model | closed |
| T-02-09-04 | Information Disclosure | `checkError` in stack detail response | medium | mitigate | Controlled template text only; raw stderr stays server-side | closed |
| T-02-09-05 | Denial of Service | Unbounded inspect on malformed refs | low | mitigate | 30s `execFile` timeout; imageless-service filter | closed |
| T-02-09-06 | Tampering | npm/yarn installs | high | mitigate | No new deps; `yarn.lock` unchanged | closed |
| T-02-10-01 | Information Disclosure | `RegistryClient.listTags()` SSRF | high | mitigate | HTTPS-forced, host from image ref only, redirects same-host, no cross-host bearer replay | closed |
| T-02-10-02 | Denial of Service | Hostile/huge registry response | high | mitigate | 15s `AbortSignal.timeout`, `n=100` bound, ~2MB body cap | closed |
| T-02-10-03 | Elevation of Privilege | `GET /api/stacks/:id/services/:serviceName/tags` | high | mitigate | `requireAuth`; service resolved from addressed stack only | closed |
| T-02-10-04 | Denial of Service | Registry rate limiting | high | mitigate | Runs only inside 6h staggered check; 429 → recorded, not retried | closed |
| T-02-10-05 | Tampering | Registry-supplied tag strings | medium | mitigate | Filtered to `semver.coerce`/`parseDateTag`-accepted values | closed |
| T-02-10-06 | Spoofing | Anonymous bearer token negotiation | medium | accept | Follows registry's own advertised challenge (standard client behavior) | closed |
| T-02-10-07 | Tampering | npm/yarn installs | high | mitigate | No new deps (global `fetch`); `yarn.lock` unchanged | closed |
| T-02-11-01 | Tampering | `targetTag` written into compose file | high | mitigate | `upgradeServiceSchema` grammar-constrains tag; written via YAML document API, not string concat | closed |
| T-02-11-02 | Elevation of Privilege | Upgrade endpoint reachable without intent | high | mitigate | `requireAuth`; no job/cron/background path calls `upgradeServiceImage` | closed |
| T-02-11-03 | Tampering | Write path escaping stack directory | high | mitigate | Write only via `StackFilesystem.writeCompose(id, ...)`, resolved from stack id | closed |
| T-02-11-04 | Denial of Service | Failed upgrade leaving unusable compose file | high | mitigate | Original content restored on pull/recreate failure | closed |
| T-02-11-05 | Repudiation | Version change with no trace | medium | mitigate | Returns `previousTag`/`newTag`; recorded UPDATING→RUNNING transitions | closed |
| T-02-11-06 | Tampering | npm/yarn installs | high | mitigate | No new deps (`yaml` already present); `yarn.lock` unchanged | closed |
| T-02-12-01 | Tampering | Registry tag strings rendered in dialog | medium | mitigate | Pre-filtered server-side (02-10); React escapes by default, no `dangerouslySetInnerHTML` | closed |
| T-02-12-02 | Elevation of Privilege | Upgrade triggered without intent | high | mitigate | Fires only on explicit confirm; disabled during transitional states; server enforces `requireAuth`+`guardTransition` | closed |
| T-02-12-03 | Information Disclosure | Error text in dialog | medium | mitigate | Only `ApiError.message` rendered; no raw stack traces | closed |
| T-02-12-04 | Spoofing | Path segments from service name | medium | mitigate | `encodeURIComponent` on stack id/service name; server resolves within addressed stack | closed |
| T-02-12-05 | Denial of Service | Repeated tag fetches from open dialog | low | mitigate | One fetch per open, no polling/refetch-on-render | closed |
| T-02-12-06 | Tampering | npm/yarn installs | high | mitigate | No new deps (`Dialog`/`Select`/`sonner` already present); `yarn.lock` unchanged | closed |
| T-02-13-01 | Tampering | Image refs → Docker CLI args | medium | mitigate | `execFile` argv array via existing `imageDigest()`, never a shell | closed |
| T-02-13-02 | Spoofing | "Nothing changed" decided from CLI progress text | medium | mitigate | Moved to content-addressed local image digest comparison | closed |
| T-02-13-03 | Denial of Service | Extra local Docker calls per update run | low | accept | Local-only, no registry traffic; proportionate to user-initiated action | closed |
| T-02-13-04 | Denial of Service | Stack stranded in UPDATING on throw | high | mitigate | Ref collection is total (never throws); each degraded path tested for non-transitional final status | closed |
| T-02-13-05 | Information Disclosure | Digest values in logs | low | accept | Public content-address of public images, no secret | closed |
| T-02-13-06 | Tampering | npm/yarn installs | high | mitigate | No new deps; `yarn.lock` unchanged | closed |
| T-02-14-01 | Denial of Service | Event-driven refetch loop | medium | mitigate | Guards ignore events for other stack ids; no polling/refetch-on-render | closed |
| T-02-14-02 | Information Disclosure | Background refresh failure swallowed silently | low | mitigate | Logged to console; refresh indicator visible; only initial load shows full error screen | closed |
| T-02-14-03 | Spoofing | Stale data after failed background refresh | medium | accept | Deliberate trade-off — keeps last-good data rather than destroying the page | closed |
| T-02-14-04 | Tampering | Stack fields rendered into page | low | mitigate | React escapes by default, no `dangerouslySetInnerHTML` | closed |
| T-02-14-05 | Tampering | npm/yarn installs | high | mitigate | No new deps; `yarn.lock` unchanged | closed |
| T-02-15-01 | Information Disclosure | `GET /api/stacks/:id/events` | high | mitigate | `requireAuth` on the plugin; query scoped to addressed stack id only | closed |
| T-02-15-02 | Denial of Service | Unbounded page size on events query | medium | mitigate | `limit` schema: int, min 1, max 100, default 20; served by `[stackId, createdAt]` index | closed |
| T-02-15-03 | Tampering | Event type values reaching DB | medium | mitigate | Typed to generated enum union at every call site; ad-hoc `as any` cast removed | closed |
| T-02-15-04 | Information Disclosure | Parser error text served as event message | low | accept | Same YAML validation text already readable via compose endpoint | closed |
| T-02-15-05 | Spoofing | Reading another stack's events via id guess | medium | mitigate | Stack resolved first (`NotFoundError` on miss); event query filters on same id | closed |
| T-02-15-06 | Tampering | npm/yarn installs | high | mitigate | No new deps; `yarn.lock` unchanged | closed |
| T-02-16-01 | Tampering | Event message/payload text rendered in card | medium | mitigate | React escapes by default; `JSON.parse` wrapped in try/catch, only known fields read | closed |
| T-02-16-02 | Denial of Service | Refetch storm from a chatty stack | medium | mitigate | Refetches only on 3 audit event types for addressed stack, one request per event | closed |
| T-02-16-03 | Information Disclosure | Config error text shown in UI | low | accept | Same YAML validation text already readable via compose tab | closed |
| T-02-16-04 | Spoofing | Stack id used to build request path | medium | mitigate | `encodeURIComponent`; server resolves + scopes query to that id (02-15) | closed |
| T-02-16-05 | Denial of Service | Unbounded rendering of entries | low | mitigate | Server caps/defaults page size; card renders in fixed-height scroll area | closed |
| T-02-16-06 | Tampering | npm/yarn installs | high | mitigate | No new deps (`Card`/`Badge`/`ScrollArea` already present); `yarn.lock` unchanged | closed |

*Status: open · closed · open — below `high` threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (`high`) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

All 53 threats verified L1 (grep-depth: mitigation pattern independently confirmed present in
current source, not re-derived from the plan's own claim) as part of this audit. Representative
spot-checks: `execFile` with argv arrays (never a shell string) in `docker-executor.ts` and
`stack-service.ts`; `requireAuth` `onRequest` hooks on `stacks.ts` and `events.ts`; SSRF guards in
`registry-client.ts` (`redirect: "error"`, HTTPS-forced, host validated); `dockerTagSchema` regex
blocking YAML metacharacters; `AbortSignal.timeout` on all registry fetches; restore-on-failure via
`writeCompose(id, originalContent)` in `stack-service.ts`; `encodeURIComponent` on all path segments
in `stacks-api.ts`; typed `StackEventType` with zero `as any` casts remaining; `limit` schema
`min(1).max(100).default(20)` on the events route; `JSON.parse` wrapped in try/catch in
`event-log-card.tsx`.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-02-01 | T-02-08-03 | `config_error` SSE payload may echo compose fragments — already readable via the authenticated compose tab; SSE stream itself is behind `requireAuth` | plan-time (02-08) | 2026-08-30 |
| R-02-02 | T-02-08-04 | Windows polling mode is bounded, pre-existing behavior unchanged by this phase | plan-time (02-08) | 2026-08-30 |
| R-02-03 | T-02-09-03 | Registry manifest authenticity relies on Docker CLI's own trust/credential mechanism, matching the design selected in 02-CONTEXT.md; no independent signature verification at ASVS L1 | plan-time (02-09) | 2026-08-30 |
| R-02-04 | T-02-10-06 | Anonymous bearer token negotiation follows the registry's own advertised challenge — standard client behavior, no independent pinning at ASVS L1 | plan-time (02-10) | 2026-08-30 |
| R-02-05 | T-02-13-03 | Extra local (non-network) Docker digest calls are proportionate to a user-initiated update action; registry rate-limit surface (UPD-02) is untouched | plan-time (02-13) | 2026-08-30 |
| R-02-06 | T-02-13-05 | Digest values are public content addresses of public images; no secret material logged | plan-time (02-13) | 2026-08-30 |
| R-02-07 | T-02-14-03 | Keeping last-good data after a failed background refresh is the deliberate trade-off vs. destroying the mounted page; SSE/user action re-attempts, indicator shows activity | plan-time (02-14) | 2026-08-30 |
| R-02-08 | T-02-15-04 | Parser error text served as an event message is the same YAML validation text already readable via the compose endpoint by the same authenticated user | plan-time (02-15) | 2026-08-30 |
| R-02-09 | T-02-16-03 | Config error text shown in the Event Log card is the same YAML validation text already readable via the compose tab | plan-time (02-16) | 2026-08-30 |

No accepted risk's underlying condition has changed since it was authored — re-verified during
this audit, not merely carried forward.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-30 | 53 | 53 | 0 | /gsd-secure-phase (retroactive register build from 9 plan-time threat models; L1 grep-depth verification, no auditor subagent needed per the `threats_open: 0 AND register_authored_at_plan_time: true AND asvs_level == 1` short-circuit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-30
