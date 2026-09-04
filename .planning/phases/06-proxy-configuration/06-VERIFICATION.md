---
phase: 06-proxy-configuration
verified: 2026-09-04T18:00:00Z
status: human_needed
score: 15/17 must-haves verified (2 present, behavior-unverified)
behavior_unverified: 2
overrides_applied: 0
human_verification:
  - test: "Run `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts` on a host where the dev Postgres (`docktor-db-dev`) is reachable, then query `information_schema.columns` for `Stack.isProtected` and `ProxyConfig.certStatus`/`certMessage`/`certCheckedAt` (and confirm `npmProxyHostId`/`isPublic` are absent)."
    expected: "The live database schema matches server/prisma/schema/proxy.prisma and stack.prisma."
    why_human: "Both this verification session and every one of the six plan-execution sessions hit the identical `P1001: Can't reach database server` error against the published Postgres port — a documented, host-level sandbox restriction, not something a grep/file check can resolve. I independently re-ran the exact command and reproduced the same P1001 failure."
  - test: "Run `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts`, `test/integration/setup-wizard-flow.test.ts` on an unrestricted host with a reachable Postgres."
    expected: "All HTTP-round-trip assertions pass: 201 assign + real compose-file write, GET list, 409 duplicate domain, 400 invalid hostname, 400 proxy-stack-not-deployed, 204/404 remove, 409 port-conflict deploy, 400 compose-failure deploy, 401 on every route without a cookie, and the wizard step6 flow."
    why_human: "Same testcontainers-Postgres-unreachable restriction confirmed independently in this session (full unit run: 38/43 test files passed, the same 5 pre-existing integration files failed identically to what every 06-* SUMMARY documents, including this phase's own `test/integration/proxy.test.ts`). The underlying mechanisms these integration tests exercise (compose-file byte-preservation, D-08 aggregation, idempotent re-assign, removeServiceProxyEnv) are independently unit-tested against real temp-directory files and did run green in this session — only the HTTP-boundary round trip is unconfirmed."
  - test: "On a dedicated/verified-clear Docker host with free host ports 80/443: POST /api/settings/proxy/deploy (or the wizard's Proxy step), then `docker ps` for docktor-proxy-nginx/docktor-proxy-acme, `docker network ls` for a bare `docktor_proxy` network, assign a domain with TLS to a real service, and confirm a DNS-pointed domain reaches 'Secured' while a non-pointed one shows 'Cert failed' with a real acme-companion log line. Also confirm the dashboard hides docktor-proxy while proxy.showInDashboard is off, and that stop/restart/delete on it return 400."
    expected: "The managed proxy stack deploys, routes traffic, issues real certificates, and is protected — end to end, on real infrastructure."
    why_human: "No live Docker host with free ports 80/443 was available in any of the six plan-execution sessions or in this verification session (the shared execution host carries real unrelated production workloads, and a prior live docker-compose run on this exact host stopped real containers before the collision was noticed — recorded in STATE.md). This is the class of check no static analysis can substitute for."
gaps: []
---

# Phase 6: Proxy Configuration — Verification Report

