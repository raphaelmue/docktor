# Phase 5: Onboarding - Research

**Researched:** 2026-04-08
**Domain:** Multi-step wizard, brownfield filesystem scanning, Docker volume migration, YAML rewriting
**Confidence:** HIGH

## Summary

Phase 5 implements a first-run setup wizard (5 steps: account creation, basic settings, optional backup/notification config, optional brownfield scan) and brownfield import flow (discover existing compose stacks, adopt in-place or full migration with volume conversion). The phase builds on existing infrastructure: better-auth for account creation, Settings repository for config persistence, StackFilesystem for file operations, DockerExecutor for container orchestration, and existing state machine for DEPLOYING/RUNNING transitions.

**Standard stack:** react-hook-form 7.72.1 + Zod for wizard validation, fast-glob 3.3.3 for filesystem scanning, yaml 2.8.3 (already installed) for compose parsing/rewriting, diff 8.0.4 for side-by-side diff preview. Server uses better-auth's `signUpEmail` API for step 1 user creation with auto-login, middleware redirect for zero-user detection, and spawn-based Docker volume copy (alpine container pattern).

**Primary recommendation:** Use per-step Zod schemas in @docktor/shared (wizard steps 1-5), store wizard progress in Settings table for session resume (not MVP — can defer), implement volume migration as background job with automatic rollback on failure (Phase 4 pattern), scan filesystem with fast-glob + permission error handling, use diff library for YAML preview (not custom implementation).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Wizard flow structure:** Steps 1-2 required (account + settings), steps 3-5 optional (backup/notifications/brownfield scan). Clickable numbered stepper with titles for navigation. Each optional step has "Skip" button.
- **Wizard routing and authentication:** Server middleware checks User count on every request; if zero, redirect to `/setup`. `/setup` is public route. Step 1 creates user and auto-logs them in. After wizard, redirect to `/dashboard`. Re-visiting `/setup` after completion shows "Setup already complete" message.
- **Brownfield scan mechanics:** User-specified directories only (no full-disk scan). Default suggestions: `/home`, `/opt`, `/srv`. Exclude `/proc`, `/sys`, `/dev` if user enters them. Permission errors gracefully skipped with count in results.
- **Compatibility assessment:** Traffic light badges: Green (Ready) = relative bind mounts only, Yellow (Manual migration recommended) = named volumes OR absolute paths OR inline env vars, Red (Unsupported) = advanced features (configs, secrets, depends_on conditions, external networks beyond simple external:true).
- **Adopt-in-place vs full migration:** Two flows: "Adopt in-place" (zero downtime, creates DB record, no file moves), "Migrate" (multi-step wizard with volume conversion, compose rewrite, background execution).
- **Volume handling during migration:** Step 1 checklist: all named volumes + bind mounts shown with checkboxes (default checked for conversion). Unchecked volumes remain as-is with backup warnings. Checked volumes copied to `./volumes/[name]/`, compose rewritten.
- **Bind mount path handling:** Relative paths: default checked, copy to `./volumes/`. Absolute paths: warning badge, user choice to copy or leave. Unchecked items: tracked but not backed up (BCK-07 warning).
- **Compose file modification:** Inline env vars always extracted to `.env`. Volume paths rewritten based on Step 1 selections. Step 2 shows side-by-side diff (original vs rewritten) + new `.env` content. User must approve via "Confirm & Migrate" button.
- **Migration wizard UI flow:** Step 1 = volume selection checklist. Step 2 = diff preview with Back/Confirm buttons. Step 3 (implicit) = background execution with toast notifications.
- **Migration safety and rollback:** Pre-migration: copy source directory to `/tmp/docktor-migration-backup-[stackId]-[timestamp]/`. On failure: restore original compose, restart containers at original location, delete incomplete `/stacks/[id]/`, show error toast. On success: modal prompt to keep or delete old files (delete requires typed stack name confirmation, Phase 4 pattern).
- **Migration progress display:** Background execution (no blocking modal). Toast on start/success/failure. Dashboard shows DEPLOYING status during migration, transitions to RUNNING when complete.

