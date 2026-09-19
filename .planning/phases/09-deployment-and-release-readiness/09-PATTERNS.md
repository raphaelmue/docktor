# Phase 9: Deployment and Release Readiness - Pattern Map

**Mapped:** 2026-09-15
**Files analyzed:** 14 (new/modified)
**Analogs found:** 12 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `.env.example` (fix line 3) | config | file-I/O | n/a — text edit | n/a |
| `.env.production` (fix header, if accessible) | config | file-I/O | n/a — text edit | n/a |
| `server/prisma/migrations/0_init/migration.sql` | migration | batch | none (net-new: `prisma migrate diff` generated) | no-analog |
| `server/src/lib/schema-sync.ts` (modify) | utility/startup | request-response (CLI subprocess) | itself (existing file, modify in place) | exact |
| `.github/workflows/ci.yml` (modify — add matrix job) | config (CI) | batch | itself (existing `build-and-test` job) | exact |
| `server/prisma/schema/proxy.prisma` (modify — add `Certificate` model + linkage) | model | CRUD | existing `ProxyConfig` model in same file | exact |
| `shared/src/validation/proxy.ts` (modify — add wildcard pattern + certSource) | utility (Zod schema) | transform | `hostnamePattern`/`assignDomainSchema` in same file | exact |
| `server/src/repositories/certificate-repository.ts` | repository | CRUD | `server/src/repositories/proxy-repository.ts` | exact |
| `server/src/application/certificate-service.ts` | service | CRUD + file-I/O (validation, cert-file materialization) | `server/src/application/proxy-service.ts` | role-match (proxy-service also mixes CRUD + filesystem writes) |
| `server/src/routes/certificates.ts` | route/controller | request-response (+ file upload) | `server/src/routes/proxy.ts` (routing shape); `@fastify/multipart` is net-new for the upload part | role-match |
| `client/src/lib/certificates-api.ts` | API client | request-response (+ multipart upload) | `client/src/lib/proxy-api.ts` | role-match |
| `server/src/jobs/proxy-cert-poller.ts` (modify — branch on `certSource`) | job (event-driven/cron) | event-driven | itself (existing file, modify in place) | exact |
| `client/src/components/domain/stack/cert-status-badge.tsx` (modify — add expiry state) | component | request-response (presentational) | itself (existing file, modify in place) | exact |
| `client/src/routes/app/settings/components/certificates-card.tsx` (or similar, new UI section) | component | CRUD (form + list) | no direct analog found for a card-with-upload; closest shape precedent is Settings' existing proxy card pattern in `client/src/routes/app/settings.tsx` | partial |

## Pattern Assignments

### `server/src/lib/schema-sync.ts` (modify: `db push` → `migrate deploy`, add D-05 auto-baseline)

**Analog:** itself — modify in place, preserving the guard structure.

**What stays unchanged** (guard skeleton, lines 218-271 of current file): env-var opt-out check, `acquireLock()`/advisory-lock dance, never-throw `try/catch` wrapper, `finally { await lockResult.release() }`.

**What changes — `buildArgv()`** (current lines 126-128):
```typescript
function buildArgv(): string[] {
    return ["db", "push", `--config=${resolvePrismaConfigPath()}`];
}
```
becomes (D-04) a `migrate deploy` argv. Per RESEARCH.md, verify the exact no-op stdout string live before finalizing the outcome regex — do not reuse `/already in sync/i` verbatim (that string is `db push`-specific).

