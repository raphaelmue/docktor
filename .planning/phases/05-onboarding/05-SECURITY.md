---
phase: "05"
slug: "onboarding"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-08-31"
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Unauthenticated browser → `/api/setup/*` | Public setup-wizard API, reachable before any admin exists | Admin credentials (step1), backup S3/restic secrets (step3), SMTP password (step4), host filesystem paths (scan/adopt/migrate) |
| Unauthenticated browser → `/api/auth/sign-up/email` | better-auth's generic self-registration endpoint | Email + password for new account creation |
| Setup wizard → host filesystem | Brownfield scan reads arbitrary directories the server process can access | Compose file contents, directory paths |
| Setup wizard → Docker daemon | Migration flow shells out to `docker run`/`docker compose up` | Container volume data, compose file contents |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-05-02 | Info Disclosure | brownfield-scanner.ts | medium | accept | `DiscoveredStack` shape has no raw-content field | closed |
| T-05-03 | Spoofing | onboarding wizard step1 | medium | accept | better-auth defaults + `wizardStep1Schema` validation | closed |
| T-05-06 | Info Disclosure | brownfield-scanner.ts | medium | accept | Same as T-05-02 | closed |
| T-05-07 | Spoofing | setup.ts step1 | high | mitigate | step1 rejects with 400 when `userCount > 0` | closed |
| T-05-09 | Elevation of Privilege | setup.ts preHandler | high | mitigate | Fixed 2026-08-31 (commit `d9b40cc`): gate now tracks `isWizardComplete()` via a durable `Setting` row instead of `userCount > 0`. Dynamically confirmed step2+ no longer 410s after step1, while the permanent post-completion gate is preserved. | closed |
| T-05-10 | Info Disclosure | onboarding-service.ts | medium | mitigate | `cryptoLib.encrypt()` on backup/SMTP secrets before persist | closed |
| T-05-13 | Tampering | migration-service.ts | medium | mitigate | Backup created before any destructive step | closed |
| T-05-14 | Info Disclosure | migration-service.ts | medium | accept | Backup cleanup on success/failure paths (CR-04) | closed |
| T-05-15 | Spoofing | setup.tsx | medium | mitigate | `loadSetupStatus()` shows "Setup Complete" when already configured | closed |
| T-05-16 | Info Disclosure | wizard step components | low | mitigate | Password fields use `type="password"`, no console logging | closed |
| T-05-17 | Tampering | setup.tsx | low | accept | Matches declared UX for step navigation | closed |
| T-05-19 | DoS | brownfield-scanner.ts | medium | mitigate | fast-glob `ignore` excludes for `node_modules`/`.git` | closed |
| T-05-20 | Info Disclosure | brownfield-scanner.ts | medium | accept | Same as T-05-02 | closed |
| T-05-21 | Tampering | wizard step components + server routes | medium | mitigate | Zod schema validation client + server (`standardSchemaResolver` / Fastify `schema.body`) | closed |
| T-05-22 | Info Disclosure | diff-viewer.tsx | low | accept | Renders only props passed in, no independent fetch | closed |
| T-05-09-01 | Tampering | first-run-gate.tsx | medium | mitigate | Hardcoded `/setup` literal, no server-supplied `redirectTo` read | closed |
| T-05-09-02 | Elevation of Privilege | setup.ts preHandler | high | mitigate | Closed by the T-05-09 fix above (narrow "configured instance" scope now fully covered) | closed |
| T-05-09-03 | Info Disclosure | setup-api.ts / status endpoint | low | accept | `/api/setup/status` returns only `{setupComplete: boolean}` | closed |
| T-05-09-04 | DoS | use-setup-status.ts | low | accept | `enabled` flag short-circuits for authenticated sessions | closed |
| T-05-09-SC | Tampering (supply chain) | 05-09 file scope | n/a | accept | No new dependencies introduced | closed |
| T-05-10-01 | Elevation of Privilege | setup.ts step1 (WR-07 lock) | high | mitigate | `Setting.key` unique-PK atomic lock closes the double-submit race | closed |
| T-05-10-02 | Info Disclosure | migration-service.ts | medium | mitigate | Backup cleanup test-verified (migration-service.test.ts) | closed |
| T-05-10-03 | DoS | migration-service.ts | high | mitigate | Rollback-restores-original-stack test-verified | closed |
| T-05-10-04 | Tampering | setup.ts integration test harness | low | accept | Confirmed test-only surface | closed |
| T-05-10-SC | Tampering (supply chain) | 05-10 file scope | n/a | accept | No new dependencies introduced | closed |
| CR-01-RESIDUAL | Elevation of Privilege / Broken Access Control | auth.ts sign-up/email hook | critical | accept | The `hooks.before` middleware added in commit `24c4dd0` blocks self-registration once `userCount > 0`, but the zero-admin window (before the wizard's own step1 runs) is unguarded — a direct `POST /api/auth/sign-up/email` can still create the very first account outside the wizard/WR-07 lock. See Accepted Risks Log. | open — accepted |
| NEW-01 | Missing Authentication for Critical Function | setup.ts (step2, step3, step4, scan, adopt, migrate/preview, migrate, complete) | high | accept | Introduced as a side effect of the T-05-09 fix: these routes have no `requireAuth` check (unlike every other protected route in the codebase), so any unauthenticated caller can reach them for as long as the wizard is incomplete, not only the just-authenticated admin. See Accepted Risks Log. | open — accepted |
| T-05-01 | Tampering | wizardStep5Schema (shared/src/validation/wizard.ts) | critical* | accept | Declared mitigation ("absolute paths, no `..` sequences, reject system dirs") was never implemented in the schema — only `z.array(z.string()).min(1)`. See Accepted Risks Log. | open — accepted |
| T-05-04 | Tampering | brownfield-scanner.ts | critical* | accept | System-dir pre-filter present; "validate paths are absolute" half never implemented (no `path.isAbsolute()` call). See Accepted Risks Log. | open — accepted |
| T-05-05 | DoS | brownfield-scanner.ts | critical* | accept | `suppressErrors` present; no scan-depth cap on the glob patterns. See Accepted Risks Log. | open — accepted |
| T-05-08 | Tampering | onboarding-service.ts (`adoptInPlace`) | critical* | accept | No `path.isAbsolute()` validation on `composePath` before reading it, reachable pre-auth. See Accepted Risks Log. | open — accepted |
| T-05-11 | Tampering | migration-service.ts | critical* | accept | `composePath` read via `fs.readFile`/`path.dirname` with zero validation (only an unrelated field gets an `isAbsolute` check). See Accepted Risks Log. | open — accepted |
| T-05-12 | DoS | volume-migrator.ts | critical* | accept | `docker run` volume-copy invocation has no `--memory`/resource-limit flag. See Accepted Risks Log. | open — accepted |
| T-05-18 | Tampering | brownfield-scanner.ts / wizard.ts | critical* | accept | Same root cause as T-05-04/T-05-01 — no path-absoluteness validation anywhere in the scan pipeline. See Accepted Risks Log. | open — accepted |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

\* T-05-01/04/05/08/11/12/18 carry no parseable `severity` field in their originating `05-0{1,2,3,4}-PLAN.md` `<threat_model>` tables (authored before the severity column was standardized) and fail-closed to `critical` under audit policy for the `threats_open` computation. Independent auditor read on actual impact: T-05-01/04/18 medium, T-05-05 medium, T-05-08 medium-high (pre-auth reachable), T-05-11 high (pre-auth reachable, drives filesystem+Docker ops), T-05-12 low-medium.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | CR-01-RESIDUAL | Two audit rounds fixed the userCount>0 window (T-05-09 preHandler fix, sign-up/email post-admin block) and confirmed both close cleanly. The remaining zero-admin `/sign-up/email` window is a narrower, pre-first-boot-only variant of the original finding. User reviewed both audit reports and chose to document rather than extend the fix cycle further in this session. | User (Raphael Müßeler) | 2026-08-31 |
| AR-02 | NEW-01 | Side effect of the T-05-09 fix reopening step2-migrate to the legitimate admin; the auditor's suggested remediation (`requireAuth` on those routes, since the client already establishes a session via `signIn.email()` after step1) is straightforward but was deferred by user decision to avoid a further fix/re-audit cycle in this session. | User (Raphael Müßeler) | 2026-08-31 |
| AR-03 | T-05-01, T-05-04, T-05-05, T-05-08, T-05-11, T-05-12, T-05-18 | Legacy plans (05-01 through 05-04) predate this project's threat-model severity column; all seven relate to a single root cause (missing `path.isAbsolute()`/`..`-rejection validation across the brownfield scan/adopt/migrate pipeline) plus one Docker resource-limit gap (T-05-12). User chose to document as a tracked follow-up rather than expand the fix scope of this gap-closure session further. | User (Raphael Müßeler) | 2026-08-31 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-31 (round 1) | 32 | 24 | 8 declared + 1 undeclared (sign-up/email bypass) = 9 | gsd-security-auditor |
| 2026-08-31 (round 2, post-fix) | 10 re-scoped | 1 (T-05-09) | 9 (CR-01-RESIDUAL, NEW-01, T-05-01/04/05/08/11/12/18) | gsd-security-auditor |
| 2026-08-31 (accepted-risk close-out) | — | — | 0 (9 items moved to Accepted Risks Log) | orchestrator, per user decision |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-31