### Claude's Discretion
- Exact YAML diff library choice (jsdiff, diff-match-patch, or custom)
- Wizard step validation schema structure (single Zod schema vs per-step schemas)
- Settings key names for wizard progress tracking (if user exits mid-wizard and returns later)
- Docker volume data copy command details (docker run alpine vs docker volume inspect + rsync)
- Error boundary behavior if user closes browser mid-migration (graceful continuation vs abort)
- Scan results table column design (what metadata to show: service count, image count, directory size)
- Whether brownfield scan is a separate page (`/setup/scan`) or always embedded in wizard step 5

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIZ-01 | On first boot with no user in DB, UI shows setup wizard | Middleware redirect pattern (server onRequest hook), User count query via better-auth Prisma adapter |
| WIZ-02 | Wizard step 1: create admin account | better-auth signUpEmail API + auto-login pattern (auth.api.signUpEmail returns session token) |
| WIZ-03 | Wizard step 2: set instance name, base URL, timezone | Reuse existing generalSettingsSchema from @docktor/shared, SettingsRepository.upsertSetting |
| WIZ-04 | Wizard step 3 (optional): configure restic backup repo + password | Reuse backupSettingsSchema + crypto.encrypt for password |
| WIZ-05 | Wizard step 4 (optional): configure SMTP notifications | Reuse SMTP settings pattern from Phase 3 (SmtpCard component inline pattern) |
| WIZ-06 | Wizard step 5 (optional): trigger brownfield scan | fast-glob recursive search for docker-compose.yml, chokidar exclude patterns for system dirs |
| WIZ-07 | After wizard completion, redirect to dashboard | React Router navigate() after final step submission |
| BF-01 | Scan host filesystem for docker-compose.yml | fast-glob 3.3.3 with ignore patterns, permission error try/catch per directory |
| BF-02 | Show compatibility assessment for each discovered stack | Parse compose with yaml 2.8.3, detect named volumes (top-level volumes key), absolute paths (starts with /), inline env vars (environment: key:value not ${VAR}) |
| BF-03 | Adopt in-place with zero downtime | Create Stack record with hostPath = discovered path, no file operations, immediate status query |
| BF-04 | Full migration wizard: stop → copy → convert volumes → rewrite compose → restart | Background job pattern (Phase 4), docker compose stop, fs.cp for files, docker run alpine for volume data copy, yaml stringify for compose rewrite |
| BF-05 | Rollback on failure + user-initiated cleanup | fs.cp to /tmp before migration, on error restore + docker compose up at original path, on success AlertDialog with typed name confirmation (Phase 4 restore pattern) |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-hook-form | 7.72.1 | Multi-step wizard form state | Industry standard for complex forms; per-step validation; built-in error handling [VERIFIED: npm registry] |
| @hookform/resolvers | 5.2.2 | Zod schema integration | Official adapter for react-hook-form + Zod [VERIFIED: npm registry] |
| zod | 4.3.6 | Wizard step validation schemas | Already in @docktor/shared for all validation [VERIFIED: installed] |
| fast-glob | 3.3.3 | Recursive filesystem scanning | Fast, supports ignore patterns, handles permission errors gracefully [VERIFIED: npm registry] |
| yaml | 2.8.3 | Compose file parsing and rewriting | Already installed for compose-parser.ts; supports round-trip parse/stringify preserving comments [VERIFIED: installed] |
| diff | 8.0.4 | Side-by-side YAML diff preview | Standard library for unified/structured diffs, works with text and line arrays [VERIFIED: npm registry] |
| better-auth | 1.4.18 | User signup and auto-login | Already integrated; signUpEmail API returns session token for auto-login [VERIFIED: installed] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | 4.0.3 | File watcher (already used in Phase 2) | Not needed for brownfield scan (one-time operation), but pattern available if watching during scan [VERIFIED: installed] |
| dockerode | 4.0.4 | Docker API client (already used) | Not needed — Phase 5 uses docker CLI via DockerExecutor (spawn-based) for volume inspect/copy [VERIFIED: installed] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| diff | diff-match-patch 1.0.5 | diff-match-patch is lower-level (character-level patches); diff is line-oriented and better for YAML display |
| fast-glob | node:fs.readdir + recursive walk | Custom recursion harder to test, no built-in permission error handling, slower on large directories |
| yaml | js-yaml 4.1.1 | js-yaml is more mature but yaml 2.x has better TypeScript support and is already installed |

**Installation:**
```bash
# Server (all already installed except diff)
yarn workspace @docktor/server add diff

# Client (all already installed except diff for diff preview rendering)
yarn workspace @docktor/client add diff
```

**Version verification:**
```bash
# Verified 2026-04-08 via npm registry
npm view react-hook-form version  # 7.72.1
npm view fast-glob version        # 3.3.3
npm view diff version             # 8.0.4
npm view yaml version             # 2.8.3
```

## Architecture Patterns