**Phase Goal:** Users can configure domain and TLS exposure for any service directly from the stack detail page, without touching Nginx configuration manually
**Verified:** 2026-09-04
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Roadmap Success Criteria (the contract)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | User can configure ACME email + proxy-stack settings in Settings; Docktor auto-deploys nginx-proxy+acme-companion, offered as an optional wizard step | ✓ VERIFIED (mechanism) / ⚠️ live-deploy unverified | `ProxySettingsCard` (183 lines) renders the email field, dashboard-visibility switch, and deploy action, wired to `getProxySettings`/`saveProxySettings`/`deployProxyStack` in `client/src/lib/proxy-api.ts`; server `deployProxyStack()` renders a real, pinned, comment-annotated compose file (`renderProxyStackCompose`, 11 passing unit tests) and drives it through the same `StackService.deployStack` pipeline every stack uses. Wizard step 6 (`ProxyStep`, `wizard-stepper.tsx` `{number:6, title:"Proxy", required:false}`) is optional and terminal, wired to `POST /api/setup/step6` → `OnboardingService.handleWizardStep6`. No live host-port deploy was exercised — see human verification #3. |
| 2 | User assigns domain(s)/port/TLS from the stack detail page; Docktor writes routing/TLS env vars and redeploys | ✓ VERIFIED | `ProxyTab` (377 lines) renders the assign form and table, wired to `assignDomain` from `proxy-api.ts`. Server `ProxyService.assignDomain` → `setServiceProxyEnv` (yaml Document-API surgical mutation) is unit-tested with exact-byte-equality assertions against real fixture compose content (11 tests in `compose-proxy-editor.test.ts`), including the D-08 "one comma-joined `VIRTUAL_HOST` key" invariant. HTTP-round-trip (`proxy.test.ts`, 8 tests) is written but not executed this session — see human verification #2. |
| 3 | User removes a proxy config from the UI; env vars removed, service redeployed | ✓ VERIFIED | `removeServiceProxyEnv` unit-tested (7 tests) including the "leaves a second service's `VIRTUAL_HOST` and network intact" byte-match case. `ProxyTab`'s remove flow goes through an `AlertDialog` (not a bare `confirm()`), unit- and Playwright-tested. `DELETE /api/proxy-configs/:id` route delegates to `ProxyService.removeDomain`. |
| 4 | Proxy operations are idempotent | ✓ VERIFIED | `ProxyService.assignDomain`'s idempotent branch (query-then-`updateConfig`, never a duplicate `create`) is unit-tested (4 tests) for same-service re-assign, cross-service 409, and port-repoint. A concurrency backstop test (5 simultaneous assigns) was empirically proven to fail with `withKeyedLock` removed before being accepted, per the plan's own RED-verification requirement. |

### Observable Truths (representative sample across the 6 plans' must_haves)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `setServiceProxyEnv`/`readServiceProxyEnv`/`removeServiceProxyEnv` preserve every other byte of a compose file (PRXY-01/04) | ✓ VERIFIED | `server/test/unit/lib/compose-proxy-editor.test.ts`, 20 tests, exact-string-equality assertions; re-ran this session, all pass |
| 2 | D-08 promote invariant — multiple domains render one comma-joined `VIRTUAL_HOST` key, never per-domain keys | ✓ VERIFIED | dedicated unit test, re-ran green this session |
| 3 | Assigning a domain already owned by another service returns 409; assigning without the proxy stack deployed returns 400 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Enforced in `ProxyService.assignDomain` (code inspected, logic present and wired) and asserted by `proxy.test.ts`, but that HTTP-level suite could not execute this session (Postgres unreachable, reproduced independently) |
| 4 | Concurrent writes to one stack's compose file are serialized (`withKeyedLock`) | ✓ VERIFIED | `keyed-mutex.test.ts` (5 tests) plus `proxy-service.test.ts`'s held-out concurrency test, both green this session; the SUMMARY documents the test was manually confirmed to fail with the lock removed |
| 5 | Removing the last domain clears env vars and the `docktor_proxy` network entry; removing one of several leaves the rest comma-joined | ✓ VERIFIED | unit-tested, green this session |
| 6 | Hand-written `VIRTUAL_HOST` domains are adopted into `ProxyConfig` rows rather than dropped | ✓ VERIFIED | `proxy-service.test.ts` adoption describe block, green this session |
| 7 | `stopStack`/`restartStack`/`deleteStack` reject `isProtected` stacks with 400 before any docker call; `deployStack`/`updateImages` are unaffected | ✓ VERIFIED | `assertNotProtected` present at all 3 call sites (`grep -c` → 4: declaration + 3 sites), `stack-service.test.ts` asserts rejection + no docker call, green this session |
| 8 | Dashboard hides `isProtected` stacks unless `proxy.showInDashboard === "true"` | ✓ VERIFIED | `StackService.listStacks` filter present and unit-tested |
| 9 | `renderProxyStackCompose` produces a pinned, bind-mount-only, adversarial-input-safe compose file | ✓ VERIFIED | 11 unit tests parsing the output with `parseDocument`, green this session; `docker manifest inspect` re-verification recorded in 06-03-SUMMARY |
| 10 | `deployProxyStack` refuses to deploy over an occupied host port with the real container name (D-11) | ✓ VERIFIED (mechanism) / ⚠️ live-port-bind unverified | `assertHostPortsFree` unit-tested against fixture `listContainers` output; never exercised against a real Docker host with a real port conflict |
| 11 | ProxyCertPoller classifies issued/pending/failed correctly, never reads `.key` files, only publishes SSE on change | ✓ VERIFIED | 11 unit tests in `proxy-cert-poller.test.ts`, green this session, including the "no path ends in `.key`" and "no-op-on-unchanged" assertions |
| 12 | `useProxyStatus` merges live SSE status per stack, ignores other stacks/events, no leaked `EventSource` | ✓ VERIFIED | 7 unit tests, green this session |
| 13 | Proxy tab renders the exact UI-SPEC copy for empty/gating/error states; icon-only remove button has an `aria-label`; no third type-weight class | ✓ VERIFIED | grepped copy strings match verbatim; `grep -c aria-label` and `grep -c font-medium` gates pass; 10 component tests green this session |
| 14 | Settings > Proxy card and StackActions protected-action disabling | ✓ VERIFIED | `isProtected` prop threaded from `[id].tsx` → `StackActions`, disables Stop/Restart/Delete with a tooltip, leaves Deploy/Update Images enabled; 5 tests green this session |
| 15 | Wizard step 6 is optional, terminal, and does not block reaching the dashboard on skip | ✓ VERIFIED | `wizard-stepper.tsx` has 6 entries, `grep -c 'step === 5'` on `setup.tsx` → 0 (no stale terminal branch); Playwright wizard spec covers skip-to-dashboard and submit-to-dashboard, reported green in 06-06-SUMMARY (not re-run live this session; static wiring independently confirmed) |
| 16 | Live database schema matches the revised Prisma models (`isProtected`, `certStatus`/`certMessage`/`certCheckedAt`, dropped `npmProxyHostId`/`isPublic`) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `.prisma` files inspected directly and contain exactly the claimed shape (`grep -c 'npmProxyHostId\|isPublic'` on non-comment lines → 0); the live-DB push itself could not be re-proven — reproduced the identical `P1001` failure independently in this verification session |
| 17 | Full Playwright coverage of the 4 proxy UI flows and the updated 6-step wizard flow against stubbed APIs | ✓ VERIFIED (per SUMMARY, not re-run) | `client/test/integration/proxy.spec.ts` (4 tests) and updated `setup-wizard.spec.ts` exist with the described assertions on intercepted request bodies and dialog copy; SUMMARYs report both green; not re-executed in this session (Playwright run is expensive and the unit-level equivalents were re-verified instead) |

