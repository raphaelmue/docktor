# Phase 6: Proxy Configuration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-03
**Phase:** 6-proxy-configuration
**Areas discussed:** Proxy mechanism & deployment, Proxy config schema, Cert email/deploy timing/port conflicts/proxy stack protection

---

## Proxy Mechanism & Deployment

The user opened the discussion by questioning the roadmap's original premise — "whether it makes sense to build something similar like Nginx Proxy Manager, or maybe use something like nginx-proxy and build a manager on top." A quick web check confirmed NPM's REST API is officially undocumented (community-reverse-engineered only, matching STATE.md's existing concern), while `nginx-proxy`/`acme-companion` are actively maintained (commits through August 2026) and require no API integration at all.

| Option | Description | Selected |
|--------|-------------|----------|
| nginx-proxy + acme-companion | No REST API — Docktor writes env vars into compose, proxy reacts via Docker socket. Fits YAML-first, event-driven architecture. | ✓ |
| Nginx Proxy Manager (as scoped) | REST API integration (JWT auth). Full admin GUI fallback, but officially undocumented API. | |
| Fully custom nginx config generation | Docktor owns raw nginx config + cert issuance directly. | |

**User's choice:** nginx-proxy + acme-companion
**Notes:** This reverses the roadmap/requirements wording ("NPM API") — flagged as a canonical-refs update needed in CONTEXT.md.

---

| Question | Options | Selected |
|----------|---------|----------|
| Should Docktor auto-deploy the proxy containers? | Docktor auto-deploys / User deploys manually / You decide | **Docktor auto-deploys it** |
| Network wiring model | Well-known shared network, auto-joined / nginx-proxy joins every stack's network / You decide | **You decide** |
| Per-service TLS/proxy UI scope | Domain + TLS toggle only / Domain + TLS + advanced options / You decide | **You decide** |
| Failure/cert-issuance feedback | Poll logs/cert state, surface in UI / No automated feedback / You decide | **You decide** |

**Notes:** User deferred three of four follow-ups to Claude/planner discretion, keeping only the deployment-ownership question as a hard decision.

---

## Proxy Config Schema — Reuse or Revise

A dormant `ProxyConfig` Prisma model already exists (`domain`, `internalPort`, `tlsEnabled`, `isPublic`, `npmProxyHostId`, `@@unique([domain])`) but is unreferenced anywhere in application code.

| Question | Options | Selected |
|----------|---------|----------|
| Disposition of `npmProxyHostId`/`isPublic` fields | Drop npmProxyHostId, defer isPublic / Drop both / You decide | **You decide** |
| Domain uniqueness / path-based routing | Keep unique per domain / Support path-based routing / You decide | **Keep unique per domain** |
| Multiple domains per service | One domain per service / Support multiple domains per service / You decide | **Support multiple domains per service** |

**Notes:** Multi-domain support means moving the schema from a single unique-domain-per-service shape to one-to-many.

---

## Cert Email, Deploy Timing, Port Conflicts, Proxy Stack Protection

Four additional gray areas the user chose to explore after the mechanism pivot.

| Question | Options | Selected |
|----------|---------|----------|
| When to collect the ACME/Let's Encrypt email | Global Settings field, optional wizard step / Required before first proxy config / You decide | **Global Settings field, optional wizard step** |
| When to auto-deploy the proxy stack | First-Run Wizard optional step / Lazy, on first proxy config / You decide | **First-Run Wizard optional step** |
| Host port 80/443 conflict handling | Fail loudly, let user free ports / Let user pick alternate ports / You decide | **Fail loudly, let user free the ports** |
| Proxy stack visibility in dashboard | Hidden system stack / Regular stack like any other / You decide | **Clarified via follow-up (see below)** |
| Existing host-port-bound service + proxy enabled | Warn but leave both active / Auto-remove host port binding / You decide | **Warn but leave both active** |

**Proxy stack visibility — clarification exchange:** The user's first answer to the visibility question was a garbled free-text response: *"This should be configurable in this settings then up to share the and also get some additional checks that prevent that this services get stopped accidentally. So treat them differently than usual services."* Claude reflected back an interpretation — visibility configurable in Settings (not hard-hidden/hard-shown), plus extra safeguards against accidental stop/delete/restart regardless of visibility — and the user confirmed with "yes."

---

## Claude's Discretion

- Network wiring model between proxied services and `nginx-proxy` (shared external network vs. per-stack join)
- Per-service TLS/proxy UI scope beyond domain + TLS toggle
- Failure/cert-issuance status detection mechanism
- `ProxyConfig.npmProxyHostId`/`isPublic` field cleanup approach

## Deferred Ideas

None — discussion stayed within Phase 6's existing PRXY-01..05 scope. No new capabilities were proposed.