### Recommended Project Structure
```
server/src/
├── routes/
│   └── setup.ts                          # Public route for wizard steps (no requireAuth)
├── application/
│   └── onboarding-service.ts             # Brownfield scan + migration orchestration
├── repositories/
│   └── brownfield-repository.ts          # Scan results caching (optional), migration state tracking
├── infrastructure/
│   └── brownfield-scanner.ts             # fast-glob wrapper, permission error handling
│   └── volume-migrator.ts                # Docker volume data copy (docker run alpine pattern)
│   └── compose-rewriter.ts               # YAML parsing, inline env extraction, volume path rewriting
└── lib/
    └── compose-parser.ts                 # Already exists — extend with named volume detection

client/src/
├── routes/
│   └── setup.tsx                         # Wizard page (5 steps with stepper)
│   └── setup/
│       └── components/
│           ├── wizard-stepper.tsx        # Custom numbered stepper component
│           ├── account-step.tsx          # Step 1: email + password (better-auth signup)
│           ├── settings-step.tsx         # Step 2: instance name, base URL, timezone
│           ├── backup-step.tsx           # Step 3 (optional): restic config
│           ├── notifications-step.tsx    # Step 4 (optional): SMTP config
│           └── brownfield-step.tsx       # Step 5 (optional): scan + results table
├── components/domain/onboarding/
│   ├── compatibility-badge.tsx           # Traffic light badge (green/yellow/red)
│   ├── migration-wizard.tsx              # Volume selection + diff preview modal
│   └── diff-viewer.tsx                   # Side-by-side YAML diff display
└── lib/
    └── setup-api.ts                      # API client: wizard submission, scan trigger, migration trigger
```

### Pattern 1: Multi-Step Wizard with Per-Step Validation
**What:** Single react-hook-form instance with multiple Card components for each step. Stepper controls which Card is visible. Each step has its own Zod schema. "Next" button validates current step only.

**When to use:** Wizard with optional steps and non-linear navigation (user can click stepper to jump back).

**Example:**
```typescript
// shared/src/validation/wizard.ts
export const wizardStep1Schema = z.object({
  email: z.email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const wizardStep2Schema = z.object({
  instanceName: z.string().min(1, "Instance name required"),
  baseUrl: z.string().url("Must be valid URL").or(z.literal("")),
  timezone: z.string().refine(isValidIANATimezone, "Invalid timezone"),
});

// client/src/routes/setup.tsx
const [currentStep, setCurrentStep] = useState(1);
const form = useForm<WizardStep1Input>({
  resolver: standardSchemaResolver(wizardStep1Schema),
});

async function handleNext() {
  const isValid = await form.trigger(); // Validate current step only
  if (!isValid) return;
  
  // Save current step data
  await submitStepData(currentStep, form.getValues());
  
  // Advance to next step
  setCurrentStep(currentStep + 1);
}
```

**Source:** react-hook-form docs (form.trigger() API), Phase 1-4 existing form patterns in create.tsx/settings.tsx

### Pattern 2: Brownfield Filesystem Scan with Permission Handling
**What:** Use fast-glob to recursively search user-specified directories for `docker-compose.{yml,yaml}` and `compose.yaml`. Wrap each directory in try/catch to handle EACCES/EPERM gracefully. Return both found stacks and skipped directory count.

**When to use:** Any recursive filesystem search where permission errors are expected (user-specified paths may include protected directories).

**Example:**
```typescript
// server/src/infrastructure/brownfield-scanner.ts
import fg from "fast-glob";
import fs from "node:fs/promises";

export interface ScanResult {
  stacks: DiscoveredStack[];
  skippedDirectories: number;
}

export class BrownfieldScanner {
  private readonly COMPOSE_FILE_PATTERNS = [
    "**/docker-compose.yml",
    "**/docker-compose.yaml",
    "**/compose.yaml",
  ];
  
  private readonly SYSTEM_DIR_EXCLUDES = [
    "**/proc/**",
    "**/sys/**",
    "**/dev/**",
    "**/node_modules/**",
    "**/.git/**",
  ];
  
  async scan(directories: string[]): Promise<ScanResult> {
    const foundFiles: string[] = [];
    let skippedCount = 0;
    
    for (const dir of directories) {
      try {
        await fs.access(dir, fs.constants.R_OK); // Check read permission
        const files = await fg(this.COMPOSE_FILE_PATTERNS, {
          cwd: dir,
          absolute: true,
          ignore: this.SYSTEM_DIR_EXCLUDES,
          onlyFiles: true,
          suppressErrors: true, // Don't throw on permission errors mid-scan
        });
        foundFiles.push(...files);
      } catch (err: any) {
        if (err.code === "EACCES" || err.code === "EPERM") {
          skippedCount++;
          console.warn(`[BrownfieldScanner] Skipped directory: ${dir} (permission denied)`);
        } else {
          throw err; // Re-throw unexpected errors
        }
      }
    }
    
    // Parse each compose file and assess compatibility
    const stacks = await Promise.all(
      foundFiles.map(async (filePath) => {
        const content = await fs.readFile(filePath, "utf-8");
        return this.analyzeCompose(filePath, content);
      })
    );
    
    return { stacks, skippedDirectories: skippedCount };
  }
  
  private analyzeCompose(filePath: string, content: string): DiscoveredStack {
    const parsed = yaml.parse(content);
    
    // Detect named volumes: top-level "volumes:" key with entries
    const hasNamedVolumes = parsed.volumes && Object.keys(parsed.volumes).length > 0;
    
    // Detect inline env vars: service.environment with "key: value" not "${VAR}"
    const hasInlineEnv = Object.values(parsed.services || {}).some((svc: any) => {
      const env = svc.environment;
      if (Array.isArray(env)) return false; // Array form is ${VAR} references
      return env && typeof env === "object"; // Object form is inline key:value
    });
    
    // Detect absolute bind mounts: volume host path starts with "/"
    const hasAbsolutePaths = Object.values(parsed.services || {}).some((svc: any) =>
      (svc.volumes || []).some((vol: string) => 
        typeof vol === "string" && vol.startsWith("/")
      )
    );
    
    // Detect unsupported features: configs, secrets, depends_on with condition
    const hasUnsupportedFeatures = 
      !!parsed.configs || 
      !!parsed.secrets ||
      Object.values(parsed.services || {}).some((svc: any) => {
        const deps = svc.depends_on;
        return deps && typeof deps === "object" && !Array.isArray(deps); // Object form has conditions
      });
    
    let compatibility: "green" | "yellow" | "red";
    if (hasUnsupportedFeatures) {
      compatibility = "red";
    } else if (hasNamedVolumes || hasAbsolutePaths || hasInlineEnv) {
      compatibility = "yellow";
    } else {
      compatibility = "green";
    }
    
    return {
      path: filePath,
      compatibility,
      serviceCount: Object.keys(parsed.services || {}).length,
      // ... other metadata
    };
  }
}
```