**Score:** 15/17 verified, 2 present-and-wired-but-behavior-unverified (both are Postgres/live-Docker dependent, confirmed as an environmental restriction independently in this session, not a code defect)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `shared/src/validation/proxy.ts` | assign/settings/cert-status schemas | ✓ VERIFIED | exists, 25 lines, exports confirmed |
| `server/src/lib/compose-proxy-editor.ts` | surgical compose editor | ✓ VERIFIED | 180 lines, `setServiceProxyEnv`/`readServiceProxyEnv`/`removeServiceProxyEnv`/`PROXY_NETWORK_NAME`/`ComposeProxyEditError` all present |
| `server/src/repositories/proxy-repository.ts` | ProxyConfig CRUD | ✓ VERIFIED | 71 lines |
| `server/src/application/proxy-service.ts` | orchestration | ✓ VERIFIED | 418 lines, `PROXY_STACK_ID`, `assignDomain`, `removeDomain`, `deployProxyStack`, `getProxyStackState`, `updateProxySettingsAndSync`, `assertHostPortsFree` all present |
| `server/src/routes/proxy.ts` | authenticated REST endpoints | ✓ VERIFIED | 60 lines, thin handlers, `requireAuth` hook first line, no Prisma access, no `501` stub remaining |
| `server/src/lib/keyed-mutex.ts` | per-key serialization | ✓ VERIFIED | 47 lines, dependency-free |
| `server/src/lib/proxy-stack-compose.ts` | proxy stack compose renderer | ✓ VERIFIED | 89 lines |
| `server/src/jobs/proxy-cert-poller.ts` | cert reconciliation job | ✓ VERIFIED | 209 lines, registered in `jobs/index.ts` via `startJob`/`stopJobs` |
| `client/src/hooks/use-proxy-status.ts` | SSE cert-status hook | ✓ VERIFIED | 44 lines |
| `client/src/lib/proxy-api.ts` | typed API client | ✓ VERIFIED | 67 lines, 6 functions, no direct `fetch(` |
| `client/src/components/domain/stack/cert-status-badge.tsx` | cert badge | ✓ VERIFIED | 47 lines |
| `client/src/routes/app/stacks/components/proxy-tab.tsx` | stack-detail Proxy tab | ✓ VERIFIED | 377 lines |
| `client/src/routes/app/settings/components/proxy-settings-card.tsx` | Settings > Proxy card | ✓ VERIFIED | 183 lines, new directory per CLAUDE.md refactoring target |
| `client/src/routes/setup/components/proxy-step.tsx` | wizard step 6 | ✓ VERIFIED | 86 lines |
| Prisma schema (`isProtected`, `certStatus`/`certMessage`/`certCheckedAt`, dropped `npmProxyHostId`/`isPublic`) | schema files | ✓ VERIFIED (file) / ⚠️ live DB unverified | `.prisma` files match exactly; live push unreproducible this session (see human verification) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `server/src/app.ts` | `server/src/routes/proxy.ts` | `import proxyRoutes` + `app.register(proxyRoutes)` | ✓ WIRED | line 17, 131 |
| `server/src/application/index.ts` | `ProxyService` | singleton construction with all 6 collaborators | ✓ WIRED | `new ProxyService(new ProxyRepository(), repo, fs, stackService, settingsService, dockerodeClient)` |
| `server/src/jobs/index.ts` | `proxyCertPoller` | `startJob("ProxyCertPoller", ...)` / `stopJobs()` | ✓ WIRED | import + start + stop all present |
| `client/src/routes/app/stacks/[id].tsx` | `ProxyTab` | `VALID_TABS`/`tabLabels`/`TabsTrigger`/`TabsContent value="proxy"` | ✓ WIRED | all 4 sites confirmed by grep |
| `client/src/routes/app/settings.tsx` | `ProxySettingsCard` | `TabsContent value="proxy"` | ✓ WIRED | import + render site confirmed |
| `client/src/routes/app/stacks/[id].tsx` | `StackActions` | `isProtected={stack.isProtected}` prop | ✓ WIRED | line 211 |
| `server/src/application/stack-service.ts` | `SettingsService.getProxySettings` | `listStacks()` dashboard filter | ✓ WIRED | line 76 |
| `client/src/routes/setup.tsx` | `ProxyStep` | step-6 render branch | ✓ WIRED | import + render site confirmed |
| `server/src/routes/setup.ts` | `OnboardingService.handleWizardStep6` | `POST /api/setup/step6` | ✓ WIRED | confirmed by grep |

