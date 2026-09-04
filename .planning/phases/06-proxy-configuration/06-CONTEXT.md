# Phase 6: Proxy Configuration - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can assign a domain (or multiple domains) and a TLS setting to any service from the stack detail page. Docktor auto-provisions and owns an `nginx-proxy` + `acme-companion` reverse-proxy stack — rather than integrating with a separately user-managed Nginx Proxy Manager instance over its REST API — and, when a user configures a domain, writes the corresponding env vars into that service's compose file and redeploys it so the proxy container picks up routing and certificate issuance automatically via the Docker socket.

This covers PRXY-01, PRXY-04, and PRXY-05 as originally worded. **PRXY-02 and PRXY-03 are reinterpreted** under the new mechanism: "NPM API credentials in Settings" becomes "ACME email + proxy-stack settings," and "creates/updates proxy hosts via the NPM API" becomes "writes VIRTUAL_HOST/LETSENCRYPT_HOST-style env vars into the service's compose config." See Canonical References below — REQUIREMENTS.md/PROJECT.md/ROADMAP.md wording is stale relative to this decision and should be updated at or before planning.

</domain>

<decisions>
## Implementation Decisions

### Proxy Mechanism
- **D-01:** Build on `nginx-proxy` + `acme-companion` (env-var/label driven, reacts via the Docker socket) instead of the originally-scoped Nginx Proxy Manager REST API integration. — **Reversibility:** one-way — undoing this means rewriting REQUIREMENTS.md's PRXY-02/03 wording again, discarding the compose-env-var write path for a REST client, and reviving the now-irrelevant `npmProxyHostId` field; the two mechanisms don't share implementation.
- **D-02:** Docktor auto-deploys the `nginx-proxy` + `acme-companion` containers itself; the user does not set them up separately.
- **D-03:** Network wiring between proxied services and the `nginx-proxy` container — left to researcher/planner discretion. Discussed default: one well-known external network (e.g. `docktor_proxy`) that a service joins when proxying is enabled for it, versus wiring `nginx-proxy` into every stack's own network individually.
- **D-04:** Per-service TLS/proxy UI scope — left to planner discretion. Default assumption: start minimal (domain + TLS on/off, matching PRXY-01's original wording), add advanced `nginx-proxy` knobs (force-SSL redirect, `client_max_body_size`, custom headers) only if cheap.
- **D-05:** Failure/cert-issuance feedback — left to planner discretion, since there's no synchronous API call to fail against. Default assumption: poll `acme-companion`'s container logs/cert file state (same style as `StatePoller` reading Docker state) and surface pending/success/failure on the stack detail page, rather than leaving the user to check container logs manually.

### Config Schema
- **D-06:** Disposition of the dormant `ProxyConfig.npmProxyHostId` and `isPublic` fields — left to planner discretion. `npmProxyHostId` has no meaning under the new mechanism (no external ID to track); `isPublic` (LAN-only access restriction) has no `nginx-proxy`-native equivalent, so it's either dropped or kept-but-unenforced this phase.
- **D-07:** Domain uniqueness stays global (`@@unique([domain])`, one domain → one target service). No path-based routing (multiple services behind one domain by path) in this phase.
- **D-08:** A single service **may have multiple domains** at once (e.g. `app.example.com` and `app2.example.com` both routing to the same service). This moves the schema from a single unique domain value per config toward one-to-many (multiple `ProxyConfig` rows per service, each still globally unique on `domain`).

### Deployment, Certs & Safety
- **D-09:** The ACME/Let's Encrypt registration email is a global Settings field (like instance name/timezone), offered as an optional First-Run Wizard step — not a required blocking field, not collected inline per-domain.
- **D-10:** The proxy stack is deployed at First-Run Wizard time as an optional step (alongside the existing account/settings/backup/notifications/brownfield-scan steps) — not lazily deployed the first time a user configures a domain.
- **D-11:** If host ports 80/443 are already taken when Docktor tries to auto-deploy the proxy stack, **fail loudly** and let the user free the ports. No silent fallback to alternate ports. — **Reversibility:** reversible — this is a validation/UX choice, easy to relax later if needed.
- **D-12:** Visibility of the proxy stack in the dashboard stack list is **configurable in Settings** (not hard-coded hidden, not hard-coded fully visible). Regardless of the visibility setting, the proxy stack must be protected from accidental stop/delete/restart through the normal stack-action UI. — **Reversibility:** costly — this needs a "protected stack" concept threaded through `StackService`'s action handlers and `StackRepository`, not just a display filter; retrofitting it after other Phase 6 code assumes a plain `Stack` row would touch multiple call sites.
- **D-13:** When a user enables proxying for a service that already publishes a host port directly (e.g. `8080:80`), **warn but leave both bindings active** — do not silently remove the existing host port mapping.

### Claude's Discretion
- Network wiring model (D-03)
- Advanced TLS/proxy UI scope beyond domain + TLS toggle (D-04)
- Cert/failure status detection mechanism (D-05)
- `ProxyConfig.npmProxyHostId`/`isPublic` field cleanup (D-06)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Proxy Mechanism — External Tooling
- https://github.com/nginx-proxy/nginx-proxy — the reverse proxy container Phase 6 builds on; auto-configures vhosts from target containers' `VIRTUAL_HOST`/`VIRTUAL_PORT` env vars via the Docker socket. Confirmed actively maintained (commits through August 2026).
- https://github.com/nginx-proxy/acme-companion — companion container for automated Let's Encrypt cert issuance/renewal via `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` env vars. Confirmed actively maintained.

### Requirements & Roadmap — wording superseded by D-01, needs update
- `.planning/REQUIREMENTS.md` §Proxy Configuration (PRXY-01..05) — current text says "Nginx Proxy Manager integration... via the NPM API"; superseded by D-01.
- `.planning/PROJECT.md` §Active > Post-MVP — Proxy Configuration — same NPM-API wording, same caveat.
- `.planning/ROADMAP.md` §Phase 6: Proxy Configuration — success criteria reference "NPM proxy host"; same caveat.
- `.planning/STATE.md` §Blockers/Concerns — "Phase 6: NPM API is undocumented and version-sensitive — needs /gsd:research-phase before Phase 6 implementation begins" — this concern is the reason D-01 was made; now moot for the API-integration risk, but the note that Phase 6 needs research still applies (this time for `nginx-proxy`/`acme-companion` networking/deployment specifics, per D-03/D-05).

### Existing Schema
- `server/prisma/schema/proxy.prisma` — dormant `ProxyConfig` model (`domain`, `internalPort`, `tlsEnabled`, `isPublic`, `npmProxyHostId`, `@@unique([domain])`). Zero references to it exist in application code today. Needs revision per D-06/D-08 before use.
- `server/prisma/schema/setting.prisma` — `Setting` key/value model; target for the new ACME email setting key (D-09).
- `server/prisma/schema/service.prisma` — `Service` model; no `domain`/`tls` field exists today, confirms `ProxyConfig` is the intended home for this data.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Encrypted-settings pattern:** `server/src/lib/crypto.ts` (AES-256-GCM: `encrypt()`/`decrypt()`, key from `ENCRYPTION_KEY` env var) + `server/src/repositories/settings-repository.ts` (`SETTING_KEYS`, `upsert(key, value)`) + `server/src/application/settings-service.ts` (`getSmtpConfig()`-style decrypt-on-read getters, dotted key namespace like `smtp.password`/`backup.password`). Reuse this for the new ACME email setting key (e.g. `proxy.acmeEmail` — doesn't need encryption, but the same getter/setter convention applies).
- **Compose-rewriting infra:** Phase 5's `ComposeRewriter`/`VolumeMigrator` (see `05-04-PLAN.md`) is the closest existing precedent for programmatically mutating a stack's `docker-compose.yml` — needed to inject `VIRTUAL_HOST`/`LETSENCRYPT_HOST` env vars and the shared proxy network into a target service.
- **Backup & Restore (Phase 4) as full-phase layering analog:** repository (`server/src/repositories/backup-repository.ts`), application service (`server/src/application/backup-service.ts`), routes (`server/src/routes/backups.ts`), client API (`client/src/lib/backups-api.ts`), stack-detail tab (`client/src/routes/app/stacks/components/backups-tab.tsx` + `backup-config-card.tsx`). Mirror this layering for a new proxy service/tab.
- **First-Run Wizard step pattern:** existing step components in `client/src/routes/setup/components/` (Account/Settings/Backup/Notifications steps) — add a Proxy step following the same optional-step convention for D-09/D-10.
- **External HTTP client precedent (if any API call is still needed, e.g. health-checking `nginx-proxy`'s own container):** `server/src/infrastructure/registry-client.ts` — native `fetch` with `AbortSignal.timeout()`, bounded body reads, dedicated `*UnavailableError extends AppError`.

### Established Patterns
- **YAML-first** (PROJECT.md Key Decision: compose file on disk is source of truth, DB stores derived metadata only) — applies directly: the `ProxyConfig` table should be a derived/cache index of what's actually written into each service's compose env vars, not the reverse.
- **Reactive Docker-event architecture** (StatePoller/dockerode events) — `nginx-proxy`'s own reactive Docker-socket watching is architecturally consistent with this; no new polling loop needed for routing itself, only for surfacing cert-issuance status (D-05).
- **Fail-loudly-not-silently-misconfigure:** `assertStacksDirMatchesHost()` in `server/src/index.ts` — direct precedent for D-11's port-conflict handling.
- **One-component-per-tab** on the stack detail page: `client/src/routes/app/stacks/[id].tsx`'s `VALID_TABS` array + one component per tab in `client/src/routes/app/stacks/components/` — a new "proxy" tab follows this.

### Integration Points
- `server/prisma/schema/proxy.prisma` — `ProxyConfig` model needs revision (D-06, D-08) before Phase 6 code uses it.
- `client/src/routes/app/stacks/[id].tsx` — add `"proxy"` to `VALID_TABS`, add a new `ProxyTab` component.
- `client/src/routes/setup/` — new optional wizard step for proxy-stack deployment + ACME email (D-09/D-10).
- `server/src/application/settings-service.ts` — new getter/setter for the ACME email setting.
- Stack protection/visibility (D-12) likely touches `StackService`'s action handlers, `StackRepository`, and the dashboard stack-list query — this is a new "protected/system stack" concept, not present anywhere today.

</code_context>

<specifics>
## Specific Ideas

No particular UI mockups or reference implementations were given beyond the decisions above. The user's own framing ("build something similar like NPM, or use nginx-proxy and build a manager on top... easy to setup, integrates seamlessly into the UI") is the core intent behind D-01/D-02: Docktor should feel like it owns proxy configuration end-to-end through its own UI, not hand the user off to a separate admin tool.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. No new capabilities were proposed; all decisions were "how" clarifications for the existing PRXY-01..05 scope (with the mechanism itself reinterpreted per D-01).

### Reviewed Todos (not folded)
None — the automated todo-phase matcher returned only generic keyword matches (ui/service/stack/user) with no todo actually about proxy/domain/TLS/NPM/nginx-proxy, so none were presented or folded.

</deferred>

---

*Phase: 6-proxy-configuration*
*Context gathered: 2026-09-03*
