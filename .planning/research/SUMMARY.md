# Project Research Summary

**Project:** Docktor — Docker Compose management platform
**Domain:** Self-hosted Docker Compose management (single-host, homelab/personal server)
**Researched:** 2026-03-10
**Confidence:** HIGH (stack and architecture verified against installed source; features and pitfalls grounded in codebase analysis and domain expertise)

## Executive Summary

Docktor is a self-hosted Docker Compose management platform targeting non-expert users who run personal servers or homelabs. The existing codebase (Milestone 1) has already shipped core stack lifecycle operations, a CodeMirror compose editor, authentication, and a schema that anticipates the full feature set. Milestone 2 is about completing the product to a fully usable state: the three remaining MVP items (container state poller, live log streaming, settings page) plus a structured sequence of post-MVP features that transform Docktor from functional to compelling. The stack is largely locked — all supporting libraries (chokidar, node-cron, dockerode, yaml) are already installed; the only new dependency is nodemailer for SMTP notifications.

The recommended architectural approach is to extend the existing layered server cleanly: a new jobs subsystem (StatePoller, FileWatcher, UpdateChecker, BackupScheduler) registered via Fastify lifecycle hooks, a DockerodeClient infrastructure adapter wrapping the already-installed dockerode, a SettingsRepository for key-value settings persistence, and a CliRunner for restic subprocess management. No new top-level patterns are needed. The critical path for MVP is: Settings → StatePoller → SSE log streaming, in that dependency order. All other features build on this foundation.

The three highest risks in this milestone are: (1) the state poller race-conditioning on transitional states, which requires an explicit skip-list and optimistic locking; (2) dockerode log stream leaks on SSE client disconnect, which requires mandatory `request.raw.on('close', stream.destroy)` handling; and (3) the Nginx Proxy Manager API integration, which uses an undocumented internal API prone to version drift. The NPM integration is correctly deferred to the final phase and should be validated against a live NPM instance before implementation begins.

## Key Findings

### Recommended Stack

The stack is almost entirely locked. All critical infrastructure libraries are already installed and their APIs verified against installed source. The single new addition is nodemailer (^6.9) for SMTP notifications — the Node.js industry standard, zero dependencies, full TLS/STARTTLS support. Restic CLI invocation follows the existing DockerExecutor pattern using `node:child_process.spawn` (not execFile — restic needs streaming for long-running backup operations). The Nginx Proxy Manager integration uses native `fetch` with a simple client class; no HTTP client library is needed or appropriate.

See `.planning/research/STACK.md` for full API patterns, verified code samples, and confidence-annotated source references.

**Core technologies:**
- Node.js 22 + TypeScript: runtime and language — locked, ESM throughout
- Fastify 5: HTTP server, SSE via `reply.hijack()` + `reply.raw` — verified pattern
- dockerode 4.0.9: container inspect + log streaming — API verified against installed source
- chokidar 4.0.3: compose file watching — verified, inotify on Linux, no native deps
- node-cron 3.0.3: background job scheduling — already installed
- nodemailer ^6.9: SMTP notifications — only new server dependency
- child_process (built-in): restic CLI invocation via `spawn` with streaming
- native fetch (built-in): Nginx Proxy Manager API client

### Expected Features

The competitive landscape (Portainer, Dockge, Yacht, CasaOS) establishes clear table stakes. Docktor's differentiators are brownfield import, integrated restic backup/restore, file watcher with external edit detection, and the bind-mount convention enforcement. Anti-features are explicitly defined and important — no RBAC, no multi-host, no metrics dashboards, no automatic image updates.

See `.planning/research/FEATURES.md` for competitive analysis, feature dependency graph, and MVP phase ordering.

**Must have (table stakes — MVP):**
- Container state poller — real-time RUNNING/HEALTHY/UNHEALTHY/ERROR visibility
- Live log streaming (SSE, per-service) — #1 debugging tool; SSH-free ops
- Settings page — required before any configurable post-MVP feature

**Should have (differentiators — post-MVP):**
- File watcher + update checker — observability without log-watching
- SMTP notifications on ERROR/UNHEALTHY — passive monitoring for non-experts
- Restic backup + restore — unique in the competitive landscape; critical for self-hosters
- First-run wizard — reduces "where do I start?" friction significantly
- Brownfield import — adoption unlock for existing self-hosters
- Nginx Proxy Manager integration — eliminates the #1 post-deploy friction point

