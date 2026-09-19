---
phase: 09-deployment-and-release-readiness
plan: 06
subsystem: api
tags: [tls, certificates, fastify, multipart, node-crypto, aes-256-gcm, prisma]

# Dependency graph
requires:
  - phase: 09-05-deployment-and-release-readiness
    provides: "the Certificate Prisma model, domainPatternRegex, createCertificateSchema, and certSource/certificateId linkage on ProxyConfig this plan builds the upload/validation/storage pipeline on top of"
provides:
  - "server/src/domain/certificate-validation.ts — parseCertificate, validateCertKeyPair, certCoversDomainPattern, certificateExpiry (pure, node:crypto only)"
  - "server/src/domain/certificate-naming.ts — certFileBaseName (parent-domain wildcard naming, defense-in-depth path guards)"
  - "server/src/infrastructure/certificate-filesystem.ts — CertificateFilesystem: getCertsDir/writeCertificateFiles/removeCertificateFiles, containment guard, 0o600 key perms, leaf+CA-bundle concatenation"
  - "server/src/repositories/certificate-repository.ts — CertificateRepository/certificateRepository, explicit-field toDto(), findReferencingDomains()"
  - "server/src/application/certificate-service.ts — CertificateService/certificateService: create/listAll/delete"
  - "POST/GET/DELETE /api/certificates — server/src/routes/certificates.ts, requireAuth-gated, @fastify/multipart scoped to this plugin only"
  - "server/test/fixtures/certs/ — throwaway OpenSSL-generated self-signed cert/key material"
affects: [09-07-deployment-and-release-readiness, 09-08-deployment-and-release-readiness]

# Actuals (#2632)
actuals:
  tokens: 16028
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: ["@fastify/multipart@10.1.1"]
  patterns:
    - "Certificate validation stays entirely inside node:crypto's X509Certificate/createPrivateKey — no PEM/ASN.1 parser, no OpenSSL shell-out; validateCertKeyPair distinguishes three failure classes (cert unparseable, key unparseable, mismatch) with fixed non-interpolating reasons"
    - "certFileBaseName implements nginx-proxy's parent-domain wildcard convention (confirmed against the upstream project's own docs in 09-RESEARCH.md) — *.example.com writes as example.com.crt, never an underscore-prefixed name"
    - "Three-layer path-traversal defense for certificate filenames: domainPatternRegex validates the pattern before any path derivation (09-05), certFileBaseName throws on separators/dot-dot/null-byte, CertificateFilesystem asserts the resolved path stays inside getCertsDir() (mirrors getStackPath()'s escape guard)"
    - "Decrypt-once discipline: the plaintext private key is encrypted immediately for persistence and decrypted again only at the single call site immediately before the file write — no other function in the codebase calls decrypt() on a certificate's key"
    - "CertificateFilesystem owns leaf+CA-bundle concatenation (not the service) — the service passes the leaf certificate and the optional bundle through as separate fields; the .crt file's chain content is assembled at the one place that writes it"
    - "certificate-service.ts's constructor Pick<> grew across Task 2 (create-only) and Task 3 (adds findAll/findByIdOrThrow/findReferencingDomains/removeCertificateFiles) rather than over-provisioning the interface up front"

key-files:
  created:
    - server/src/domain/certificate-validation.ts
    - server/src/domain/certificate-naming.ts
    - server/src/infrastructure/certificate-filesystem.ts
    - server/src/repositories/certificate-repository.ts
    - server/src/application/certificate-service.ts
    - server/src/routes/certificates.ts
    - server/test/fixtures/certs/ (leaf.crt, leaf.key, unrelated.key, ca-bundle.crt, README.md)
    - server/test/unit/domain/certificate-validation.test.ts
    - server/test/unit/domain/certificate-naming.test.ts
    - server/test/unit/application/certificate-service.test.ts
    - server/test/unit/routes/certificates-routes.test.ts
  modified:
    - server/package.json (added @fastify/multipart)
    - yarn.lock
    - server/src/application/index.ts (certificateService singleton wiring)
    - server/src/app.ts (certificateRoutes registration)

