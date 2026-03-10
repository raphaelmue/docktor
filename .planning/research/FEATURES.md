# Feature Landscape

**Domain:** Docker Compose management platform (self-hosting, single-host)
**Researched:** 2026-03-10
**Confidence note:** Web and Context7 tools unavailable. Analysis based on project design document
(`.planning/PROJECT.md`, `docs/design.md`) and training knowledge of Portainer, Dockge, Yacht, and CasaOS
(knowledge cutoff August 2025). Competitive landscape ratings are MEDIUM confidence; Docktor-specific
requirements derived from the design doc are HIGH confidence.

---

## Competitive Reference Points

| Platform | Positioning | Notable strengths | Known gaps |
|----------|-------------|-------------------|------------|
| **Portainer CE** | Enterprise-adjacent; full Docker/K8s | Rich feature set, multi-host, templates | Heavy UI, overwhelming for personal use |
| **Dockge** | Compose-first, developer UX | Real-time terminal output, clean UI, fast | No backup/restore, limited notifications |
| **Yacht** | Homelab-friendly | Template library, app cards | Compose support less mature, slower development |
| **CasaOS** | App store for personal servers | Curated app store, clean onboarding | Opinionated directory layout, less power-user friendly |

---

## Table Stakes

Features users expect from any Docker Compose management UI. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stack deploy / stop / restart | Core operational control | Low | Already shipped in Docktor |
| Real-time status display | Users need to know if their app is running | Low | Requires poller — in active scope |
| Live container log streaming | #1 debugging tool; SSH-free ops | Medium | In active scope (SSE per-service) |
| Compose file editor in UI | Must be able to edit without SSH | Medium | Already shipped (CodeMirror) |
| Service-level container state | Per-service healthy/unhealthy visibility | Medium | Poller covers this |
| Stack list with status summary | Glanceable dashboard | Low | Already shipped |
| Deploy error surfacing | Must show `docker compose up` failure output | Low | State machine ERROR state + StatusLog |
| Config-changed indicator | Prevents accidental redeploy of stale config | Low | Already shipped |
| Auth / access control | Nobody should be able to reach this without a login | Low | Already shipped (better-auth) |
| Environment variable management | `.env` is standard Docker Compose practice | Low | Already shipped (env editor) |
| Delete stack with cleanup | Remove containers + files | Low | Already shipped |

---

## Differentiators

Features that set Docktor apart from alternatives. Not universally expected, but valued — especially by the
target audience of non-expert self-hosters.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Restic backup + restore | Only Dockge/Portainer lack full backup; Yacht has none | High | Encrypted, deduplicated, multi-target |
| Brownfield import (adopt-in-place) | Existing self-hosters don't have to start over | High | Critical for adoption; nobody else does this smoothly |
| First-run wizard | Removes "where do I start?" friction for new users | Medium | Guided account + config + optional backup/notification setup |
| File watcher (external edit detection) | SSH-first users expect compose edits to reflect in UI | Medium | Chokidar + 60s polling fallback |
| Image update checker | Users need to know when their apps are outdated | Medium | Digest/semver comparison; update is always manual |
| SMTP notifications on ERROR/UNHEALTHY | Passive monitoring without running Prometheus | Medium | Per-trigger enable/disable |
| Disk space monitoring + alerts | Silent disk-full kills services; users rarely notice | Low | Disk warnings at <10% or <2 GB |
| Nginx Proxy Manager integration | Proxy setup is the #1 friction point after deploy | High | NPM API integration; TLS via Let's Encrypt |
| Bind-mount convention enforcement | Transparent data layout, backup-ready from day one | Low-Medium | Named volume rejection with auto-convert offer |
| YAML safety warnings (non-blocking) | Informed users, not restricted users | Low | `privileged`, host mounts, `network_mode: host` |
| Per-stack backup scheduling (cron) | Set-and-forget reliability | Medium | node-cron, per-stack expression |
| Retention policies | Prevents backup storage from growing unbounded | Low | daily/weekly/monthly configurable |
| Restore from snapshot | True recovery, not just re-deploy | High | restic restore → move into place → redeploy |
| Deployment history / StatusLog | Audit trail for "when did this break?" | Low | Append-only StatusLog already in schema |

---

## Anti-Features

