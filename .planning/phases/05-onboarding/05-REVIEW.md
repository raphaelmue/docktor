---
phase: 05-onboarding
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - client/src/components/ui/checkbox.tsx
  - client/src/lib/setup-api.ts
  - client/src/main.tsx
  - client/src/routes/setup/components/account-step.tsx
  - client/src/routes/setup/components/backup-step.tsx
  - client/src/routes/setup/components/brownfield-step.tsx
  - client/src/routes/setup/components/compatibility-badge.tsx
  - client/src/routes/setup/components/diff-viewer.tsx
  - client/src/routes/setup/components/migration-wizard.tsx
  - client/src/routes/setup/components/notifications-step.tsx
  - client/src/routes/setup/components/settings-step.tsx
  - client/src/routes/setup/components/wizard-stepper.tsx
  - client/src/routes/setup.tsx
  - client/test/integration/setup-wizard.spec.ts
  - server/package.json
  - server/src/application/migration-service.ts
  - server/src/application/onboarding-service.ts
  - server/src/app.ts
  - server/src/infrastructure/brownfield-scanner.ts
  - server/src/infrastructure/compose-analyzer.ts
  - server/src/infrastructure/compose-rewriter.ts
  - server/src/infrastructure/volume-migrator.ts
  - server/src/routes/setup.ts
  - server/test/unit/application/onboarding-service.test.ts
  - server/test/unit/brownfield-scanner.test.ts
  - server/test/unit/compose-analyzer.test.ts
  - server/test/unit/infrastructure/brownfield-scanner.test.ts
  - server/test/unit/infrastructure/compose-analyzer.test.ts
  - shared/src/validation/index.ts
  - shared/src/validation/wizard.ts
findings:
  critical: 5
  warning: 10
  info: 3
  total: 18
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-08-31T00:00:00Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

This phase implements the first-run onboarding wizard (admin account, instance settings, backup/SMTP config, and brownfield stack discovery/adoption/migration). The client-side wizard is generally clean, but the server-side setup routes have a severe broken-access-control gap: only step 1 checks whether setup is already complete — every other `/api/setup/*` endpoint (instance settings, backup credentials, SMTP credentials, filesystem scan, stack adoption, and full compose-file migration) is reachable by an unauthenticated caller forever, because the app-wide "first-run gate" hook explicitly exempts the entire `/api/setup` prefix regardless of whether users already exist. Combined with attacker-controlled path strings flowing unchecked into filesystem copy/mkdir operations in the migration service, this adds up to unauthenticated arbitrary file read/write on the host and unauthenticated `docker compose up` invocation on attacker-chosen directories — the most severe class of finding this review can produce. There is also a functional correctness bug in the compose rewriter (long-form bind mounts are silently left un-rewritten after being migrated), a data-retention/exposure issue (migration backups of potentially sensitive stack data are left permanently in the shared OS temp directory), and a completely skipped Playwright test suite for the entire feature (20/20 tests are `test.skip()`), meaning none of the described UAT-level integration behavior is actually verified by CI.

## Critical Issues

### CR-01: `/api/setup/*` endpoints beyond step 1 are reachable without authentication, forever

**File:** `server/src/routes/setup.ts:43-171`, `server/src/app.ts:55-75`

**Issue:** `app.ts`'s first-run gate hook unconditionally exempts every request whose URL starts with `/api/setup`, independent of whether `userCount > 0`:

```ts
if (
    request.url.startsWith("/api/setup") ||
    request.url.startsWith("/api/auth/") ||
    request.url === "/setup" ||
    !request.url.startsWith("/api/")
) {
    return;
}
```

