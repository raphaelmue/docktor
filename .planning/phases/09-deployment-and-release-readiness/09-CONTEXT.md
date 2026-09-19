# Phase 9: Deployment and Release Readiness - Context

**Gathered:** 2026-09-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 closes exactly 4 release-blocking gaps for v1.0.0, per ROADMAP.md:

1. Deployment config documentation (`.env`/`docker-compose.yml`) — **closed during this discussion, no new work** (see D-01).
2. Adopt `prisma migrate` (replacing schemaless `db push`).
3. Add a Windows CI runner.
4. Add support for custom TLS certificates on proxied domains.

No new capabilities beyond these 4 items — everything below clarifies HOW to implement items 2–4 (and how to close out item 1).

</domain>

<decisions>
## Implementation Decisions

### Item 1 — Deployment Documentation
- **D-01:** Item 1 is closed with no new implementation work. `docs/deployment.md` (272 lines), the cleaned `docker-compose.yml`/`.env.example`, and the guarded `db push` startup step already shipped across Phase 05.1 and Phase 07 — every specific defect the original todo lists (Dockerfile bugs, missing schema-sync, undocumented `BETTER_AUTH_*`, dead `DOCKTOR_DATA_DIR`/`DOCKTOR_BACKUP_DIR`, DooD mount mismatch) traces to a fix already merged and documented. The only work item is a **drift check**: confirm `docs/deployment.md` still matches the current `docker-compose.yml`/`.env.example`/`Dockerfile` byte-for-byte in the facts it states, then close `.planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md`.

### Item 2 — Prisma Migrate Cutover
- **D-02:** Cut over from `db push` to real `prisma migrate` **now, for v1.0.0** — not deferred further. Supersedes the 2026-09-01 decision ("create the first migration as late as possible"); v1.0.0 release is that trigger. — **Reversibility:** one-way — once existing self-hosted installs are auto-baselined into migration history at first boot after upgrade (D-05), there's no clean path back to `db push` without discarding that migration history.
- **D-03:** Baseline the first migration via `prisma migrate diff --from-empty --to-schema-datamodel` against the current schema, saved as the initial migration folder. Applied to already-synced databases (dev DB, and existing self-hosted installs on upgrade) via `prisma migrate resolve --applied`.
- **D-04:** The guarded `prisma db push` startup step (`DOCKTOR_DB_AUTO_PUSH`, `server/src/lib/schema-sync.ts`) is **replaced** by `prisma migrate deploy`, not kept as a fallback. — **Reversibility:** costly — `schema-sync.ts`'s guarded push logic (lock/retry/never-force-dataloss) gets removed; reverting means reinstating and re-testing that whole startup path.
- **D-05:** An existing self-hosted install upgrading into this version (schema already applied via `db push`, no `_prisma_migrations` table) is **auto-detected and baselined at boot** — zero-touch upgrade. The startup step detects "schema exists but no migration history," runs the same `resolve --applied` baseline automatically, then proceeds. — **Reversibility:** one-way — this auto-mutates a production database's migration-history table with no explicit operator confirmation step; an incorrect baseline diff has no clean undo short of manually editing `_prisma_migrations`.

### Item 3 — Windows CI Scope
- **D-06:** Windows CI job covers **unit tests + typecheck only**, not integration tests — GitHub-hosted Windows runners don't have a Docker Engine (only Docker Desktop via a paid/complex setup), and this project's integration suite is testcontainers-based. Integration tests stay Linux-only. Matches the todo's own stated fallback.
- **D-07:** The new Windows job is a **required (blocking) check from day one**, not advisory. Accepted risk: Windows-specific CI flake can block PRs until fixed.
- **D-08:** Add a **macOS** job too (not Windows-only) — same unit-tests+typecheck scope as D-06.

