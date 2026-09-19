---
phase: 09-deployment-and-release-readiness
reviewed: 2026-09-17T00:00:00Z
depth: standard
files_reviewed: 48
files_reviewed_list:
  - client/src/components/domain/stack/cert-status-badge.tsx
  - client/src/hooks/use-proxy-status.ts
  - client/src/lib/api.ts
  - client/src/lib/certificates-api.ts
  - client/src/lib/proxy-api.ts
  - client/src/routes/app/settings/components/certificates-card.tsx
  - client/src/routes/app/settings.tsx
  - client/src/routes/app/stacks/components/proxy-tab.tsx
  - client/test/unit/components/domain/stack/cert-status-badge.test.tsx
  - client/test/unit/lib/api.test.ts
  - client/test/unit/lib/certificates-api.test.ts
  - client/test/unit/routes/proxy-tab.test.tsx
  - client/test/unit/routes/settings/certificates-card.test.tsx
  - Dockerfile
  - docs/deployment.md
  - .env.example
  - .github/workflows/ci.yml
  - package.json
  - server/package.json
  - server/prisma/migrations/0_init/migration.sql
  - server/prisma/migrations/20260917083545_add_certificate/migration.sql
  - server/prisma/schema/proxy.prisma
  - server/src/application/certificate-service.ts
  - server/src/application/index.ts
  - server/src/application/proxy-service.ts
  - server/src/app.ts
  - server/src/domain/certificate-naming.ts
  - server/src/domain/certificate-validation.ts
  - server/src/index.ts
  - server/src/infrastructure/certificate-filesystem.ts
  - server/src/jobs/proxy-cert-poller.ts
  - server/src/lib/schema-sync.ts
  - server/src/lib/state-broadcaster.ts
  - server/src/repositories/certificate-repository.ts
  - server/src/repositories/proxy-repository.ts
  - server/src/routes/certificates.ts
  - server/test/fixtures/certs/ca-bundle.crt
  - server/test/fixtures/certs/leaf.crt
  - server/test/fixtures/certs/leaf.key
  - server/test/fixtures/certs/README.md
  - server/test/fixtures/certs/unrelated.key
  - server/test/unit/application/certificate-service.test.ts
  - server/test/unit/application/proxy-service.test.ts
  - server/test/unit/domain/certificate-naming.test.ts
  - server/test/unit/domain/certificate-validation.test.ts
  - server/test/unit/jobs/proxy-cert-poller.test.ts
  - server/test/unit/lib/schema-sync.test.ts
  - server/test/unit/routes/certificates-routes.test.ts
  - shared/src/validation/proxy.ts
  - shared/test/unit/validation/proxy.test.ts
  - yarn.lock
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-09-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 48
**Status:** issues_found

## Summary

Reviewed the full custom-TLS-certificate feature (data model, upload/validation/storage/encryption, ACME
suppression, expiry polling, client UI), the Prisma schemaless-to-migrations cutover, and the CI matrix
addition. The domain layer (`certificate-naming.ts`, `certificate-validation.ts`) is careful and
well-tested: path-traversal defenses are layered three deep, and rejection reasons are provably
non-interpolating so secret PEM material can never leak into an error message. The `certSource`
promote-not-add invariant is consistently threaded through `assignDomain`, `adoptUnmanagedDomains`,
`renderProxyEnvForService`, and the poller's row classification, and is backfilled correctly by the
migration (`DEFAULT 'acme'` on the new column). `schema-sync.ts`'s baseline/drift-probe logic is
thoroughly unit-tested against all four startup scenarios (fresh DB, `db push`-synced DB, already-migrated
DB, and post-baseline drift).

One concrete secret-handling gap was found in the certificate file-write path (private key file is briefly
world-readable before its permissions are narrowed — see CR-01), plus four maintainability/robustness
gaps around error-path completeness and defense-in-depth that should be fixed before this ships.

## Critical Issues

### CR-01: Private key file is briefly world-readable before its permissions are narrowed (TOCTOU window, violates the file's own T-09-35 threat mitigation)

**File:** `server/src/infrastructure/certificate-filesystem.ts:70-72`

**Issue:** `writeCertificateFiles()` writes the key file with `fs.writeFile(keyPath, content.privateKey, "utf-8")` — a string encoding argument, not an object with a `mode` — then narrows permissions in a *separate, later* `fs.chmod(keyPath, PRIVATE_KEY_MODE)` call. `fs.writeFile` with a bare encoding argument creates the file at the process's default mode (`0o666` minus umask — verified empirically as `0o644`, i.e. world-readable, under this project's default umask). Between the `writeFile` completing and the `chmod` call resolving, the plaintext private key sits on disk at `0o644` — readable by any other user or process on the host, including the `acme-companion` container, which this file's own comment says is mounted read-write into the same certs directory. This directly contradicts the comment immediately above the constant it uses:

```ts
// Owner-only permissions — the private key file must never be group/world
// readable on the host (T-09-35).
const PRIVATE_KEY_MODE = 0o600;
```

Confirmed empirically:
```
$ node -e "require('fs').writeFileSync('/tmp/t','x','utf-8'); console.log((require('fs').statSync('/tmp/t').mode & 0o777).toString(8))"
644
```

This only matters on first write of a given certificate base name (an overwrite of an already-`chmod`'d file keeps its existing mode across the `writeFile` truncate), but every *new* certificate upload hits this exact path.

**Fix:** Create the file already restricted, instead of writing then narrowing:

```ts
await fs.writeFile(crtPath, crtContent, "utf-8");
await fs.writeFile(keyPath, content.privateKey, {encoding: "utf-8", mode: PRIVATE_KEY_MODE});
await fs.chmod(keyPath, PRIVATE_KEY_MODE); // keep as a defense-in-depth backstop for the overwrite case, where an existing file's mode from a stale prior write must still be forced back to 0600
```
Note the `mode` option to `fs.writeFile`/`fs.open` is itself subject to the process umask on file creation, so for a hard guarantee under an unknown umask, open explicitly with `fs.open(keyPath, 'w', PRIVATE_KEY_MODE)` and write through the returned handle, then still keep the trailing `chmod` as a backstop for the overwrite case.

## Warnings

### WR-01: Duplicate `domainPattern` on certificate upload surfaces as an unhandled 500, not a client-facing error

**File:** `server/src/application/certificate-service.ts:64-70`

**Issue:** `Certificate.domainPattern` has a `@@unique` constraint (`server/prisma/schema/proxy.prisma:88`), but `CertificateService.create()` calls `this.certRepo.create(...)` with no try/catch around the unique-constraint violation. A second upload for a domain pattern that already has a certificate throws a raw `Prisma.PrismaClientKnownRequestError` (code `P2002`), which is not an `AppError` subclass, so `app.ts`'s global error handler falls through to `reply.status(500).send({error: "Internal server error"})` — an opaque failure for an entirely expected, guessable user action. Contrast with `delete()` in the same class, which carefully translates its own `P2003`/`P2002` failures into `ConflictError` via `translateCertificateDeleteError`. There is no test in `certificate-service.test.ts` covering this path either, confirming the gap is unaddressed rather than deliberately deferred.

**Fix:** Add the same translate-and-rethrow pattern `delete()` already uses:

```ts
try {
    row = await this.certRepo.create({...});
} catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError(`A certificate for domain pattern "${input.domainPattern}" already exists`);
    }
    throw err;
}
```

### WR-02: Certificate upload route only maps one of three multipart limit errors to a 4xx

**File:** `server/src/routes/certificates.ts:44-55`

**Issue:** The route registers `@fastify/multipart` with three limits (`fileSize`, `files: 3`, `fields: 2`), and the catch block explicitly maps only `FST_REQ_FILE_TOO_LARGE_CODE` to `BadRequestError`. `@fastify/multipart` throws two other, equally-reachable limit errors from the exact same `limits` config — `FST_FILES_LIMIT` (more than 3 file parts) and `FST_FIELDS_LIMIT` (more than 2 non-file fields) — both also carrying a `413` `statusCode` on the underlying error object. Neither is special-cased, so both fall through to `throw err`, and since `app.ts`'s global error handler doesn't fall back to a thrown error's own `.statusCode` for non-`AppError`/non-Zod errors, the client receives an unhelpful `500` instead of the `4xx` the route's own comment says it's trying to guarantee ("Mapped explicitly here so an over-limit upload is a 4xx, not an unhandled-looking 500"). This is the exact DoS-mitigation surface (T-09-32) this route calls out, so all three limit codes should be handled uniformly, not just one.

**Fix:**
```ts
const MULTIPART_LIMIT_CODES = new Set([
    "FST_REQ_FILE_TOO_LARGE",
    "FST_FILES_LIMIT",
    "FST_FIELDS_LIMIT",
]);
...
if (err && typeof err === "object" && "code" in err && MULTIPART_LIMIT_CODES.has(err.code as string)) {
    throw new BadRequestError("Certificate upload exceeded an upload limit (file size, file count, or field count)");
}
```

### WR-03: Unchecked `as` cast on `RequestInit.headers` in `apiFetch`, with no justifying comment, silently breaks on valid `RequestInit` shapes

**File:** `client/src/lib/api.ts:19-21`

**Issue:**
```ts
const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
};
```
`RequestInit["headers"]` is typed as `HeadersInit`, which also legally includes a `Headers` instance or a `[string, string][]` tuple array — not only a plain object. CLAUDE.md requires that "`as SomeType` is only acceptable with a comment explaining why it is safe"; this cast has none, and it is not actually safe: spreading a `Headers` instance's own enumerable properties yields `{}` (its data is not exposed as own-enumerable keys), and spreading an array of tuples yields an object keyed by numeric index (`{0: [...], 1: [...]}`), not by header name. No current caller passes either shape (confirmed via `grep` across `client/src`), so this is currently latent rather than triggered, but it will silently produce broken headers for the first caller that does (e.g. a future caller reusing a `Headers` object built elsewhere), with no compiler error to catch it.

**Fix:** Normalize explicitly instead of casting:
```ts
const headers: Record<string, string> = {};
if (options?.headers) {
    for (const [key, value] of new Headers(options.headers).entries()) {
        headers[key] = value;
    }
}
```
(`new Headers(...)` accepts all three `HeadersInit` shapes and normalizes them uniformly.)

### WR-04: The `certSource`/`certificateId` "custom requires a certificate" invariant (D-11) is enforced only by the Zod schema at the route boundary, not independently in the service layer

**File:** `server/src/application/proxy-service.ts:225-229`

**Issue:**
```ts
const certSource = input.certSource ?? "acme";
if (certSource === "custom" && input.certificateId) {
    await this.certRepo.findByIdOrThrow(input.certificateId);
}
const certificateId = certSource === "custom" ? (input.certificateId ?? null) : null;
```
If `certSource === "custom"` but `input.certificateId` is falsy, the existence check is skipped entirely (the `if` requires both), and the row is still persisted with `certSource: "custom"`, `certificateId: null` — a state with TLS implied to be certificate-backed but no certificate actually linked. Today this can only happen if a caller bypasses `assignDomainSchema`'s `superRefine` (which requires `certificateId` whenever `certSource` is `"custom"`) — confirmed the one existing route (`server/src/routes/proxy.ts`) does apply that schema via `{schema: {body: assignDomainSchema}}`, so this is not currently reachable from the HTTP API. But per CLAUDE.md's DDD principle ("keep business logic in the domain/application layers"; the service is supposed to be the layer that keeps invariants, not just the transport layer), this leaves `ProxyService.assignDomain` — a method already explicitly documented as enforcing "D-11 promote rule: every row carries an explicit certificate source — never inferred" — silently trusting the caller for half of that same rule. Any future second caller of `assignDomain()` (an import path, an admin script, a different route) would not be protected.

**Fix:** Make the service self-defending regardless of the caller:
```ts
if (certSource === "custom") {
    if (!input.certificateId) {
        throw new BadRequestError("certificateId is required when certSource is custom");
    }
    await this.certRepo.findByIdOrThrow(input.certificateId);
}
```

## Info

### IN-01: `CERTIFICATE_EXPIRY_WARNING_DAYS` is duplicated (client and server) with no shared source of truth

**File:** `client/src/routes/app/settings/components/certificates-card.tsx:38`

**Issue:** The client redeclares the value `30` locally, with a comment acknowledging it "must stay in sync with the poller's own threshold" (`server/src/jobs/proxy-cert-poller.ts`'s `CERT_EXPIRY_WARNING_DAYS`). This is a real (if currently harmless) drift risk — a future change to one constant silently desyncs the client's warning badge from the server's actual classification, since nothing enforces they match, and no test asserts equality between the two literals.

**Fix:** Move the constant into `@docktor/shared` (alongside `certStatusSchema`, which already documents itself as the shared vocabulary these three consumers must agree on) and import it from both sides, or add a unit test in one workspace that imports both literals and asserts equality as a tripwire.

### IN-02: `CertificatesCard`'s load effect maps any fetch failure (network error, 401, 500) to "no certificates"

**File:** `client/src/routes/app/settings/components/certificates-card.tsx:78-99`

**Issue:** `catch { if (!cancelled) setCertificates([]); }` treats every error identically to "there are genuinely zero certificates," rendering the friendly empty-state copy ("No certificates uploaded yet...") instead of surfacing that the list actually failed to load. This mirrors an existing precedent elsewhere in the file (`proxy-settings-card.tsx`), so it's a consistent pattern rather than a one-off omission, but it does mean a user with certificates who hits a transient fetch failure sees "you have none" rather than "something went wrong, retry."

**Fix:** Track a distinct error state (as `certificates-card.tsx`'s sibling error states for upload/delete already do) and render a retry affordance instead of silently rendering the empty-list copy.

---

_Reviewed: 2026-09-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