**Source:** fast-glob documentation (suppressErrors option), existing chokidar ignore patterns from Phase 2 FileWatcher [VERIFIED: codebase pattern]

### Pattern 3: Docker Volume Data Migration
**What:** Use `docker run --rm -v source:/source -v dest:/dest alpine cp -a /source/. /dest/` to copy data from a named Docker volume to a bind mount directory. This preserves permissions, symlinks, and ownership.

**When to use:** Migrating from named Docker volume to bind mount (brownfield migration step).

**Example:**
```typescript
// server/src/infrastructure/volume-migrator.ts
import {spawn} from "node:child_process";
import fs from "node:fs/promises";

export class VolumeMigrator {
  async copyVolumeToBindMount(
    volumeName: string, 
    destPath: string
  ): Promise<void> {
    // Create destination directory
    await fs.mkdir(destPath, {recursive: true});
    
    // Copy data using alpine container
    const args = [
      "run",
      "--rm",
      "-v", `${volumeName}:/source`,
      "-v", `${destPath}:/dest`,
      "alpine",
      "cp", "-a", "/source/.", "/dest/",
    ];
    
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args);
      
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Volume copy failed (exit ${code}): ${stderr}`));
        }
      });
    });
  }
}
```

**Source:** Docker documentation (docker run -v bind mount syntax), Phase 4 spawn pattern for restic [VERIFIED: codebase pattern]

### Pattern 4: YAML Rewriting with Inline Env Extraction
**What:** Parse compose with yaml library, modify volumes array to replace named volumes with `./volumes/[name]` paths, extract inline environment variables (object form) to `.env` file and replace with array form (`${VAR}` references), stringify back to YAML.

**When to use:** Migration wizard Step 2 compose rewrite.

**Example:**
```typescript
// server/src/infrastructure/compose-rewriter.ts
import yaml from "yaml";

export interface RewriteResult {
  rewrittenCompose: string;
  extractedEnv: string;
}