### Item 4 — Custom TLS Certificates
- **D-09:** Custom certificates are provided via **file upload** (`.crt`/`.key`, plus an optional intermediate/CA bundle file) — not pasted PEM text.
- **D-10:** Certificate is a **new, reusable entity**, decoupled from `ProxyConfig` — oriented at Nginx Proxy Manager's certificate model, not a one-off field inline on a single domain's proxy config. Fields: private key, certificate, optional intermediate/CA chain, and the entity's own domain pattern (which may be a **wildcard**, e.g. `*.example.com`). Any number of `ProxyConfig` rows (subdomains under that pattern) reference the same Certificate — one upload covers every matching subdomain, and the wildcard cert is written to disk **once** under its own domain-pattern-derived filename rather than duplicated per subdomain. This is also the fix for the on-disk naming problem: a wildcard cert has no single "domain" to name a per-`ProxyConfig` file after; a Certificate entity keyed by its own pattern does. — **Reversibility:** one-way — this is a new schema/API resource; once any proxy config references it, collapsing back to an inline per-`ProxyConfig` field would be a breaking schema change for existing rows.
- **D-11:** Skipping ACME/`acme-companion` issuance for a custom-cert domain is done via a **new `ProxyConfig`/`Certificate` linkage field** (e.g. `certSource: 'acme' | 'custom'`). When `custom`, Docktor writes the cert files directly under `volumes/certs/` (per `PROXY_CERTS_SUBPATH`) and never sets `LETSENCRYPT_HOST` for that service — `acme-companion` only acts on containers carrying that env var, so it structurally never touches custom-cert domains. Not relying on `acme-companion`'s own "skip if a valid cert already exists" detection.
- **D-12:** Docktor **validates the uploaded cert/key before accepting them**: private key must match the certificate, and the domain (or wildcard pattern) must appear in the cert's SAN/CN. Reject on save if either check fails, rather than accepting and surfacing failure later via `ProxyCertPoller`.
- **D-13:** Docktor **surfaces an expiry warning in the UI** for custom certs — parse the cert's `notAfter` date at upload, re-check on `ProxyCertPoller`'s existing cron cadence, and show a warning as expiry approaches. Custom certs have no ACME-style auto-renewal, so silence here would be a real gap.

### Claude's Discretion
- Exact on-disk nginx-proxy wildcard cert filename convention (e.g. whether it is `_.example.com.crt` or something else) — confirm via research against the actual `nginx-proxy` project, don't assume.
- Whether the Certificate management UI lives in Settings (global) vs. a stack/proxy-tab location — Phase 6's precedent (ACME email is a global Setting) suggests Settings, given Certificates are explicitly decoupled/reusable, but left to planner discretion.
- Network/schema wiring for the `Certificate` ↔ `ProxyConfig` relationship (one Certificate → many ProxyConfig rows).
- Whether the private key is encrypted at rest via the existing `crypto.ts` AES-256-GCM pattern (used for SMTP/SFTP/S3/restic secrets today) — strongly implied by established convention, not explicitly asked, left to planner to apply as the obvious consistent choice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope (source todos)
- `.planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md` — item 1, closed per D-01; still needs the drift check + close.
- `.planning/todos/pending/2026-09-01-adopt-prisma-migrate-post-mvp.md` — item 2, cutover decisions D-02 through D-05.
- `.planning/todos/pending/2026-09-03-ci-has-no-windows-runner.md` — item 3, scope decisions D-06 through D-08.
- `.planning/todos/pending/2026-09-07-add-support-for-custom-tls-certificates.md` — item 4, decisions D-09 through D-13.

### Deployment Documentation (item 1 drift-check baseline)
- `docs/deployment.md` — the current deployment guide; confirm it still matches the files below before closing the todo.
- `docker-compose.yml`, `.env.example`, `Dockerfile` — current, already-cleaned deployment config.
- `server/src/lib/schema-sync.ts` — the guarded `db push` startup step D-04 replaces.

### Prisma Migrate (item 2)
- `server/prisma/schema/` — current modular schema files; source for the `migrate diff --from-empty` baseline (D-03).
- `.planning/STATE.md` §Accumulated Context — records the superseded 2026-09-01 "as late as possible" decision (now superseded by D-02).

