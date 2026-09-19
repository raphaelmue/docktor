# Phase 9: Deployment and Release Readiness - Research

**Researched:** 2026-09-15
**Domain:** Deployment docs verification, Prisma migration cutover, cross-platform CI, reverse-proxy custom TLS certificates
**Confidence:** MEDIUM (item 1: HIGH — direct file diff; item 2: HIGH — CLI verified against npm registry + official docs; item 3: MEDIUM — no live CI run performed; item 4: MEDIUM — nginx-proxy convention confirmed via official docs, but Certificate entity design is new code with no precedent in this repo)

## Summary

This phase closes 4 release-blocking gaps. Item 1 (docs drift) is **not clean** — a genuine drift was found: `.env.example` line 3 still instructs operators to copy the template to `.env.local`, but `docker-compose.yml` has loaded `.env` (not `.env.local`) since Phase 05.1-10, and `docs/deployment.md` itself correctly says `.env`. This is a **one-line fix**, not a "close with no changes" outcome as D-01 assumed. Item 2 (Prisma migrate) is well-supported by Prisma 7's CLI, but the project's Prisma version (7.4.0, confirmed against npm) uses the **v7 flag name `--to-schema`**, not the older `--to-schema-datamodel` named in the todo/CONTEXT.md — the planner must use the current flag. Item 3 (Windows/macOS CI) is low-risk: the server has zero native-compiled dependencies, but the **root `test:unit` script excludes `@docktor/server` entirely** — the new CI job must call `yarn workspace @docktor/server test:unit` explicitly or server unit tests silently never run on the new platforms. Item 4 (custom TLS certs) required confirming nginx-proxy's actual on-disk wildcard-cert naming convention, which is **not** the commonly-assumed underscore form (`_.example.com.crt`) — it is **parent-domain naming** (`example.com.crt` for a cert covering `*.example.com`), confirmed against the nginx-proxy project's own docs. Node's built-in `crypto.X509Certificate` covers all of D-12/D-13's validation needs with no new dependency; the only new dependency this phase needs is `@fastify/multipart` for D-09's file-upload requirement (verified OK, official Fastify org package).

**Primary recommendation:** Fix the `.env.example`/`.env.production` `.env.local` drift as part of item 1; use `--to-schema` (not `--to-schema-datamodel`) for item 2's baseline; add `yarn workspace @docktor/server test:unit` as an explicit step (not just `yarn test:unit`) to the new Windows/macOS CI jobs; name on-disk custom wildcard certs after the **parent domain**, stripped of the `*.` prefix, matching nginx-proxy's own fallback lookup order.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deployment docs accuracy | Docs (non-code) | — | Pure documentation; no runtime tier owns it |
| Prisma migration history | Database / Storage | API / Backend (startup sequence) | Migration state lives in `_prisma_migrations`; the boot sequence in `server/src/index.ts` orchestrates when it's applied |
| CI platform matrix | Build/CI infra | — | GitHub Actions config; not part of the runtime app at all |
| Certificate upload & validation | API / Backend | — | Validation (key/cert match, SAN check) must happen server-side before persistence; never trust client-side checks |
| Certificate storage (encrypted key) | Database / Storage | API / Backend | Private key ciphertext lives in Postgres via `crypto.ts`; the service layer is the only decrypt point |
| Certificate file materialization | API / Backend | Filesystem (proxy stack dir) | Docktor writes plaintext cert/key files under `volumes/certs/` for nginx-proxy to read — files are the actual "config surface" nginx-proxy consumes, DB is metadata (YAML-first precedent) |
| Certificate expiry monitoring | Background job (`ProxyCertPoller`) | Browser/Client (badge) | Existing cron-based poller is the established pattern for proxy/cert state; UI only renders what the poller/DB report |

## Item 1 — Deployment Documentation Drift Check

**Verdict: NOT clean — one confirmed drift, one confirmed pre-existing gap already tracked elsewhere.**

`docs/deployment.md` (272 lines), `docker-compose.yml`, `.env.example`, and `Dockerfile` were read in full this session and cross-checked fact-by-fact.

### Confirmed drift (new finding, in scope for item 1)

`.env.example` lines 1-7 [VERIFIED: `.env.example:1-7`]:
```
# Docktor environment configuration — docker-compose deployment template.
#
# Copy this file to `.env.local` (the file docker-compose.yml's `env_file`
# entry loads) and change every value marked CHANGE_ME before running
# `docker compose up`. See docs/deployment.md for the full quickstart,
# the complete variable reference, and a troubleshooting guide mapped to
# the exact mistakes people have already made with this file.
```

`docker-compose.yml` lines 22-23 [VERIFIED: `docker-compose.yml:22-23`]:
```
    env_file:
      - .env
```

