# Phase 6: Proxy Configuration - Research

**Researched:** 2026-09-03
**Domain:** Reverse-proxy / TLS automation (nginx-proxy + acme-companion), Docker-outside-of-Docker compose orchestration, layered DDD feature addition
**Confidence:** MEDIUM — the Docktor-internal integration surface (schema, compose-editing, deploy pipeline, SSE, state machine) is HIGH confidence (all read directly from source this session). The external `nginx-proxy`/`acme-companion` mechanics are MEDIUM confidence (official GitHub docs fetched this session, but via summarizing fetches, not raw byte-for-byte diffs — flagged `[CITED]` throughout, with two internally-inconsistent doc pages noted as an open question).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Proxy Mechanism**
- **D-01:** Build on `nginx-proxy` + `acme-companion` (env-var/label driven, reacts via the Docker socket) instead of the originally-scoped Nginx Proxy Manager REST API integration. — Reversibility: one-way.
- **D-02:** Docktor auto-deploys the `nginx-proxy` + `acme-companion` containers itself; the user does not set them up separately.
- **D-03:** Network wiring between proxied services and the `nginx-proxy` container — left to researcher/planner discretion. Discussed default: one well-known external network (e.g. `docktor_proxy`) that a service joins when proxying is enabled for it, versus wiring `nginx-proxy` into every stack's own network individually.
- **D-04:** Per-service TLS/proxy UI scope — left to planner discretion. Default assumption: start minimal (domain + TLS on/off, matching PRXY-01's original wording), add advanced `nginx-proxy` knobs (force-SSL redirect, `client_max_body_size`, custom headers) only if cheap.
- **D-05:** Failure/cert-issuance feedback — left to planner discretion, since there's no synchronous API call to fail against. Default assumption: poll `acme-companion`'s container logs/cert file state (same style as `StatePoller` reading Docker state) and surface pending/success/failure on the stack detail page, rather than leaving the user to check container logs manually.

**Config Schema**
- **D-06:** Disposition of the dormant `ProxyConfig.npmProxyHostId` and `isPublic` fields — left to planner discretion. `npmProxyHostId` has no meaning under the new mechanism; `isPublic` (LAN-only access restriction) has no `nginx-proxy`-native equivalent, so it's either dropped or kept-but-unenforced this phase.
- **D-07:** Domain uniqueness stays global (`@@unique([domain])`, one domain → one target service). No path-based routing in this phase.
- **D-08:** A single service **may have multiple domains** at once. This moves the schema from a single unique domain value per config toward one-to-many (multiple `ProxyConfig` rows per service, each still globally unique on `domain`).

**Deployment, Certs & Safety**
- **D-09:** The ACME/Let's Encrypt registration email is a global Settings field, offered as an optional First-Run Wizard step — not a required blocking field, not collected inline per-domain.
- **D-10:** The proxy stack is deployed at First-Run Wizard time as an optional step — not lazily deployed the first time a user configures a domain.
- **D-11:** If host ports 80/443 are already taken when Docktor tries to auto-deploy the proxy stack, **fail loudly** and let the user free the ports. No silent fallback to alternate ports. — Reversibility: reversible.
- **D-12:** Visibility of the proxy stack in the dashboard stack list is **configurable in Settings**. Regardless of the visibility setting, the proxy stack must be protected from accidental stop/delete/restart through the normal stack-action UI. — Reversibility: costly.
- **D-13:** When a user enables proxying for a service that already publishes a host port directly (e.g. `8080:80`), **warn but leave both bindings active** — do not silently remove the existing host port mapping.

### Claude's Discretion
- Network wiring model (D-03)
- Advanced TLS/proxy UI scope beyond domain + TLS toggle (D-04)
- Cert/failure status detection mechanism (D-05)
- `ProxyConfig.npmProxyHostId`/`isPublic` field cleanup (D-06)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. No new capabilities were proposed; all decisions were "how" clarifications for the existing PRXY-01..05 scope (with the mechanism itself reinterpreted per D-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRXY-01 | User can configure one or more domains, an internal service/port, and a TLS setting for a stack's service via the stack detail page | Schema section (D-07/D-08 shape), Architecture Patterns (new "proxy" tab following existing one-component-per-tab convention), Code Examples (compose-proxy-editor) |
| PRXY-02 | Docktor auto-deploys and manages an `nginx-proxy` + `acme-companion` reverse-proxy stack; configuring a domain writes routing/TLS env vars into the target service's compose file and redeploys it | Standard Stack (image versions/env vars), Architecture Patterns (proxy stack as a normal Docktor `Stack`), Don't Hand-Roll, Common Pitfalls |
| PRXY-03 | ACME/Let's Encrypt registration email and proxy-stack settings are configurable in Settings | Reusable Assets (Settings key/value pattern), First-Run Wizard step pattern |
| PRXY-04 | User can remove a proxy configuration, which removes the routing/TLS env vars from the service's compose file and redeploys it | Code Examples (compose-proxy-editor removal path), idempotency discussion |
| PRXY-05 | Proxy operations are idempotent (re-applying an existing domain's env vars updates the service's config rather than erroring or duplicating) | Domain uniqueness / idempotency discussion under Architecture Patterns |
</phase_requirements>

## Summary

Phase 6 is a net-new full-stack feature, not a library-selection problem: almost every piece of infrastructure it needs (compose-file surgical editing, Docker-outside-of-Docker deploy pipeline, background polling that mirrors Docker state into the DB and broadcasts SSE, a Settings key/value store with an encrypted-value convention, a First-Run Wizard optional-step pattern) already exists in this codebase and was read directly this session. The job is composition, not invention: **the `nginx-proxy` + `acme-companion` proxy stack should be deployed as an ordinary Docktor-managed `Stack`** (its own directory under the managed stacks dir, its own `docker-compose.yml`, deployed via the same `DockerExecutor.up()`/`StackService.deployStack()` path every user stack uses) rather than as a special-cased container pair outside Docktor's own model. This is the cleanest way to satisfy D-02 ("Docktor auto-deploys and manages" it) and reuse `StatePoller` for its health, `StackService`'s guard rails for lifecycle safety (D-12), and the existing UI's tab/action conventions for free.

Per-service proxy configuration should reuse the exact pattern already established by `server/src/lib/compose-editor.ts` (`parseDocument`/`getIn`/`setIn`/`hasIn` from the `yaml` package, preserving comments and formatting) rather than the full parse-and-restringify approach in `server/src/infrastructure/compose-rewriter.ts` (Phase 5's migration tool, which reformats the entire file — acceptable for a one-time migration, wrong for a config toggle a user will flip repeatedly). A new sibling module, surgically setting/clearing `environment.VIRTUAL_HOST`/`LETSENCRYPT_HOST`/`VIRTUAL_PORT` on one service and adding/removing the shared proxy network from that service's `networks:` list, is the right shape.

For D-03 (network wiring), the single well-known external Docker network (`docktor_proxy`) is the correct default: it is nginx-proxy's own documented deployment model `[CITED: nginx-proxy/docs]` ("All containers must be on the same Docker network as nginx-proxy"), requires zero per-stack nginx-proxy reconfiguration, and Docktor's own `Out of Scope` table already documents the underlying mechanism ("Inter-stack networking: users can use `external: true` manually in compose files" — Phase 6 just automates writing that `external: true` network reference into the target service's compose file, the same operation the docs already describe as a supported manual workaround).

For D-05 (cert-issuance feedback), the two viable signals are (a) the acme-companion container's own logs, tailable via the already-existing `DockerodeClient.getLogStream()` (same primitive the log-viewer feature already uses for OBS-05..09), and (b) cert file presence/mtime under the shared `certs` volume — which, per this project's bind-mounts-only convention, can be a bind mount Docktor's own filesystem can `stat()` directly, no Docker exec needed. Recommend a small polling job mirroring `StatePoller`'s cron-reconcile shape, publishing a new SSE event type through the existing `StateBroadcaster` discriminated union.

**Primary recommendation:** deploy `nginx-proxy` + `acme-companion` as a normal Docktor `Stack` (protected via a new `Stack.isProtected` flag enforced in `StackService`, not just hidden in a list filter); wire proxied services to it through one well-known external network (`docktor_proxy`); edit target-service compose files with a `compose-editor.ts`-style surgical YAML mutation module; and detect cert status via a `StatePoller`-style poller reading acme-companion's logs and the shared certs bind mount.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Proxy-stack lifecycle (deploy/protect/visibility) | API / Backend (`StackService`, new `ProxyService`) | Database (Stack row, protected flag) | Reuses the existing stack lifecycle state machine; must not be a parallel bespoke code path |
| Per-service domain/TLS assignment (write env vars + network into target compose) | API / Backend (new compose-editing lib, `ComposeConfig`) | Database / Storage (compose file on disk is source of truth per YAML-first decision; `ProxyConfig` rows are a derived cache index) | Matches project's established YAML-first pattern — DB never leads |
| Routing / vhost generation, HTTP request proxying | External Tooling (`nginx-proxy` container, via Docker socket + env vars) | — | Docktor never runs an nginx process itself; `nginx-proxy` owns this entirely, reactive to Docker events like `StatePoller` already is |
| Cert issuance / renewal | External Tooling (`acme-companion` container) | API / Backend (status polling only, no cert material handled by Docktor) | Docktor never touches ACME/Let's Encrypt directly; it only observes outcome |
| Cert/issuance status surfaced to user | API / Backend (poller + SSE publish) | Browser / Client (SSE subscriber, stack detail page badge) | Mirrors `StatePoller` → `StateBroadcaster` → `useContainerEvents`-style hook precedent already in the codebase |
| Domain/TLS/port configuration UI | Browser / Client (new stack-detail "proxy" tab) | — | Follows the established one-component-per-tab convention (`backups-tab.tsx`, `services-tab.tsx`) |
| ACME email + proxy-stack settings | Browser / Client (Settings page card + optional wizard step) | API / Backend (`SettingsService` getter/setter) | Mirrors SMTP/backup settings card + wizard-step pattern already in the codebase |

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|---------------|
| `nginxproxy/nginx-proxy` | `1.11-alpine` pinned tag recommended (avoid bare `latest`) `[CITED: hub.docker.com/r/nginxproxy/nginx-proxy/tags — WebSearch this session, "latest" and "1.11-alpine" both observed pushed within the last ~3 weeks]` | Reverse proxy container; auto-generates nginx vhost config from proxied containers' `VIRTUAL_HOST`/`VIRTUAL_PORT` env vars via the Docker socket | Purpose-built for exactly this integration model (env-var/label driven, Docker-socket reactive); this is the mechanism CONTEXT.md's D-01 explicitly locks in |
| `nginxproxy/acme-companion` | `2.6.3` pinned tag recommended (avoid bare `latest`) `[CITED: hub.docker.com/r/nginxproxy/acme-companion — WebSearch this session, 2.6.3 pushed ~2 months ago, latest pushed ~1 hour ago]` | Automated Let's Encrypt/ACME cert issuance and renewal, driven by `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` env vars on proxied containers, reading the same Docker socket | The maintained companion project for `nginx-proxy`; the only container in this stack Docktor grants write access to certs |
| `yaml` (already a server dependency) | `^2.7.0` `[VERIFIED: server/package.json:26]` | Surgical compose-file mutation for env vars/networks | Already used by `compose-editor.ts` and `compose-rewriter.ts`; no new dependency needed |

No new npm/PyPI/crates packages are required by this phase — every piece of new server code composes existing dependencies (`yaml`, `zod`, `dockerode`, `node-cron`) already present in `server/package.json`. **Package Legitimacy Audit is therefore not applicable** in its npm-registry form; the equivalent diligence performed instead was verifying the two new *Docker images* (`nginxproxy/nginx-proxy`, `nginxproxy/acme-companion`) are the official, actively-maintained project images (not a stale fork or lookalike) — see Package Legitimacy Audit below.

### Supporting

| Asset | Location | Purpose | When to Use |
|-------|----------|---------|-------------|
| `compose-editor.ts` surgical-edit pattern | `server/src/lib/compose-editor.ts` `[VERIFIED: read this session]` | `parseDocument`/`getIn`/`setIn`/`hasIn` targeted mutation preserving comments/formatting | Model for the new proxy env-var/network editor — do not reuse `compose-rewriter.ts`'s full-restringify approach for this |
| `DockerodeClient.getLogStream()` | `server/src/infrastructure/dockerode-client.ts:35-42` `[VERIFIED: read this session — see verbatim quote below]` | Tail a container's stdout/stderr | D-05 cert-status detection: tail acme-companion's logs the same way the existing log-viewer feature does |
| `StateBroadcaster` / `StateEvent` union | `server/src/lib/state-broadcaster.ts:1-58` `[VERIFIED: read this session — see verbatim quote below]` | SSE event publishing | Add a new discriminated-union member for cert/proxy status, following the existing `ContainerStateEvent`/`ConfigChangedEvent` shape |
| `SettingsRepository`/`SettingsService` key-value convention | `server/src/repositories/settings-repository.ts`, `server/src/application/settings-service.ts` `[VERIFIED: read this session]` | ACME email + proxy-stack settings storage | D-09: add `proxy.acmeEmail`, `proxy.showInDashboard` (or similar) keys via `upsertSetting`/`getSetting`, mirroring `getSmtpConfig()`'s getter-with-decrypt convention (email needs no encryption, but the dotted-namespace convention still applies) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `nginx-proxy` + `acme-companion` (D-01, locked) | Traefik | Traefik is a comparable label-driven reverse proxy with built-in ACME, but D-01 explicitly locks the nginx-proxy family; not evaluated further |
| Single well-known external network (`docktor_proxy`) | Wire `nginx-proxy` into every stack's own Docker network individually via `docker network connect` | Rejected as the default: requires `nginx-proxy`-side reconfiguration (or a live `docker network connect` call) on every new proxied stack instead of a single one-line compose edit on the target service; the shared-network model is also what the official docs describe as the norm `[CITED: nginx-proxy/docs]` |
| Deploying nginx-proxy/acme-companion as a normal Docktor `Stack` | A special-cased, DB-row-less container pair managed by bespoke code outside `StackService` | Rejected: would duplicate the entire deploy/monitor/lifecycle machinery `StackService`/`StatePoller`/`DockerExecutor` already provide, and D-12's "protected stack" requirement implies the proxy stack IS a `Stack` row (there is nothing else to protect otherwise) |

**Installation:** No new npm install step. Docker images are pulled at first-deploy time via the existing `DockerExecutor.up()` → `docker compose pull && up -d` path (implicit in `docker compose up -d`), the same as any user-added stack.

## Package Legitimacy Audit

Not applicable in its standard npm-registry form (see Standard Stack above — zero new npm packages). Equivalent Docker-image diligence performed this session:

| Image | Registry | Publisher | Maintenance signal | Verdict | Disposition |
|-------|----------|-----------|---------------------|---------|-------------|
| `nginxproxy/nginx-proxy` | Docker Hub | `nginxproxy` org (successor to the archived `jwilder/nginx-proxy`) | `latest`/`alpine` tags both observed pushed within the last ~3 weeks as of this session `[CITED: WebSearch, hub.docker.com/r/nginxproxy/nginx-proxy/tags]`; matches CONTEXT.md's canonical ref confirming "commits through August 2026" | OK | Approved |
| `nginxproxy/acme-companion` | Docker Hub | `nginxproxy` org (successor to `jrcs/letsencrypt-nginx-proxy-companion`) | `latest` pushed ~1 hour ago, `2.6.3` (latest numbered release) pushed ~2 months ago as of this session `[CITED: WebSearch, hub.docker.com/r/nginxproxy/acme-companion]` | OK | Approved |

**Packages removed due to `[SLOP]` verdict:** none. **Packages flagged `[SUS]`:** none.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────┐
   Browser (client)  │  Stack detail "proxy" tab    │
   ─────────────────►│  Settings > Proxy card       │
                      │  First-Run Wizard proxy step │
                      └──────────────┬───────────────┘
                                     │ REST (apiFetch)
                                     ▼
          ┌───────────────────────────────────────────────────────┐
          │ routes/proxy.ts (Fastify, Zod-validated, requireAuth)  │
          └───────────────────────────┬───────────────────────────┘
                                       │ delegates only
                                       ▼
          ┌───────────────────────────────────────────────────────┐
          │ application/proxy-service.ts                          │
          │  - assignDomain(stackId, serviceName, domain, tls,    │
          │    internalPort)  →  idempotent upsert                │
          │  - removeDomain(proxyConfigId)                        │
          │  - deployProxyStack() (first-run / settings trigger)  │
          └───┬───────────────┬───────────────┬────────────────┬──┘
              │               │               │                │
              ▼               ▼               ▼                ▼
  repositories/       lib/compose-        StackService     StackRepository
  proxy-repository.ts proxy-editor.ts     .deployStack()   (isProtected flag,
  (ProxyConfig CRUD,  (surgical env var/  (redeploy the    settings/visibility)
   D-07/D-08 model)   network YAML edit,  target service
                       compose-editor.ts  after edit)
                       style)
                                       │
                                       ▼
                         docker compose (DockerExecutor, DooD)
                                       │
                                       ▼
          ┌───────────────────────────────────────────────────────┐
          │ docktor_proxy (external Docker network)                │
          │                                                        │
          │  ┌────────────┐   ┌────────────────┐   ┌────────────┐  │
          │  │nginx-proxy │◄──┤ target service  │   │acme-       │  │
          │  │(80/443,    │   │ VIRTUAL_HOST=…  │   │companion   │  │
          │  │ docker.sock│   │ LETSENCRYPT_HOST│   │(watches    │  │
          │  │ ro)        │   │ VIRTUAL_PORT=…  │   │same socket,│  │
          │  └─────┬──────┘   └────────────────┘   │ writes to  │  │
          │        │ shared bind-mounted            │ certs vol) │  │
          │        │ certs/ + html/ volumes ◄────────┴────────────┘  │
          └────────┴──────────────────────────────────────────────┘
                    │
                    ▼
       proxy-poller.ts (StatePoller-style cron)
         reads certs bind mount + acme-companion log tail
         → StateBroadcaster.publish({type: "proxy_cert_status", …})
                    │
                    ▼
          SSE → useProxyStatus() hook → stack detail proxy tab
```

### Recommended Project Structure

```
server/src/
├── application/
│   └── proxy-service.ts          # assignDomain/removeDomain/deployProxyStack — orchestrates repo + compose-editor + StackService.deployStack()
├── lib/
│   └── compose-proxy-editor.ts   # setServiceProxyEnv/removeServiceProxyEnv — compose-editor.ts-style surgical YAML edits
├── jobs/
│   └── proxy-cert-poller.ts      # StatePoller-style cron: certs bind mount + acme-companion log tail → SSE
├── repositories/
│   └── proxy-repository.ts       # ProxyConfig CRUD (mirrors backup-repository.ts shape)
└── routes/
    └── proxy.ts                  # FastifyPluginAsyncZod, requireAuth, thin handlers delegating to proxy-service

client/src/
├── routes/app/stacks/components/
│   └── proxy-tab.tsx             # new stack-detail tab: domain/TLS/port form + status badges
├── routes/app/settings/components/     (per CLAUDE.md's Known Refactoring Target — extract, don't add to the monolith)
│   └── proxy-settings-card.tsx   # ACME email + proxy-stack visibility setting
├── routes/setup/components/
│   └── proxy-step.tsx            # optional First-Run Wizard step (mirrors backup-step.tsx)
├── hooks/
│   └── use-proxy-status.ts       # SSE subscriber for proxy_cert_status events
└── lib/
    └── proxy-api.ts              # apiFetch<T> client functions
```

### Pattern 1: Proxy stack is a normal `Stack` row, deployed through `StackService`

**What:** At First-Run Wizard proxy step (or later from Settings, if the user skipped it), Docktor writes a `docker-compose.yml` for `nginx-proxy` + `acme-companion` into a new managed-stack directory (e.g. id `docktor-proxy`) via `StackFilesystem.createDirectory()`/`writeCompose()`, creates a `Stack` row via `StackRepository.create()` with a new `isProtected: true` flag, then calls the existing `StackService.deployStack()` path (`DockerExecutor.up()` under the hood).

**When to use:** Any time the proxy stack itself needs to exist, be redeployed (e.g. after an ACME email change requires restarting `acme-companion` with a new `DEFAULT_EMAIL`), or be health-monitored.

**Why:** This is the only way D-02 ("Docktor auto-deploys and manages") and D-12 ("protected from stop/delete/restart through the normal stack-action UI") compose cleanly — there is no other place a "protected stack" concept could attach. It also means `StatePoller` picks up its container health for free (no bespoke health-check code needed), and the dashboard/stack-list visibility toggle (D-12) is just a query filter on an existing `Stack` row rather than a parallel data model.

**Example — reusing the exact create/deploy call shape already used by `StackService.createStack()`/`deployStack()`** `[VERIFIED: server/src/application/stack-service.ts:39-64, 165-232 — verbatim method bodies read this session]`:
```typescript
// application/proxy-service.ts (new) — sketch, not the literal existing code
async deployProxyStack(): Promise<void> {
  const id = "docktor-proxy"; // fixed, not user-chosen — see Common Pitfalls
  if (await this.stackRepo.exists(id)) return; // idempotent (mirrors StackService.createStack's ConflictError guard)

  await assertHostPortsFree([80, 443]); // new — see Common Pitfalls / D-11

  const composeContent = renderProxyStackCompose({ acmeEmail: await this.settings.getProxyAcmeEmail() });
  const hostPath = await this.fs.createDirectory(id);
  await this.fs.writeCompose(id, composeContent);
  const composeConfig = createComposeConfig(composeContent);

  await this.stackRepo.create({ id, displayName: "Docktor Proxy", hostPath, composeConfig, isProtected: true });
  await this.stackService.deployStack(id); // reuses the existing guardTransition/transitionStatus/broadcaster pipeline
}
```

### Pattern 2: Surgical compose-file editing for per-service proxy env vars

**What:** A new module mirroring `compose-editor.ts`'s exact API shape: `parseDocument(content)`, `hasIn`/`getIn`/`setIn` on `["services", serviceName, ...]` paths, mutate only the `environment` and `networks` keys for the target service, `doc.toString({lineWidth: 0})` to re-serialize with everything else byte-for-byte preserved.

**When to use:** Every `assignDomain`/`removeDomain` call (PRXY-01/04). Never use `compose-rewriter.ts`'s parse-then-restringify-the-whole-doc approach here — that reformats unrelated services/comments on every domain toggle, which is fine for a one-time Phase-5 migration but not for a config a user flips repeatedly.

**Example — env var shape to write, aggregating multiple `ProxyConfig` rows for one service into single comma-separated env vars (nginx-proxy's documented multi-domain syntax)** `[CITED: nginx-proxy/docs — "VIRTUAL_HOST: Domain name(s) for the service (comma-separated for multiple hosts)"]`:
```yaml
services:
  myapp:
    image: myapp:latest
    networks:
      - default
      - docktor_proxy       # added by Docktor when proxying is enabled
    environment:
      VIRTUAL_HOST: "app.example.com,app2.example.com"   # D-08: multiple domains, one comma-separated value
      VIRTUAL_PORT: "8080"                                 # internalPort from PRXY-01
      LETSENCRYPT_HOST: "app.example.com,app2.example.com" # only written when tlsEnabled=true
      # LETSENCRYPT_EMAIL omitted — falls back to acme-companion's DEFAULT_EMAIL (D-09 global setting)

networks:
  docktor_proxy:
    external: true
```

### Pattern 3: `nginx-proxy` + `acme-companion` compose skeleton

**What:** The proxy stack's own `docker-compose.yml`, following the two-container example from the acme-companion project's own docs `[CITED: raw.githubusercontent.com/nginx-proxy/acme-companion/main/docs/Docker-Compose.md — fetched this session]`, adapted to this project's bind-mounts-only convention (no named Docker volumes — see PROJECT.md's Key Decision) and to expose `NGINX_PROXY_CONTAINER` explicitly rather than relying on label auto-detection (the label name was inconsistently reported across two different doc pages fetched this session — see Open Questions):

```yaml
services:
  nginx-proxy:
    image: nginxproxy/nginx-proxy:1.11-alpine
    container_name: docktor-proxy-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./volumes/certs:/etc/nginx/certs:ro
      - ./volumes/html:/usr/share/nginx/html
      - ./volumes/vhost.d:/etc/nginx/vhost.d
      - /var/run/docker.sock:/tmp/docker.sock:ro
    networks:
      - docktor_proxy

  acme-companion:
    image: nginxproxy/acme-companion:2.6.3
    container_name: docktor-proxy-acme
    restart: unless-stopped
    environment:
      DEFAULT_EMAIL: ${ACME_EMAIL}          # from Settings (D-09), written to .env by Docktor
      NGINX_PROXY_CONTAINER: docktor-proxy-nginx
    volumes:
      - ./volumes/certs:/etc/nginx/certs:rw
      - ./volumes/html:/usr/share/nginx/html:rw
      - ./volumes/vhost.d:/etc/nginx/vhost.d:rw
      - ./volumes/acme:/etc/acme.sh
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - docktor_proxy

networks:
  docktor_proxy:
    external: true   # must be created (docker network create docktor_proxy) before this stack deploys — see Common Pitfalls
```

**D-04 note:** this compose skeleton has no `VIRTUAL_HOST` on either of its own containers (nginx-proxy/acme-companion are never themselves proxied), so it needs no domain assigned — it is purely infrastructure.

### Anti-Patterns to Avoid

- **Deploying nginx-proxy/acme-companion outside `StackService`'s model:** loses lifecycle safety, monitoring, and the D-12 protection hook for free; do not build a parallel deploy path.
- **Full-document restringify on every domain toggle:** use the `compose-editor.ts` targeted-mutation pattern, not `compose-rewriter.ts`'s approach, for repeated per-service edits (see Pattern 2).
- **Writing one `VIRTUAL_HOST`/`LETSENCRYPT_HOST` env var per domain:** nginx-proxy's model is one comma-separated value per service, not N separate env-var keys; the `ProxyConfig` table can have N rows per service, but the compose write path must aggregate them into one value each.
- **Treating `ProxyConfig` rows as the source of truth:** per the project's YAML-first decision, the compose file is authoritative; `ProxyConfig` rows are a derived index for the UI (rebuild-from-compose-on-mismatch should be considered, mirroring how `Service` rows are synced from parsed compose content in `replaceServices()`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Reverse proxy / vhost generation | A custom Docker-socket watcher that writes nginx config | `nginx-proxy` container (D-01, locked) | Purpose-built, actively maintained, exactly the integration model this phase targets |
| ACME/Let's Encrypt cert issuance & renewal | Custom ACME client (e.g. driving `certbot` or an ACME library directly) | `acme-companion` container | Handles HTTP-01 challenge routing through nginx-proxy, renewal scheduling, and multi-domain SAN certs; re-implementing this is exactly the kind of "deceptively complex" problem this section exists to flag |
| Compose-file YAML mutation | A regex-based or line-splice env-var injector | `yaml` package's `Document`/`getIn`/`setIn` API, per `compose-editor.ts`'s existing precedent | Regex-based YAML editing is fragile against quoting/indentation/multi-line values; this project already solved this correctly once — don't re-solve it worse |
| Host-port-in-use detection (D-11) | Nothing existing to reuse directly — this is new | See Common Pitfalls below for the two candidate approaches | No existing Docktor code checks port availability; `assertStacksDirMatchesHost()` is the closest fail-loudly precedent in spirit but checks a path, not a port |

**Key insight:** every piece of this phase that touches Docker or compose files already has a correct-shaped precedent somewhere in this codebase from Phases 1-5. The risk in this phase is not "which library" but "did you find and reuse the existing pattern, or did you reinvent a worse version of it."

## Common Pitfalls

### Pitfall 1: One `VIRTUAL_HOST`/`LETSENCRYPT_HOST` env var per domain instead of one comma-separated value
**What goes wrong:** Compose only allows one `environment.VIRTUAL_HOST` key per service; writing a second `ProxyConfig` row's domain as a second env var key silently overwrites the first (YAML object keys are unique) rather than adding a domain.
**Why it happens:** D-08 makes it natural to think "one domain = one env var to write," but nginx-proxy's model is "one service = one (possibly multi-value) `VIRTUAL_HOST`."
**How to avoid:** The write path for `assignDomain`/`removeDomain` must always re-read ALL `ProxyConfig` rows for that `(stackId, serviceName)` pair and re-render the full comma-separated value, not patch a single domain in isolation.
**Warning signs:** A second domain assigned to an already-proxied service silently has no effect, or replaces the first domain instead of adding to it.

### Pitfall 2: `docktor_proxy` external network doesn't exist yet when a target stack redeploys
**What goes wrong:** `docker compose up` fails with a "network docktor_proxy declared as external, but could not be found" error if a service's compose file references `networks: {docktor_proxy: {external: true}}` before the network has been created.
**Why it happens:** The network must be created once, either by `docker network create docktor_proxy` run by Docktor, or implicitly by being defined as non-external in the proxy stack's own compose file (Compose auto-creates non-external networks it owns) and then referenced as `external: true` everywhere else.
**How to avoid:** Have the proxy stack's own compose file own the `docktor_proxy` network definition (non-`external`, created on that stack's first deploy) OR have `deployProxyStack()` explicitly run `docker network create docktor_proxy` (idempotent — check-then-create or catch "already exists") before any target service can be edited to reference it. Recommend gating: `assignDomain()` should refuse with a clear error if the proxy stack isn't deployed yet, rather than silently producing a broken compose file.
**Warning signs:** Redeploy of a proxied service fails with a network-not-found compose error.

### Pitfall 3: Host ports 80/443 check races or under-detects (D-11)
**What goes wrong:** Two candidate detection approaches each have gaps. (a) Inspecting Docker containers' published ports via `dockerode.listContainers()` for existing `80`/`443` host bindings only catches ports bound by *other Docker containers* — it misses a bare host process already listening on 80/443 outside Docker. (b) A raw `net.createServer().listen(80)` bind-test from inside the Docktor container only tests **the Docktor container's own network namespace**, which is different from the host's under Docker-outside-of-Docker (Docktor does not itself publish 80/443) — a bind success inside the container does NOT prove the port is free on the host.
**Why it happens:** Docktor runs DooD (drives the *host's* Docker daemon over a socket, but is not itself on the host network) — this is the same class of host/container path divergence documented for `assertStacksDirMatchesHost()`.
**How to avoid:** The only reliable check from inside a DooD container is `dockerode.listContainers()` port-binding inspection (catches the common case: another container already publishing 80/443) combined with fail-loud-on-actual-deploy-failure: if `docker compose up` for the proxy stack fails because the host port is genuinely taken by a non-Docker process, surface that `docker compose` stderr directly to the user (D-11's "fail loudly" is satisfied by relaying the real error, not by a perfect pre-flight check). Do not attempt the in-container `net.listen()` bind test — it produces a false negative (reports free when the host port is actually taken) precisely in the case D-11 cares about.
**Warning signs:** Proxy stack deploy silently "succeeds" per Docktor's DB state while `docker compose up` actually failed underneath, or a pre-flight check falsely reports success/failure.

### Pitfall 4: "Protected stack" enforced only in the UI, not the API
**What goes wrong:** `client/src/routes/app/stacks/components/stack-actions.tsx`'s current button-disabling pattern `[VERIFIED: read this session]` is purely client-side (`disabled={!canDelete}` etc. derived from `status`); it has no server-side counterpart today beyond `StackService`'s status-machine guard (`guardTransition`). If D-12's protection is implemented only as a client prop, a direct API call (`DELETE /api/stacks/docktor-proxy`) still succeeds.
**Why it happens:** Every existing action guard in `StackService` (`deployStack`, `stopStack`, `restartStack`, `deleteStack`, `updateImages`) currently takes only `id` as an argument and checks the `StackStatus` state machine — there is no concept of a per-stack immutable flag today `[VERIFIED: grep across server/src, client/src confirmed zero existing references to "protected"/"isSystem"/"hidden" as a stack concept]`.
**How to avoid:** Add the `isProtected` check inside `StackService`'s methods themselves (e.g. at the top of `stopStack`/`restartStack`/`deleteStack`, throw `BadRequestError`/`ConflictError` before `guardTransition` runs), not just in the client's `StackActions` component. The client disabling is UX-only; the server check is the actual guarantee.
**Warning signs:** `curl -X DELETE /api/stacks/docktor-proxy` succeeds despite the dashboard hiding the delete button.

### Pitfall 5: TLS toggle writes `LETSENCRYPT_HOST` even before a cert has ever been issued for that domain
**What goes wrong:** Setting `LETSENCRYPT_HOST` on a service immediately triggers acme-companion's HTTP-01 challenge flow, which requires the domain's DNS to already resolve to this host on ports 80/443 publicly. If a user enables TLS before DNS propagation, the challenge fails (understood and expected), but if there's no user-visible feedback, this reads as "Docktor is broken."
**Why it happens:** There's no synchronous "did the cert issue" API — this is exactly why D-05 exists.
**How to avoid:** Implement D-05's poller (Pattern in Architecture section) before or alongside PRXY-01/02's write path, so a stuck/failed cert is visible, not silent. Surface both a "pending" and a distinct "failed" state (not just success/absence) — parsing acme-companion's log lines for repeated retry/error patterns, not just checking cert-file absence (a genuinely-pending-but-healthy first issuance also has no cert file yet).
**Warning signs:** UAT reports "I set a domain and nothing happened" with no further detail in the UI.

## Code Examples

Verified patterns read directly from the existing codebase this session.

### Surgical compose edit primitive (`compose-editor.ts`, to be mirrored for proxy env vars)
```typescript
// Source: server/src/lib/compose-editor.ts (read verbatim this session)
export function setServiceImageTag(content: string, serviceName: string, newTag: string): string {
    const doc = parseDocument(content);
    const rawImage = readServiceImage(doc, serviceName);
    const {name} = splitImageRef(rawImage);
    const newImage = `${name}:${newTag}`;

    const path = ["services", serviceName, "image"];
    const imageNode = doc.getIn(path, true);
    if (isScalar(imageNode)) {
        (imageNode as Scalar).value = newImage;
    } else {
        doc.setIn(path, newImage);
    }

    return doc.toString({lineWidth: 0});
}
```
The proxy env-var writer should follow this exact shape against `["services", serviceName, "environment"]` and `["services", serviceName, "networks"]` paths instead of `["services", serviceName, "image"]`.

### Log tailing primitive for D-05 (`DockerodeClient.getLogStream`)
```typescript
// Source: server/src/infrastructure/dockerode-client.ts:35-42 (read verbatim this session)
async getLogStream(containerId: string, tail = 100): Promise<NodeJS.ReadableStream> {
    return this.docker.getContainer(containerId).logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail,
        timestamps: true,
    }) as unknown as NodeJS.ReadableStream
}
```

### SSE event union to extend (`state-broadcaster.ts`)
```typescript
// Source: server/src/lib/state-broadcaster.ts:1-58 (read verbatim this session)
export type StateEvent =
    | ContainerStateEvent
    | StackStatusEvent
    | ConfigChangedEvent
    | ConfigErrorEvent
    | UpdateAvailableEvent
    | NotificationCreatedEvent
// New member to add, matching this shape:
// | ProxyCertStatusEvent { type: "proxy_cert_status"; proxyConfigId: string; domain: string; status: "pending" | "issued" | "failed"; message?: string }
```

### Existing `ProxyConfig` schema (needs revision per D-06/D-08)
```prisma
# Source: server/prisma/schema/proxy.prisma (read verbatim this session)
model ProxyConfig {
  id          String @id @default(cuid())
  stackId     String
  stack       Stack  @relation(fields: [stackId], references: [id], onDelete: Cascade)

  serviceName String // which service in the stack to expose
  domain      String // e.g. "cloud.example.com"
  internalPort Int   // e.g. 80
  tlsEnabled  Boolean @default(true)
  isPublic    Boolean @default(true) // false = LAN-only

  // NPM integration
  npmProxyHostId Int? // Nginx Proxy Manager host ID, if managed

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([domain])
}
```
Note: this model already permits multiple rows per `(stackId, serviceName)` — nothing today enforces one-domain-per-service — so D-08 (multiple domains per service) requires **no structural schema change**, only removing `npmProxyHostId` (D-06) and deciding `isPublic`'s fate (D-06). The `@@unique([domain])` constraint (D-07) is already correct as-is.

### Existing `Setting` schema (target for D-09's ACME email)
```prisma
# Source: server/prisma/schema/setting.prisma (read verbatim this session)
model Setting {
  key       String   @id
  value     String // stored as string; JSON for complex values, encrypted for secrets
  encrypted Boolean  @default(false) // if true, value is AES-encrypted
  updatedAt DateTime @updatedAt
}
```

### Existing `Stack` schema (target for D-12's protected/visibility flags)
```prisma
# Source: server/prisma/schema/stack.prisma (read verbatim this session, relevant excerpt)
model Stack {
  id               String      @id // slugified name, e.g. "my-nextcloud"
  displayName      String
  ...
  status           StackStatus @default(DRAFT)
  ...
  # No isProtected / isHidden / isSystem field exists today — confirmed by
  # grep across server/src and client/src this session (zero matches for
  # "protected"/"isSystem"/"system.?stack" as a stack concept).
}
```
Recommend adding `isProtected Boolean @default(false)` here for D-12's stop/delete/restart guard. Dashboard visibility (also D-12, "configurable in Settings") should be a separate `Setting` key (e.g. `proxy.showInDashboard`), not a second column on `Stack` — it's a display preference, not a stack-intrinsic fact, and this project already has a Settings key/value store purpose-built for exactly this kind of toggle.

### `DockerExecutor` — confirms the proxy stack deploys through the identical mechanism as every user stack
```typescript
// Source: server/src/infrastructure/docker-executor.ts (read verbatim this session)
async up(stackId: string): Promise<void> {
    await this.composeExec(stackId, ["up", "-d", "--remove-orphans"]);
}
```
`composeExec` runs with `cwd: getStackPath(stackId)` `[VERIFIED: server/src/infrastructure/docker-executor.ts:14-21]` — i.e. it operates on whatever directory is registered under the managed stacks dir, with no special-casing possible or needed for a "proxy" stack; it is exactly one more `Stack` row.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| REQUIREMENTS.md's "Nginx Proxy Manager REST API integration" (PRXY-02/03 original wording) | `nginx-proxy` + `acme-companion`, env-var/label driven | This session (D-01, 2026-09-03) | The `npmProxyHostId` field and any planned REST client are dead; do not build an HTTP client for this phase |
| `jwilder/nginx-proxy` / `jrcs/letsencrypt-nginx-proxy-companion` (original, now-archived image names, still referenced by many older blog posts and tutorials found during research) | `nginxproxy/nginx-proxy` / `nginxproxy/acme-companion` (current org, actively maintained) | Ongoing since the community fork | Do not follow tutorials referencing the old `jwilder`/`jrcs` image names — use the `nginxproxy/*` images only |

**Deprecated/outdated:** `jwilder/nginx-proxy` and `jrcs/letsencrypt-nginx-proxy-companion` — both appeared repeatedly in search results as legacy/archived; use only `nginxproxy/nginx-proxy` and `nginxproxy/acme-companion`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `LETSENCRYPT_HOST` accepts the same comma-separated multi-domain syntax as `VIRTUAL_HOST` | Pattern 2 (Code Examples) | If false, a service with 2+ domains would only get a cert for the wrong/partial domain set; medium risk, should be a `checkpoint:human-verify` before shipping D-08's multi-domain TLS path — verify against a real deploy or the acme-companion source (`LETSENCRYPT_SINGLE_DOMAIN_CERTS` toggling "separate certificates" strongly implies the default is one SAN cert across a comma-joined list, but this was inferred from a fetch summary, not read as raw source) |
| A2 | The container-identification mechanism between `nginx-proxy` and `acme-companion` is best set via `NGINX_PROXY_CONTAINER=<container_name>` rather than the label-based auto-detection | Pattern 3 (Code Examples) | Two different fetches this session returned two different label strings (`com.github.nginx-proxy.nginx-proxy.nginx` vs `com.github.nginx-proxy.nginx`) for the same purpose — low risk since `NGINX_PROXY_CONTAINER` (confirmed via a separate, consistent WebSearch) sidesteps the ambiguity entirely, but the planner should pin the container name explicitly rather than rely on either label |
| A3 | `nginxproxy/nginx-proxy:1.11-alpine` and `nginxproxy/acme-companion:2.6.3` are the correct pinned tags to use | Standard Stack | These were the most recent numbered tags returned by WebSearch at research time (2026-09-03); a `checkpoint:human-verify` (or a fresh `docker manifest inspect`) before first deploy is advisable, since tags observed via search snippets can be stale by the time of execution |
| A4 | A bind-mounted (not named-volume) `certs` directory under the proxy stack's own `./volumes/certs` is readable by the Docktor process itself for D-05's file-presence check, with no additional permission handling needed | Pitfall 5 / Pattern in Summary | If acme-companion writes cert files as a non-Docktor UID with restrictive permissions, Docktor's own filesystem stat may fail; should be a `checkpoint:human-verify` during D-05 implementation — check the actual file ownership acme-companion writes with, since this project already runs entirely as one process without a documented UID-matching convention for this specific case |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Exact env var contract between `nginx-proxy`/`acme-companion` documentation pages is internally inconsistent**
   - What we know: CONTEXT.md's canonical refs assert `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` are current `[CITED: nginx-proxy/acme-companion, per CONTEXT.md]`. One doc fetch this session (`docs/Basic-usage.md`) returned `ACME_HOST`/`ACME_EMAIL` instead and explicitly stated "the documentation does not mention LETSENCRYPT_HOST or LETSENCRYPT_EMAIL" for that page, while a second fetch (the wiki's "Let's Encrypt and ACME" page) returned `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` as the apparently-canonical set with no mention of `ACME_HOST`/`ACME_EMAIL`.
   - What's unclear: whether `ACME_HOST`/`ACME_EMAIL` are a newer CA-agnostic alias family (acme-companion supports non-Let's-Encrypt ACME CAs, which plausibly motivated a rename) that coexist with the legacy `LETSENCRYPT_*` names for backward compatibility, or whether one doc page is simply stale.
   - Recommendation: at plan/execution time, either read the acme-companion image's actual entrypoint/nginx-gen template source (most authoritative, not a doc page) or do a `checkpoint:human-verify` live-testing both `LETSENCRYPT_HOST` and `ACME_HOST` against a real deployed instance before committing to one in the compose-write code. Given CONTEXT.md's canonical refs lock in `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL`, default to those unless the execution-time check shows otherwise.

2. **Should the proxy stack's own compose file be user-editable via the normal compose/environment tabs?**
   - What we know: D-12 requires protecting it from stop/delete/restart via the *action* UI; nothing in CONTEXT.md addresses whether its Compose/Environment tabs (which exist for every other stack) should also be locked read-only.
   - What's unclear: whether a user editing the proxy stack's compose file directly (e.g. removing the `docktor_proxy` network definition) is a supported escape hatch or should also be blocked.
   - Recommendation: default to leaving Compose/Environment tabs editable (consistent with "protected" meaning specifically the destructive lifecycle actions D-12 names — stop/delete/restart — not a fully locked-down stack), but flag this as a planner discretion call, not a locked decision.

3. **Does `docker compose down` (used by `StackService.deleteStack()`'s `docker.down(id)` call) ever legitimately run against the proxy stack?**
   - What we know: `DockerExecutor.down()` uses `docker compose down -v` `[VERIFIED: server/src/infrastructure/docker-executor.ts]` — the `-v` flag removes volumes, which would destroy issued certs.
   - What's unclear: whether D-12's "protected from delete" fully prevents this path from ever being reachable for the proxy stack (it should, if enforced server-side per Pitfall 4), or whether there's a separate "uninstall proxy" flow needed later.
   - Recommendation: confirm in planning that `isProtected` blocks `deleteStack()` unconditionally; no separate uninstall flow is in scope for Phase 6 per CONTEXT.md's Deferred Ideas (none deferred — meaning this is out of scope entirely for now, not merely deferred).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Docker Engine / socket (`/var/run/docker.sock`) | Deploying the proxy stack, all compose operations | Assumed present (Docktor's core DooD dependency, already required by every other phase) | — | None — Docktor cannot function at all without this; not a new Phase 6 dependency |
| Host ports 80/443 free | First deploy of the proxy stack (D-11) | Unknown until deploy time — this is exactly what D-11's fail-loud check exists for | — | None (D-11 explicitly rejects a silent alternate-port fallback) |
| Outbound internet access from the Docker host (to Let's Encrypt's ACME endpoint and to Docker Hub for image pulls) | `acme-companion`'s HTTP-01 challenge flow; initial image pull of `nginxproxy/nginx-proxy`/`nginxproxy/acme-companion` | Not verifiable in this research session (no live target host) | — | None documented; a self-hosting deployment with no outbound internet cannot use Let's Encrypt at all — this is an inherent constraint of the ACME model, not something Docktor can work around |
| Public DNS resolution of the domains a user assigns | Cert issuance (HTTP-01 challenge validates DNS→host mapping) | Not verifiable in this research session | — | None — surfaced via D-05's pending/failed status instead of blocking the domain-assignment UI action itself |

**Missing dependencies with no fallback:** host ports 80/443 (D-11, by design); outbound internet + DNS for ACME issuance (inherent to Let's Encrypt).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `[VERIFIED: server/package.json:10 — "test": "vitest run"]` |
| Config file | `server/vitest.config.ts` `[VERIFIED: read this session — defines "unit" project (`test/unit/**/*.test.ts`) and "test/integration" project (`test/integration/**/*.test.ts`, 30s timeouts)]` |
| Quick run command | `yarn workspace @docktor/server test` (runs the "unit" project by default per existing usage) |
| Full suite command | `yarn workspace @docktor/server test` (both projects) + `yarn workspace @docktor/server test:integration` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| PRXY-01 | `ProxyService.assignDomain()` writes correct env vars/network into target compose, upserts `ProxyConfig` | unit | `yarn workspace @docktor/server test test/unit/application/proxy-service.test.ts` | ❌ Wave 0 |
| PRXY-01 | Compose-editor surgical mutation preserves unrelated YAML content | unit | `yarn workspace @docktor/server test test/unit/lib/compose-proxy-editor.test.ts` | ❌ Wave 0 |
| PRXY-02 | Proxy stack deploys via `StackService.deployStack()` and is marked `isProtected` | integration | `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` | ❌ Wave 0 |
| PRXY-03 | ACME email setting persists via `SettingsService`/`SettingsRepository` | unit | `yarn workspace @docktor/server test test/unit/application/settings-service.test.ts` | ✅ existing file — extend |
| PRXY-04 | `removeDomain()` clears env vars, redeploys, deletes `ProxyConfig` row | unit | `yarn workspace @docktor/server test test/unit/application/proxy-service.test.ts` | ❌ Wave 0 (same file as PRXY-01) |
| PRXY-05 | Re-applying an existing domain updates in place, no duplicate env var / no duplicate `ProxyConfig` row (unique constraint) | unit | same file as PRXY-01/04 | ❌ Wave 0 |
| D-11 | Deploying proxy stack with host port 80/443 already bound fails loudly with a surfaced error | integration | `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` | ❌ Wave 0 (same file as PRXY-02) |
| D-12 | `stopStack`/`restartStack`/`deleteStack` reject when `isProtected: true` | unit | `yarn workspace @docktor/server test test/unit/application/stack-service.test.ts` | ✅ existing file `[VERIFIED: server/test/unit/application/stack-service.test.ts]` — extend |

### Sampling Rate
- **Per task commit:** `yarn workspace @docktor/server test` (unit project)
- **Per wave merge:** `yarn workspace @docktor/server test` + `yarn workspace @docktor/server test:integration`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `server/test/unit/lib/compose-proxy-editor.test.ts` — covers PRXY-01/04/05 (surgical YAML edit correctness, comma-joining multiple domains, idempotent re-apply)
- [ ] `server/test/unit/application/proxy-service.test.ts` — covers PRXY-01/04/05 (orchestration, domain uniqueness conflict handling)
- [ ] `server/test/integration/proxy.test.ts` — covers PRXY-02, D-11 (real deploy against a test DB; port-conflict path likely needs mocking `DockerExecutor` rather than a real port bind, per Pitfall 3's finding that in-container bind tests are unreliable)
- [ ] Extend `server/test/unit/application/stack-service.test.ts` — covers D-12 (protected-stack guard)
- [ ] Extend `server/test/unit/application/settings-service.test.ts` — covers PRXY-03 (ACME email getter/setter)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No (unchanged) | Existing `requireAuth` preHandler on all new routes, per every existing route file `[VERIFIED: pattern confirmed in server/src/routes/backups.ts:24]` |
| V3 Session Management | No (unchanged) | N/A — reuses existing better-auth session handling |
| V4 Access Control | Yes | `requireAuth` on all `routes/proxy.ts` endpoints; D-12's server-side `isProtected` check is itself an access-control control (see Known Threat Patterns) |
| V5 Input Validation | Yes | Domain strings and ports must be Zod-validated in `@docktor/shared` (new `proxyConfigSchema`) before being interpolated into compose YAML — see Known Threat Patterns |
| V6 Cryptography | No new surface | ACME/TLS cert material is entirely owned and generated by `acme-companion`; Docktor never generates, stores, or handles private key material directly — it only reads cert file *presence*, not content, for D-05 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Domain-name / env-var injection: a malicious `domain` value containing YAML-breaking characters or shell-meaningful characters written into the target service's compose `environment` block | Tampering | Zod-validate the domain against a strict hostname pattern (RFC 1123-style, no wildcards beyond what's explicitly supported) before it ever reaches the compose-editor; the `yaml` package's `setIn`/scalar-value mutation (Pattern 2) already avoids string-splice injection risk by construction (values are set as proper YAML scalars, not string-concatenated into raw text) — but validation must still happen at the Zod-schema boundary in `routes/proxy.ts`, not rely on the editor alone |
| Domain hijack: a second user (irrelevant here, single-user model) or a race between two `assignDomain` calls both claiming the same domain for different services | Tampering / Repudiation | `@@unique([domain])` DB constraint (D-07, already present) plus catching the resulting Prisma unique-constraint violation and translating it to a `ConflictError` (409), matching the existing `StackService.createStack()` pattern for slug conflicts |
| A user deletes/stops the proxy stack, silently taking down TLS termination and routing for every proxied service on the instance | Denial of Service | D-12's `isProtected` server-side enforcement (Pitfall 4) — this is the primary mitigation the CONTEXT.md decisions already designed in |
| Docker socket exposure via the proxy stack's own containers (`nginx-proxy` mounts the socket read-only; `acme-companion` mounts it read-write per the official example `[CITED: acme-companion docs]`) | Elevation of Privilege | This is an accepted, documented risk inherent to the `nginx-proxy`/`acme-companion` model itself (same class of risk Docktor's own `docker-compose.yml` already accepts and documents for its own DooD socket mount `[VERIFIED: docker-compose.yml comment: "This grants the container host-root-equivalent reach..."]`) — document identically in the proxy stack's own compose file comments rather than silently mounting it |
| A malicious/compromised proxied container sets its own `VIRTUAL_HOST`/`LETSENCRYPT_HOST` env vars directly (bypassing Docktor's UI) to hijack a domain or trigger unwanted cert issuance for a domain it doesn't legitimately serve | Spoofing | Out of scope for Phase 6 to fully mitigate (this is `nginx-proxy`'s own trust model — any container on the shared network can set these env vars); note as an accepted risk consistent with the project's single-user, trusted-operator threat model (already the basis for "RBAC / multi-user" being out of scope project-wide) |

## Sources

### Primary (HIGH confidence — read directly this session)
- `server/prisma/schema/proxy.prisma`, `setting.prisma`, `service.prisma`, `stack.prisma` — exact current schema shapes
- `server/src/infrastructure/compose-editor.ts`, `compose-rewriter.ts`, `volume-migrator.ts`, `compose-analyzer.ts`, `docker-executor.ts`, `dockerode-client.ts`
- `server/src/application/stack-service.ts`, `settings-service.ts`, `index.ts` (singleton wiring)
- `server/src/jobs/state-poller.ts`, `server/src/lib/state-broadcaster.ts`, `stacks-dir.ts`, `crypto.ts`, `errors.ts`, `compose-parser.ts`
- `server/src/repositories/stack-repository.ts`, `settings-repository.ts`
- `client/src/routes/app/stacks/[id].tsx`, `components/stack-actions.tsx`, `components/backup-config-card.tsx` (via backups-api.ts)
- `client/src/routes/setup/components/backup-step.tsx`, `client/src/routes/setup.tsx`
- `shared/src/validation/backups.ts`, `shared/src/validation/index.ts`
- `docker-compose.yml`, `server/package.json`, `.planning/config.json`
- `.planning/phases/06-proxy-configuration/06-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary (MEDIUM confidence — official docs, WebFetch/WebSearch this session)
- `https://github.com/nginx-proxy/nginx-proxy/blob/main/docs/README.md` (env var reference, network requirements, volumes, label)
- `https://raw.githubusercontent.com/nginx-proxy/acme-companion/main/README.md` and `.../docs/Basic-usage.md` and the wiki "Let's Encrypt and ACME" page (env vars — internally inconsistent, see Open Questions)
- `https://raw.githubusercontent.com/nginx-proxy/acme-companion/main/docs/Docker-Compose.md` (canonical two-container compose example)
- `hub.docker.com/r/nginxproxy/nginx-proxy/tags`, `hub.docker.com/r/nginxproxy/acme-companion` (current image tags/maintenance signal, via WebSearch)

### Tertiary (LOW confidence)
None used as the basis for a stated recommendation — all `[ASSUMED]`-worthy gaps are captured in the Assumptions Log above instead.

## Metadata

**Confidence breakdown:**
- Docktor-internal integration surface (schema, compose-editing precedent, deploy pipeline, SSE, action-guard pattern): HIGH — every claim was read directly from source this session and quoted verbatim where required.
- `nginx-proxy`/`acme-companion` external mechanics (env vars, volumes, network model): MEDIUM — official docs fetched this session, but two doc pages disagreed on env var naming (see Open Question 1); recommend a `checkpoint:human-verify` before the compose-write code is finalized.
- Image tags/versions: MEDIUM — current as of this session's WebSearch, but image tags move; recommend re-verifying immediately before execution with `docker manifest inspect nginxproxy/nginx-proxy:1.11-alpine` / `nginxproxy/acme-companion:2.6.3`.

**Research date:** 2026-09-03
**Valid until:** 2026-09-17 (14 days — shorter than the default 30 for stable domains, because this phase's external dependency (`nginx-proxy`/`acme-companion` image tags and doc content) is fast-moving relative to the rest of this project, per the internally-inconsistent doc-page finding in Open Question 1)
</content>
