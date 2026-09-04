---
phase: "6"
slug: "proxy-configuration"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-03"
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Regenerated from `06-RESEARCH.md`'s Validation Architecture section, cross-checked against the actual `<automated>` commands committed in `06-0{1..6}-PLAN.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (server + client), Playwright (client e2e) |
| **Config file** | `server/vitest.config.ts` — defines `unit` project (`test/unit/**/*.test.ts`) and `test/integration` project (`test/integration/**/*.test.ts`, 30s timeouts) |
| **Quick run command** | `yarn workspace @docktor/server test` (unit project) / `yarn workspace @docktor/client test` |
| **Full suite command** | `yarn workspace @docktor/server test && yarn workspace @docktor/server test:integration && yarn workspace @docktor/client test && yarn workspace @docktor/client exec playwright test --reporter=list` |
| **Estimated runtime** | ~90s unit (server+client) + ~3-5min integration/e2e |

---

## Sampling Rate

- **After every task commit:** Run `yarn workspace @docktor/server test` / `yarn workspace @docktor/client test` (whichever workspace the task touched) + `tsc --noEmit`
- **After every plan wave:** Run the full suite (unit + integration + e2e)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~90 seconds (unit loop)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01 Task 1 | 01 | 1 | PRXY-01, PRXY-02 | unit | `yarn workspace @docktor/server test test/unit/lib/compose-proxy-editor.test.ts --run` | ❌ W0 | ⬜ pending |
| 06-01 Task 1 | 01 | 1 | PRXY-01, PRXY-02 | integration | `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` | ❌ W0 | ⬜ pending |
| 06-01 Task 2 | 01 | 1 | PRXY-01, PRXY-02 | schema | `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts && yarn db:generate` | ✅ | ⬜ pending |
| 06-02 Task 1 | 02 | 2 | PRXY-02, PRXY-04, PRXY-05 | unit | `yarn workspace @docktor/server test test/unit/lib/compose-proxy-editor.test.ts test/unit/application/proxy-service.test.ts --run` | ❌ W0 | ⬜ pending |
| 06-02 Task 1 | 02 | 2 | PRXY-04 | integration | `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` | ❌ W0 | ⬜ pending |
| 06-02 Task 2 | 02 | 2 | PRXY-05 | unit | `yarn workspace @docktor/server test test/unit/lib/keyed-mutex.test.ts test/unit/application/proxy-service.test.ts --run` | ❌ W0 | ⬜ pending |
| 06-03 Task 1 | 03 | 3 | D-12 (protected stack) | unit | `yarn workspace @docktor/server test test/unit/application/stack-service.test.ts test/unit/application/settings-service.test.ts --run` | ✅ existing — extend | ⬜ pending |
| 06-03 Task 2 | 03 | 3 | PRXY-02 | unit | `yarn workspace @docktor/server test test/unit/lib/proxy-stack-compose.test.ts --run` | ❌ W0 | ⬜ pending |
| 06-03 Task 3 | 03 | 3 | PRXY-02, D-11 | unit + integration | `yarn workspace @docktor/server test test/unit/application/proxy-service.test.ts --run && yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` | ❌ W0 | ⬜ pending |
| 06-04 Task 1 | 04 | 4 | PRXY-02 (D-05) | unit | `yarn workspace @docktor/server test test/unit/jobs/proxy-cert-poller.test.ts --run` | ❌ W0 | ⬜ pending |
| 06-04 Task 2 | 04 | 4 | PRXY-02 (D-05) | unit | `yarn workspace @docktor/client test test/unit/hooks/use-proxy-status.test.ts` | ❌ W0 | ⬜ pending |
| 06-05 Task 1 | 05 | 5 | PRXY-01, PRXY-04 | unit | `yarn workspace @docktor/client test test/unit/routes/proxy-tab.test.tsx test/unit/components/domain/stack/cert-status-badge.test.tsx` | ❌ W0 | ⬜ pending |
| 06-05 Task 2 | 05 | 5 | PRXY-03 | unit | `yarn workspace @docktor/client test test/unit/routes/proxy-settings-card.test.tsx` | ❌ W0 | ⬜ pending |
| 06-05 Task 3 | 05 | 5 | PRXY-01..04 | e2e | `yarn workspace @docktor/client exec playwright test test/integration/proxy.spec.ts --reporter=list` | ❌ W0 | ⬜ pending |
| 06-06 Task 1 | 06 | 4 | PRXY-02, PRXY-03 | unit + integration | `yarn workspace @docktor/server test test/unit/application/onboarding-service.test.ts --run && yarn workspace @docktor/server test:integration test/integration/setup-wizard-flow.test.ts` | ❌ W0 | ⬜ pending |
| 06-06 Task 2 | 06 | 4 | PRXY-02, PRXY-03 | unit + e2e | `yarn workspace @docktor/client test test/unit/routes/proxy-step.test.tsx && yarn workspace @docktor/client exec playwright test test/integration/setup-wizard.spec.ts --reporter=list` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/test/unit/lib/compose-proxy-editor.test.ts` — covers PRXY-01/04/05 (surgical YAML edit correctness, comma-joining multiple domains, idempotent re-apply)
- [ ] `server/test/unit/application/proxy-service.test.ts` — covers PRXY-01/04/05 (orchestration, domain uniqueness conflict handling)
- [ ] `server/test/integration/proxy.test.ts` — covers PRXY-02, D-11 (real deploy against a test DB; port-conflict path mocks `DockerExecutor` rather than a real port bind, per RESEARCH.md Pitfall 3)
- [ ] `server/test/unit/lib/keyed-mutex.test.ts` — covers PRXY-05 (serialized per-stack compose writes)
- [ ] `server/test/unit/lib/proxy-stack-compose.test.ts` — covers PRXY-02 (proxy-stack compose skeleton renderer)
- [ ] `server/test/unit/jobs/proxy-cert-poller.test.ts` — covers D-05 (cert-status detection)
- [ ] `client/test/unit/hooks/use-proxy-status.test.ts` — covers D-05 (client-side cert status hook)
- [ ] `client/test/unit/routes/proxy-tab.test.tsx`, `client/test/unit/components/domain/stack/cert-status-badge.test.tsx` — covers PRXY-01/04 UI
- [ ] `client/test/unit/routes/proxy-settings-card.test.tsx` — covers PRXY-03 UI
- [ ] `client/test/integration/proxy.spec.ts` — covers PRXY-01..04 e2e
- [ ] `server/test/integration/setup-wizard-flow.test.ts`, `client/test/unit/routes/proxy-step.test.tsx`, `client/test/integration/setup-wizard.spec.ts` — covers the optional First-Run Wizard proxy step (PRXY-02/03)
- [ ] Extend `server/test/unit/application/stack-service.test.ts` — covers D-12 (protected-stack guard)
- [ ] Extend `server/test/unit/application/settings-service.test.ts` — covers PRXY-03 (ACME email getter/setter)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Let's Encrypt cert issuance against a publicly resolvable domain | PRXY-02 (D-05) | Requires outbound internet, public DNS, and a real Let's Encrypt rate-limit budget — not reproducible in CI/integration tests, which mock `DockerExecutor` per RESEARCH.md Pitfall 3 | Deploy the proxy stack on a host with ports 80/443 free and a domain pointed at it; assign the domain to a test service; confirm the cert-status badge transitions pending → issued and the service is reachable over HTTPS |
| `LETSENCRYPT_HOST`/`LETSENCRYPT_EMAIL` vs `ACME_HOST`/`ACME_EMAIL` env var family resolution | PRXY-02 | RESEARCH.md Open Question 1 — resolved at runtime in 06-01 Task 1 Step 0 by reading the deployed acme-companion image's own template source, not guessable statically | During/after 06-01 Task 1 execution, confirm the resolved env var family matches what the deployed acme-companion image actually consumes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (confirmed via failing-direction probe during plan-checker verification — all severities `none`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (13 Wave 0 files listed above)
- [x] No watch-mode flags
- [ ] Feedback latency < 90s (unit loop) — to be confirmed against real runtimes during execution
- [ ] `nyquist_compliant: true` set in frontmatter — set by `/gsd-validate-phase` post-execution, not at plan time

**Approval:** pending