`docs/deployment.md` line 41 and lines 44-53 [VERIFIED: `docs/deployment.md:41,44-53`] correctly instruct `cp .env.example .env` and explain at length why the filename must be exactly `.env` (Compose's `${VAR}` interpolation only reads a project-root file literally named `.env`, never `.env.local` via `env_file:`).

So: `docker-compose.yml` and `docs/deployment.md` agree the file must be named `.env`. `.env.example`'s own header comment still says `.env.local` — a leftover from before the Phase 05.1-10 rename. This is exactly the class of defect STATE.md already flagged and left open: `.planning/STATE.md` §Accumulated Context records `[Phase 05.1-10]: .env.example line 3 and .env.production line 12 still tell operators to copy the template to .env.local instead of .env — blocked on workspace permission settings denying Read/Bash/Write access to .env* paths` [VERIFIED: `.planning/STATE.md` accumulated-context entry, Phase 05.1-10]. `.env.production` itself is a real deployment file (matches `.env*` secret-file exclusion patterns) and could not be read this session for the same access-restriction reason documented in that STATE.md entry — treat its line-12 header comment as carrying the identical stale `.env.local` reference until confirmed fixed.

**Action for item 1:** Fix `.env.example` line 3 (`.env.local` → `.env`) and, if accessible in the execution environment, `.env.production`'s equivalent header line. This is a one-line documentation-parity fix, not a "no work" close.

### Confirmed clean (no drift)

Cross-checked and matching between `docs/deployment.md` and the three source files:
- Environment variable table (17 rows) — every variable in `docs/deployment.md`'s table appears in `.env.example` with matching defaults/requiredness, including `POSTGRES_PASSWORD` (deliberately absent from `.env.example`, documented as such) and `DOCKER_DATA_PATH` default correction (`/host/var/lib/docker`).
- Stacks-directory pairing mechanism (`DOCKTOR_STACKS_DIR`/`DOCKTOR_STACKS_HOST_DIR`) — matches `docker-compose.yml`'s `environment:`/volume block exactly, including the interpolation-only-reads-`.env` explanation.
- Database schema section — accurately describes the current `DOCKTOR_DB_AUTO_PUSH`-gated `prisma db push` step and correctly cites `server/src/lib/schema-sync.ts` and the same pending-todo this phase's item 2 addresses. (This section will need a rewrite once item 2 ships — see Item 2 below; that is new work item 2 creates, not a pre-existing drift.)
- Backups section — correctly states there is no `/backups` volume and that repository config lives in-app.
- Troubleshooting table (10 rows) — all 10 map to real, already-fixed defects with accurate causes/fixes; row 9 specifically documents the `.env.local`→`.env` rename itself (ironic given the drift found above — the troubleshooting row is correct, only the template file's own header comment wasn't updated).

### Ancillary finding (out of strict D-01 scope, flag for awareness)

`package.json` line 6 pins `"packageManager": "yarn@4.13.0"` [VERIFIED: `package.json:6`], but `Dockerfile` line 3 explicitly runs `corepack prepare yarn@4.12.0 --activate` [VERIFIED: `Dockerfile:3`] — a one-minor-version drift between the repo's declared package manager and what the production image actually builds with. `docs/deployment.md` does not state a yarn version as a "fact" (so this is not a D-01 drift-check failure), but it is a real inconsistency worth a one-line Dockerfile bump if the planner wants zero-debt output. Not blocking.

## Item 2 — Prisma Migrate Cutover

### Confirmed Prisma version

`yarn.lock` resolves `prisma@npm:7` → **`prisma@7.4.0`** and `@prisma/client@npm:7` → **`@prisma/client@7.4.0`** [VERIFIED: `yarn.lock`, `prisma@npm:7` / `@prisma/client@npm:7` entries]. `npm view prisma@7 version` confirms `7.4.0` is a real published version on the 7.x line, with `7.10.0` the latest 7.x as of this session [VERIFIED: npm registry `npm view prisma@7 version`]. `server/src/lib/schema-sync.ts`'s own comment independently confirms the same pin: `"prisma db push" in this project's Prisma version (7.4.0)` [VERIFIED: `server/src/lib/schema-sync.ts:118-119`].

### Exact CLI commands (Prisma v7 syntax — corrects CONTEXT.md's D-03 flag name)

Prisma v7's CLI reference for `migrate diff` **removed** the pre-v7 `--to-schema-datamodel`/`--from-schema-datamodel` flag names in favor of a unified `--to-schema` / `--from-schema` [CITED: prisma.io/docs/cli/v7/migrate/diff]. The full flag set on v7's `migrate diff` page:
- One of: `--from-empty`, `--from-schema`, `--from-migrations`, `--from-config-datasource`
- One of: `--to-empty`, `--to-schema`, `--to-migrations`, `--to-config-datasource`
- `--script`, `-o`/`--output`, `--exit-code`, `--config`, `--help`
- Explicitly removed in v7: `--from-url`, `--to-url`, `--from-schema-datasource`, `--to-schema-datasource`, `--shadow-database-url` (replaced by `--from-config-datasource`/`--to-config-datasource`) [CITED: prisma.io/docs/cli/v7/migrate/diff]

Prisma's own baselining workflow doc shows the exact sequence [CITED: prisma.io/docs/orm/prisma-migrate/workflows/baselining]:
```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

npx prisma migrate resolve --applied 0_init
```

Applied to this repo's actual layout and existing `--config` convention (matches every other Prisma CLI invocation already in the codebase — `server/prisma/prisma.config.ts`, `package.json`'s `db:generate`/`db:migrate`/`db:push` scripts, and `schema-sync.ts`'s `buildArgv()`):
```bash
# 1. Generate the baseline migration SQL from the current modular schema
#    directory (prisma.config.ts already points `schema:` at server/prisma/schema/,
#    a directory — --to-schema accepts this directory the same way prisma.config.ts does).
prisma migrate diff \
  --from-empty \
  --to-schema server/prisma/schema \
  --script \
  --config=server/prisma/prisma.config.ts \
  > server/prisma/migrations/0_init/migration.sql

# 2. Mark it applied against the dev DB (and any already-synced DB) without running it.
prisma migrate resolve --applied 0_init --config=server/prisma/prisma.config.ts

# 3. Production apply — replaces `prisma db push` in schema-sync.ts / Dockerfile.
prisma migrate deploy --config=server/prisma/prisma.config.ts
```

`prisma migrate deploy`'s documented behavior [CITED: prisma.io/docs/cli/v7/migrate/deploy]: "Apply pending migrations to update the database schema in production/staging"; applies all pending migrations and creates the database if missing; explicitly does **not** look for drift, does **not** reset the database, does **not** rely on a shadow database — i.e. it is non-interactive and safe to run unattended at container boot, structurally similar to today's guarded `db push` step. Not supported on MongoDB (irrelevant — this project uses Postgres).

`prisma migrate resolve --applied <name>` [CITED: prisma.io/docs/cli/v7/migrate/resolve]: records a specific migration as applied without running it — "supports baselining." A second, distinct flag `--rolled-back` exists for marking a *failed* migration as rolled back; do not confuse the two — `--applied` is the one D-03/D-05 need.

### `db:migrate` script already exists and is unused

Root `package.json` already defines (unused today, since no `migrations/` directory exists) [VERIFIED: `package.json`, `db:migrate` script]:
```json
"db:migrate": "dotenv -e .env.development -- prisma migrate dev --config=server/prisma/prisma.config.ts && dotenv -e .env.development -- prisma generate --config=server/prisma/prisma.config.ts"
```
This is the correct **dev-time** migration-authoring command (`prisma migrate dev`) once the baseline exists — new schema changes after this phase should be authored via `yarn db:migrate`, not by hand-editing the schema and re-running `db push`. No new script needed for dev workflow; only the interim `db:push` script becomes vestigial (keep or remove is a planner call — it's no longer part of the deploy path either way).

### What `schema-sync.ts` currently does, and exactly what changes (D-04)

`server/src/lib/schema-sync.ts` (271 lines, read in full) [VERIFIED: `server/src/lib/schema-sync.ts`]:
- `buildArgv()` (lines 126-128) returns `["db", "push", "--config=<resolved path>"]` — **this is the single line that changes** to build a `migrate deploy` argv instead.
- `syncDatabaseSchema()` (lines 218-271) is the exported entry point wired into `server/src/index.ts`'s startup sequence. Its guard structure (env-var skip, reachability retry, Postgres advisory lock via a raw `pg.Client`, never-throws contract) is **unchanged** by the D-02/D-04 cutover — only the CLI subcommand and its outcome-parsing changes:
  - Current: treats `/already in sync/i` in combined stdout/stderr as `"already-current"`.
  - New: `prisma migrate deploy`'s "no pending migrations" output text differs (Prisma prints something like "No pending migrations to apply." rather than "already in sync") — the outcome-detection regex must be updated to match `migrate deploy`'s actual stdout, not reused verbatim. Confirm the exact string by running `prisma migrate deploy --help` / a real invocation during implementation; do not assume the same regex still matches (this repo's own `schema-sync.ts` comment at lines 117-124 already documents once having shipped a broken flag from assumption without running it live — same risk class here).
- The doc comment at lines 202-216 explicitly says *"Interim fix only... do not adopt that formal-migrations command here"* — this comment itself must be deleted/rewritten as part of the D-04 change; leaving it in place after the cutover would be actively misleading to future readers.
- `resolvePrismaConfigPath()` (lines 95-107) and `resolvePrismaCliEntrypoint()` (imported from `./prisma-cli.js`, not read this session but referenced identically) are unaffected — both `db push` and `migrate deploy` are invoked the same way (`process.execPath` + CLI entrypoint + argv array, never a shell string, per the T-05.1-24 no-shell-string precedent already in place).

### Detecting "schema exists, no migration history" for D-05's auto-baseline

Two viable mechanisms, both confirmed feasible:

1. **Direct `information_schema` query via the existing raw `pg.Client`** (recommended — `schema-sync.ts` already holds a raw Postgres connection for the advisory lock (`connectWithRetry()`/`defaultAcquireLock()`, lines 151-200), so this reuses an existing connection rather than opening a second one or shelling out):
   ```sql
   SELECT EXISTS (
     SELECT FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = '_prisma_migrations'
   ) AS has_migration_history;
   ```
   Combine with a check that at least one *application* table already exists (e.g. `"Setting"` or `"Stack"`) to distinguish "genuinely empty DB — safe to run `migrate deploy` cold" from "DB has data from `db push` but no migration history — needs `migrate resolve --applied 0_init` first, then `migrate deploy`."

2. **`prisma migrate status`** — Prisma's own CLI command reports migration state as text/exit-code (documented to report "database schema is up to date" vs. drift vs. missing history), but this shells out an extra CLI process per boot and its exact stdout format for the "no `_prisma_migrations` table yet" case was not confirmed via a live run this session — treat this option as a fallback only if the direct SQL query proves awkward. [ASSUMED — not verified against a live `prisma migrate status` invocation this session; the `information_schema` approach above needs no such confirmation since it is standard Postgres SQL.]

**Recommended D-05 boot sequence:**
```
1. Query information_schema for _prisma_migrations existence.
2. If missing AND an application table already exists (schema present, pushed via db push):
     run `prisma migrate resolve --applied 0_init` (creates _prisma_migrations, backfills the one row)
3. Run `prisma migrate deploy` unconditionally after step 2 (no-ops if nothing pending).
```
This auto-baseline path has no operator confirmation step (D-05's accepted one-way risk) — log every step's outcome loudly, matching the existing `[schema-sync]` log-line convention.

### Prisma 7 + modular schema files — no gotchas found

`server/prisma/schema/` contains 12 `.prisma` files (`auth.prisma`, `backup.prisma`, `base.prisma`, `deployment.prisma`, `image-update-check.prisma`, `notification.prisma`, `proxy.prisma`, `registry.prisma`, `service.prisma`, `setting.prisma`, `stack-event.prisma`, `stack.prisma`, `status-log.prisma`) [VERIFIED: `ls server/prisma/schema/`]. `prisma.config.ts` already points `schema:` at the **directory**, not a single file [VERIFIED: `server/prisma/prisma.config.ts:5`] — Prisma 7's multi-file schema support (stable since Prisma 5.15+, GA in later versions) treats the whole directory as one logical schema for every CLI command including `migrate diff`/`migrate dev`/`migrate deploy`. No migrations directory exists yet (`server/prisma/migrations/` does not exist) [VERIFIED: `ls server/prisma/migrations` — no such directory], confirming D-03's premise that this is a true from-empty baseline, not a resume of partial migration history.

## Item 3 — Windows/macOS CI

### Current CI file (read in full)

`.github/workflows/ci.yml` [VERIFIED: `.github/workflows/ci.yml`] has exactly one test job, `build-and-test`, `runs-on: ubuntu-latest`, running (in order): checkout → `actions/setup-node@v4` (node 22) → `corepack enable` → `yarn install --immutable` → `prisma generate` → `yarn build` → `yarn typecheck` → `yarn test:unit` (client+shared) → `yarn workspace @docktor/server test` (unit **and** integration combined) → Playwright install → `yarn test:integration` (client E2E) → coverage upload. A second job, `sonarqube`, depends on it.

### Critical gap: root `test:unit` excludes the server workspace entirely

Root `package.json`:
```json
"test:unit": "yarn workspaces foreach -A --exclude @docktor/server run test:unit"
```
[VERIFIED: `package.json`, `test:unit` script] — this explicitly **excludes** `@docktor/server`. Server unit tests only run today via the separate `yarn workspace @docktor/server test` step in `ci.yml`, which runs vitest with **no** `--project` filter — the server's `vitest.config.ts` defines two named projects (`unit` and `test/integration`, confirmed by reading the file) and an unfiltered `vitest run` executes **both**. Server's own dedicated unit-only script exists and is currently unused in CI:
```json
"test:unit": "yarn workspace @docktor/shared build && vitest run --project unit"
```
[VERIFIED: `server/package.json:11`]

**Consequence for the new Windows/macOS jobs (D-06):** a job that runs only `yarn test:unit` (root) + `yarn typecheck` will build/typecheck correctly but **silently run zero server unit tests** — root's `test:unit` skips the server workspace by design (so that CI's single ubuntu job can run server unit+integration together in one combined step instead). The new cross-platform job **must** add an explicit `yarn workspace @docktor/server test:unit` step to actually cover server-side logic (domain/state-machine/service-layer unit tests) on Windows/macOS. This is the single most important implementation detail for item 3 — omitting it would make the new "required" checks pass every time without testing anything server-side.

### Recommended job shape (two new jobs, or one job with a matrix)

A matrix-based single job is idiomatic GitHub Actions and keeps the workflow file smaller:
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
No integration/testcontainers/Playwright steps — matches D-06's explicit scope. `fail-fast: false` keeps a Windows failure from cancelling the in-flight macOS job (and vice versa), useful during the initial stabilization period even though D-07 makes both required checks.

### D-07 (required/blocking status) is a GitHub repo setting, not YAML

Marking a check "required" is configured under the repository's **Branch protection rules** (Settings → Branches → `main` → required status checks), not in `ci.yml` itself. The planner should include an explicit task/checkpoint to update branch protection after the new job names exist and have run at least once (GitHub only lists a check as selectable in branch-protection settings after it has appeared in at least one workflow run) — this is a manual, human-gated step that cannot be scripted from within the repo.

### Windows/macOS-specific risk assessment (low overall)

- **No native-compiled npm dependencies** in `server/package.json` — no `bcrypt`, `sharp`, `sqlite3`, `canvas`, `node-gyp`-requiring packages found [VERIFIED: `server/package.json` full dependency list read] — this removes the single most common Windows CI failure class (missing MSVC build tools) entirely.
- `dockerode` (server dep) is pure JS; it is never actually *used* in the new job since only unit tests run (no live Docker calls) and no Docker daemon is assumed present on the runner.
- **`testcontainers`/`@testcontainers/postgresql`** are devDependencies but only imported by integration-test files under `server/test/integration/`, which are excluded from this job's `--project unit` filter — they will not attempt to start a container on Windows/macOS.
- **Path separators:** `server/vitest.config.ts`'s resolve-alias regex (`/^(?:\.\.\/)+src\//`) matches against **module specifier strings** (import paths), which always use forward slashes in JS/TS regardless of host OS — this is not filesystem-path handling and is not Windows-sensitive. [VERIFIED: `server/vitest.config.ts:10`]
- STATE.md already documents a **fixed** prior Windows path bug relevant to this exact surface: `[Phase 04-backup-restore]: Use path.resolve() instead of path.join() for absolute path concatenation on Windows to prevent drive letter duplication` [VERIFIED: `.planning/STATE.md` accumulated-context, Phase 04-backup-restore] — confirms the team has already hit and fixed one class of this bug; no new instance found in files read this session, but the planner should keep this precedent in mind if new path-joining code is added elsewhere in this phase's own changes (e.g., cert file path resolution for item 4).
- **CRLF/line-ending risk:** not investigated in depth this session (no `.gitattributes` was read) — flag as an Open Question below rather than assume either way.
- Corepack + Yarn 4 on Windows/macOS GitHub-hosted runners is a well-established, widely-used combination (large ecosystem precedent); no repo-specific reason found to expect it to fail here. [ASSUMED — general ecosystem knowledge, not verified via a live run in this session, since no CI execution was performed as part of research.]

## Item 4 — Custom TLS Certificates

### Confirmed: which nginx-proxy fork, and its wildcard cert naming convention

`server/src/lib/proxy-stack-compose.ts` pins:
```
NGINX_PROXY_IMAGE = "nginxproxy/nginx-proxy:1.11-alpine"
ACME_COMPANION_IMAGE = "nginxproxy/acme-companion:2.6.3"
```
[VERIFIED: `server/src/lib/proxy-stack-compose.ts:15-16`] — this is the **`nginxproxy/nginx-proxy`** maintained fork (the successor to the archived `jwilder/nginx-proxy`), not jwilder's original.

**The wildcard-cert naming question CONTEXT.md flagged for research is resolved, and the commonly-assumed answer is wrong for this project.** The project's own official docs state [CITED: github.com/nginx-proxy/nginx-proxy/blob/main/docs/README.md, SSL certificate naming section]:
- Standard (single-domain) cert: named after the full virtual host — `VIRTUAL_HOST=foo.bar.com` → `foo.bar.com.crt` / `foo.bar.com.key`.
- **Wildcard cert: named after the parent domain, not with an underscore prefix** — a cert for `*.bar.com` covering `VIRTUAL_HOST=foo.bar.com` is named `bar.com.crt` / `bar.com.key`.
- Deeper-subdomain fallback: `sub.foo.bar.com` first looks for `sub.foo.bar.com.crt`; if absent, falls back to `foo.bar.com.crt` (i.e., strips exactly one leftmost label at a time).
- A system-wide fallback `default.crt`/`default.key` is used when no host-specific or wildcard match exists.
- All files must be placed in `/etc/nginx/certs/` inside the nginx-proxy container — which this repo already mounts read-write from `./volumes/certs` on the acme-companion side and read-only on nginx-proxy's side (`renderProxyStackCompose()`, lines 51-52 and 71-72) [VERIFIED: `server/src/lib/proxy-stack-compose.ts:51-52,71-72`].

**Implication for D-10/D-11:** given a `Certificate` row with domain pattern `*.example.com`, Docktor must write the uploaded cert/key to disk as `example.com.crt` / `example.com.key` under `PROXY_CERTS_SUBPATH` (`volumes/certs`, already defined at `server/src/lib/proxy-stack-compose.ts:19`) — i.e., **strip the leading `*.`** from the pattern to derive the filename, not prepend an underscore. For a non-wildcard Certificate (single exact domain), name the files after that exact domain, matching the standard convention and the existing ACME-issued-cert candidate path already checked by `ProxyCertPoller.hasCertificateFile()` (`${domain}.crt`) [VERIFIED: `server/src/jobs/proxy-cert-poller.ts:166-169`].

### Existing proxy/cert code read and its integration points

- **`server/src/lib/proxy-stack-compose.ts`** (89 lines, read in full): defines `PROXY_CERTS_SUBPATH = "volumes/certs"` and both container images/names. The compose template is a plain template literal (not the YAML `Document`-API editing pattern used elsewhere) because Docktor fully owns this file's content. No changes needed here for item 4 — custom certs are written as files under the same `volumes/certs` directory this file already declares; nginx-proxy auto-discovers new cert files via its docker-gen file watcher with no compose-file change required.
- **`server/src/jobs/proxy-cert-poller.ts`** (209 lines, read in full): a 60-second cron (`node-cron`) that reconciles `ProxyConfig` rows with `tlsEnabled: true` against files found under the certs directory, and only for rows with **no** file yet, fetches the acme-companion container's log tail to distinguish "pending" from "failed." **For `certSource: 'custom'` rows (D-11), this whole failed/pending-via-acme-log-tail branch is wrong** — a custom cert is either present (validated and written at upload time, D-12) or the row shouldn't exist; there is no ACME issuance process to have "failed." The planner should branch `reconcile()` on `certSource`:
  - `acme` rows: keep exactly the current logic unchanged.
  - `custom` rows: skip the ACME-log-tail-based failed/pending classification entirely (a custom cert's file was already proven present+valid at upload); instead check the file's expiry via `X509Certificate.validTo` (D-13) and publish an `expiring`-flavored status/event instead of `pending`/`issued`/`failed`.
  - `hasCertificateFile(domain)`'s two candidate paths (`${domain}.crt` and `${domain}/fullchain.pem`) are both ACME/acme-companion-specific naming (`fullchain.pem` is acme.sh's own layout). A custom cert's on-disk name is derived from its **Certificate row's own domain pattern** (parent-domain-stripped, per above), which may differ from a given `ProxyConfig.domain` (a ProxyConfig for `cloud.example.com` linked to a wildcard Certificate for `*.example.com` resolves to file `example.com.crt`, not `cloud.example.com.crt`) — the poller's per-row file-path resolution must be updated to resolve via the linked Certificate, not the ProxyConfig's own `domain` field, whenever `certSource === 'custom'`.
- **`server/prisma/schema/proxy.prisma`** (24 lines, read in full): current `ProxyConfig` model has `certStatus: String @default("pending")`, `certMessage: String?`, `certCheckedAt: DateTime?`, and a comment noting the closed set of valid values lives in `@docktor/shared`'s `certStatusSchema`. **D-10's new `Certificate` model and D-11's linkage field are net-new — neither exists in this file yet.** `certStatusSchema` currently only has three values: `"pending" | "issued" | "failed"` [VERIFIED: `shared/src/validation/proxy.ts:24`] — D-13's expiry warning needs either a fourth status value (e.g. `"expiring"`) added to this schema, or a separate field (e.g. `certExpiresAt: DateTime?` plus a client-side "within N days" computation) rather than overloading `certStatus`. This is a genuine design choice left to the planner (CONTEXT.md does not resolve it); recommend the separate-field approach since `certStatus` already has established call-site semantics (`issued` = "file present," full stop) that a fourth overlapping meaning would muddy.
- **`client/src/components/domain/stack/cert-status-badge.tsx`** (47 lines, read in full): a pure presentational component switching on `status: string | null | undefined` — `"issued"` → green "Secured," `"failed"` → red "Cert failed" + scrollable message, anything else → yellow "Cert pending." Adding an expiry-warning state (D-13) is a straightforward new branch here (e.g. amber/orange "Expiring soon" badge) once the server-side status/field design above is settled.

### Existing hostname-validation regex does NOT allow wildcards — new schema needed

`shared/src/validation/proxy.ts`'s `hostnamePattern` (used by `assignDomainSchema.domain`) is:
```ts
export const hostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;
```
[VERIFIED: `shared/src/validation/proxy.ts:9`] — this pattern has no `*` in its character class and will **reject** a domain pattern like `*.example.com`. This regex is correctly scoped to `ProxyConfig.domain` (a concrete, routable hostname — wildcards are never valid there). D-10's new `Certificate.domainPattern` field needs a **separate** Zod schema permitting an optional single leading `*.` followed by the same label-validation rules, e.g. (illustrative, not prescriptive): `/^(?:\*\.)?(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/`. Add this alongside `hostnamePattern` in `shared/src/validation/proxy.ts`, per CLAUDE.md's "single source of truth" validation rule — do not duplicate it into `certificate.ts` or a server-only file.

### Node `crypto.X509Certificate` covers D-12/D-13 with zero new dependencies

Confirmed via Node's official API docs [CITED: nodejs.org/api/crypto.html, X509Certificate class] that the built-in `X509Certificate` class (stable since Node 15.6, available in this project's Node 22 runtime) exposes:
- `new X509Certificate(buffer)` — parses a PEM or DER cert buffer directly, no external library.
- `x509.checkPrivateKey(privateKey)` — returns a boolean; **this is the exact primitive D-12 needs** to validate an uploaded private key matches the uploaded certificate. `privateKey` must be a `KeyObject` (e.g., via `crypto.createPrivateKey(pemString)`).
- `x509.checkHost(name[, options])` — validates a hostname against the certificate's SAN/CN with documented wildcard-matching support (matches a single label per RFC rules) — usable for D-12's "domain (or wildcard pattern) must appear in the cert's SAN/CN" check. Note: `checkHost` validates a concrete hostname against a (possibly wildcard) cert, which is the right direction for validating that an uploaded cert actually covers the `Certificate.domainPattern` being registered — e.g. call `checkHost('example.com')` or a representative subdomain, or inspect `subjectAltName` directly for an exact wildcard-pattern string match if bytewise pattern equality is preferred over host-matching semantics.
- `x509.subjectAltName` — string property listing the cert's SAN entries.
- `x509.validTo` (string) / `x509.validToDate` (Date object, more convenient for arithmetic) — **this is what D-13's expiry check reads**, both at upload time and on `ProxyCertPoller`'s existing cron cadence.