### Proxy / Custom TLS (item 4) — Phase 6 mechanism this builds on
- `.planning/phases/06-proxy-configuration/06-CONTEXT.md` — the Phase 6 decisions this phase extends: `nginx-proxy` + `acme-companion` mechanism (D-01/D-02 there), per-domain `ProxyConfig` schema (D-06/D-07/D-08 there).
- `server/src/lib/proxy-stack-compose.ts` — `PROXY_CERTS_SUBPATH` (`volumes/certs`), `ACME_COMPANION_CONTAINER_NAME`; the nginx-proxy/acme-companion compose template and volume layout new cert-writing code must follow.
- `server/src/jobs/proxy-cert-poller.ts` — existing `ProxyCertStatus` (`pending`/`issued`/`failed`) polling; needs branching for `certSource: custom` (skip ACME status polling, add expiry check per D-13).
- `server/prisma/schema/proxy.prisma` — dormant/existing `ProxyConfig` model; needs the new `Certificate` model (D-10) and the linkage field (D-11).
- `client/src/components/domain/stack/cert-status-badge.tsx` — existing cert status badge; needs a state for expiry warning (D-13).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Encrypted-settings pattern:** `server/src/lib/crypto.ts` (AES-256-GCM `encrypt()`/`decrypt()`, key from `ENCRYPTION_KEY` env var) — already used for SMTP passwords, SFTP keys, S3 secrets, and the restic repository password. The new Certificate entity's private key is exactly this class of secret.
- **Full-phase layering analog:** Backup & Restore (Phase 4) — repository (`server/src/repositories/backup-repository.ts`), application service (`server/src/application/backup-service.ts`), routes (`server/src/routes/backups.ts`), client API (`client/src/lib/backups-api.ts`). Mirror this layering for the new `Certificate` entity (repository/service/routes/client-api), consistent with `06-CONTEXT.md`'s existing recommendation to use this analog for Phase 6 work.
- **Node built-in `crypto.X509Certificate`** (Node 15+, no third-party dependency needed) — can parse a cert's SAN/CN and `validTo`/expiry natively, relevant to D-12 (cert/key/domain validation) and D-13 (expiry check).

### Established Patterns
- **YAML-first / files-on-disk-as-source-of-truth:** compose files are the source of truth, DB stores derived metadata only. Certificate files on disk under `volumes/certs/` follow the same principle — the `Certificate` DB row should be treated as metadata/index, the on-disk file as what `nginx-proxy` actually reads.
- **Global Settings for cross-stack config:** Phase 6's ACME email is a global `Setting`, not per-domain — same shape argument applies to where Certificate management UI lives (see Claude's Discretion above).
- **Fail-loudly-not-silently-misconfigure:** `assertStacksDirMatchesHost()` (Phase 05.1) and Phase 6's D-11 (port conflict) are the precedent for D-12's "reject on save, don't accept-then-fail-later" validation choice.

### Integration Points
- `server/prisma/schema/proxy.prisma` — add `Certificate` model + linkage from `ProxyConfig`.
- `server/prisma/migrations/` — does not exist yet; created by D-03's baseline.
- `.github/workflows/ci.yml` — currently `ubuntu-latest` only (single `build-and-test` job); needs new Windows + macOS jobs (D-06/D-07/D-08).
- `server/src/lib/schema-sync.ts` / `server/src/index.ts` — startup sequence changes for D-04/D-05.

</code_context>

<specifics>
## Specific Ideas

The user explicitly named **Nginx Proxy Manager's certificate model** as the reference point for scope and functionality (D-10) — a reusable Certificate entity supporting wildcard domains, not a one-off per-domain field. They also specifically want **intermediate/CA chain certificate support** as a distinct upload field (D-09), not a requirement to hand-concatenate a full chain before uploading.

</specifics>

<deferred>
## Deferred Ideas

None new — discussion stayed within the phase's 4-item scope. All other pending todos (YAML/env editor, topology visualization, dashboard stats, registry auth, badge polish, etc.) were already triaged into the v1.1+ backlog by the user on 2026-09-11 (see `.planning/STATE.md` §Roadmap Evolution) and were not re-litigated here.

### Reviewed Todos (not folded)
None — the automated todo-phase matcher's only matches above the 4 locked-scope items (e.g. `add-yaml-env-editor.md` at 0.9, `add-stack-and-service-topology-visualization.md` at 0.7) were already explicitly deferred to v1.1+ per the 2026-09-11 STATE.md triage, so they were not re-presented for folding.

</deferred>

---

*Phase: 9-deployment-and-release-readiness*
*Context gathered: 2026-09-15*