key-decisions:
  - "Task 1 (checkpoint:human-verify, gate=blocking-human): developer approved @fastify/multipart — see Task 1 Resolution section below"
  - "Chain-file name for nginx-proxy's trusted-chain stapling file: NOT verified against upstream docs during implementation — only the concatenated .crt (leaf+bundle) and .key are written, per the plan's explicit instruction not to write a speculatively named third file"
  - "Over-limit upload mapping: app.ts's global error handler does NOT turn @fastify/multipart's RequestFileTooLargeError into a 4xx on its own (it only recognizes AppError subclasses, 400-shaped Zod validation errors, and error.name === 'ZodError' — everything else falls through to a generic 500) — so the route explicitly catches the FST_REQ_FILE_TOO_LARGE code and re-throws BadRequestError"
  - "Task 2's certificate-service.ts has no dedicated unit test file of its own — per the plan's own file/behavior lists, Task 2's create() logic is exercised only indirectly (via the mocked-service route test); Task 3 is where the first dedicated certificate-service.test.ts is written, and it locks down create()'s already-shipped behavior alongside the new listAll()/delete() behavior"

patterns-established:
  - "Certificate.toDto() constructs the metadata-only DTO field by field (id/domainPattern/expiresAt/createdAt/updatedAt) rather than spreading the Prisma row and deleting secret keys, so a future schema field added to the Certificate model can never leak into a response by default"

requirements-completed: []  # n/a — phase scoped by four todo files, not REQUIREMENTS.md IDs (see plan frontmatter); this plan implements the upload/validation/storage tracer + expansion for scope item 4, closed end-to-end by plan 09-08