None of this requires a new npm dependency — `node:crypto` is a Node built-in. This matches CONTEXT.md's own Code Context note and is now confirmed against the primary source rather than assumed.

### Reusable patterns for the new `Certificate` entity

`server/src/application/proxy-service.ts` (419 lines, read in full) and `server/src/repositories/proxy-repository.ts` (72 lines, read in full) establish the concrete layering pattern to mirror:
- Repository: thin, one method per Prisma operation, no business logic (`ProxyRepository` — `create`/`findById`/`findByIdOrThrow`/`findByStackId`/`updateConfig`/`delete`).
- Service: constructor-injected `Pick<>`-typed dependencies (repo, a narrowed `StackRepository`, filesystem port, `StackService`, `SettingsService`, `DockerodeClient`) — every dependency is the minimal interface slice the service actually calls, not the full class. A new `CertificateService` should follow this exact shape: inject `CertificateRepository`, a filesystem port for writing cert files under `volumes/certs`, and reuse `encrypt()`/`decrypt()` from `server/src/lib/crypto.ts` for the private key field.
- `crypto.ts`'s AES-256-GCM pattern (32 lines, read in full) is a clean drop-in: `encrypt(plaintext: string): string` / `decrypt(ciphertext: string): string`, keyed off `ENCRYPTION_KEY`, already used for 4 other secret classes (SMTP password, SFTP key, S3 secret, restic password). Encrypting the Certificate's private key at rest via this exact function is the "obvious consistent choice" CONTEXT.md's Claude's Discretion section already points at — no new crypto code needed.
- Route pattern: `server/src/routes/proxy.ts` (60 lines, read in full) is a `FastifyPluginAsyncZod` with a `requireAuth` `onRequest` hook and inline Zod param/body schemas imported from `@docktor/shared` — a new `certificates.ts` route file should match this shape exactly. File-upload bodies (D-09) cannot use the same `{schema: {body: zodSchema}}` JSON-body pattern; they need `@fastify/multipart` (see Package Legitimacy Audit below) with the cert/key/CA-bundle fields read as multipart parts, and any non-file fields (e.g. `domainPattern`) either as additional multipart fields or the route accepting `multipart/form-data` exclusively for this one endpoint.