Inside `routes/setup.ts`, only the `POST /api/setup/step1` handler re-checks `prisma.user.count()` before proceeding. Every other handler — `step2` (instance settings), `step3` (backup repo type/path/host/user/**S3 access & secret key**/**restic password**), `step4` (SMTP host/user/**password**), `scan` (arbitrary filesystem enumeration), `adopt` (arbitrary compose-file read + stack creation), `migrate/preview`, and `migrate` (full filesystem copy + `docker compose up`) — has zero authentication and zero "is setup already complete" check. Compare with `server/src/routes/settings.ts:3,50`, which registers `app.addHook("onRequest", requireAuth)` — the very pattern that is missing here.

Concretely, after a Docktor instance has been fully set up, any unauthenticated network client can, at any time:
- Overwrite backup repository credentials (`backupS3AccessKey`, `backupS3SecretKey`, `backupPassword`) to redirect/backdoor future backups.
- Overwrite SMTP credentials to hijack outbound notification email.
- Call `/api/setup/scan` to enumerate every `docker-compose.yml`/`compose.yaml` on the host filesystem (see CR-02 for the more severe `/api/setup/migrate` chain).

**Fix:** Add a stateful guard (mirroring the one in `app.ts`) inside `setup.ts` itself — e.g. a shared `preHandler` that re-checks `prisma.user.count() > 0` and returns 410/403 for every route except `GET /status` and `POST /step1` — and stop exempting the whole `/api/setup` prefix in the global hook once setup is complete:

```ts
const setupRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("preHandler", async (request, reply) => {
        if (request.method === "GET" && request.url === "/api/setup/status") return;
        if (request.url === "/api/setup/step1") return;
        const userCount = await prisma.user.count();
        if (userCount > 0) {
            return reply.status(410).send({error: "Setup already complete"});
        }
    });
    ...
```

---

### CR-02: Unauthenticated arbitrary file/directory write (path traversal) via migration volume selections

**File:** `server/src/application/migration-service.ts:88-112`

**Issue:** `MigrationInput.volumeSelections` (`{originalPath, newPath, convert}`) and `namedVolumeSelections` (`Record<string, boolean>`) come directly from the request body (validated only as `z.string()` / `z.record(z.string(), z.boolean())` — no path constraints) and are used to build filesystem destinations with no sanitization:

```ts
// Step 4: named volumes
const destPath = path.join(volumesDir, volName);              // volName is an attacker-controlled key
await this.migrator.copyVolumeToBindMount(volName, destPath); // volName is ALSO the `-v` source for `docker run`

// Step 5: bind mounts
const srcPath = path.isAbsolute(sel.originalPath) ? sel.originalPath : path.join(originalDir, sel.originalPath);
const destPath = path.join(newStackPath, sel.newPath);        // sel.newPath is fully attacker-controlled
await this.migrator.copyDirectory(srcPath, destPath);         // fs.cp(srcPath, destPath, {recursive: true})
```

`path.join` normalizes `..` segments, so a `newPath` of `"../../../../etc/cron.d/evil"` (or a `volName` containing `/`) escapes the intended `volumesDir`/`newStackPath` sandbox entirely. `fs.cp`/`fs.mkdir({recursive: true})` will then create/overwrite files at that resolved path with data from `srcPath` (also attacker-controlled — can be any absolute path the process can read, per `path.isAbsolute(sel.originalPath) ? sel.originalPath : ...`). Because `volName` is also passed verbatim as the Docker `-v` source (`volume-migrator.ts:17`, `` `${volumeName}:/source:ro` ``), a `volName` containing `/` is interpreted by Docker as a **host bind path** rather than a named volume, letting an attacker read arbitrary host paths (e.g. `/etc`, `/root/.ssh`) into the traversed `destPath`.

Combined with CR-01 (no auth required to reach `/api/setup/migrate`), this is unauthenticated arbitrary file read/write on the host, and — since `migrate()` subsequently runs `docker compose up` (`migration-service.ts:161`) against the resulting directory — a path to full container/RCE compromise.

**Fix:** Reject any `originalPath`/`newPath`/volume-name value that is absolute or contains `..` segments once resolved, and confine all resolved destinations to be strict descendants of `newStackPath`/`volumesDir`:

```ts
function assertWithin(base: string, target: string): string {
    const resolved = path.resolve(base, target);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        throw new BadRequestError(`Path escapes managed directory: ${target}`);
    }
    return resolved;
}
```

Apply this to every `destPath`/`volName` before use, and validate Docker volume names against `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` before passing them to `docker run -v`.

---

### CR-03: `ComposeRewriter` silently skips long-form bind mounts, producing a migrated compose file that doesn't match the copied data

**File:** `server/src/infrastructure/compose-rewriter.ts:39-70` (specifically line 44)

**Issue:** `compose-analyzer.ts`'s `parseVolumeEntry` (lines 106-115) correctly detects long-form bind mounts (`{type: "bind", source: "/abs/path", target: "..."}`) and reports them in `absolutePaths`, which the client wizard then lets the user select for conversion. However, `ComposeRewriter.rewrite()` explicitly bails out for any non-string volume entry:

```ts
svc.volumes = svc.volumes.map((vol: string | object) => {
    if (typeof vol !== "string") return vol; // Skip long-form syntax
    ...
```

Meanwhile `migration-service.ts` step 5 (`copyDirectory`) **does** copy the data for every selected `VolumeSelection` regardless of the original compose syntax. The result: for stacks using long-form `volumes:` entries, the data is physically copied to the new `./volumes/...` bind-mount location, but the rewritten `docker-compose.yml` still references the old (possibly now-stale or inaccessible) absolute host path. The migrated, "adopted" stack silently points at the wrong location, defeating the entire purpose of the migration and potentially causing data loss or an empty volume on next `docker compose up`.

**Fix:** Handle long-form entries in the same loop, rewriting `source`/updating to `external: true` for named-volume long-form entries exactly as is done for the string form, and add a regression test asserting a long-form bind mount is rewritten.

---

### CR-04: Migration backup snapshot (containing stack secrets/data) is left permanently in the shared OS temp directory

**File:** `server/src/application/migration-service.ts:70-166`

**Issue:** Before migrating, the service copies the entire original stack directory (which may contain `.env` files with plaintext secrets, database volumes, etc.) into `os.tmpdir()`:

```ts
const backupDir = path.join(os.tmpdir(), `docktor-migration-backup-${stackId}-${Date.now()}`);
...
await fs.cp(originalDir, backupDir, {recursive: true});
```

On the **success** path, this backup is never removed — the cleanup call is commented out:

```ts
// Clean up backup (keep for now, user can delete old files later)
// await fs.rm(backupDir, {recursive: true, force: true});
```

`os.tmpdir()` (typically `/tmp`) is a shared, world-traversable directory on most Linux hosts; files/directories created there generally inherit the process umask rather than being locked down, so other local users/processes on the host may be able to read copied `.env` secrets, database files, or other sensitive stack data. The backup also accumulates indefinitely across every successful migration with no operator-facing cleanup mechanism.

**Fix:** Either (a) delete `backupDir` on the success path once the new stack is confirmed healthy, or (b) create the backup under a Docktor-managed directory with restrictive permissions (`0700`) instead of the shared OS temp dir, and expose an explicit retention/cleanup policy.

---

### CR-05: Entire Playwright integration suite for the setup wizard is skipped — zero automated coverage of the shipped feature

**File:** `client/test/integration/setup-wizard.spec.ts` (all 20 tests)

**Issue:** Every single test in this file calls `test.skip()` with the actual assertions left as commented-out pseudocode, e.g.:

```ts
test("should create admin account and auto-login on step 1 submit", async ({page}) => {
    // WIZ-02: Account creation
    // await page.goto("/setup");
    // await page.getByLabel(/email/i).fill("admin@example.com");
    // ...
    test.skip();
});
```

This covers first-run redirect, the 5-step wizard flow, account creation/auto-login, skip-optional-steps behavior, post-wizard redirect, re-visit prevention, brownfield scan, compatibility badges, adopt-in-place, and the full migration wizard (steps 1/2, background execution, success toast, rollback-on-failure). None of it runs. This directly violates the project's explicit testing rule ("Do not skip tests to ship faster — tests are part of the feature") and means the entire onboarding flow described in this phase has no end-to-end verification — only isolated unit tests of individual service methods exist.

**Fix:** Implement the described assertions (uncomment/flesh out) or, at minimum, implement the first-run redirect and step-progression tests before merging; do not ship a fully-skipped integration suite as if it were coverage.

## Warnings

### WR-01: Explicit `any` typing used throughout the setup flow, violating strict-TS "no any" rule

**File:** `client/src/routes/setup.tsx:49,63,77,91` (`catch (err: any)`), `server/src/application/migration-service.ts:168,190` (`catch (err: any)`), `server/src/infrastructure/brownfield-scanner.ts:75,107` (`catch (err: any)`), `server/src/app.ts:84` (`const issues: any[] = (error as any).validation`)

**Issue:** CLAUDE.md is explicit: "No `any` — use `unknown` and narrow the type, or model the type properly." All of the above use `: any` on caught exceptions or casts instead of `unknown` + narrowing.

**Fix:**
```ts
} catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    toast.error(message);
}
```

### WR-02: `BackupStep` and `NotificationsStep` bypass the required react-hook-form + Zod resolver pattern

**File:** `client/src/routes/setup/components/backup-step.tsx` (whole file), `client/src/routes/setup/components/notifications-step.tsx` (whole file)

**Issue:** CLAUDE.md: "Forms: always use `react-hook-form` with a Zod resolver — no uncontrolled or ad-hoc form state." `AccountStep` and `SettingsStep` correctly use `useForm` + `standardSchemaResolver`, but `BackupStep`/`NotificationsStep` manage every field via raw `useState` and never surface Zod validation client-side. As a direct consequence, if `wizardStep4Schema`'s `from` (required valid email) or `wizardStep3Schema` requirements fail server-side, the wizard shows only a generic toast (`err.message`) with no field-level feedback, contradicting "Map `ApiError.fields` to react-hook-form field errors for form validation feedback."

**Fix:** Convert both components to `useForm` with `standardSchemaResolver(wizardStep3Schema)` / `standardSchemaResolver(wizardStep4Schema)`, matching `account-step.tsx`/`settings-step.tsx`.

### WR-03: `onboarding-service.ts` throws raw `Error` instead of the typed error hierarchy

**File:** `server/src/application/onboarding-service.ts:42,140`

**Issue:** CLAUDE.md: "Throw typed errors from the custom hierarchy — never throw raw `Error` in business code." Lines 42 (`throw new Error("Signup succeeded but no session returned")`) and 140 (`throw new Error("Display name produces an empty slug")`) both throw raw `Error`, which the global error handler in `app.ts` maps to a generic `500 Internal server error` — even though "empty slug" is a client input problem that should be a `400 BadRequestError`.

**Fix:**
```ts
import {BadRequestError} from "../lib/errors.js";
...
if (!id) {
    throw new BadRequestError("Display name produces an empty slug");
}
```

### WR-04: Duplicated unit test suites for `BrownfieldScanner` and `ComposeAnalyzer`

**File:** `server/test/unit/brownfield-scanner.test.ts` vs `server/test/unit/infrastructure/brownfield-scanner.test.ts`; `server/test/unit/compose-analyzer.test.ts` vs `server/test/unit/infrastructure/compose-analyzer.test.ts`

**Issue:** Two separate, non-identical test files exercise the same two classes in two different locations (one set uses real temp-directory filesystem fixtures, the other mocks `fast-glob`/`fs`). This is significant duplication with no clear canonical location, doubling maintenance cost and making it unclear which suite is authoritative going forward.

**Fix:** Consolidate into a single suite per unit (project convention per CLAUDE.md is `server/test/unit/` for services/domain — pick one location, e.g. `server/test/unit/infrastructure/`, merge the unique test cases, and delete the other file).

### WR-05: `POST /api/setup/adopt` performs file I/O directly in the route handler

**File:** `server/src/routes/setup.ts:111-114`

**Issue:** CLAUDE.md: "Route handlers must be thin — extract logic into services immediately if more than ~10 lines" and routes should not own I/O concerns that belong in the application/infrastructure layer. `fs.readFile(composePath, "utf-8")` is called directly in the route before delegating to `onboardingService.adoptInPlace`, which already accepts `composeContent` as a parameter — the file read itself should live inside the service (or a dedicated infra helper) alongside the rest of the migration/scan file I/O.

**Fix:** Move the `fs.readFile` call into `OnboardingService.adoptInPlace` (or a small infra helper it calls), so the route only extracts/validates the body and calls the service.

### WR-06: `checkSetupStatus()` network failure is silently treated as "setup incomplete"

**File:** `client/src/routes/setup.tsx:25-34`

**Issue:**
```ts
useEffect(() => {
    checkSetupStatus()
        .then((status) => {
            setSetupComplete(status.setupComplete);
            setLoading(false);
        })
        .catch(() => {
            setLoading(false);
        });
}, []);
```
On any transient failure of `GET /api/setup/status` (network blip, 5xx, etc.), `setupComplete` remains at its default `false`, so the full setup wizard renders as if the instance had never been set up — even if it actually has been. This is a misleading fallback with no visible error state to the user.

**Fix:** On error, either retry, or render a distinct error state rather than silently falling through to "show the wizard":
```ts
.catch(() => {
    setLoading(false);
    setStatusError(true); // render a retry/error UI instead of assuming incomplete
});
```

### WR-07: TOCTOU race in `POST /api/setup/step1` allows creating more than one admin account

**File:** `server/src/routes/setup.ts:31-40`

**Issue:**
```ts
const userCount = await prisma.user.count();
if (userCount > 0) {
    return reply.status(400).send({error: "Setup already complete"});
}
const result = await onboardingService.handleWizardStep1(request.body);
```
The check-then-act sequence (`count()` then `signUpEmail`) is not atomic. Two concurrent `POST /api/setup/step1` requests (e.g., a user double-clicking "Next", or two browser tabs) can both observe `userCount === 0` and both proceed to create an account, resulting in two "first" admin users instead of one.

**Fix:** Rely on a unique DB constraint / transaction, or use `prisma.$transaction` with a serializable isolation check, to make the guard atomic; treat a duplicate-email failure from `signUpEmail` as the authoritative rejection rather than the pre-check alone.

### WR-08: Imprecise prefix match for the first-run gate exemption

**File:** `server/src/app.ts:58`

**Issue:** `request.url.startsWith("/api/setup")` matches any URL beginning with that literal string, not just the `/api/setup/...` route tree (e.g. a hypothetical `/api/setupanything` would also be exempted from the first-run gate). While no such route currently exists, this is a fragile pattern for a security-relevant check.

**Fix:** `request.url.startsWith("/api/setup/") || request.url === "/api/setup"`.

### WR-09: `MigrationWizard.handleMigrate` continues updating state after unmount

**File:** `client/src/routes/setup/components/migration-wizard.tsx:78-106`

**Issue:**
```ts
const handleMigrate = async () => {
    setLoading(true);
    toast.info(`Migrating ${displayName}...`);
    onClose(); // Close modal, migration runs in background
    try {
        const result = await executeMigration(...);
        ...
```
`onClose()` (which the parent wires to `setMigratingStack(null)`, unmounting `MigrationWizard`) is called before the `await`. All subsequent `setLoading`/state updates run against an unmounted component, and `loading` is never reset to `false` on either branch, which is harmless only because the component has already been unmounted — but it's a fragile pattern (React will warn, and any future refactor that keeps the dialog open across the await would surface a stuck "Migrating..." button).

**Fix:** Track loading/toast state in the parent (`BrownfieldStep`) rather than inside the component being unmounted, or move the background execution to a hook that outlives the dialog.

### WR-10: `compose.yml` (no `docker-` prefix) is not recognized by the scanner or by adopt's hostPath derivation

**File:** `server/src/infrastructure/brownfield-scanner.ts:28-32`, `server/src/application/onboarding-service.ts:147-150`

**Issue:** `COMPOSE_FILE_PATTERNS` only globs `docker-compose.yml`, `docker-compose.yaml`, and `compose.yaml` — it omits `compose.yml`, which is a valid and increasingly common Compose file name (Docker Compose's own file-resolution order is `compose.yaml` → `compose.yml` → `docker-compose.yaml` → `docker-compose.yml`). Separately, `adoptInPlace`'s hostPath-stripping regex (`/[\/\\]docker-compose\.(yml|yaml)$|[\/\\]compose\.yaml$/`) has the same gap: if `/api/setup/adopt` is ever reached with a `compose.yml` path (e.g., directly, bypassing the scan step — see CR-01), the regex fails to match and `hostPath` ends up equal to the full file path (including the filename) instead of its containing directory, which will break subsequent `docker compose` invocations that `cwd` into `hostPath`.

**Fix:** Add `"**/compose.yml"` to `COMPOSE_FILE_PATTERNS` and extend the regex to `/[\/\\](docker-compose\.(yml|yaml)|compose\.(yml|yaml))$/`.

## Info

### IN-01: Unused `stackId` parameter

**File:** `client/src/routes/setup/components/brownfield-step.tsx:84`
**Issue:** `const handleMigrationComplete = (stackId: string) => { ... }` never references `stackId`; it uses the outer `migratingStack.path` closure instead.
**Fix:** Either use the passed-in `stackId` (e.g. to log/display it) or rename to `_stackId` / drop the parameter if genuinely unnecessary, and confirm the `onComplete` contract still needs it.

### IN-02: Commented-out cleanup code

**File:** `server/src/application/migration-service.ts:163-164`
**Issue:** `// await fs.rm(backupDir, {recursive: true, force: true});` is left commented out rather than removed or implemented (see CR-04 for the underlying functional problem this leaves unresolved).
**Fix:** Remove the comment once CR-04 is resolved with an explicit retention policy.

### IN-03: Dead/redundant condition in the first-run gate hook

**File:** `server/src/app.ts:60`
**Issue:** `request.url === "/setup" ||` is unreachable in practice: `/setup` does not start with `/api/`, so the final clause `!request.url.startsWith("/api/")` on line 61 already exempts it. The explicit clause adds confusion about what the hook is actually protecting.
**Fix:** Remove the redundant clause, or add a comment clarifying intent if it's meant as defensive/future-proofing.

---

_Reviewed: 2026-08-31T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
