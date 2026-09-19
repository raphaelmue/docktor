---
phase: 09-deployment-and-release-readiness
plan: 07
subsystem: api
tags: [tls, certificates, proxy, acme, nginx-proxy, prisma, expiry-monitoring]

# Dependency graph
requires:
  - phase: 09-06-deployment-and-release-readiness
    provides: "CertificateRepository/CertificateService, certFileBaseName, certificateExpiry/parseCertificate, and the committed self-signed test fixtures this plan's issuance-suppression and expiry-classification logic builds on and proves against"
provides:
  - "server/src/application/proxy-service.ts — renderProxyEnvForService filters the issuance host to TLS-enabled AND ACME-sourced rows only, the single place suppression happens; assignDomain confirms a custom certificate exists before creating anything and persists certSource/certificateId explicitly on both branches; adoptUnmanagedDomains creates hand-written domains as explicit ACME rows"
  - "server/src/repositories/proxy-repository.ts — create()/updateConfig() extended with certSource/certificateId; new findAllForCertPolling() joining the linked Certificate's domainPattern/expiresAt"
  - "server/src/jobs/proxy-cert-poller.ts — CERT_EXPIRY_WARNING_DAYS=30, classifyCertificateExpiry (pure, clock-injectable), per-row branch on certSource: ACME rows keep exactly their prior file+log-tail classification, custom rows are classified from the linked certificate's own domain pattern (certFileBaseName) and expiry, never from the container log"
  - "server/src/lib/state-broadcaster.ts — proxy_cert_status event's status union extended with 'expiring', no second event type"
  - "Real-YAML and real-fixture-certificate proof (Task 3) that the issuance key is genuinely absent/correctly-scoped in the rendered compose document, and that expiry classification is correct against a real X.509 not-after date"
affects: [09-08-deployment-and-release-readiness]

# Actuals (#2632)
actuals:
  tokens: 13932
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Certificate-source filtering lives in exactly one function (renderProxyEnvForService) and nowhere else — the issuance host is TLS-enabled AND certSource==='acme'; there is no second code path for custom rows, so acme-companion structurally never sees a LETSENCRYPT_HOST entry for a domain whose certificate the user supplied"
    - "D-11 promote rule carried through to persistence: every ProxyConfig row (ACME and custom alike) is written with an explicit certSource — assignDomain's both branches, updateConfig's re-assign branch, and adoptUnmanagedDomains all set it explicitly; nothing is ever left to be inferred from certificateId's presence/absence"
    - "ProxyCertPoller.reconcile() splits into reconcileAcmeRows()/reconcileCustomRows(), sharing one applyStatus() choke point for the skip-if-unchanged-status + publish-on-change behavior both branches need identically"
    - "Custom-row file resolution always goes through the linked Certificate's own domainPattern via certFileBaseName — the same pure function the writer (09-06) used — never through ProxyConfig.domain, so a wildcard certificate shared by several subdomains resolves to the one file that actually exists for every one of them"
    - "A missing custom certificate file classifies failed, not pending — there is no issuance process in flight to wait for, unlike a fresh ACME row"
    - "findAllForCertPolling() is a second, additive repository method (a thin Prisma include through the Certificate relation) rather than widening findAll()'s existing shape or callers"

key-files:
  created: []
  modified:
    - server/src/application/proxy-service.ts
    - server/src/application/index.ts
    - server/src/repositories/proxy-repository.ts
    - server/src/jobs/proxy-cert-poller.ts
    - server/src/lib/state-broadcaster.ts
    - server/test/unit/application/proxy-service.test.ts
    - server/test/unit/jobs/proxy-cert-poller.test.ts

key-decisions:
  - "ProxyConfigCertRow's linked-certificate fields are shaped as a nested `certificate: {domainPattern, expiresAt} | null` object (the natural Prisma include shape), not flattened certificateDomainPattern/certificateExpiresAt fields — keeps findAllForCertPolling() a genuinely thin, mapping-free query per the plan's own instruction, and avoids a silent field-name mismatch behind the poller's existing `as unknown as ProxyCertPollerRepo` cast"
  - "ProxyCertPollerRepo's method was renamed from findAll to findAllForCertPolling (matching the real repository's new method) rather than kept as findAll — the poller's local port interface must name the method it actually calls, since the unsound `as unknown as` cast at the lazy-import site would otherwise silently keep calling the old (uncertificate-joined) query at runtime with no compile-time signal"
  - "The custom-row expiry check prefers the Certificate's persisted expiresAt and only parses the on-disk PEM's not-after date as a fallback when that persisted value is somehow absent — reading the file remains how presence is confirmed either way, matching the plan's explicit ordering"
  - "applyStatus() was extracted as a shared private method between the ACME and custom row loops — both need byte-identical skip-if-unchanged/persist/publish behavior, and duplicating it per branch would be exactly the kind of second code path the plan says not to introduce"