**New: D-05 auto-baseline detection**, reusing the existing raw `pg.Client` connection pattern already established in `connectWithRetry()`/`defaultAcquireLock()` (lines 151-200):
```typescript
async function needsBaseline(client: Client): Promise<boolean> {
    const {rows} = await client.query<{has_history: boolean}>(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name = '_prisma_migrations'
         ) AS has_history`,
    );
    return rows[0]?.has_history === false;
}
```
Wire this into `syncDatabaseSchema()` right after lock acquisition, before building/running the CLI argv: if `needsBaseline()` is true AND an application table already exists, run `prisma migrate resolve --applied 0_init` first, then proceed to `migrate deploy` unconditionally (no-ops if nothing pending). Log every step loudly via the existing `[schema-sync]` prefix convention (see lines 230-231, 246-247, 259).

**Doc comment at lines 202-216 must be rewritten** — it currently says "Interim fix only... do not adopt that formal-migrations command here," which becomes false and misleading after this cutover.

---

### `.github/workflows/ci.yml` (add Windows + macOS matrix job)

**Analog:** the existing `build-and-test` job in the same file (lines 9-73).

**Core pattern to copy** (steps 1-6 of the existing job: checkout, setup-node@v4, corepack enable, `yarn install --immutable`, `prisma generate`, `yarn build`, `yarn typecheck`):
```yaml
cross-platform-unit:
  strategy:
    fail-fast: false
    matrix:
      os: [windows-latest, macos-latest]
  runs-on: ${{ matrix.os }}
  env:
    BETTER_AUTH_SECRET: ci-test-secret
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
    - name: Enable Corepack
      run: corepack enable
    - name: Install dependencies
      run: yarn install --immutable
    - name: Generate Prisma client
      run: yarn exec prisma generate --config=server/prisma/prisma.config.ts
    - name: Build
      run: yarn build
    - name: Typecheck
      run: yarn typecheck
    - name: Unit tests (client + shared)
      run: yarn test:unit
    - name: Server unit tests only
      run: yarn workspace @docktor/server test:unit
```
**Critical deviation from the ubuntu job:** do NOT copy the ubuntu job's `yarn workspace @docktor/server test` step (that runs unit+integration combined, and integration tests are testcontainers-based — no Docker on these runners per D-06). Use `yarn workspace @docktor/server test:unit` explicitly (confirmed present at `server/package.json:11`) — root `yarn test:unit` excludes `@docktor/server` by design (`package.json`'s `test:unit` script), so omitting this step would make the new required check pass while running zero server-side tests (RESEARCH.md Pitfall 5).

**Do not copy:** Playwright install/E2E steps, coverage-artifact upload/SonarQube steps — out of scope per D-06.

**D-07 (required-check status)** is a GitHub branch-protection setting, not YAML — no file pattern applies; flag as a manual follow-up step.

---

### `server/prisma/schema/proxy.prisma` (add `Certificate` model + `certSource` linkage)

**Analog:** the existing `ProxyConfig` model in the same file (24 lines, shown in full above).

**Pattern to copy** — id/timestamps convention, relation style, inline comments explaining string-vs-enum choices:
```prisma
model ProxyConfig {
  id          String @id @default(cuid())
  stackId     String
  stack       Stack  @relation(fields: [stackId], references: [id], onDelete: Cascade)
  ...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([domain])
}
```
New `Certificate` model should follow the same shape: `id String @id @default(cuid())`, `createdAt`/`updatedAt` pair, a `domainPattern String` field (may include a leading `*.`), encrypted `privateKey String` (ciphertext via `crypto.ts`), `certificate String` (PEM, not secret — but still not surfaced in list responses per Security Domain notes), optional `caBundle String?`, `expiresAt DateTime?` (D-13, separate field per RESEARCH.md's recommended design — do NOT overload `certStatus`), and a `@@unique([domainPattern])`.

Add to `ProxyConfig`: `certSource String @default("acme")` (D-11) and an optional `certificateId String?` + relation to `Certificate`, mirroring the existing `stackId`/`stack` relation pattern in the same model.

---

### `shared/src/validation/proxy.ts` (add wildcard-aware schema + certSource enum)

**Analog:** `hostnamePattern`/`assignDomainSchema`/`certStatusSchema` in the same file (full file shown above, 26 lines).

**Pattern to copy** — regex-with-comment-explaining-security-rationale, then a Zod object wrapping it, then `z.infer` export:
```typescript
export const hostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export const assignDomainSchema = z.object({
    domain: z.string().min(1).regex(hostnamePattern, "Must be a valid hostname").toLowerCase(),
    ...
});
export type AssignDomainInput = z.infer<typeof assignDomainSchema>;

