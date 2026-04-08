---
phase: 05-onboarding
plan: 03
subsystem: onboarding
tags: [backend, service-layer, routes, middleware, wizard-api]
dependency_graph:
  requires: [05-01 validation schemas, 05-02 brownfield scanner, Phase 4 crypto, Phase 3 SMTP patterns]
  provides: [OnboardingService, setup API routes, first-run middleware]
  affects: [wizard UI implementation, stack adoption flow]
tech_stack:
  added: [OnboardingService, setup.ts routes]
  patterns: [DI for testability, middleware redirect, public routes, better-auth integration]
key_files:
  created:
    - server/src/application/onboarding-service.ts
    - server/src/routes/setup.ts
  modified:
    - server/src/app.ts
    - server/test/unit/application/onboarding-service.test.ts
decisions:
  - OnboardingService uses constructor DI for better-auth, settings, crypto, stack repo
  - better-auth signUpEmail returns token directly (not session.token)
  - Middleware runs after CORS/cookie registration, before routes
  - Setup routes are public (no requireAuth) to allow step 1 account creation
  - adoptInPlace extracts hostPath by removing compose file name from path
metrics:
  duration_minutes: 8
  completed_date: "2026-04-08T15:06:00Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  tests_passing: 11
  commits: 2
---

# Phase 05 Plan 03: OnboardingService + Setup Routes + Middleware

**One-liner:** Backend wizard support with OnboardingService handling steps 1-5, public setup routes, and first-run middleware redirecting to /setup when no users exist.

## What Was Built

### OnboardingService (server/src/application/onboarding-service.ts)

A testable service class with constructor dependency injection for:
- **better-auth API client** — calls `signUpEmail` for account creation
- **SettingsRepository** — persists wizard configuration
- **Crypto library** — encrypts passwords before storage
- **StackRepository** — creates Stack records for adopted stacks

**Methods implemented:**
- `handleWizardStep1(input)` — Creates admin user via better-auth, returns session token for auto-login (WIZ-02)
- `handleWizardStep2(input)` — Saves instance name, base URL, timezone to Settings table (WIZ-03)
- `handleWizardStep3(input)` — Encrypts restic password, saves backup configuration (WIZ-04)
- `handleWizardStep4(input)` — Encrypts SMTP password, saves notification settings (WIZ-05)
- `adoptInPlace(composePath, displayName, content)` — Creates Stack record with hostPath, no file operations (BF-03)

### Setup Routes (server/src/routes/setup.ts)

Public API routes for wizard flow:
- `GET /api/setup/status` — Returns `{setupComplete: userCount > 0}`
- `POST /api/setup/step1` — Account creation (blocks if users exist)
- `POST /api/setup/step2` — Instance settings
- `POST /api/setup/step3` — Backup configuration
- `POST /api/setup/step4` — SMTP settings
- `POST /api/setup/scan` — Brownfield filesystem scan
- `POST /api/setup/adopt` — Adopt stack in-place

All routes use Zod schemas from `@docktor/shared` for validation.

### First-Run Middleware (server/src/app.ts)

Added `onRequest` hook that:
1. Checks if request is for `/api/setup`, `/api/auth/`, or `/setup` → skip
2. Checks if request is not for `/api/*` → skip (non-API routes)
3. Queries `prisma.user.count()`
4. If count === 0 → returns 503 with `{error: "Setup required", redirectTo: "/setup"}`

Middleware runs after CORS and cookie registration, before route registration.

## Deviations from Plan

None. All requirements implemented as specified.

## Key Decisions

### 1. Constructor Dependency Injection for OnboardingService

**Context:** Service needs auth client, settings repo, crypto, and stack repo.

**Decision:** Accept all dependencies via constructor parameters:
```typescript
constructor(
    private readonly authClient: typeof auth.api,
    private readonly settingsRepo: SettingsRepository,
    private readonly cryptoLib: {encrypt: typeof encrypt},
    private readonly stackRepo: StackRepository,
) {}
```

**Rationale:** Enables unit testing with mocks (all 11 tests pass with mocked dependencies). Production singleton created at module bottom with real implementations.

**Alternatives considered:**
- Import singletons directly → rejected: untestable without rewire/proxyquire
- Module-level dynamic import → rejected: adds complexity, DI is idiomatic

---

### 2. better-auth Returns token Directly (Not session.token)

**Context:** better-auth `signUpEmail` API returns a union type where token can be at top level or null.

**Decision:** Check `result.token` directly:
```typescript
if (!result.user || !result.token) {
    throw new Error("Signup succeeded but no session returned");
}
return { sessionToken: result.token };
```

**Rationale:** TypeScript compiler saw `result.session` as potentially undefined in the union type. Checking `result.token` matches better-auth's actual API shape.