**Defer indefinitely:**
- Multi-host / clustering
- RBAC / multi-user access
- Metrics dashboards (Prometheus/Grafana)
- Marketplace SaaS
- Automatic image updates (silent updates break things; manual-only is correct)

### Architecture Approach

Docktor is a single-process Fastify server. All Milestone 2 work fits cleanly into the existing layered architecture (Routes → Application → Domain → Repositories → Infrastructure) with a new horizontal slice: a Jobs layer that runs background processes registered via Fastify `onReady`/`onClose` hooks. Jobs write to the DB; routes read from the DB or stream directly from Docker — these layers never call each other directly. The container-lookup bridge uses Docker Compose labels (`com.docker.compose.project` / `com.docker.compose.service`) which are set on every container by Compose v2.

See `.planning/research/ARCHITECTURE.md` for the full component diagram, data flow diagrams, suggested build order, and anti-patterns to avoid.

**Major components:**
1. Jobs subsystem (`jobs/index.ts` + job classes) — StatePoller, FileWatcher, UpdateChecker, BackupScheduler; registered via Fastify lifecycle hooks
2. DockerodeClient (`infrastructure/dockerode-client.ts`) — wraps dockerode for log streaming and container inspect; handles demuxStream, TTY detection, AbortController cleanup
3. SettingsRepository + SettingsService (`repositories/settings-repository.ts`, `application/settings-service.ts`) — key-value CRUD with AES-256 encryption for sensitive keys
4. CliRunner (`infrastructure/cli-runner.ts`) — spawn-based subprocess runner for restic; supports AbortSignal and streaming output
5. SSE log route (`routes/logs.ts`) — pipes dockerode log stream to HTTP response; mandatory disconnect cleanup

### Critical Pitfalls

1. **Poller race-conditions on transitional states** — The poller must skip stacks in `DEPLOYING`, `UPDATING`, `BACKING_UP`, `RESTORING`, `MIGRATING` states. Use optimistic locking on DB writes (`WHERE status = $expected`). Failure corrupts the state machine mid-operation.

2. **dockerode log stream leak on SSE disconnect** — Every SSE route must wire `request.raw.on('close', () => logStream.destroy())`. Without this, each disconnected browser tab leaves a live stream on the Docker socket, accumulating file descriptors until the process crashes.

3. **Unbounded log buffer freezes browser** — Always set `tail: 100` in the initial `container.logs()` call. Implement a circular buffer (last 1000 lines) on the client. Never render all lines in the DOM without virtual scrolling.

4. **Restic orphan process holds repo lock** — Use `spawn` directly (not shell), send `SIGKILL` after `SIGTERM` timeout, and auto-run `restic unlock` in the backup failure cleanup path. Without this, a timed-out backup blocks all future backups for the stack.

5. **NPM API non-idempotent proxy host creation** — Always GET-before-POST (check for existing entry by domain), store the NPM proxy host ID in `ProxyConfig` immediately on creation, and implement a reconciliation check. The NPM API has no idempotency keys.

## Implications for Roadmap

Based on the feature dependency graph, architectural build order, and pitfall phase warnings, the following phase structure is recommended:

### Phase 1: MVP Completion — Core Infrastructure
**Rationale:** Three remaining MVP blockers; all other features depend on Settings and StatePoller. Dependency order within this phase: Settings → StatePoller → SSE Logs.
**Delivers:** Fully functional product core — real-time status, live logs, configurable settings.
**Addresses:** Container state poller, live log streaming (SSE), settings page (instance name, base URL, timezone, SMTP config placeholder).
**Avoids:** Poller race conditions (skip transitional states, optimistic locking), dockerode stream leaks (mandatory disconnect cleanup), unbounded log buffers (tail:100 + client circular buffer).
**Research flag:** None — all patterns verified against installed source; HIGH confidence.

### Phase 2: Observability — File Watcher + Update Checker
**Rationale:** Depends on StatePoller (for current image digest) and Settings (for registry credentials). Natural grouping: both are passive background observers. Low implementation risk; high user value.
**Delivers:** External edit detection, image update badges on stack cards, per-service update indicators.
**Uses:** chokidar (already installed), node-cron (already installed), DockerodeClient (from Phase 1).
**Implements:** FileWatcher job, UpdateChecker job, 60s polling reconciliation fallback.
**Avoids:** chokidar inotify unreliability (60s polling fallback is mandatory, not optional), Docker Hub rate limiting (per-service TTL cache + staggered schedule + auth support).
**Research flag:** None — established patterns; chokidar API verified against installed source.