coverage:
  - id: D1
    description: "A user can upload a certificate, key, and optional CA bundle over an authenticated multipart POST; the response contains only id/domainPattern/expiresAt, never privateKey/certificate/caBundle/any BEGIN-PEM substring"
    verification:
      - kind: unit
        ref: "server/test/unit/routes/certificates-routes.test.ts — 'POST /api/certificates' describe block (7 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A mismatched key/certificate pair, malformed PEM content, or a certificate not covering the declared domain pattern is rejected with BadRequestError before anything is persisted or written to disk; no rejection reason contains any substring of the key/certificate material"
    verification:
      - kind: unit
        ref: "server/test/unit/domain/certificate-validation.test.ts (10 tests); server/test/unit/application/certificate-service.test.ts — create() describe block (6 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "certFileBaseName strips a leading wildcard label (parent-domain naming, matching nginx-proxy's own convention) and throws for path-traversal-shaped input"
    verification:
      - kind: unit
        ref: "server/test/unit/domain/certificate-naming.test.ts (8 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The private key is encrypted (AES-256-GCM via the existing crypto.ts helper) before it is persisted, and decrypted only once, immediately before the plaintext is written to a 0o600 key file under the proxy stack's certificates directory"
    verification:
      - kind: unit
        ref: "server/test/unit/application/certificate-service.test.ts — 'encrypts the private key before persisting' + 'writes the key file using the decrypted plaintext' (2 tests); source: grep -rc '0o600' server/src/infrastructure/certificate-filesystem.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Certificates can be listed (metadata-only) and deleted; deleting a certificate still referenced by a proxy configuration is refused with a message naming every referencing domain rather than cascading or orphaning"
    verification:
      - kind: unit
        ref: "server/test/unit/application/certificate-service.test.ts — listAll()/delete() describe blocks (4 tests); server/test/unit/routes/certificates-routes.test.ts — GET/DELETE describe blocks (3 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A file write failure after the database row is created rolls the row back (no orphaned DB-only certificate); every certificate route requires authentication via the same requireAuth hook every other authenticated route uses"
    verification:
      - kind: unit
        ref: "server/test/unit/application/certificate-service.test.ts — 'deletes the just-created row and rethrows when the filesystem write rejects'; server/test/unit/routes/certificates-routes.test.ts — 'never reaches the handler when the authentication hook rejects the request'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live end-to-end proof that an uploaded certificate actually lands on the mounted proxy-stack certificates directory under the filename nginx-proxy resolves, against a real running proxy stack"
    verification: []
    human_judgment: true
    rationale: "This plan proves the path is correct via source-level containment/naming logic and unit tests with mocked filesystem I/O; it does not exercise a real Docker-mounted proxy stack. Same class of live-environment gap documented for 09-05/09-03 (TCP-to-Postgres block) and prior phases (shared-host live-deploy risk) — a human on an unrestricted host should upload a real cert through the API and confirm nginx-proxy serves it before treating scope item 4 as fully proven end-to-end."

duration: ~1h
completed: 2026-09-17
status: complete
---

# Phase 9 Plan 6: Certificate Upload, Validation, and Storage Summary

**Authenticated multipart certificate upload validated end-to-end with node:crypto (no PEM library), encrypted at rest with the existing AES-256-GCM helper, and written to disk under nginx-proxy's parent-domain wildcard naming convention — plus listing, refused deletion, and upload rejection hardening.**

## Performance

- **Duration:** ~1h
- **Started:** 2026-09-17 (required-reading phase preceded the first commit)
- **Completed:** 2026-09-17
- **Tasks:** 3 (1 checkpoint:human-verify resolved by the orchestrator before this session began, 2 tdd="true" auto tasks)
- **Files modified:** 17 (10 created source/test files, 5 fixture files, 2 wiring edits, plus package.json/yarn.lock)

## Task 1 Resolution (checkpoint:human-verify, gate=blocking-human)

Per the orchestrator's prompt, this verification was already performed and presented to the developer before this execution session began — live, authoritative data was fetched directly from the npm registry API and the npm downloads API (not from memory/recall).

- **Verdict:** approved
- **Date:** 2026-09-17
- **Package:** `@fastify/multipart`
- **Version at approval:** 10.1.1 (published 2026-08-14T23:05:37.241Z)
- **Repository URL:** `https://github.com/fastify/fastify-multipart` (official `fastify` GitHub organisation)
- **Scope:** `@fastify` (official Fastify org scope, matching this project's existing `@fastify/cookie`/`@fastify/cors`/`@fastify/static` convention)
- **Weekly downloads at approval:** 2,008,249 (window 2026-09-05 to 2026-09-11)

Per the orchestrator's instruction, this checkpoint was not re-asked or reopened — execution proceeded directly to Task 2 Step A (`yarn workspace @docktor/server add @fastify/multipart`), which installed cleanly at the approved version.

## Task Commits

1. **Task 2 (RED):** `361d0e9` — `test(09-06): add failing tests for certificate naming, validation, and upload route`
2. **Task 2 (GREEN):** `db0c62d` — `feat(09-06): add certificate upload tracer — validation, encryption, and file materialization`
3. **Task 3 (RED):** `58beda9` — `test(09-06): add failing tests for certificate listing, deletion, and rejection paths`
4. **Task 3 (GREEN):** `d935dc4` — `feat(09-06): add certificate listing, refused deletion, and upload rejection hardening`

**Plan metadata:** (this commit) — `docs(09-06): complete certificate upload, validation, and storage plan`

## Task 2: TDD Discipline (RED → GREEN)

**RED:** Wrote `certificate-naming.test.ts`, `certificate-validation.test.ts`, and `certificates-routes.test.ts` (POST-only) against no implementation — all three files failed with `Cannot find module` errors on the not-yet-created source modules (0 tests collected, exactly the expected "module doesn't exist yet" RED shape). Fixture material (`leaf.crt`/`leaf.key` with SANs covering both `example.com` and `*.example.com`, `unrelated.key`, `ca-bundle.crt`) was generated with OpenSSL in the same commit, verified matching (`openssl x509 ... -pubkey | md5` equals `openssl pkey ... -pubout | md5`) before being committed. Committed as `361d0e9`.

**GREEN:** Implemented `certificate-validation.ts` (pure, `node:crypto` only — `X509Certificate`/`createPrivateKey`, no PEM/ASN.1 dependency added), `certificate-naming.ts` (pure, parent-domain wildcard convention), `certificate-filesystem.ts` (containment guard mirroring `getStackPath()`, `0o600` key perms, leaf+CA-bundle concatenation), `certificate-repository.ts` (explicit-field `toDto()`), `certificate-service.ts` (`create()`: validate → coverage check → expiry → encrypt → persist → decrypt-once → write, with row rollback on file-write failure), and `routes/certificates.ts` (`POST /api/certificates`, `requireAuth` first, `@fastify/multipart` scoped to this plugin with explicit `64KB`/`3 files`/`2 fields` limits). Wired into `application/index.ts` and `app.ts`. Re-ran: **18/18 domain tests pass, 4/4 route tests pass**, `yarn typecheck` exits 0, full server unit suite **43 files / 663 tests pass (2 pre-existing todo)** — no regressions. Committed as `db0c62d`.

## Task 3: TDD Discipline (RED → GREEN)

**RED:** Wrote `certificate-service.test.ts` (new — covers `listAll()`, `delete()`, and locks down Task 2's already-shipped `create()` behavior with dedicated assertions for the first time) and extended `certificates-routes.test.ts` with `GET`/`DELETE` and rejection-path tests. To obtain genuine RED evidence (not just "these assertions would fail if run"), the three Task-3 implementation files were reverted to their Task-2 HEAD state via `git checkout --` before running the suite: **7 of 20 tests failed exactly on the new surface** (`service.listAll is not a function`, `service.delete is not a function`, `404` on the not-yet-registered `GET`/`DELETE` routes) — the 13 tests covering Task 2's `create()` logic still passed, confirming the RED was scoped to this task's additions only. Committed as `58beda9`.

**GREEN:** Re-applied the Task 3 implementation (from the exact content already authored, verified against the reverted-file reads): `CertificateRepository.findReferencingDomains()` (resolves through the Certificate row's own back-relation to `ProxyConfig`, never touching `proxy-repository.ts`), `CertificateService.listAll()`/`delete()` (refuses with `ConflictError` naming every referencing domain; translates a `P2003` restricted-relation race into the same error), `GET`/`DELETE /api/certificates(/:id)` routes, and an explicit `RequestFileTooLargeError → BadRequestError` mapping in the POST handler (see Deviations/decisions below for why this mapping was needed). Re-ran: **20/20 tests pass**, `yarn typecheck` exits 0, full server unit suite **44 files / 679 tests pass (2 pre-existing todo)** — no regressions. Committed as `d935dc4`.

## Files Created/Modified

- `server/src/domain/certificate-validation.ts` — pure PEM/key/coverage/expiry validation, `node:crypto` only
- `server/src/domain/certificate-naming.ts` — parent-domain wildcard filename derivation
- `server/src/infrastructure/certificate-filesystem.ts` — certs-dir resolution, containment guard, `0o600` key write, leaf+bundle concatenation
- `server/src/repositories/certificate-repository.ts` — CRUD, explicit-field `toDto()`, `findReferencingDomains()`
- `server/src/application/certificate-service.ts` — `create()`/`listAll()`/`delete()` orchestration
- `server/src/routes/certificates.ts` — `POST`/`GET`/`DELETE /api/certificates(/:id)`, `requireAuth` first, scoped multipart registration
- `server/src/application/index.ts` — `certificateService` singleton wiring
- `server/src/app.ts` — `certificateRoutes` import + registration
- `server/test/fixtures/certs/` — throwaway OpenSSL-generated fixtures + `README.md`
- `server/test/unit/domain/certificate-validation.test.ts`, `certificate-naming.test.ts` — 18 tests
- `server/test/unit/application/certificate-service.test.ts` — 10 tests
- `server/test/unit/routes/certificates-routes.test.ts` — 10 tests

## Decisions Made

See `key-decisions` in frontmatter. In particular:

1. **Chain-file name not verified.** Per the plan's own instruction, no speculatively named third certificate file was written for nginx-proxy's trusted-chain stapling. Only the concatenated `.crt` (leaf + CA bundle, when supplied) and `.key` are written — this satisfies D-09's functional requirement (a complete chain is served) without guessing at an unconfirmed filename.
2. **Over-limit upload required explicit mapping.** Reading `server/src/app.ts`'s global error handler confirmed it only recognizes `AppError` subclasses, 400-shaped Zod validation errors, and `error.name === "ZodError"` — any other thrown error (including `@fastify/multipart`'s `RequestFileTooLargeError`, which carries a real `statusCode: 413` but is not an `AppError`) falls through to a generic `500`. The route now catches `err.code === "FST_REQ_FILE_TOO_LARGE"` explicitly and re-throws `BadRequestError`, confirmed by a route test that posts a 70 KiB file against the 64 KiB limit and asserts a `4xx`, not `500`.

## Deviations from Plan

None — plan executed exactly as written, including its own two-task tracer/expansion structure and Task 1's already-resolved checkpoint.

## Issues Encountered

- **Test-authoring correction (no production-code bug):** an early version of a Task 3 service test asserted that the certificate PEM value passed to the mocked filesystem port would already contain the concatenated CA bundle. Re-reading the plan's Step D confirmed concatenation is `CertificateFilesystem`'s responsibility, not the service's — the service passes the leaf certificate and bundle through as separate fields. The test was corrected to assert on both fields independently rather than a pre-concatenated string; no service or filesystem code changed as a result.

## User Setup Required

None — no external service configuration required. A developer on an unrestricted host with a live proxy stack deployed should perform one live end-to-end upload (see coverage item D7) to confirm nginx-proxy actually serves a certificate written by this code, before treating scope item 4 as fully proven in production. This is consistent with the class of live-environment gaps already tracked in `.planning/WINDOWS.md` (entries #10, #11) for this phase's earlier plans.

## Next Phase Readiness

- **Ready for 09-07:** `CertificateService.create()`/`listAll()`/`delete()` and the `GET`/`POST`/`DELETE /api/certificates` routes are in place and fully unit-tested; `server/src/application/proxy-service.ts`, `server/src/jobs/proxy-cert-poller.ts`, and `server/src/repositories/proxy-repository.ts` are all untouched (verified via `git diff --stat`), so plan 09-07 can wire `ProxyCertPoller`'s `certSource: 'custom'` branch and the ACME-skip linkage against a clean base.
- **Ready for 09-08:** the todo this plan partially implements (`2026-09-07-add-support-for-custom-tls-certificates.md`) has its upload/validation/storage slice (scope item 4, decisions D-09/D-10/D-12) fully delivered; 09-08 can close the todo once 09-07's poller integration and any UI work land.
- **Carried-forward gap:** D7 (live end-to-end proof against a real mounted proxy stack) is unverified in this session — see coverage block and User Setup Required above.

## Self-Check: PASSED

- FOUND: `server/src/domain/certificate-validation.ts`
- FOUND: `server/src/domain/certificate-naming.ts`
- FOUND: `server/src/infrastructure/certificate-filesystem.ts`
- FOUND: `server/src/repositories/certificate-repository.ts`
- FOUND: `server/src/application/certificate-service.ts`
- FOUND: `server/src/routes/certificates.ts`
- FOUND: `server/test/fixtures/certs/README.md`
- FOUND: `server/test/unit/domain/certificate-validation.test.ts`
- FOUND: `server/test/unit/domain/certificate-naming.test.ts`
- FOUND: `server/test/unit/application/certificate-service.test.ts`
- FOUND: `server/test/unit/routes/certificates-routes.test.ts`
- FOUND commit: `361d0e9` (test)
- FOUND commit: `db0c62d` (feat)
- FOUND commit: `58beda9` (test)
- FOUND commit: `d935dc4` (feat)

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-17*