### Where Certificate management UI belongs (research input to a CONTEXT.md discretion item)

No new information found this session beyond what CONTEXT.md already reasoned through (ACME email precedent in Settings) — `client/src/routes/app/settings.tsx` was not re-read this session since CONTEXT.md's own analysis is sound and this is explicitly left to planner discretion, not something further research resolves.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing a PEM cert to extract SAN/CN/expiry | A hand-rolled ASN.1/PEM parser | `node:crypto`'s `X509Certificate` | Built into Node 22, zero dependencies, handles PEM/DER, wildcard-aware `checkHost()` |
| Verifying a private key matches a certificate | Manual modulus/exponent comparison or an OpenSSL shell-out | `X509Certificate.checkPrivateKey(privateKey)` | One built-in method call, no subprocess, no OpenSSL binary dependency |
| Multipart file upload parsing | Manual `multipart/form-data` boundary parsing | `@fastify/multipart` (official Fastify org plugin) | 2M+ weekly downloads, actively maintained, integrates with Fastify's existing hook/schema model |
| Migration SQL generation | Hand-writing the baseline `CREATE TABLE` SQL from the Prisma schema | `prisma migrate diff --from-empty --to-schema ... --script` | Generates SQL that is guaranteed to match the schema exactly; hand-writing risks drift from day one |