### Behavioral / Automated Verification Run This Session

- `yarn workspace @docktor/server test --run`: **603 unit tests passed** (38/43 files), **5 integration test files failed identically with `P1001: Can't reach database server`** — reproduced independently, matches every 06-* SUMMARY's documented environmental restriction exactly (including this phase's own `test/integration/proxy.test.ts`).
- `yarn workspace @docktor/server tsc --noEmit` → zero errors.
- `yarn workspace @docktor/shared tsc --noEmit` → zero errors.
- `yarn workspace @docktor/client tsc --noEmit` → zero errors.
- `yarn workspace @docktor/client test` on the 6 proxy-related test files (`proxy-tab`, `cert-status-badge`, `proxy-settings-card`, `stack-actions`, `proxy-step`, `use-proxy-status`) run in isolation: **44/44 tests passed** — this directly re-confirms the SUMMARY's claim that `proxy-step.test.tsx` and `stack-actions.test.tsx` (the two files reported as flaky under full-suite load) pass cleanly.
- `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts` → reproduced the identical `P1001` failure the SUMMARYs report; this is a genuine, independently-confirmed sandbox restriction, not a fabricated excuse.
- Debt-marker scan (`TBD`/`FIXME`/`XXX`) across all 14 new proxy source files → zero matches.
- `TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" scan → zero matches (only legitimate form-input `placeholder` attribute strings).

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| PRXY-01 | 06-01, 06-05 | ✓ SATISFIED | assign endpoint + Proxy tab, both wired and tested |
| PRXY-02 | 06-01, 06-03, 06-04, 06-06 | ✓ SATISFIED | auto-deploy pipeline, compose-write mechanism, cert poller, wizard step |
| PRXY-03 | 06-03, 06-05, 06-06 | ✓ SATISFIED | Settings card + wizard step, both wired to `/api/settings/proxy*` |
| PRXY-04 | 06-02, 06-05 | ✓ SATISFIED | remove endpoint + UI confirmation dialog + protected-action disabling |
| PRXY-05 | 06-02 | ✓ SATISFIED | idempotent re-assign unit-tested and code-inspected |

No orphaned requirements — REQUIREMENTS.md maps exactly PRXY-01 through PRXY-05 to Phase 6, and all five are claimed by at least one plan's `requirements:` frontmatter.

### Anti-Patterns / Code-Review Findings (informational — not must-have failures)

`06-REVIEW.md` (already committed) found 0 critical, 7 warning-level issues. I independently spot-checked and confirmed three of them still present in the code as reviewed:

- **WR-01** (`removeDomain` deletes the DB row before the compose write is confirmed, no rollback on write/redeploy failure) — confirmed present at `proxy-service.ts` `removeDomain`. Does not violate any declared must-have truth or prohibition (those cover double-removal safety and cross-service isolation, which are separately tested and correct); it is a genuine asymmetry versus `assignDomain`'s rollback and is a legitimate follow-up.
- **WR-04** (no guard against assigning a domain to the proxy stack itself, `stackId === PROXY_STACK_ID`) — confirmed absent via `grep`. Not a declared must-have; a real gap in defense-in-depth against a self-inflicted misconfiguration.
- **WR-06** (deploy-failure UI hardcodes "ports 80/443 are already in use" for every failure reason) — confirmed present in both `proxy-settings-card.tsx` and `proxy-step.tsx`. This is not a truth failure: the 06-05 must-have literally requires this exact fixed sentence plus the raw error verbatim underneath, and both are present. It is, however, a real transparency issue the review correctly flagged — the raw error is shown (satisfying the phase's own non-negotiable "never paraphrase" prohibition), but the fixed lead-in sentence can misattribute a non-port-conflict failure.

None of the 7 warnings block phase completion; none contradict a declared must_have truth or prohibition. They are appropriately tracked in the committed review and are good candidates for a follow-up hardening plan.

### Human Verification Required

See frontmatter `human_verification` for the full structured list. Summary:

1. **Live database schema verification** — re-run the two commands and the `information_schema.columns` query on a host where Postgres is actually reachable.
2. **Integration test execution** (`test/integration/proxy.test.ts`, `test/integration/setup-wizard-flow.test.ts`) on an unrestricted host — this is where the remaining HTTP-boundary assertions (409/400/401/204/404 status codes) get their first live confirmation. The underlying mechanisms these tests exercise are independently unit-tested and green.
3. **Live proxy-stack deploy and certificate issuance** on a dedicated Docker host with free ports 80/443 — the deploy pipeline, host-port pre-flight, real container startup, real DNS-based certificate issuance, and the full first-run wizard walkthrough all require infrastructure this sandboxed environment does not safely provide (this host carries real unrelated production workloads and has a documented incident of a prior live test stopping real containers).

### Gaps Summary

No must-have truth failed inspection. Every artifact exists, is substantive (not a stub — the smallest new file is 25 lines, the largest 418), and is wired end-to-end (routes → service → repository/editor on the server; API client → tab/card/step components → route wiring on the client). All 603 server unit tests and 44 targeted client unit tests re-ran green in this verification session, independently confirming the SUMMARYs' claims rather than trusting them. TypeScript compiles clean across all three workspaces. No debt markers, no stub patterns, no orphaned requirements.

The phase's outstanding work is entirely the live-infrastructure verification every one of the six SUMMARYs already flagged and carried forward consistently: Postgres is unreachable in this sandbox (I reproduced this independently, not just trusted the claim), and no live Docker host with free ports 80/443 was available for a real deploy/cert-issuance/wizard walkthrough. These are exactly the kind of checks a code-only verifier cannot perform and that this framework routes to human_needed rather than a false pass or a false gap.

---

_Verified: 2026-09-04_
_Verifier: Claude (gsd-verifier)_