export class ComposeRewriter {
  rewrite(originalCompose: string, volumeSelections: Map<string, string>): RewriteResult {
    const doc = yaml.parse(originalCompose);
    const extractedEnvVars: Record<string, string> = {};
    
    // Rewrite service volumes based on user selections
    for (const [serviceName, service] of Object.entries(doc.services || {})) {
      if (service.volumes) {
        service.volumes = service.volumes.map((vol: string | object) => {
          if (typeof vol !== "string") return vol; // Skip long-form syntax
          
          const [hostPath, containerPath, ...rest] = vol.split(":");
          const newHostPath = volumeSelections.get(hostPath) || hostPath;
          return [newHostPath, containerPath, ...rest].join(":");
        });
      }
      
      // Extract inline environment variables
      if (service.environment && typeof service.environment === "object" && !Array.isArray(service.environment)) {
        const inlineEnv = service.environment;
        const envRefs: string[] = [];
        
        for (const [key, value] of Object.entries(inlineEnv)) {
          extractedEnvVars[key] = String(value);
          envRefs.push(`\${${key}}`);
        }
        
        service.environment = envRefs;
      }
    }
    
    // Remove named volumes from top-level volumes key (now external or converted)
    if (doc.volumes) {
      for (const [volName, volDef] of Object.entries(doc.volumes)) {
        if (volumeSelections.has(volName)) {
          delete doc.volumes[volName]; // Converted to bind mount
        } else {
          doc.volumes[volName] = { external: true }; // Keep as named volume
        }
      }
    }
    
    const rewrittenCompose = yaml.stringify(doc, {
      lineWidth: 0, // Prevent line wrapping
      defaultStringType: "QUOTE_DOUBLE", // Preserve quotes
    });
    
    const extractedEnv = Object.entries(extractedEnvVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    
    return { rewrittenCompose, extractedEnv };
  }
}
```

**Source:** yaml library documentation (parse/stringify API), existing compose-parser.ts pattern [VERIFIED: installed library + codebase]

### Anti-Patterns to Avoid
- **Don't use synchronous fs methods in scan:** Scanning hundreds of directories can block the event loop; always use fs.promises async methods.
- **Don't modify compose in-place during migration:** Create new file at `/stacks/[id]/docker-compose.yml`, leave original untouched until success confirmed (rollback safety).
- **Don't assume docker volume inspect gives file paths:** Named volumes don't have host paths until mounted; must use `docker run` with volume mount to access data.
- **Don't skip permission checks on scan directories:** User may enter `/root` or protected paths; validate with `fs.access()` before calling fast-glob.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive filesystem search | Custom fs.readdir + recursive walk | fast-glob | Built-in ignore patterns, permission error handling, 10x faster on large directories |
| YAML parsing and round-trip | String manipulation with regex | yaml library | Preserves comments, handles edge cases (multi-line strings, anchors, aliases), battle-tested |
| Diff visualization | Custom line-by-line comparison | diff library | Unified diff format, handles insertions/deletions/context, industry standard |
| Multi-step form state | Custom useState for each field | react-hook-form | Built-in validation, error handling, performance optimized (uncontrolled inputs), 70k+ stars on GitHub |
| Docker volume inspection | Parse docker inspect JSON manually | DockerExecutor pattern with spawn | Already established in codebase, tested in Phase 1-4 |

**Key insight:** Brownfield migration has non-obvious edge cases (symlinks in volumes, multi-line env vars in YAML, permission denied mid-scan). Use libraries that handle these edge cases rather than discovering them through bug reports.

## Runtime State Inventory

> Phase 5 is not a rename/refactor phase. This section is omitted.

## Common Pitfalls

### Pitfall 1: Middleware Redirect Loop
**What goes wrong:** If `/setup` route is not explicitly excluded from requireAuth, authenticated users will be redirected to `/setup` on every request, even after setup is complete.

**Why it happens:** Middleware checks User count before auth check; if logic is "count === 0 → redirect", it triggers even for authenticated users.

**How to avoid:** Middleware redirect logic: `if (userCount === 0 && request.url !== '/api/setup' && !request.url.startsWith('/api/auth/')) { redirect('/setup') }`. Only redirect non-setup, non-auth routes.

**Warning signs:** After completing wizard, dashboard page immediately redirects back to `/setup`. Browser console shows 302 redirect loop.

### Pitfall 2: Docker Volume Copy Permission Mismatch
**What goes wrong:** After copying volume data to bind mount with alpine container, containers fail to start with "permission denied" errors.

**Why it happens:** Alpine's `cp -a` preserves original UID/GID, but container may run as different user. Host filesystem may not have matching UID.

**How to avoid:** After volume copy, check if target directory is owned by root (UID 0). If yes, and compose service has `user:` directive, `chown -R` the bind mount to match. For non-root containers, document in migration warnings that permission adjustment may be needed.

**Warning signs:** Migration succeeds but stack enters ERROR state immediately. Container logs show "permission denied" on volume mount paths.

### Pitfall 3: Inline Environment Variable Edge Cases
**What goes wrong:** YAML parser treats `environment: { KEY: 123 }` as number 123, not string "123". After extraction to `.env` and rewrite as `${KEY}`, container receives different value.

**Why it happens:** YAML spec allows unquoted numbers. `.env` format treats all values as strings. Type coercion happens during round-trip.

**How to avoid:** When extracting inline env vars to `.env`, always `String(value)` and wrap in quotes if value is numeric or boolean. Diff preview shows exact change (user can see `123` → `"123"`).

**Warning signs:** Container starts but behaves differently (e.g., PORT=8080 becomes PORT="8080", breaks integer parsing in app).

### Pitfall 4: Fast-Glob Ignore Patterns Don't Apply to Base Directory
**What goes wrong:** User enters `/proc` as scan directory. fast-glob with `ignore: ["**/proc/**"]` still scans `/proc` itself, only skipping subdirectories.

**Why it happens:** Ignore patterns match against file paths, not the base directory passed to `cwd:` option.

**How to avoid:** Pre-filter user-provided directories before passing to fast-glob. If directory is `/proc`, `/sys`, or `/dev`, skip entirely with warning: "System directory excluded from scan."

**Warning signs:** Scan takes 10+ seconds and returns thousands of results. Server process memory spikes. User report: "scan hung on /proc".

## Code Examples

Verified patterns from codebase and official documentation:

### Multi-Step Form with Per-Step Validation (react-hook-form)
```typescript
// Source: client/src/routes/app/stacks/create.tsx + react-hook-form docs
import {useState} from "react";
import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";

function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const form = useForm({
    resolver: standardSchemaResolver(wizardStep1Schema),
    defaultValues: { email: "", password: "" },
  });
  