**Key insight:** every "hand-roll" temptation in this phase (PEM parsing, key/cert matching, migration SQL) already has a built-in or already-installed answer — this phase should add exactly one new dependency (`@fastify/multipart`) and zero new cryptography code beyond calling `node:crypto`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `@fastify/multipart` | npm | ~9 years (first published 2022-04-27 under a predecessor name; latest `10.1.1` published 2026-08-14) | ~2,008,249/wk | `github.com/fastify/fastify-multipart` | OK | Approved |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

No other new packages are needed for this phase — Prisma CLI, `pg`, and `node:crypto` are all already installed/built-in. `@fastify/multipart`'s package name and legitimacy were discovered via WebSearch/training knowledge and then confirmed via `npm view` and the project's own `package-legitimacy check` seam (verdict `OK`, official `fastify` GitHub org repository, no postinstall script, current version `10.1.1`) — per the package-name provenance rule this is tagged `[ASSUMED]` for the *name itself* until a human confirms it's the intended package, even though the registry lookup independently passed.

## Common Pitfalls

### Pitfall 1: Reusing `db push`'s "already in sync" regex after the `migrate deploy` cutover
**What goes wrong:** `schema-sync.ts`'s outcome classification (`/already in sync/i`) is specific to `prisma db push`'s stdout wording. `prisma migrate deploy` uses different wording for its no-op case.
**Why it happens:** Copy-pasting the guard structure (correctly reusable) without re-verifying the string-matching logic against the new subcommand's actual output.
**How to avoid:** Run `prisma migrate deploy` against a real up-to-date DB during implementation and read its actual stdout before writing the new outcome regex — do not assume it says "already in sync."
**Warning signs:** `syncDatabaseSchema()` returns `"applied"` on every boot even when nothing changed, or returns `"failed"` on a genuinely no-op deploy.