patterns-established:
  - "Certificate-status classification is scoped by certSource at the top of reconcile(), with each branch (ACME vs custom) owning its own presence-check strategy but sharing one status-application choke point — a template other per-source-behavior branches in this codebase can follow"

requirements-completed: []  # n/a — phase scoped by four todo files, not REQUIREMENTS.md IDs (see plan frontmatter); this plan implements ACME suppression and expiry monitoring for the custom-TLS-certificates todo (scope item 4, D-11/D-13), closed end-to-end by plan 09-08

coverage:
  - id: D1
    description: "A domain whose certificate the user supplied never receives an ACME issuance environment variable, regardless of TLS state or mix with ACME-sourced domains on the same service — proven against mocks (Task 1) and against a real rendered compose document (Task 3)"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — 'ProxyService.renderProxyEnvForService — issuance filtered by TLS-enabled AND ACME-sourced (D-11)' describe block (4 tests)"
        status: pass
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — 'ProxyService — end-to-end suppression proof against real compose YAML (D-11, Task 3)' describe block (2 tests, real yaml-package parsed-document assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "assignDomain persists an explicit certSource on every row (never inferred from the certificate link's presence/absence), confirms a custom certificate exists before creating anything, and rejects an unknown certificate id before touching the compose file"
    verification:
      - kind: unit
        ref: "server/test/unit/application/proxy-service.test.ts — 'ProxyService.assignDomain — certificate source (D-11)' describe block (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A custom-sourced row is classified by its linked certificate's file presence and expiry, never by tailing the ACME container's log; a wildcard certificate resolves via its own domain pattern, never the row's routing hostname; a missing file classifies failed, not pending"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/proxy-cert-poller.test.ts — 'reconcile — custom-sourced rows (D-11/D-13)' describe block (8 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "classifyCertificateExpiry is a pure, clock-injectable function correct at all four boundaries (far-future, inside-window, exactly-at-boundary, already-past), including proof against a real certificate's actual not-after date rather than a hand-written literal"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/proxy-cert-poller.test.ts — 'classifyCertificateExpiry' describe block (4 tests) and 'classifyCertificateExpiry — proof against the real fixture certificate's own not-after date (Task 3)' (1 test using server/test/fixtures/certs/leaf.crt)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ACME-sourced rows keep byte-identical prior behavior (file presence, log tail fetched at most once and only when needed); the proxy_cert_status event's status union carries exactly the four vocabulary members with no second event type; no path ending in .key is ever passed to the poller's filesystem port"
    verification:
      - kind: unit
        ref: "server/test/unit/jobs/proxy-cert-poller.test.ts — pre-existing ACME regression-lock tests (unchanged assertions, all still passing) plus the new mixed ACME+custom .key-exclusion test"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live end-to-end confirmation that a real proxy stack with a genuinely uploaded certificate serves HTTPS correctly and that acme-companion never attempts issuance for it"
    verification: []
    human_judgment: true
    rationale: "This plan proves suppression and expiry classification against real compose YAML and a real self-signed fixture certificate, but does not exercise a live Docker-mounted proxy stack. Same class of live-environment gap already tracked for 09-06 (coverage D7) and prior phases (shared-host live-deploy risk documented in STATE.md) — a human on an unrestricted host should upload a real certificate, assign it to a domain, and confirm both that nginx-proxy serves HTTPS and that acme-companion's logs show no issuance attempt for that domain, before treating scope item 4 as fully proven end-to-end."

duration: ~35min
completed: 2026-09-17
status: complete
---

# Phase 9 Plan 7: ACME Issuance Suppression and Custom Certificate Expiry Monitoring Summary

**The certificate source field now actually governs behavior: `renderProxyEnvForService` filters the ACME issuance environment variable to TLS-enabled-AND-ACME-sourced rows only, and `ProxyCertPoller` classifies custom-sourced rows by their linked certificate's file presence and expiry (never the ACME container's log), with a 30-day expiry warning traveling the existing `proxy_cert_status` stream.**

## Performance

- **Duration:** ~35min
- **Started:** ~2026-09-17T13:12Z (required-reading phase preceded the first commit)
- **Completed:** 2026-09-17T13:46Z
- **Tasks:** 3 (2 `tdd="true"` auto tasks, 1 proof-only auto task)
- **Files modified:** 7 (5 source files, 2 test files — no new files created)

## Accomplishments
- ACME issuance variable is now computed from `certSource`, not merely TLS state — a custom-certificate domain never appears in `LETSENCRYPT_HOST`, structurally invisible to acme-companion, proven against a real rendered compose document (not just mocks)
- `assignDomain` confirms a referenced custom certificate exists before creating anything, and persists an explicit certificate source on every row (ACME and custom alike) rather than ever inferring it from the certificate link's absence
- `ProxyCertPoller` classifies custom-sourced rows by file presence and expiry via the linked certificate's own domain pattern — a wildcard certificate shared across subdomains resolves correctly for every one of them, proven with a real self-signed fixture's actual not-after date
- A custom certificate approaching expiry surfaces as `expiring` through the existing live status stream 30 days out, with an already-expired one reported as `failed` naming its date — no new event type, no second stream

## Task Commits

Each task was committed atomically:

1. **Task 1: Compute the ACME issuance variable from the certificate source, for both branches** - `4c6f8b0` (feat)
2. **Task 2: Teach the certificate poller to classify custom-sourced rows by file and expiry** - `fd244f7` (feat)
3. **Task 3: Prove the end-to-end suppression and expiry behaviour against a real compose file and real certificate files** - `7e92e83` (test)

**Plan metadata:** (this commit) - `docs(09-07): complete ACME suppression and expiry monitoring plan`

_Note: both TDD tasks (1 and 2) had their RED state confirmed by running the extended test files before any implementation existed — see "TDD Discipline" below. Each task's RED→GREEN cycle is captured within a single commit here because the plan is running sequentially and the tests+implementation for each task were authored and verified as one atomic unit before committing; RED was confirmed via a full pre-commit test run, not via a separate committed RED state._

## Task 1: TDD Discipline (RED → GREEN)

**RED:** Extended `server/test/unit/application/proxy-service.test.ts` with 8 new tests (certificate-source persistence on assign, custom-certificate existence confirmation, unknown-certificate rejection, adopted-domain explicit ACME source, and 4 issuance-filtering tests covering mixed/all-custom/TLS-disabled/removal scenarios) plus a defaulting change to the test file's fake repository (`certSource: "acme"` applied to every row unless overridden, so every pre-existing test keeps exercising exactly its prior behavior). Ran against the unmodified implementation: **6 of 32 tests failed** exactly on the new assertions (missing `certSource`/`certificateId` persistence, issuance host still including custom-sourced domains) — the 26 pre-existing tests passed unchanged, confirming the RED was scoped to this task's additions only and the defaulting change was behavior-preserving.

**GREEN:** Extended `proxy-repository.ts`'s `create`/`updateConfig` with `certSource`/`certificateId`; added a narrowed `CertificateRepository` dependency to `ProxyService`'s constructor (wired in `application/index.ts`); `assignDomain` now confirms a custom certificate exists via the throwing finder before creating anything and persists `certSource`/`certificateId` explicitly on both the create and update branches; `adoptUnmanagedDomains` creates hand-written domains with an explicit ACME source; `renderProxyEnvForService`'s issuance-host filter changed from TLS-enabled-only to TLS-enabled-AND-`certSource==='acme'` — the single place suppression happens. Re-ran: **32/32 tests pass**, `yarn typecheck` exits 0, full server unit suite **44 files / 687 tests pass (2 pre-existing todo)** — no regressions.

## Task 2: TDD Discipline (RED → GREEN)

**RED:** Extended `server/test/unit/jobs/proxy-cert-poller.test.ts` — renamed the mock repository's `findAll` to `findAllForCertPolling` (mechanical, matching the new interface the implementation would need to call), extended the `tlsRow()` helper with `certSource`/`certificate` defaults, added a `customTlsRow()` helper, and wrote 12 new tests (4 `classifyCertificateExpiry` boundary tests, a wildcard file-resolution-by-pattern proof, issued/expiring/failed/missing-file custom classifications, a log-tail-never-fetched-for-custom proof, an event-vocabulary proof, and a mixed ACME+custom `.key`-exclusion regression lock). Ran against the unmodified implementation: **22 of 23 tests failed** (only "stop() called twice" survived, since it never touches the repository) — `CERT_EXPIRY_WARNING_DAYS`/`classifyCertificateExpiry` didn't exist yet and the renamed mock method broke every existing call site, giving unambiguous "module doesn't implement this yet" RED evidence.

**GREEN:** Extended `state-broadcaster.ts`'s `proxy_cert_status` status union with `"expiring"`; added `ProxyRepository.findAllForCertPolling()` (a thin `include` through the `Certificate` relation, `findAll()` left untouched for its existing callers); in the poller, added `CERT_EXPIRY_WARNING_DAYS = 30` and the pure `classifyCertificateExpiry(validTo, now, warningDays)`, extended `ProxyConfigCertRow` with `certSource`/`certificate`, added `readFile` to the filesystem port, and split `reconcile()` into `reconcileAcmeRows()` (byte-identical to the prior single-branch logic) and `reconcileCustomRows()` (resolves the file via `certFileBaseName(row.certificate.domainPattern)`, never `row.domain`; a missing file classifies `failed`; a present file classifies via `classifyCertificateExpiry` using the certificate's persisted `expiresAt`, falling back to parsing the file's own PEM only if that's absent), sharing one `applyStatus()` choke point for the skip-if-unchanged/persist/publish behavior. Re-ran: **23/23 tests pass**, `yarn typecheck` exits 0, full server unit suite **44 files / 699 tests pass (2 pre-existing todo)** — no regressions.