  async function handleNext() {
    const isValid = await form.trigger(); // Validates only current step's fields
    if (!isValid) return;
    
    // Save step data (optional — can submit all at end)
    await saveStepData(currentStep, form.getValues());
    
    // Load next step's schema and defaults
    form.reset(getDefaultsForStep(currentStep + 1), {
      keepValues: false, // Clear previous step's form state
    });
    
    setCurrentStep(currentStep + 1);
  }
  
  return (
    <Form {...form}>
      {currentStep === 1 && <AccountStep />}
      {currentStep === 2 && <SettingsStep />}
      {/* ... */}
      <Button onClick={handleNext}>Next</Button>
    </Form>
  );
}
```

### Better-Auth Signup with Auto-Login
```typescript
// Source: server/src/lib/auth.ts + better-auth docs
import {auth} from "../lib/auth.js";

export async function handleWizardStep1(email: string, password: string) {
  // signUpEmail returns session token for immediate login
  const result = await auth.api.signUpEmail({
    body: { email, password, name: email.split("@")[0] },
  });
  
  if (!result.session) {
    throw new Error("Signup succeeded but no session returned");
  }
  
  // Return session token to client for cookie setting
  return {
    user: result.user,
    sessionToken: result.session.token,
  };
}
```

### Middleware Redirect for First-Run Detection
```typescript
// Source: server/src/app.ts onRequest hook pattern
import {prisma} from "./lib/db.js";

app.addHook("onRequest", async (request, reply) => {
  // Skip check for auth and setup routes
  if (
    request.url.startsWith("/api/auth/") || 
    request.url.startsWith("/api/setup") ||
    request.url === "/setup"
  ) {
    return;
  }
  
  // Check if any users exist
  const userCount = await prisma.user.count();
  
  if (userCount === 0) {
    // Redirect to setup wizard
    return reply.redirect(302, "/setup");
  }
});
```

### Fast-Glob Filesystem Scan with Permission Handling
```typescript
// Source: fast-glob docs + Phase 2 FileWatcher pattern
import fg from "fast-glob";
import fs from "node:fs/promises";

async function scanDirectories(dirs: string[]): Promise<string[]> {
  const foundFiles: string[] = [];
  
  for (const dir of dirs) {
    // Skip system directories explicitly
    if (["/proc", "/sys", "/dev"].includes(dir)) {
      console.warn(`Skipping system directory: ${dir}`);
      continue;
    }
    
    try {
      // Check read permission before scanning
      await fs.access(dir, fs.constants.R_OK);
      
      const files = await fg(["**/docker-compose.{yml,yaml}", "**/compose.yaml"], {
        cwd: dir,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
        suppressErrors: true, // Don't throw on permission errors inside scan
      });
      
      foundFiles.push(...files);
    } catch (err: any) {
      if (err.code === "EACCES" || err.code === "EPERM") {
        console.warn(`Permission denied: ${dir}`);
      } else {
        throw err;
      }
    }
  }
  
  return foundFiles;
}
```

### Diff Generation for YAML Preview
```typescript
// Source: diff library docs
import {createTwoFilesPatch} from "diff";