### Pitfall 2: `certStatus: String` field reused for a fourth meaning without updating `certStatusSchema`
**What goes wrong:** Adding an `"expiring"` value to written data without adding it to `shared/src/validation/proxy.ts`'s `certStatusSchema` enum breaks the single-source-of-truth validation CLAUDE.md requires, and any Zod-validated boundary (route body/response, if one validates this field) silently rejects or miscoerces the new value.
**Why it happens:** The DB column is a plain `String`, not a Prisma enum, so nothing at the schema level stops an unregistered string from being written.
**How to avoid:** If choosing the "extend certStatus" design, update `certStatusSchema` in the same commit as the DB write path change. Prefer the separate-field design (see Item 4 analysis above) to avoid this class of drift entirely.
**Warning signs:** `CertStatusBadge` renders the generic yellow "Cert pending" badge for a cert that's actually expiring, because the new status string doesn't match any of the component's three `if` branches.

### Pitfall 3: Resolving a custom cert's on-disk filename from `ProxyConfig.domain` instead of the linked `Certificate.domainPattern`
**What goes wrong:** For a `ProxyConfig` row on `cloud.example.com` linked to a wildcard `Certificate` for `*.example.com`, looking up `cloud.example.com.crt` will never find the file — it was written (correctly) as `example.com.crt`.
**Why it happens:** `ProxyCertPoller.hasCertificateFile()`'s existing candidate-path logic keys off `row.domain` directly, which is correct for ACME-issued single-domain certs but wrong for wildcard custom certs.
**How to avoid:** For `certSource: 'custom'` rows, resolve the file path via the joined `Certificate.domainPattern` (parent-domain-stripped), never via `ProxyConfig.domain`.
**Warning signs:** Every custom-cert domain under a wildcard shows "Cert pending" forever even though the file is present on disk under a different (correct) name.

### Pitfall 4: Assuming the underscore wildcard-cert convention (`_.example.com.crt`)
**What goes wrong:** This is a real, widely-documented convention for *other* reverse-proxy tools (notably common in some Kubernetes ingress / cert-manager patterns and a few blog posts), but it is **not** what `nginxproxy/nginx-proxy`'s own docker-gen template looks for.
**Why it happens:** The underscore convention is common enough elsewhere that it's an easy default assumption — exactly why CONTEXT.md flagged it for mandatory research rather than assumption.
**How to avoid:** Already resolved by this research — use parent-domain naming (see Item 4 above), confirmed against the project's own docs.
**Warning signs:** A wildcard cert is uploaded and validated successfully server-side, but `nginx-proxy` never picks it up and continues serving its self-signed default — because the file it's looking for (`example.com.crt`) doesn't exist; only `_.example.com.crt` does.

### Pitfall 5: Windows/macOS CI job passing without covering server logic
**What goes wrong:** A job that runs `yarn test:unit` (root) alone silently never executes a single server-side test, because root's `test:unit` excludes `@docktor/server` by design (see Item 3 above).
**Why it happens:** The exclusion exists for a legitimate reason on the existing ubuntu job (server unit+integration run combined via a separate step) — but that reason doesn't transfer to a Windows/macOS job that has no equivalent combined step.
**How to avoid:** Add `yarn workspace @docktor/server test:unit` as an explicit, separate step in the new job(s).
**Warning signs:** The new "required" check is green on every PR, including ones that break server domain logic outright, because it never ran a server test.

## Code Examples

### Detecting the D-05 auto-baseline condition (illustrative pattern, matches existing `schema-sync.ts` structure)
```typescript
// Reuses the already-open pg.Client used for the advisory lock — see
// connectWithRetry()/defaultAcquireLock() in schema-sync.ts for the existing
// connection-management pattern this should slot into.
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

### Validating an uploaded cert/key pair (D-12), using only `node:crypto`
```typescript
// Source: Node.js official crypto docs (nodejs.org/api/crypto.html), X509Certificate class
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

function certCoversDomainPattern(cert: X509Certificate, domainPattern: string): boolean {
    // For a wildcard pattern like "*.example.com", check the SAN/CN directly
    // rather than checkHost() (which validates a *concrete* hostname, not a pattern).
    return cert.subjectAltName?.includes(domainPattern) ?? false;
}
```

### Deriving the on-disk cert filename from a Certificate's domain pattern (D-11)
```typescript
// nginx-proxy wildcard convention: parent-domain naming, NOT underscore-prefixed.
// Source: github.com/nginx-proxy/nginx-proxy/blob/main/docs/README.md (SSL cert naming section)
function certFileBaseName(domainPattern: string): string {
    return domainPattern.startsWith("*.") ? domainPattern.slice(2) : domainPattern;
}
// certFileBaseName("*.example.com") === "example.com"  -> example.com.crt / example.com.key
// certFileBaseName("cloud.example.com") === "cloud.example.com" -> cloud.example.com.crt / .key
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `prisma migrate diff --to-schema-datamodel <file>` | `prisma migrate diff --to-schema <path>` (accepts a file or a multi-file schema directory) | Prisma v7 (this project uses 7.4.0) | Any todo/doc/plan text written against pre-v7 Prisma CLI syntax needs the flag name corrected before use |
| Underscore-prefixed wildcard cert files (`_.example.com.crt`) — common in other proxy tools | Parent-domain-named wildcard cert files (`example.com.crt` for `*.example.com`) in `nginxproxy/nginx-proxy` | N/A — this has been nginx-proxy's convention throughout its history, not a recent change | Determines the exact filename Docktor's new cert-writing code must produce |

