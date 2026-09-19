---
phase: "9"
slug: "deployment-and-release-readiness"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-15"
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 (server, client, shared) + Playwright (client E2E) |
| **Config file** | `server/vitest.config.ts` (projects: `unit`, `test/integration`), `client/vitest.config.ts` (single unit project), `shared/vitest.config.ts` |
| **Quick run command** | `yarn workspace @docktor/server test:unit` / `yarn test:unit` (client+shared) |
| **Full suite command** | `yarn workspace @docktor/server test` (unit+integration combined) + `yarn test:integration` (client Playwright E2E) |
| **Estimated runtime** | ~30-90s unit; integration/E2E significantly longer (Docker-backed) |

---

## Sampling Rate

- **After every task commit:** Run `yarn typecheck && yarn workspace @docktor/server test:unit` (server-side changes) or `yarn test:unit` (shared/client changes)
- **After every plan wave:** Run `yarn workspace @docktor/server test` (unit+integration, where a Docker-backed dev environment is available)
- **Before `/gsd-verify-work`:** Full suite must be green, plus at least one live Windows and one live macOS CI run observed green before D-07's required-check status is applied in GitHub branch protection settings
- **Max feedback latency:** ~90 seconds (unit-only sampling)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Item | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|------|-----------------|-----------|-------------------|-------------|--------|
| 09-0X-0X | TBD | TBD | 1 (docs drift) | `.env.example`/`.env.production` no longer reference `.env.local` | doc/manual grep | `grep -n "env.local" .env.example .env.production` returns nothing | ✅ (grep-based, no new test file needed) | ⬜ pending |
| 09-0X-0X | TBD | TBD | 2 (D-03/D-04) | `syncDatabaseSchema()` runs `migrate deploy` and correctly classifies outcomes | unit | `yarn workspace @docktor/server test:unit -- schema-sync` | ❌ W0 — existing tests need updated mocks for new CLI subcommand/outcome text | ⬜ pending |
| 09-0X-0X | TBD | TBD | 2 (D-05) | Auto-baseline detection identifies a `db push`-only DB vs. fresh vs. already-migrated | unit | new test file, mocking `pg.Client` query result | ❌ W0 — new test file needed | ⬜ pending |
| 09-0X-0X | TBD | TBD | 3 (D-06/D-08) | New CI job runs typecheck + unit tests (client/shared/server) on `windows-latest`/`macos-latest`, excludes integration | CI/manual | live workflow run on a PR | N/A — verified via actual CI run, not a repo test file | ⬜ pending |
| 09-0X-0X | TBD | TBD | 4 (D-12) | Mismatched key/cert pair rejected; cert whose SAN doesn't cover domain pattern rejected | unit | new test file for certificate-validation service function | ❌ W0 — new test file needed | ⬜ pending |
| 09-0X-0X | TBD | TBD | 4 (D-13) | Expiry check flags near-expiry cert; `ProxyCertPoller.reconcile()` branches correctly on `certSource` | unit | extends existing `proxy-cert-poller` test file | ❌ W0 — existing poller tests need new cases | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are TBD — the planner fills in real plan/task numbers when PLAN.md files are created; this table's Item/Behavior/Command columns are the binding contract.*

---

## Wave 0 Requirements

- [ ] `server/test/unit/schema-sync.test.ts` (or equivalent) — updated/new tests covering `migrate deploy` argv, outcome classification, and D-05's `needsBaseline()` logic
- [ ] New unit test file for certificate validation (key/cert match, SAN/domain-pattern coverage, expiry extraction) — covers D-12/D-13's pure logic in isolation from Fastify/multipart plumbing
- [ ] `.github/workflows/ci.yml` correctness is only provable by a live run — inherently outside the Wave 0 unit-test gap category, tracked separately as a manual-only verification below

---

## Manual-Only Verifications

| Behavior | Item | Why Manual | Test Instructions |
|----------|------|------------|-------------------|
| Windows CI job passes (typecheck + unit tests) | 3 (D-06/D-07) | GitHub-hosted Windows runner behavior can only be observed via a live workflow run, not simulated locally | Open a PR after the workflow change merges; confirm the `windows-latest` job appears and goes green; then mark it required in GitHub branch protection settings |
| macOS CI job passes (typecheck + unit tests) | 3 (D-08) | Same as above — GitHub-hosted macOS runner | Same PR; confirm the `macos-latest` job appears and goes green |
| Existing self-hosted install auto-baselines cleanly on upgrade | 2 (D-05) | Requires a real Postgres DB previously synced via `db push` (schema present, no `_prisma_migrations` table) — not reproducible in a fresh test DB without deliberately seeding that exact pre-migration state | Stand up a DB via the pre-Phase-9 `db push` path, then boot the Phase-9 server binary against it and confirm the auto-baseline log output and a subsequent clean `migrate deploy` |
| Wildcard certificate correctly served by `nginx-proxy` under its resolved on-disk filename | 4 (D-10/D-11) | Depends on the actual `nginx-proxy` container reading the file from the shared volume — an integration-level, container-networking behavior | Upload a wildcard cert for `*.example.test` via the UI, confirm the file lands at the parent-domain-derived path in `volumes/certs/`, then curl an HTTPS subdomain through the proxy stack and inspect the served cert |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