## Task 3: Real-Artifact Proof (no new production code)

Extended both test files with proof against real artifacts rather than mocks:

- **Suppression proof** (`proxy-service.test.ts`): two new tests round-trip a mixed (2 ACME + 1 custom) and an all-custom TLS-enabled service through the *real*, unmocked `setServiceProxyEnv`/compose-file content, then parse the resulting document with the `yaml` package's own `parseDocument` (the same library the editor itself uses) and assert `LETSENCRYPT_HOST`'s absence/presence via `doc.hasIn([...])` — a parsed-document assertion, not a string search that a truncated read could accidentally satisfy.
- **Expiry proof** (`proxy-cert-poller.test.ts`): one new test reads `server/test/fixtures/certs/leaf.crt` (the genuine 09-06 self-signed fixture), extracts its real not-after date via the production `certificateExpiry()`/`parseCertificate()` helpers, and drives `classifyCertificateExpiry` at three clock points derived from that real date (60 days before, 10 days before, 1 day after) — proving `issued`/`expiring`/`failed` against genuine X.509 content rather than a hand-written literal.

Verified `certificate-validation.ts`, `certificate-naming.ts`, `certificate-filesystem.ts`, `certificate-repository.ts`, `certificate-service.ts`, and `routes/certificates.ts` all have empty `git diff --stat` — plan 09-06's files were untouched throughout this plan. Re-ran: **58/58 tests pass** across both files, `yarn typecheck` exits 0, full server unit suite **44 files / 702 tests pass (2 pre-existing todo)** — no regressions.