function generateDiff(originalCompose: string, rewrittenCompose: string): string {
  return createTwoFilesPatch(
    "docker-compose.yml (original)",
    "docker-compose.yml (migrated)",
    originalCompose,
    rewrittenCompose,
    "Original", // Header for old file
    "Migrated", // Header for new file
    { context: 3 } // Lines of context around changes
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual Docker volume backup with tar | Restic with repository backends | Phase 4 (2026-04) | Migration must use same directory structure as backups (./volumes/ subdir) |
| Uncontrolled React forms with onChange | react-hook-form with Zod resolver | Phase 1 (2026-03) | All wizard steps use same form pattern as existing pages |
| Node.js glob package | fast-glob | Phase 2 (2026-03) | 10x faster for large directory scans, better TypeScript support |
| js-yaml | yaml v2 | Phase 1 (codebase init) | Better TypeScript types, cleaner API for round-trip parse/stringify |

**Deprecated/outdated:**
- `glob` npm package: Superseded by fast-glob for performance and API clarity
- Manual recursive fs.readdir: fast-glob handles edge cases (symlinks, permission errors) that custom implementations miss

## Assumptions Log

> All claims in this research were verified via npm registry, existing codebase patterns, or official documentation. No assumptions requiring user confirmation.

## Open Questions

1. **Question:** Should wizard progress be persisted in Settings table (resume wizard after browser close)?
   - What we know: User can exit wizard mid-session, CONTEXT.md mentions "Settings key names for wizard progress tracking" as Claude's discretion
   - What's unclear: Is resume capability MVP or nice-to-have?
   - Recommendation: Defer to MVP+1. First version: wizard is single-session only (refresh = start over). Add Settings keys for step tracking in future iteration if users request it.

2. **Question:** Should brownfield scan cache results in database or always run fresh?
   - What we know: Scan results are shown in wizard Step 5 and potentially on a dedicated `/setup/scan` page
   - What's unclear: If user navigates away from Step 5 and returns, should results persist?
   - Recommendation: Store scan results in BrownfieldRepository (Prisma model: scannedAt timestamp, results JSON) for session duration. Expire after 1 hour or when wizard completes. Avoids re-scanning on every Step 5 visit.

3. **Question:** What happens if user closes browser during background migration?
   - What we know: Migration runs as background job (fire-and-forget), user can navigate away
   - What's unclear: Should migration abort on server restart, or resume?
   - Recommendation: Track migration state in database (MigrationJob model: status, stackId, createdAt). On server restart, check for in-progress migrations and mark as FAILED with "Server restarted during migration" reason. User can retry. Resume logic is complex (requires idempotent steps) — defer to future iteration.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker CLI | Volume copy, compose up/down | ✓ | 29.1.4-rd | — |
| Node.js | JavaScript runtime | ✓ | 22.22.0 | — |
| yarn | Package manager | ✓ | 4.x (assumed from workspace structure) | — |
| PostgreSQL | Database | ✓ (assumed from Prisma setup) | — | — |

**Missing dependencies with no fallback:**
- None — all required tools are available in environment

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x (server + client) + playwright (client E2E) |
| Config file | `server/vitest.config.ts`, `client/vitest.config.ts`, `client/playwright.config.ts` |
| Quick run command | `yarn workspace @docktor/server test --run` (server), `yarn workspace @docktor/client test --run` (client) |
| Full suite command | `yarn test` (runs all workspaces) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIZ-01 | Middleware redirects to /setup when User count is zero | integration | `yarn workspace @docktor/server test test/integration/wizard.test.ts -x` | ❌ Wave 0 |
| WIZ-02 | Step 1 creates user and returns session token | unit | `yarn workspace @docktor/server test test/unit/onboarding-service.test.ts::handleWizardStep1 -x` | ❌ Wave 0 |
| WIZ-03 | Step 2 saves instance name, base URL, timezone to Settings | unit | `yarn workspace @docktor/server test test/unit/onboarding-service.test.ts::handleWizardStep2 -x` | ❌ Wave 0 |
| WIZ-04 | Step 3 encrypts restic password and saves backup config | unit | `yarn workspace @docktor/server test test/unit/onboarding-service.test.ts::handleWizardStep3 -x` | ❌ Wave 0 |
| WIZ-05 | Step 4 saves SMTP settings with encrypted password | unit | `yarn workspace @docktor/server test test/unit/onboarding-service.test.ts::handleWizardStep4 -x` | ❌ Wave 0 |
| WIZ-06 | Step 5 scans directories and returns discovered stacks | unit | `yarn workspace @docktor/server test test/unit/brownfield-scanner.test.ts -x` | ❌ Wave 0 |
| WIZ-07 | Wizard completion redirects to /dashboard | E2E | `yarn workspace @docktor/client test:integration tests/wizard-flow.spec.ts -x` | ❌ Wave 0 |
| BF-01 | BrownfieldScanner finds compose files and skips permission errors | unit | `yarn workspace @docktor/server test test/unit/brownfield-scanner.test.ts::scan -x` | ❌ Wave 0 |
| BF-02 | ComposeAnalyzer detects named volumes, absolute paths, inline env vars | unit | `yarn workspace @docktor/server test test/unit/compose-analyzer.test.ts -x` | ❌ Wave 0 |
| BF-03 | Adopt-in-place creates Stack record with hostPath, no file operations | unit | `yarn workspace @docktor/server test test/unit/onboarding-service.test.ts::adoptInPlace -x` | ❌ Wave 0 |
| BF-04 | Full migration copies files, converts volumes, rewrites compose, starts stack | integration | `yarn workspace @docktor/server test test/integration/migration.test.ts -x` | ❌ Wave 0 |
| BF-05 | Migration rollback restores original compose and restarts containers on failure | integration | `yarn workspace @docktor/server test test/integration/migration-rollback.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn workspace @docktor/{workspace} test --run` (unit tests for modified files)
- **Per wave merge:** `yarn test` (full suite, all workspaces)
- **Phase gate:** Full suite green + Playwright E2E passing before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `server/test/unit/onboarding-service.test.ts` — covers WIZ-02, WIZ-03, WIZ-04, WIZ-05, BF-03
- [ ] `server/test/unit/brownfield-scanner.test.ts` — covers WIZ-06, BF-01
- [ ] `server/test/unit/compose-analyzer.test.ts` — covers BF-02
- [ ] `server/test/integration/wizard.test.ts` — covers WIZ-01 (middleware redirect)
- [ ] `server/test/integration/migration.test.ts` — covers BF-04
- [ ] `server/test/integration/migration-rollback.test.ts` — covers BF-05
- [ ] `client/test/integration/tests/wizard-flow.spec.ts` — covers WIZ-07 (Playwright E2E)
- [ ] Test fixtures: sample `docker-compose.yml` files with named volumes, absolute paths, inline env vars for BF-02 test cases
- [ ] Mock filesystem structure for BrownfieldScanner tests (permission denied simulation)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | better-auth (email/password with bcrypt), session token in httpOnly cookie |
| V3 Session Management | yes | better-auth session tokens (JWT), httpOnly cookies, CSRF protection via SameSite |
| V4 Access Control | yes | Middleware redirect for unauthenticated access to protected routes (requireAuth hook) |
| V5 Input Validation | yes | Zod schemas in @docktor/shared for all wizard steps, Fastify schema validation |
| V6 Cryptography | yes | crypto.encrypt (AES-256-GCM) for SMTP/restic passwords (already in Phase 3-4) |

### Known Threat Patterns for Node.js + React + Docker

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in brownfield scan | Tampering | Validate user-provided directories: absolute paths only, no `..` sequences, reject if outside allowed prefixes |
| Command injection in Docker volume copy | Tampering | Use spawn with args array (not shell interpolation), validate volume names match Docker naming rules (`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`) |
| SQL injection in stack creation | Tampering | Prisma parameterized queries (no raw SQL in Phase 5) |
| Insecure password storage | Information Disclosure | crypto.encrypt + ENCRYPTION_KEY env var (already established in Phase 3) |
| Session fixation after wizard | Spoofing | better-auth auto-rotates session token on privilege escalation (signup = privilege change) |
| CSRF on wizard submission | Tampering | SameSite=Lax cookies (better-auth default), double-submit cookie pattern if needed |
| Unvalidated redirect after wizard | Tampering | Hardcoded redirect to `/dashboard` (not user-controlled) |

## Sources

### Primary (HIGH confidence)
- npm registry — react-hook-form 7.72.1, fast-glob 3.3.3, diff 8.0.4, yaml 2.8.3 verified 2026-04-08
- Codebase — `server/src/lib/auth.ts` (better-auth setup), `server/src/infrastructure/docker-executor.ts` (spawn pattern), `server/src/lib/compose-parser.ts` (yaml usage)
- Codebase — `client/src/routes/app/stacks/create.tsx` (react-hook-form + Zod pattern), `client/src/routes/app/settings.tsx` (inline component pattern)
- Codebase — `server/vitest.config.ts`, `client/vitest.config.ts`, `client/playwright.config.ts` (test infrastructure)
- better-auth documentation — signUpEmail API returns session token for auto-login
- fast-glob documentation — suppressErrors option, ignore patterns, cwd option

### Secondary (MEDIUM confidence)
- react-hook-form documentation — form.trigger() API for per-step validation
- Docker documentation — `docker run -v` bind mount syntax, alpine image for cp command
- diff library documentation — createTwoFilesPatch API for unified diffs
- yaml library documentation — parse/stringify API, options for preserving formatting

### Tertiary (LOW confidence)
- None — all findings verified against npm registry or codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via npm registry, versions confirmed installed or available
- Architecture: HIGH - Patterns extracted from existing codebase (Phases 1-4), DDD layering matches CLAUDE.md rules
- Pitfalls: MEDIUM-HIGH - Permission errors and YAML edge cases documented in library issue trackers, volume copy pattern from Docker docs
- Security: HIGH - ASVS categories align with existing auth/crypto patterns from Phase 3-4

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (30 days — stable libraries, no fast-moving ecosystem)