export const certStatusSchema = z.enum(["pending", "issued", "failed"]);
```
New additions, same file (single source of truth per CLAUDE.md — do not duplicate into a `certificate.ts` file):
```typescript
export const domainPatternRegex = /^(?:\*\.)?(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export const certSourceSchema = z.enum(["acme", "custom"]);
export type CertSource = z.infer<typeof certSourceSchema>;

export const createCertificateSchema = z.object({
    domainPattern: z.string().min(1).regex(domainPatternRegex, "Must be a valid hostname or wildcard pattern").toLowerCase(),
    // cert/key/caBundle arrive as multipart file parts, not this JSON body —
    // validate their PEM content server-side via node:crypto (see Certificate Service section).
});
```

---

### `server/src/repositories/certificate-repository.ts` (new)

**Analog:** `server/src/repositories/proxy-repository.ts` (full file shown above, 72 lines) — also cross-checked against `server/src/repositories/backup-repository.ts` for the `findByIdOrThrow`/`toDto` conventions.

**Core pattern to copy exactly:**
```typescript
import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";

export class CertificateRepository {
    async create(data: {domainPattern: string; privateKey: string; certificate: string; caBundle?: string | null; expiresAt: Date}) {
        return prisma.certificate.create({data});
    }

    async findById(id: string) {
        return prisma.certificate.findUnique({where: {id}});
    }

    async findByIdOrThrow(id: string) {
        const cert = await prisma.certificate.findUnique({where: {id}});
        if (!cert) {
            throw new NotFoundError(`Certificate "${id}" not found`);
        }
        return cert;
    }

    async findAll() {
        return prisma.certificate.findMany({orderBy: {createdAt: "asc"}});
    }

    async delete(id: string) {
        return prisma.certificate.delete({where: {id}});
    }
}

export const certificateRepository = new CertificateRepository();
```
**Never round-trip the private key in a list/GET response** — mirror `BackupRepository.toDto()`'s explicit-serialization-safety pattern (lines 112-117 of `backup-repository.ts`) by adding a `toDto()` that strips `privateKey` entirely rather than relying on callers to remember.

---

### `server/src/application/certificate-service.ts` (new)

**Analog:** `server/src/application/proxy-service.ts` (constructor-injected `Pick<>`-typed deps pattern, lines 33-41 shown above).

**Core pattern to copy — narrow constructor injection:**
```typescript
export class CertificateService {
    constructor(
        private readonly certRepo: CertificateRepository,
        private readonly proxyRepo: Pick<ProxyRepository, "findByIdOrThrow" | "updateConfig">,
        private readonly fs: Pick<StackFilesystem /* or a dedicated certs-fs port */, "writeFile" | "readFile">,
    ) {}
}
```

**Validation logic** (D-12) — copy directly from RESEARCH.md's Code Examples section (verified against Node's official `X509Certificate` docs, no new dependency):
```typescript
import {X509Certificate, createPrivateKey} from "node:crypto";

function validateCertKeyPair(certPem: string, keyPem: string): {valid: boolean; reason?: string} {
    let cert: X509Certificate;
    try {
        cert = new X509Certificate(certPem);
    } catch {
        return {valid: false, reason: "Certificate is not a valid PEM/DER X.509 certificate"};
    }
    let privateKey;
    try {
        privateKey = createPrivateKey(keyPem);
    } catch {
        return {valid: false, reason: "Key is not a valid private key"};
    }
    if (!cert.checkPrivateKey(privateKey)) {
        return {valid: false, reason: "Private key does not match certificate"};
    }
    return {valid: true};
}
```

**Filename derivation** (D-11, confirmed against nginx-proxy's own docs — parent-domain naming, NOT underscore-prefixed):
```typescript
function certFileBaseName(domainPattern: string): string {
    return domainPattern.startsWith("*.") ? domainPattern.slice(2) : domainPattern;
}
```

**Encryption at rest** — reuse `server/src/lib/crypto.ts` verbatim, same as SMTP/SFTP/S3/restic secrets:
```typescript
import {encrypt, decrypt} from "../lib/crypto.js";
// encrypt(privateKeyPem) before repo.create(); decrypt(row.privateKey) only at
// the single point the plaintext key is written to disk under volumes/certs.
```

**Error handling pattern** — throw typed errors from `../lib/errors.js` (`BadRequestError` for D-12 validation failures, `NotFoundError` via `findByIdOrThrow`), same hierarchy `proxy-service.ts` uses (`BadRequestError, ConflictError, NotFoundError` import at line 1).

---

### `server/src/routes/certificates.ts` (new)

**Analog:** `server/src/routes/proxy.ts` (full file shown above, 60 lines) for the route-registration shape; `@fastify/multipart` itself has no in-repo precedent (net-new dependency, D-09).

**Core pattern to copy — `requireAuth` hook + Zod params/body schemas + service delegation:**
```typescript
import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {requireAuth} from "../lib/auth-middleware.js";
import {certificateService} from "../application/index.js";

const certificateParamsSchema = z.object({id: z.string()});

const certificateRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth);

    await app.register(import("@fastify/multipart"), {
        limits: {fileSize: 64 * 1024, files: 3}, // certs/keys are small PEM text; reject oversized uploads (DoS mitigation)
    });

    app.get("/api/certificates", async () => certificateService.listAll());

    app.post("/api/certificates", async (request, reply) => {
        // multipart parts read here (domainPattern field + cert/key/caBundle files),
        // NOT a {schema: {body: zodSchema}} JSON body — validate domainPattern via
        // createCertificateSchema after extracting the field, before calling the service.
        const cert = await certificateService.create(/* parsed fields */);
        return reply.status(201).send(cert);
    });

    app.delete(
        "/api/certificates/:id",
        {schema: {params: certificateParamsSchema}},
        async (request, reply) => {
            await certificateService.delete(request.params.id);
            return reply.status(204).send();
        },
    );
};