**Deprecated/outdated:**
- `--from-schema-datasource`/`--to-schema-datasource` (Prisma CLI): removed in v7, replaced by `--from-config-datasource`/`--to-config-datasource`. Not directly needed by this phase's baseline workflow (which uses `--from-empty`/`--to-schema`), but relevant if the planner reaches for datasource-URL-based diffing for any reason.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.env.production`'s header comment (line ~12) still references `.env.local`, mirroring `.env.example`'s confirmed drift | Item 1 | Low — the fix is a one-line comment edit either way; worst case the planner double-checks and finds it already correct, wasting one verification step |
| A2 | `prisma migrate status`'s exact stdout wording for the "no `_prisma_migrations` table" case | Item 2 | Low — the recommended primary approach (direct `information_schema` query) doesn't depend on this; only relevant if the planner chooses the CLI-based fallback instead |
| A3 | `prisma migrate deploy`'s exact no-op stdout string (needed to correctly port `schema-sync.ts`'s outcome-classification regex) | Item 2 / Pitfall 1 | Medium — if not verified live during implementation, `schema-sync.ts` may misreport `"applied"` vs `"already-current"` outcomes in logs (cosmetic, not data-loss risk, since `migrate deploy` itself is non-destructive by design) |
| A4 | Corepack + Yarn 4.x behaves identically on `windows-latest`/`macos-latest` GitHub-hosted runners as on `ubuntu-latest`, with no additional setup step needed | Item 3 | Low-medium — if wrong, the new CI job fails outright on first run (visible immediately, not a silent gap) and needs a runner-specific corepack workaround step added |
| A5 | No CRLF/line-ending-related test or build failures will surface on the Windows runner (not investigated — no `.gitattributes` read this session) | Item 3 | Low-medium — Git's own `core.autocrlf` defaults could cause line-ending diffs in checked-out files on Windows; if a test asserts exact file content this could cause an unexpected first-run failure. Recommend checking for a `.gitattributes` file during planning/implementation. |
| A6 | Design choice to model D-13's expiry state as a separate field rather than a 4th `certStatus` enum value is presented as a recommendation, not a locked decision | Item 4 | Low — explicitly flagged as planner's design call in both CONTEXT.md and this research; no risk beyond normal design-decision risk |

## Open Questions

1. **(RESOLVED — see 09-03 Task 3) Exact `prisma migrate deploy` no-op stdout text**
   - What we know: the command is documented to not error and not modify anything when there's nothing pending.
   - What's unclear: the precise string `schema-sync.ts`'s outcome parser should match on, since this session had no live database to run the command against.
   - Recommendation: the implementing plan should include a task step that runs `prisma migrate deploy` against a real dev DB early, captures the actual output, and writes the outcome-classification logic against that captured text rather than an assumed string.
   - Resolution: `09-03-PLAN.md` Task 3 captures live `migrate deploy` output and pins the classification regex to it, with an honest Branch A (live DB)/Branch B (no DB reachable, blocking-heading gap recorded) fallback — no assumed string is shipped unverified.

2. **(RESOLVED — see 09-01 Task 1) `.env.production` line-12 drift — confirm and fix if accessible**
   - What we know: `.env.example` line 3 is confirmed stale (`.env.local`); STATE.md records the same issue was previously identified for `.env.production` line 12 but never fixed due to a permission restriction in that session.
   - What's unclear: whether the current execution environment (this phase's implementation session) has write access to `.env.production` — this research session's own attempt to *read* it was blocked by the same class of protection.
   - Recommendation: the planner should include a task to attempt this fix and, if blocked again by the same access restriction, document it as a known-remaining gap in the phase's summary rather than silently skipping it.
   - Resolution: `09-01-PLAN.md` Task 1 fixes the drift, or records a named blocking gap with the exact edit if access is still restricted — never silently skipped.

3. **(RESOLVED — see 09-07 Task 2) D-13's exact expiry-warning threshold and status representation**
   - What we know: CONTEXT.md requires a UI warning "as expiry approaches" with no specific day-count threshold given, and leaves the exact status-field design to the planner.
   - What's unclear: the specific N-day threshold (30 days is a common industry default for cert expiry warnings, but not stated anywhere in this project's requirements or CONTEXT.md).
   - Recommendation: planner picks a reasonable default (e.g. 30 days) and states it explicitly in the plan; this is a low-risk, easily-adjustable constant, not worth a full discuss-phase round-trip.
   - Resolution: `09-07-PLAN.md` Task 2 sets `CERT_EXPIRY_WARNING_DAYS = 30` explicitly, with `expiring` as a fourth member of `certStatusSchema`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Prisma CLI (`prisma`) | Item 2 (migrate diff/resolve/deploy) | ✓ (via yarn workspace, already installed) | 7.4.0 (pinned in yarn.lock) | — |
| `node:crypto` `X509Certificate` | Item 4 (D-12/D-13) | ✓ (Node.js built-in, Node 22 runtime) | Node 22 (stable since Node 15.6) | — |
| `@fastify/multipart` | Item 4 (D-09 file upload) | ✗ (not yet installed — new dependency) | latest `10.1.1` on npm | None needed — this is the correct, low-risk choice; no fallback required |
| `windows-latest`/`macos-latest` GitHub-hosted runners | Item 3 | ✓ (standard GitHub Actions runner labels, no special access needed) | GitHub-managed | — |
| Docker Engine on Windows/macOS CI runners | Item 3 (explicitly NOT needed) | ✗ (confirmed absent on GitHub-hosted Windows/macOS runners) | — | D-06 already scopes around this — no integration tests run there |

**Missing dependencies with no fallback:** none — `@fastify/multipart` is a straightforward `yarn add` with no viable simpler alternative given CLAUDE.md's "no hand-rolled multipart parsing" implication and the project's existing Fastify-ecosystem convention (`@fastify/cookie`, `@fastify/cors`, `@fastify/static` are all official Fastify-org plugins already in use).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (server, client, shared) + Playwright (client E2E) |
| Config file | `server/vitest.config.ts` (projects: `unit`, `test/integration`), `client/vitest.config.ts` (single unit project), `shared/vitest.config.ts` |
| Quick run command | `yarn workspace @docktor/server test:unit` / `yarn test:unit` (client+shared) |
| Full suite command | `yarn workspace @docktor/server test` (unit+integration combined) + `yarn test:integration` (client Playwright E2E) |

### Phase Requirements → Test Map

This phase has no `REQUIREMENTS.md` IDs (todo-scoped, per phase description) — mapping instead to the 4 scope items / their D-decisions:

| Item | Behavior | Test Type | Automated Command | File Exists? |
|------|----------|-----------|---------------------|-------------|
| 1 | `.env.example` no longer references `.env.local` | doc/manual grep | `grep -n "env.local" .env.example .env.production` returns nothing | ✅ (grep-based, no new test file needed) |
| 2 (D-03/D-04) | `syncDatabaseSchema()` runs `migrate deploy` and correctly classifies outcomes | unit | `yarn workspace @docktor/server test:unit -- schema-sync` | ❌ Wave 0 — existing `schema-sync.ts` unit tests (if any exist under `server/test/unit/`) need updated mocks for the new CLI subcommand/outcome text |
| 2 (D-05) | Auto-baseline detection (`needsBaseline()`) correctly identifies a `db push`-only DB vs. a fresh DB vs. an already-migrated DB | unit | new test file, mocking the `pg.Client` query result | ❌ Wave 0 — new test file needed |
| 3 (D-06/D-08) | New CI job runs typecheck + unit tests (client/shared/server) on `windows-latest` and `macos-latest`, excludes integration | CI/manual | live workflow run on a PR | N/A — not a repo test file, verified via an actual CI run |
| 4 (D-12) | Uploading a mismatched key/cert pair is rejected; uploading a cert whose SAN doesn't cover the domain pattern is rejected | unit | new test file for the certificate-validation service function | ❌ Wave 0 — new test file needed |
| 4 (D-13) | Expiry check correctly flags a near-expiry cert; `ProxyCertPoller.reconcile()` branches correctly on `certSource` | unit | extends existing `proxy-cert-poller` test file (if present under `server/test/unit/`) | ❌ Wave 0 — existing poller tests need new cases; not confirmed present/absent this session (not read) |