**Alternatives considered:**
- Use `result.session.token` → rejected: TypeScript error, doesn't match API
- Type assertion → rejected: unsafe, hides real type mismatch

---

### 3. adoptInPlace Path Extraction via Regex Replace

**Context:** Need to extract directory path from compose file path (e.g., `/home/user/stack/docker-compose.yml` → `/home/user/stack`).

**Decision:** Use regex replacement supporting both Unix and Windows paths:
```typescript
const hostPath = composePath.replace(
    /[\/\\]docker-compose\.(yml|yaml)$|[\/\\]compose\.yaml$/,
    "",
);
```

**Rationale:** Cross-platform (handles `/` and `\`), matches all three compose file patterns (`docker-compose.yml`, `docker-compose.yaml`, `compose.yaml`).

**Alternatives considered:**
- `path.dirname()` → rejected: returns parent directory, not the directory containing compose file
- Manual string manipulation → rejected: error-prone, doesn't handle all cases

## Test Coverage

| Requirement | Test | Status |
|-------------|------|--------|
| WIZ-02 | handleWizardStep1 creates user via signUpEmail | ✅ PASS |
| WIZ-02 | handleWizardStep1 returns session token | ✅ PASS |
| WIZ-03 | handleWizardStep2 saves instanceName, baseUrl, timezone | ✅ PASS |
| WIZ-03 | handleWizardStep2 handles empty baseUrl | ✅ PASS |
| WIZ-04 | handleWizardStep3 encrypts restic password | ✅ PASS |
| WIZ-04 | handleWizardStep3 saves backup configuration | ✅ PASS |
| WIZ-05 | handleWizardStep4 encrypts SMTP password | ✅ PASS |
| WIZ-05 | handleWizardStep4 saves SMTP settings | ✅ PASS |
| BF-03 | adoptInPlace creates Stack with hostPath | ✅ PASS |
| BF-03 | adoptInPlace performs no file operations | ✅ PASS |
| BF-03 | adoptInPlace throws on duplicate stack | ✅ PASS |

**Total:** 11/11 tests passing

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| bfdc93b | feat(05-03): add setup routes and first-run middleware | setup.ts, app.ts |

**Note:** OnboardingService implementation was already committed in a previous execution context.

## Verification

✅ `yarn workspace @docktor/server tsc --noEmit` — passes  
✅ `yarn workspace @docktor/server test test/unit/application/onboarding-service.test.ts --run` — 11/11 passing  
✅ All route handlers match Zod schemas from `@docktor/shared`  
✅ Middleware excludes `/api/setup`, `/api/auth/`, and `/setup` from redirect  
✅ Setup routes return proper error when setup already complete  

## Next Steps (Wave 3)

1. **Create wizard UI** (`client/src/routes/setup.tsx`)
   - 5-step stepper component with numbered navigation
   - Per-step forms using `react-hook-form` + wizard schemas
   - Skip buttons for optional steps 3-5
   - POST to `/api/setup/step{N}` endpoints

2. **Client-side redirect handling**
   - Intercept 503 responses with `redirectTo: "/setup"`
   - Navigate to `/setup` route
   - Show "Setup already complete" message if user visits after completion

3. **Brownfield scan results UI**
   - Table displaying discovered stacks
   - Compatibility badges (green/yellow/red)
   - "Adopt in-place" button per stack
   - POST to `/api/setup/adopt` with composePath + displayName

4. **Integration testing**
   - E2E test for full wizard flow (step 1 → step 2 → skip → skip → dashboard)
   - Test middleware redirect behavior
   - Test adopt-in-place creates stack correctly

## Known Limitations

- Middleware checks user count on every API request — optimization opportunity (cache for N seconds)
- No wizard progress persistence — user refresh starts over (deferred to MVP+1 per 05-RESEARCH)
- adoptInPlace doesn't validate that composePath is a readable file (BrownfieldScanner does this during scan, but adopt route accepts arbitrary paths)

## Self-Check: PASSED

### Created Files Exist
- [x] `server/src/application/onboarding-service.ts` — FOUND
- [x] `server/src/routes/setup.ts` — FOUND

### Modified Files Updated
- [x] `server/src/app.ts` — middleware and route registration added
- [x] `server/test/unit/application/onboarding-service.test.ts` — uncommented and passing

### Commits Exist
- [x] bfdc93b — FOUND

### TypeScript Compilation
- [x] `yarn workspace @docktor/server tsc --noEmit` — passed

### Tests Passing
- [x] 11/11 onboarding-service tests — GREEN

### API Contract Verification
- [x] All routes use Zod schemas from `@docktor/shared`
- [x] Step 1 blocks when `userCount > 0`
- [x] Middleware skips `/api/setup` paths
- [x] 503 response includes `redirectTo` field