### Real Artifacts Recorded

**All-custom case rendered YAML** (one TLS-enabled row, `certSource: "custom"`, issuance key genuinely absent):

```yaml
services:
  web:
    image: nginx:latest
    environment:
      VIRTUAL_HOST: cloud.example.com
      VIRTUAL_PORT: "8080"
    networks:
      - docktor_proxy
networks:
  docktor_proxy:
    external: true
```

`LETSENCRYPT_HOST` does not appear anywhere in this document — not present with an empty value, not present with a placeholder. `doc.hasIn(["services", "web", "environment", "LETSENCRYPT_HOST"])` evaluates to `false`.

**Mixed case rendered YAML** (2 ACME-sourced + 1 custom-sourced TLS-enabled row):

```yaml
services:
  web:
    image: nginx:latest
    environment:
      VIRTUAL_HOST: acme-a.example.com,acme-b.example.com,custom.example.com
      VIRTUAL_PORT: "8080"
      LETSENCRYPT_HOST: acme-a.example.com,acme-b.example.com
    networks:
      - docktor_proxy
networks:
  docktor_proxy:
    external: true
```

`VIRTUAL_HOST` lists all three domains (routing is unaffected by certificate source); `LETSENCRYPT_HOST` lists only the two ACME-sourced domains.

**Fixture certificate's real expiry** (`server/test/fixtures/certs/leaf.crt`, parsed via `certificateExpiry()`):