### Phase 3: Notifications — SMTP
**Rationale:** Depends on Settings (SMTP credentials live there) and StatePoller (ERROR/UNHEALTHY triggers). Low implementation cost relative to user value. nodemailer is trivial to integrate.
**Delivers:** Email alerts on container ERROR/UNHEALTHY, backup failure notifications, low-disk warnings.
**Uses:** nodemailer ^6.9 (new dependency), Settings from Phase 1.
**Implements:** NotificationService, per-trigger enable/disable, SMTP credential verify on save.
**Avoids:** Re-creating transporter on every send (create once, recreate only on settings change); using port 465 with secure:false or 587 with secure:true (verify port-to-TLS mapping on save).
**Research flag:** None — nodemailer is industry standard; HIGH confidence from training (no breaking changes in v6 since 2019).

### Phase 4: Backup & Restore
**Rationale:** Most complex post-MVP feature. Depends on Settings (restic repo/password), StatePoller (BACKING_UP/RESTORING states already in state machine). Groups together cleanly: CliRunner, ResticExecutor, BackupService, BackupScheduler, snapshot list UI.
**Delivers:** Manual and scheduled encrypted backups, versioned snapshot restore, retention policies, backup failure notifications.
**Uses:** CliRunner (spawn-based, from architecture), restic CLI (pre-installed in Docker image).
**Implements:** ResticExecutor, BackupService, BackupScheduler job, per-stack backup scheduling via node-cron.
**Avoids:** Orphan restic processes (SIGKILL after SIGTERM; auto-unlock on failure), restic exit code 3 mishandling (explicit exit code branches; partial-success state), live database file backup (stop-and-backup default; document clearly), OOM from buffering restic output (spawn with streaming, not execFile).
**Research flag:** May warrant `/gsd:research-phase` for S3/SFTP restic target configuration — restic remote backends have non-trivial auth patterns.