export default certificateRoutes;
```
Register alongside other route plugins the same way `proxy.ts` is registered (check `server/src/app.ts` or `server/src/routes/index.ts` for the registration list).

---

### `client/src/lib/certificates-api.ts` (new)

**Analog:** `client/src/lib/proxy-api.ts` (full file shown above, 68 lines).

**Pattern to copy — typed interface + `apiFetch<T>()` wrapper functions:**
```typescript
import {apiFetch} from "@/lib/api"

export interface Certificate {
    id: string
    domainPattern: string
    expiresAt: string | null
    createdAt: string
    updatedAt: string
    // privateKey/certificate/caBundle NEVER included — server never returns them
}

export async function getCertificates(): Promise<Certificate[]> {
    return apiFetch<Certificate[]>("/api/certificates")
}

export async function uploadCertificate(domainPattern: string, cert: File, key: File, caBundle?: File): Promise<Certificate> {
    const form = new FormData()
    form.append("domainPattern", domainPattern)
    form.append("certificate", cert)
    form.append("privateKey", key)
    if (caBundle) form.append("caBundle", caBundle)
    // multipart upload — do not JSON.stringify the body or set Content-Type
    // manually; browser sets the multipart boundary header automatically.
    return apiFetch<Certificate>("/api/certificates", {method: "POST", body: form})
}