- Not-after (`validToDate`, ISO): `2036-09-14T08:44:25.000Z`
- Classification at now = not-after − 60 days → **`issued`**
- Classification at now = not-after − 10 days (inside the 30-day warning window) → **`expiring`**
- Classification at now = not-after + 1 day → **`failed`**

## Files Created/Modified

- `server/src/repositories/proxy-repository.ts` - `create()`/`updateConfig()` extended with `certSource`/`certificateId`; new `findAllForCertPolling()`
- `server/src/application/proxy-service.ts` - `assignDomain` certificate-source handling; `renderProxyEnvForService`'s issuance filter; `adoptUnmanagedDomains` explicit ACME source
- `server/src/application/index.ts` - wires `ProxyService`'s new `CertificateRepository` dependency (single shared instance also used by `CertificateService`)
- `server/src/lib/state-broadcaster.ts` - `proxy_cert_status` status union gains `"expiring"`
- `server/src/jobs/proxy-cert-poller.ts` - `CERT_EXPIRY_WARNING_DAYS`, `classifyCertificateExpiry`, `reconcileAcmeRows`/`reconcileCustomRows`/`classifyCustomRow`/`applyStatus`, `readFile` on the filesystem port
- `server/test/unit/application/proxy-service.test.ts` - 14 new tests (8 Task 1, 2 Task 3, plus fake-repo defaulting infrastructure)
- `server/test/unit/jobs/proxy-cert-poller.test.ts` - 13 new tests (12 Task 2, 1 Task 3) plus mock-repo/helper renaming

## Decisions Made

See `key-decisions` in frontmatter. In particular:

1. **Nested `certificate` field on `ProxyConfigCertRow`**, not flattened `certificateDomainPattern`/`certificateExpiresAt` fields — matches the actual shape `findAllForCertPolling()`'s Prisma `include` returns with zero mapping, keeping the repository method genuinely thin while avoiding a field-name mismatch hidden behind the poller's existing unsound `as unknown as ProxyCertPollerRepo` cast.
2. **Renamed the poller's local repo-port method from `findAll` to `findAllForCertPolling`** — the port interface must name the method the lazy-imported real repository actually exposes; keeping the old name would have silently kept calling the old (uncertificate-joined) query at runtime with no compile-time signal, since the cast bypasses structural checking.

## Deviations from Plan

None — plan executed exactly as written, including its explicit instruction that Task 3 adds no new production code.

## Issues Encountered

None — both TDD tasks' RED states were confirmed cleanly on the first test run against the unmodified implementation (6/32 and 22/23 failures respectively, exactly on the new assertions), and both GREEN implementations passed on the first full run afterward with no additional fix-up cycles.

## User Setup Required

None - no external service configuration required. Per coverage item D6, a developer on an unrestricted host with a live proxy stack deployed should perform one live end-to-end check (upload a real certificate, assign it to a domain, confirm nginx-proxy serves HTTPS and acme-companion's logs show no issuance attempt for that domain) before treating scope item 4 as fully proven in production — consistent with the class of live-environment gaps already tracked in `.planning/WINDOWS.md` for this phase's earlier plans.

## Next Phase Readiness

- **Ready for 09-08:** the todo this plan (with 09-05 and 09-06) implements — `.planning/todos/pending/2026-09-07-add-support-for-custom-tls-certificates.md` — now has its full server-side behavior delivered: the Certificate entity (09-05/09-06), upload/validation/storage (09-06), and ACME suppression + expiry monitoring (this plan). 09-08 can close the todo, covering any remaining UI wiring and the live end-to-end handoff item (D6).
- **Carried-forward gap:** D6 (live end-to-end proof against a real mounted proxy stack, uploaded certificate, and running acme-companion) is unverified in this session — same class of shared-host live-deploy risk documented throughout STATE.md's Blockers/Concerns.

## Self-Check: PASSED

- FOUND: `server/src/application/proxy-service.ts` (modified)
- FOUND: `server/src/application/index.ts` (modified)
- FOUND: `server/src/repositories/proxy-repository.ts` (modified)
- FOUND: `server/src/jobs/proxy-cert-poller.ts` (modified)
- FOUND: `server/src/lib/state-broadcaster.ts` (modified)
- FOUND: `server/test/unit/application/proxy-service.test.ts` (modified)
- FOUND: `server/test/unit/jobs/proxy-cert-poller.test.ts` (modified)
- FOUND commit: `4c6f8b0` (feat, Task 1)
- FOUND commit: `fd244f7` (feat, Task 2)
- FOUND commit: `7e92e83` (test, Task 3)

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-17*