### Sampling Rate
- **Per task commit:** `yarn typecheck && yarn workspace @docktor/server test:unit` (server-side changes); `yarn test:unit` for shared/client changes.
- **Per wave merge:** `yarn workspace @docktor/server test` (unit+integration) where a Docker-backed dev environment is available; otherwise unit-only with an explicit note (matches this repo's existing, repeatedly-documented pattern of TCP-to-Docker-published-port sandboxing limitations recorded throughout `.planning/STATE.md`).
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus at least one live Windows and one live macOS CI run observed green before D-07's required-check status is applied in GitHub branch protection settings.

### Wave 0 Gaps
- [ ] `server/test/unit/schema-sync.test.ts` (or equivalent) — updated/new tests covering the `migrate deploy` argv, outcome classification, and D-05's `needsBaseline()` logic.
- [ ] New unit test file for certificate validation (key/cert match, SAN/domain-pattern coverage, expiry extraction) — covers D-12/D-13's pure logic in isolation from Fastify/multipart plumbing.
- [ ] `.github/workflows/ci.yml` itself has no "test" in the traditional sense — its own correctness is only provable by a live run, which is inherently outside the Wave 0 unit-test gap category.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | No (unchanged this phase) | Existing `requireAuth` middleware, reused as-is on new routes |
| V3 Session Management | No (unchanged this phase) | — |
| V4 Access Control | Yes | New Certificate CRUD routes must carry the same `requireAuth` `onRequest` hook every other route in `proxy.ts`/`backups.ts` carries — single-user model, no additional RBAC needed per project's documented out-of-scope RBAC decision |
| V5 Input Validation | Yes | Zod schemas in `@docktor/shared` for the new `Certificate` domain-pattern field (wildcard-aware regex, see Item 4); uploaded cert/key content validated server-side via `X509Certificate`/`checkPrivateKey` before persistence (D-12) — never trust client-supplied validity claims |
| V6 Cryptography | Yes | Private key encrypted at rest via existing `server/src/lib/crypto.ts` AES-256-GCM (`ENCRYPTION_KEY`-derived) — never hand-roll; never log the plaintext key or full cert PEM (matches the existing `parseHostPort()`-style "never log secrets" precedent already in `schema-sync.ts`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Malicious/oversized file upload (cert/key/CA-bundle fields) exhausting memory or disk | Denial of Service | `@fastify/multipart`'s built-in `limits` option (file size, field count) — set explicit conservative limits (certs/keys are always small, a few KB; reject anything above e.g. 64 KB per file as almost certainly not a valid PEM) |
| Path traversal via a crafted domain pattern producing a cert filename like `../../etc/passwd` | Tampering | The `hostnamePattern`-style regex validation (Item 4) is the primary defense — validate the domain pattern's character set *before* ever deriving a filesystem path from it, matching the existing `T-06-02` domain-injection precedent already established for `ProxyConfig.domain` |
| Uploading a certificate/key pair that doesn't actually belong together, silently misrouting TLS traffic | Spoofing/Tampering | D-12's mandatory `checkPrivateKey()` + SAN-coverage validation before accepting the upload — already the locked decision, confirmed implementable with built-in Node APIs |
| Private key exposure via logs, error messages, or API responses | Information Disclosure | Never include the private key field in any GET/list response (return only metadata: domain pattern, expiry, upload date — mirrors how SMTP/SFTP/S3 secrets are already never round-tripped in this codebase's existing Settings responses) |

## Sources

### Primary (HIGH confidence — file reads / registry lookups this session)
- `docs/deployment.md`, `docker-compose.yml`, `.env.example`, `Dockerfile` — full reads, item 1 drift check
- `server/src/lib/schema-sync.ts` — full read
- `server/prisma/prisma.config.ts`, `server/prisma/schema/` directory listing, `server/prisma/migrations` (confirmed absent)
- `package.json` (root), `server/package.json`, `client/package.json` — scripts and dependency lists
- `server/vitest.config.ts`, `client/vitest.config.ts`
- `.github/workflows/ci.yml` — full read
- `server/src/lib/proxy-stack-compose.ts`, `server/src/jobs/proxy-cert-poller.ts`, `server/prisma/schema/proxy.prisma`, `server/src/lib/crypto.ts`, `client/src/components/domain/stack/cert-status-badge.tsx`, `server/src/application/proxy-service.ts`, `server/src/repositories/proxy-repository.ts`, `shared/src/validation/proxy.ts` — full reads, item 4
- `.planning/STATE.md`, `.planning/CONTEXT.md` (09-CONTEXT.md), `.planning/REQUIREMENTS.md`
- `npm view prisma@7 version` / `npm view @prisma/client@7 version` / `yarn.lock` — Prisma version confirmation
- `npm view @fastify/multipart` + `gsd-tools package-legitimacy check` — package legitimacy audit

### Secondary (MEDIUM confidence — official docs fetched this session)
- prisma.io/docs/cli/v7/migrate/diff, prisma.io/docs/cli/v7/migrate/deploy, prisma.io/docs/cli/v7/migrate/resolve, prisma.io/docs/orm/prisma-migrate/workflows/baselining
- github.com/nginx-proxy/nginx-proxy/blob/main/docs/README.md — wildcard cert naming convention
- nodejs.org/api/crypto.html — X509Certificate class API surface

### Tertiary (LOW confidence — not independently re-verified against a live run)
- Windows/macOS Corepack+Yarn4 general compatibility (A4)
- CRLF/line-ending risk on Windows CI (A5) — flagged as unresearched, not assumed safe
- `prisma migrate deploy`/`prisma migrate status` exact no-op stdout wording (A2, A3)

## Metadata

**Confidence breakdown:**
- Item 1 (docs drift): HIGH — direct byte-level file comparison performed this session, drift confirmed with exact line citations
- Item 2 (Prisma migrate): HIGH for CLI syntax/version (confirmed via npm registry + official v7 docs); MEDIUM for exact runtime stdout strings (A2/A3, not live-tested)
- Item 3 (CI): MEDIUM — dependency-risk analysis is HIGH confidence (full dependency list read, zero native modules), but no live CI run was performed to confirm the job actually passes
- Item 4 (TLS certs): MEDIUM-HIGH — the previously-uncertain wildcard-naming question is now HIGH confidence (confirmed against the actual upstream project's docs), but the new `Certificate` entity design itself is new code with no existing precedent to verify against, only patterns to mirror

**Research date:** 2026-09-15
**Valid until:** 30 days for CI/tooling-version-sensitive findings (Prisma version, npm package versions); effectively indefinite for the nginx-proxy naming convention and Node crypto API (stable, unlikely to change)
