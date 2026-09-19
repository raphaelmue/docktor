# Phase 9: Deployment and Release Readiness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-15
**Phase:** 9-deployment-and-release-readiness
**Areas discussed:** Item 1 scope check, Prisma migrate cutover, Windows CI scope, Custom TLS certificate UX

---

## Item 1 scope check

| Option | Description | Selected |
|--------|-------------|----------|
| Close it, no new work | Verify docs/deployment.md against current docker-compose.yml/.env.example for drift, close the todo, spend the phase on items 2-4 | ✓ |
| There's a specific gap to close | Something in the current docs/config still isn't right | |

**User's choice:** Close it, no new work.
**Notes:** Scouting found docs/deployment.md (272 lines), a cleaned docker-compose.yml/.env.example, and the guarded db-push startup step already shipped across Phase 05.1 and Phase 07 — every defect the original todo lists traces to an already-merged, already-documented fix.

---

## Prisma migrate cutover

| Question | Options | Selected |
|---|---|---|
| Cutover timing | Cut over now, for v1.0.0 / Still defer past v1.0.0 | Cut over now, for v1.0.0 |
| Baseline creation | `migrate diff --from-empty` (Recommended) / `migrate dev --create-only` | `migrate diff --from-empty` |
| Startup step | Replace db push with `migrate deploy` (Recommended) / Keep db push as fallback | Replace it |
| Existing-install upgrade path | Auto-detect and baseline at boot (Recommended) / Document a manual step / Out of scope | Auto-detect and baseline at boot |

**User's choice:** Cut over now; baseline via `migrate diff --from-empty`; replace the startup step entirely; auto-detect and baseline existing installs at boot.
**Notes:** Supersedes the 2026-09-01 "as late as possible" decision recorded in STATE.md — v1.0.0 release is treated as that trigger.

---

## Windows CI scope

| Question | Options | Selected |
|---|---|---|
| Test scope | Unit tests only, first (Recommended) / Full suite including integration | Unit tests only, first |
| Blocking | Advisory at first (Recommended) / Blocking from day one | Blocking from day one |
| Platforms | Windows-only (Recommended) / Add macOS too | Add macOS too |

**User's choice:** Unit tests + typecheck only, on both Windows and macOS, as a required (blocking) check from day one.
**Notes:** Diverged from the "Recommended" option on blocking (chose stricter) and platforms (chose broader than the todo's literal ask).

---

## Custom TLS certificate UX

| Question | Options | Selected |
|---|---|---|
| Cert input | Paste PEM text (Recommended) / File upload | File upload |
| ACME skip mechanism | New ProxyConfig field (Recommended) / Rely on acme-companion's own detection | New ProxyConfig field |
| Validation | Validate cert/key + domain match (Recommended) / Accept as-is, surface via poller | Validate cert/key + domain match |
| Renewal | Expiry warning in UI (Recommended) / Out of scope | Expiry warning in UI |

**User's choice (initial round):** File upload; explicit linkage field to skip ACME; upload-time validation; expiry warnings.

**Follow-up (free text):** "Regarding the custom certificate: it should in general be oriented at the functionality and scope of Nginx Proxy Manager. Also I want to have the option to add intermediate certificates."

Claude reflected this back as: (1) NPM-oriented — a reusable Certificate entity rather than an inline per-domain field, and (2) a separate intermediate/CA-chain upload field mirroring NPM's 3-field cert form.

**Second follow-up:** "Yes, new entity, this is useful for wildcard certificates (Subdomains), I currently cannot think of other use cases. This should also solve the naming issue right?"

Claude confirmed: a decoupled, reusable Certificate entity (keyed by its own domain pattern, which may be a wildcard) is what resolves the on-disk naming problem — nginx-proxy names cert files after the domain, and a wildcard has no single per-`ProxyConfig` domain to name a file after. Exact nginx-proxy wildcard filename convention left as a research item (not asserted as locked fact).

**Final decisions:** D-09 through D-13 in CONTEXT.md — file upload with 3 fields (key/cert/optional intermediate), new reusable `Certificate` entity supporting wildcard domain patterns, explicit `certSource` linkage field to skip ACME, upload-time validation, expiry warnings.

---

## Claude's Discretion

- Exact on-disk nginx-proxy wildcard cert filename convention — confirm via research, don't assume.
- Whether Certificate management UI lives in Settings (global) vs. a stack/proxy-tab location.
- Network/schema wiring for the Certificate ↔ ProxyConfig relationship (one-to-many).
- Whether the private key is encrypted at rest via the existing `crypto.ts` pattern (strongly implied by established convention, not explicitly asked).

## Deferred Ideas

None new. All other pending todos not in this phase's 4-item scope were already triaged into the v1.1+ backlog by the user on 2026-09-11 (see `.planning/STATE.md` §Roadmap Evolution) and were not re-litigated here.