Features to explicitly NOT build for this product and audience.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-host / clustering | Docktor is single-host by design; clustering adds enormous complexity for no target-user benefit | Document clearly; users needing multi-host should use Portainer/Nomad |
| RBAC / multi-user | Single-user personal server; shared access rarely needed by target audience | Single admin model; document clearly |
| Metrics dashboards (Prometheus/Grafana) | Out of product scope; dedicated tools do this vastly better | Recommend Grafana stack as a Docktor-managed stack |
| OAuth / LDAP | Adds provider dependencies; email+password is sufficient for personal server | better-auth email+password is sufficient for MVP |
| Docker Secrets integration | Adds swarm dependency; `.env` + encrypted backups covers the security need | chmod 600 + restic encryption |
| Docktor self-update via UI | Circular: self-managed Docktor adds rollback and state complexity | Document `docker compose pull && up -d` workflow |
| Plugin system | Adds maintenance burden and API surface without near-term user benefit | Build the features directly; revisit when stable |
| Form-based YAML abstraction | Obscures what Docker is actually doing; undermines "YAML-first" principle | Keep CodeMirror editor; add lint/warnings inline |
| Marketplace SaaS (user accounts, ratings) | Separate future project; out of this roadmap cycle | Ship ~20 bundled templates; remote index for updates |
| Automatic image updates | Silent auto-updates break things; users need control | Update checker + manual Update button |
| Named Docker volume support | Breaks backup simplicity; requires extra steps; non-transparent | Reject with auto-convert offer (bind mount to `./volumes/`) |
| Inter-stack overlay networking | Adds Docker overlay complexity; users can use `external: true` | Document manual pattern |
| WebSocket for log streaming | SSE is simpler and sufficient for unidirectional log display | SSE via Fastify |

---

## Feature Detail: Log Streaming

What users expect from live container logs in a management UI:

| Expectation | Basis | Docktor approach |
|-------------|-------|-----------------|
| Real-time output (no polling delay) | Core use case: watch a deploy happen | SSE via dockerode log stream |
| Per-service filtering | Multi-service stacks are noisy | Per-service SSE streams + combined view |
| Service name prefixes in combined view | Easy to distinguish which service is logging | Combined stream prefixes each line with `[service-name]` |
| Historical logs (before UI opened) | Users connect mid-run and need context | dockerode supports `tail=N` on log stream open |
| No infinite scroll / memory leak | Long-running streams accumulate lines | Frontend should cap displayed lines (e.g., last 1000) and auto-scroll |
| ANSI color support | Many Docker images use colored output | Terminal-like renderer, strip or render ANSI codes |
| Clear indicator when stream is disconnected | SSE drops on server restart / network blip | Frontend reconnects automatically; shows "reconnecting..." state |

**Confidence:** MEDIUM — derived from training knowledge of Portainer/Dockge behavior and common Docker UX patterns.

---

## Feature Detail: Update Checking

What users expect from a Docker image update checker:

| Expectation | Basis | Docktor approach |
|-------------|-------|-----------------|
| "Updates available" badge on stack | Passive awareness without dashboard spam | Badge on stack card + detail page |
| Per-service update indicator | Multi-service stacks have uneven update cadence | Per-service row in services table |
| Never auto-apply updates | Trust / data integrity: silent updates break things | Manual "Update" button only |
| Support semver tags (`latest`, `v1.2.3`) | Most self-hosted images use semver or `latest` | Semver comparison + date-based + digest fallback |
| Support digest comparison for `latest` tag | `latest` has no version to compare | Digest comparison: current vs. registry HEAD |
| Private registry credentials | Some users host their own registries | Registry model in DB; credentials stored encrypted |
| Rate-limit awareness (Docker Hub) | Docker Hub has aggressive pull rate limits | Cache registry responses; stagger update checks; respect 429 |
| Manual "check now" trigger | Users want on-demand checks, not just scheduled | Manual check button on stack detail |

**Confidence:** MEDIUM — derived from training knowledge of Dockge/Watchtower/Diun behavior.

---

## Feature Detail: Backup & Restore

What users expect from a backup feature in a self-hosting management tool:

| Expectation | Basis | Docktor approach |
|-------------|-------|-----------------|
| One-click manual backup | Ad-hoc backup before risky changes | Manual backup button on stack detail |
| Scheduled automatic backups | Set-and-forget safety net | Per-stack cron expression via node-cron |
| Versioned snapshots (not just latest) | Need to roll back to specific point in time | Restic versioned snapshots |
| Off-site backup target | Local backup doesn't protect against host failure | SFTP + S3-compatible in addition to local |
| Encrypted backup at rest | `.env` files contain secrets | Restic encryption (AES-256) |
| Retention policy | Storage doesn't grow forever | daily/weekly/monthly configurable |
| Restore to a specific snapshot | Select from snapshot list, not just "restore latest" | Snapshot list with timestamps + sizes |
| Notification on failure | Silent backup failure is worse than no backup | SMTP alert on backup failure |
| Consistency awareness | Live databases need special handling | Stop-and-backup default; pre/post hooks for app-aware backups (post-MVP) |
| Clear indication of what is NOT backed up | Absolute-path volumes outside stack dir | Warning at edit time and at backup time |

**Confidence:** MEDIUM-HIGH — derived from restic documentation patterns + common homelab expectations.

---

## Feature Dependencies

```
Container state poller
  → Live stack/service status (dashboard + detail page)
  → Auto-transitions (RUNNING→HEALTHY→UNHEALTHY→ERROR)
  → Update checker (needs running services to know current image)
  → Disk space monitoring (runs alongside poller)

Live log streaming (SSE)
  → Container state poller (needs container IDs from poller)

Settings page (instance name, base URL, timezone)
  → First-run wizard (wizard writes same settings)
  → Notifications (SMTP settings live here)
  → Backup config (restic settings live here)

File watcher
  → Config-changed indicator (already partially built; watcher provides the trigger)

Image update checker
  → Registry credentials (Settings page)
  → Container state poller (to know current running image digest)

Notifications (SMTP)
  → Settings page (SMTP credentials)
  → Container state poller (ERROR/UNHEALTHY triggers)
  → Backup engine (failure trigger)
  → Disk space monitor (low-disk trigger)

Backup & Restore
  → Settings page (restic repo + password)
  → Stack state machine (BACKING_UP, RESTORING states already defined)
  → Disk space monitoring (warns before backup fills disk)

First-run wizard
  → Settings page (wizard writes to same settings model)
  → Backup config (optional wizard step)
  → Notifications config (optional wizard step)
  → Brownfield scan (optional wizard step)

Brownfield import
  → File watcher (to register imported stacks for monitoring)
  → Stack state machine (MIGRATING state already defined)

Proxy configuration (NPM integration)
  → Settings page (NPM API URL + credentials)
  → Stack state machine (does not block operations, but surfaces proxy status)
```

---

## MVP Recommendation

The three active-scope items are the correct MVP completion targets — they unlock everything else:

**Prioritize (MVP completion):**
1. Container state poller — foundational; status is broken without it
2. Live log streaming — the single most-used debugging feature
3. Settings page — required before any post-MVP feature can be configured

**Post-MVP phase order (rationale in parentheses):**
1. File watcher + update checker — observability before reliability
2. SMTP notifications — depends on settings page; low implementation cost, high user value
3. Backup & restore — complex but critical for the self-hosting audience
4. First-run wizard — polish; reduces setup friction for new installs
5. Brownfield import — adoption unlock; lets existing self-hosters migrate in
6. Proxy configuration — last because it has an external dependency (NPM) and is most niche

**Defer indefinitely:**
- Marketplace (separate project scope)
- RBAC (single-user model is correct for target audience)
- Metrics dashboards (out of product scope)

---

## Sources

- Docktor project context: `.planning/PROJECT.md` (HIGH confidence — authoritative source)
- Docktor design document: `docs/design.md` (HIGH confidence — authoritative source)
- Portainer CE features: training knowledge (MEDIUM confidence — last verified August 2025; not independently fetched this session due to tool restrictions)
- Dockge features: training knowledge (MEDIUM confidence — same caveat)
- Yacht features: training knowledge (MEDIUM confidence — same caveat)
- CasaOS features: training knowledge (MEDIUM confidence — same caveat)
- Log streaming UX expectations: derived from Portainer/Dockge/Grafana patterns (MEDIUM confidence)
- Backup UX expectations: derived from restic + Duplicati + common homelab patterns (MEDIUM confidence)
- Update checker patterns: derived from Watchtower/Diun/Dockge patterns (MEDIUM confidence)

**Note on tool restrictions:** WebSearch and WebFetch were denied during this research session. The competitive
analysis above is based on training knowledge. Before finalizing phase scope, consider verifying against current
Dockge and Portainer feature pages — particularly around update checker and notification approaches — as these
tools evolve quickly.