export async function deleteCertificate(id: string): Promise<void> {
    await apiFetch(`/api/certificates/${id}`, {method: "DELETE"})
}
```
Confirm `apiFetch()` (in `client/src/lib/api.ts`, not read this session) does not force `Content-Type: application/json` unconditionally — if it does, the multipart call needs a bypass path; check before assuming the existing helper works unmodified.

---

### `server/src/jobs/proxy-cert-poller.ts` (modify — branch on `certSource`)

**Analog:** itself — modify in place.

**Existing pattern to preserve** (`hasCertificateFile()`, lines 164-180 shown above) for `certSource: 'acme'` rows — unchanged.

**New branch needed for `certSource: 'custom'` rows** — do NOT reuse `hasCertificateFile(row.domain)` (keys off `ProxyConfig.domain`, wrong for wildcard custom certs per RESEARCH.md Pitfall 3). Resolve via the linked `Certificate.domainPattern` instead:
```typescript
// For custom rows: skip the ACME-log-tail pending/failed classification
// entirely (fetchAcmeCompanionLogTail()/findErrorLine(), lines 182-206) —
// a custom cert is proven present+valid at upload time (D-12). Instead,
// check expiry via X509Certificate.validToDate against the file resolved
// from Certificate.domainPattern (certFileBaseName()), not row.domain.
```
Reuse the existing `repo.updateCertStatus()` + `this.broadcaster.publish({type: "proxy_cert_status", ...})` calls (lines 147-160) for reporting the expiry-warning state — same call shape, different status value/threshold logic feeding it.

---

### `client/src/components/domain/stack/cert-status-badge.tsx` (modify — add expiry state)

**Analog:** itself — modify in place (full file shown above, 47 lines).

**Pattern to copy — same `if` chain shape**, insert a new branch before the final fallback:
```typescript
if (status === "expiring") {
    return (
        <Badge variant="outline" className="text-amber-600 border-amber-300">
            Expiring soon
        </Badge>
    );
}
```
Preserve the `Readonly<Props>` signature and the `ScrollArea`/`cn()` import conventions already in the file.

## Shared Patterns

### Encrypted secret at rest
**Source:** `server/src/lib/crypto.ts` (32 lines, shown in full above)
**Apply to:** `certificate-service.ts` — `encrypt()` the uploaded private key before `certificateRepository.create()`; `decrypt()` only at the single point the plaintext is written to `volumes/certs/*.key`. Never log plaintext (matches `schema-sync.ts`'s `parseHostPort()` "never log secrets" precedent).

### Repository/Service/Route/Client-API layering
**Source:** Backup & Restore vertical slice — `server/src/repositories/backup-repository.ts`, `server/src/application/proxy-service.ts` (constructor DI shape), `server/src/routes/proxy.ts`, `client/src/lib/proxy-api.ts`
**Apply to:** the entire new `Certificate` entity (repository → service → route → client-api), per CONTEXT.md's explicit "Full-phase layering analog" pointer.

### Auth guard on routes
**Source:** `server/src/routes/proxy.ts:12` — `app.addHook("onRequest", requireAuth);`
**Apply to:** `certificates.ts` — identical single-user `requireAuth` hook, no additional RBAC (matches Security Domain V4 analysis in RESEARCH.md).

### Typed error hierarchy
**Source:** `server/src/lib/errors.ts` (`AppError`/`NotFoundError`/`ConflictError`/`BadRequestError`), used throughout `proxy-service.ts` (import line 1) and `proxy-repository.ts` (`findByIdOrThrow` throwing `NotFoundError`)
**Apply to:** `certificate-service.ts`/`certificate-repository.ts` — `BadRequestError` for D-12 validation failures, `NotFoundError` via `findByIdOrThrow`. Never throw raw `Error`.

### CI job shape (steps 1-7 of `build-and-test`)
**Source:** `.github/workflows/ci.yml` lines 17-41
**Apply to:** the new `cross-platform-unit` matrix job — reuse checkout/setup-node/corepack/install/generate/build/typecheck steps verbatim; diverge only at the test-execution steps (unit-only, no integration/Playwright/coverage-upload).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `server/prisma/migrations/0_init/migration.sql` | migration | batch | Net-new: generated by `prisma migrate diff --from-empty --to-schema server/prisma/schema --script`, not hand-written or pattern-copied — see RESEARCH.md Item 2 exact CLI commands. |
| `client/src/routes/app/settings/components/certificates-card.tsx` | component | CRUD (form + list + upload) | No existing Settings card in this codebase combines a file-upload form with a list-with-delete UI; closest precedent is the general shape of other Settings cards in `client/src/routes/app/settings.tsx` (e.g. the proxy/ACME email card) but the upload-specific interaction (drag/drop or `<input type=file>` × 3 fields, D-09) has no analog. Planner should design fresh, following shadcn `Card`/`Form` primitives and `react-hook-form` per CLAUDE.md's forms rule. |

## Metadata

**Analog search scope:** `server/src/repositories/`, `server/src/application/`, `server/src/routes/`, `server/prisma/schema/`, `shared/src/validation/`, `client/src/lib/`, `client/src/components/domain/stack/`, `server/src/lib/`, `server/src/jobs/`, `.github/workflows/`
**Files scanned (full or targeted reads):** `server/src/repositories/proxy-repository.ts`, `server/src/repositories/backup-repository.ts`, `server/src/application/proxy-service.ts`, `server/src/routes/proxy.ts`, `server/src/lib/crypto.ts`, `shared/src/validation/proxy.ts`, `client/src/components/domain/stack/cert-status-badge.tsx`, `.github/workflows/ci.yml`, `server/src/lib/schema-sync.ts`, `server/src/jobs/proxy-cert-poller.ts` (targeted), `server/prisma/schema/proxy.prisma`, `client/src/lib/proxy-api.ts`
**All analog paths confirmed git-tracked** via `git ls-files` — no gitignored/mirror paths used.
**Pattern extraction date:** 2026-09-15