### Phase 5: Onboarding — First-Run Wizard + Brownfield Import
**Rationale:** First-run wizard writes to the same Settings model built in Phase 1. Brownfield import depends on FileWatcher (Phase 2) to register discovered stacks for monitoring. Grouping together makes sense — both are adoption/onboarding concerns.
**Delivers:** Guided setup for new installs; adopt-in-place migration for existing self-hosters.
**Implements:** First-run wizard (multi-step, writes to Settings), brownfield scanner (reads /host mount, discovers compose files), PathResolver (container-to-host path translation).
**Avoids:** Container path vs. host path mismatch (PathResolver is mandatory; never pass /host/* paths to Docker CLI; store canonical host path in Stack.hostPath).
**Research flag:** Brownfield path translation edge cases may need research — particularly for non-standard Docker socket paths and Docker-in-Docker environments.

### Phase 6: Proxy Configuration — Nginx Proxy Manager Integration
**Rationale:** Correctly deferred last. Has an external dependency (NPM must be running), uses an undocumented internal API (highest risk in the project), and is most niche (not all users need a reverse proxy via NPM). Validate the API against a live NPM 2.x instance before writing production code.
**Delivers:** One-click domain + TLS setup for deployed services via NPM API.
**Uses:** native fetch, Settings (NPM URL + credentials).
**Implements:** NginxProxyManagerClient, ProxyConfig CRUD, proxy host reconciliation job.
**Avoids:** Duplicate proxy host creation (GET-before-POST; store NPM host ID immediately), JWT token expiry mid-operation (401 retry-with-refresh; proactive renewal).
**Research flag:** NEEDS `/gsd:research-phase` — NPM API is undocumented, version-sensitive, and training knowledge is MEDIUM confidence. Verify current API shape against NPM source or a running instance before implementation.

### Phase Ordering Rationale

- Settings before everything: SMTP, restic repo, registry credentials, and NPM API URL all live in the Settings model. Nothing configurable can be built until Settings is implemented.
- StatePoller before SSE logs: the SSE route resolves container IDs via the DockerodeClient's `findContainer` method which uses Compose labels; the poller ensures container state is current before streaming begins.
- Observability before notifications: the update checker and file watcher provide the state that notification triggers reference.
- Backup before onboarding: the first-run wizard optionally configures backup; backup must exist first.
- Brownfield grouped with first-run: both are adoption concerns with shared UI patterns (wizard steps).
- NPM last: external dependency, undocumented API, most niche audience. Deferring reduces implementation risk and allows time to validate the API surface.

### Research Flags

Needs `/gsd:research-phase` during planning:
- **Phase 4 (Backup):** S3 and SFTP restic backend auth configuration — non-trivial patterns that vary by provider.
- **Phase 6 (Proxy):** NPM API surface — undocumented, version-sensitive. Must verify against live NPM 2.x instance. If API has changed materially, may require fallback approach (direct Nginx config file generation).

Standard patterns (skip research-phase):
- **Phase 1 (MVP Completion):** All APIs verified against installed source (dockerode, chokidar, Fastify). Implementation is high-confidence.
- **Phase 2 (Observability):** chokidar and node-cron APIs verified. Docker Hub rate limit patterns are well-documented.
- **Phase 3 (SMTP):** nodemailer is stable and industry-standard. No research needed.
- **Phase 5 (Onboarding):** Brownfield path translation pattern is documented in design.md. Wizard is UI work on existing Settings model.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core APIs verified against installed `node_modules` source. NPM API is MEDIUM (training knowledge only). |
| Features | MEDIUM-HIGH | Docktor-specific requirements are HIGH (from design.md). Competitive landscape ratings are MEDIUM (training knowledge, no live web fetch). |
| Architecture | HIGH | Grounded in existing codebase analysis. Patterns derived from installed source and existing code structure. |
| Pitfalls | HIGH | Derived from codebase inspection + domain mechanics. One exception: inotify bind-mount behavior (Pitfall 10) is MEDIUM. |

**Overall confidence:** HIGH for Phases 1–3. MEDIUM for Phases 4–5 (restic remote targets, brownfield edge cases). MEDIUM for Phase 6 (NPM API).

### Gaps to Address

- **NPM API version compatibility:** Training knowledge is August 2025; NPM API may have changed. Verify `POST /api/tokens`, `POST /api/nginx/proxy-hosts`, and `GET /api/nginx/proxy-hosts` against NPM source before Phase 6 implementation. URL: https://github.com/NginxProxyManager/nginx-proxy-manager
- **Restic S3/SFTP backend auth:** Restic remote backend configuration (bucket names, access keys, known_hosts for SFTP) has non-trivial setup patterns not covered in STACK.md. Research during Phase 4 planning.
- **Docker Hub rate limits for update checker:** Staggered scheduling design needs to be specified (per-stack jitter range, TTL values). Detailed scheduling algorithm deferred to Phase 2 planning.
- **StatusLog retention policy:** Pitfall 12 identifies log spam risk from crash loops. A retention/pruning strategy (delete entries older than 30 days; keep one per hour as summary) needs to be specified in the data model before Phase 1 implementation completes.

## Sources

### Primary (HIGH confidence)
- Installed source: `node_modules/dockerode`, `node_modules/docker-modem`, `node_modules/@types/dockerode` — log streaming, demuxStream, container inspect, AbortSignal
- Installed source: `node_modules/chokidar/index.d.ts` — ChokidarOptions, FSWatcher API
- Installed source: `node_modules/fastify/docs/Reference/Reply.md`, `Migration-Guide-V5.md` — reply.hijack(), reply.raw SSE pattern
- Existing codebase: `server/src/infrastructure/docker-executor.ts`, `server/src/application/stack-service.ts`, `server/src/domain/stack-status-machine.ts` — architectural patterns and existing boundaries
- Project documents: `docs/design.md`, `.planning/PROJECT.md` — requirements, constraints, schema

### Secondary (MEDIUM confidence)
- Training knowledge (August 2025 cutoff): nodemailer ^6.9 API — industry standard, no breaking changes since 2019; not independently verified this session
- Training knowledge: NPM (Nginx Proxy Manager) REST API — internal, undocumented, version-sensitive; requires live validation
- Training knowledge: Portainer, Dockge, Yacht, CasaOS feature sets — competitive landscape, not independently fetched this session

### Tertiary (needs validation)
- NPM API endpoint shapes — verify against https://github.com/NginxProxyManager/nginx-proxy-manager before Phase 6

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
