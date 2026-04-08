# Phase 5: Onboarding - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Guide new users through initial setup with a multi-step wizard (account creation, settings, optional backup/notifications config, optional brownfield scan) and enable existing self-hosters to adopt or migrate their running Docker Compose stacks into Docktor. No new stack management capabilities beyond import — builds on existing CRUD, state machine, and settings from Phases 1-4.

</domain>

<decisions>
## Implementation Decisions

### Wizard flow structure
- **Required steps:** Steps 1-2 (account creation + basic settings: instance name, base URL, timezone) must be completed
- **Optional steps:** Steps 3-5 (backup config, notification config, brownfield scan) can be skipped via "Skip" button on each step
- **Navigation:** Clickable numbered stepper with step titles at top (e.g., "1. Account → 2. Settings → 3. Backup → 4. Notifications → 5. Import"). User can click stepper to jump between steps OR use Next/Back buttons for linear flow
- **Progress indicator:** Numbered steps with titles (not dots, not percentage bar) — shows context of what's ahead
- **Skip UX:** Each optional step (3-5) has its own "Skip" button in the footer alongside Next/Back

### Wizard routing and authentication
- **Entry mechanism:** Server middleware checks User count on every request. If zero users exist, redirect to `/setup`. After first user created, middleware stops redirecting
- **Auth bypass:** `/setup` route is public (no `requireAuth` hook). Step 1 creates user via better-auth signup API and **auto-logs them in** after creation. Steps 2-5 run with the user authenticated
- **Post-wizard:** After wizard completes (user clicks Finish on last step OR skips remaining optional steps), redirect to `/dashboard`. If user manually visits `/setup` after completion, show "Setup already complete" message with link to dashboard (no re-run capability)

### Brownfield scan mechanics
- **Directory selection:** Wizard step 5 presents text inputs for user to specify directories to scan (e.g., `/home`, `/opt`, `/srv`). Default suggestions shown but user enters paths. No automatic full-disk scan — prevents permission errors and long scan times
- **Scan execution:** Recursive search for `docker-compose.yml` (or `compose.yaml`, `docker-compose.yaml`) in user-specified directories. Excludes `/proc`, `/sys`, `/dev` if user accidentally includes them
- **Permission errors:** Gracefully skip directories that can't be read (log warning, continue scan). Show count of skipped directories in results summary

### Compatibility assessment
- **Scoring system:** Traffic light badges for each discovered stack:
  - **Green (Ready):** Uses only relative bind mounts (e.g., `./data:/app/data`), no named volumes, no inline env vars
  - **Yellow (Manual migration recommended):** Has named volumes OR absolute bind mount paths OR inline environment variables
  - **Red (Unsupported):** Uses advanced Docker Compose features not supported by Docktor (configs, secrets, depends_on with conditions, external networks beyond simple `external: true`)
- **Display:** Badge with icon + color + hover tooltip explaining what makes it green/yellow/red

### Adopt-in-place vs full migration
- **Two separate flows:** Scan results table shows two action buttons per discovered stack:
  - **"Adopt in-place"** (always available): Creates Docktor DB record pointing to existing directory path. No files moved, no compose rewrite, no container restart. Zero downtime. Stack appears in dashboard immediately with live status
  - **"Migrate"** (always available): Multi-step wizard (see below) that copies/moves files, converts volumes, rewrites compose, and imports into `/stacks/[id]/`
- **User choice:** User decides which flow to use based on compatibility badge and guidance text: "Green stacks can be adopted in-place safely. Yellow/red stacks should be migrated for full Docktor compatibility (backups, env editing)."

### Volume handling during migration
- **Named volumes:** Migration wizard Step 1 presents a checklist of all named volumes found in compose. Each volume has:
  - Checkbox (default: checked for conversion)
  - Volume name
  - Warning text: "If unchecked, this volume will remain a Docker volume (not backed up by Docktor)"
  - User can uncheck volumes that must stay as named volumes (e.g., shared across stacks)
- **Checked volumes:** Data copied from Docker volume to `/stacks/[id]/volumes/[volume-name]/` via `docker run --rm -v source:/source -v dest:/dest alpine cp -a /source/. /dest/`. Compose rewritten to use `./volumes/[volume-name]` bind mount
- **Unchecked volumes:** Remain as named volumes with `external: true` added to compose. Backup warnings shown in Docktor UI (BCK-07 pattern from Phase 4)

### Bind mount path handling during migration
- **Relative paths** (e.g., `./data`, `./config`): Migration wizard Step 1 checklist includes these with:
  - Checkbox (default: checked for copy/move)
  - Original path
  - Warning: "If unchecked, will be tracked but not backed up"
- **Checked relative paths:** Data copied to `/stacks/[id]/volumes/[dirname]/`, compose rewritten to relative path under `./volumes/`
- **Unchecked relative paths:** Rewrite compose to use original relative path (if outside stack directory), add backup exclusion warning
- **Absolute paths** (e.g., `/mnt/nas/data`, `/var/lib/myapp`): Always shown in checklist with **warning badge**: "Absolute path — not recommended for Docktor". User can check to copy data to `./volumes/` or uncheck to leave as-is (tracked but not backed up, BCK-07 warning shown)

### Compose file modification
- **Rewrite triggers:** Any checked volume in migration wizard Step 1 triggers compose rewrite. Inline env vars always trigger extraction
- **Step 2 — Diff preview:** After user confirms volume selections in Step 1, wizard shows side-by-side diff:
  - Left: original `docker-compose.yml`
  - Right: rewritten compose (volume paths updated, inline env vars replaced with `${VAR}` references)
  - Below diff: new `.env` file content (extracted env vars)
- **User approval required:** Step 2 has "Back" (returns to Step 1 checklist) or "Confirm & Migrate" buttons. Migration does not start without explicit approval of diff
- **Inline environment variables:** Automatically extracted to `.env` file. All `environment: key: value` entries become `environment: - ${KEY}` references. `.env` file created with extracted values. User sees this in diff preview

### Migration wizard UI flow
- **Step 1 — Volume selection:**
  - Checklist of named volumes (if any) with conversion checkboxes
  - Checklist of bind mount paths (relative + absolute) with copy/move checkboxes
  - Warning badges for absolute paths and unchecked items
  - Next button → proceeds to Step 2
- **Step 2 — Diff preview:**
  - Side-by-side diff of compose file changes
  - New `.env` file preview below diff
  - Back button → returns to Step 1 for adjustments
  - "Confirm & Migrate" button → starts background migration
- **Step 3 (implicit) — Background execution:**
  - Migration runs in background (not blocking modal)
  - Toast notification: "Migration started for [stack name]"
  - User can navigate away or stay on scan results page
  - On completion: toast notification "Migration complete" OR "Migration failed — rollback executed"

### Migration safety and rollback
- **Backup before migration:** Before stopping containers or modifying files, create temporary backup:
  - Copy entire source directory to `/tmp/docktor-migration-backup-[stackId]-[timestamp]/`
  - Store original compose file path for restoration
- **Automatic rollback on failure:** If any step fails (copy error, docker compose up fails, file permission error):
  - Restore original compose file to source directory
  - Restart containers at original location via `docker compose up -d`
  - Delete incomplete `/stacks/[id]/` directory
  - Show error toast with failure reason + "Rollback complete — your original stack is running"
- **Post-success cleanup:** After migration succeeds and new stack is running in `/stacks/[id]/`:
  - Show modal: "Migration complete! Old files preserved at [original path]. Delete them or keep as backup?"
  - Buttons: "Keep files" (closes modal) / "Delete old files" (removes original directory after confirmation)
  - If user chooses Delete: secondary confirmation dialog with typed stack name (same pattern as restore confirmation in Phase 4)

### Migration progress display
- **Background execution:** Migration does not block UI. Starts when user clicks "Confirm & Migrate" in Step 2, then immediately returns to scan results page
- **Toast notifications:** 
  - On start: "Migrating [stack name]..."
  - On success: "Migration complete! [stack name] is now managed by Docktor" with "View stack" link to detail page
  - On failure: "Migration failed — rollback complete. Your original stack is still running." with "View error" link to error details
- **Dashboard integration:** If user navigates to dashboard during migration, new stack appears with DEPLOYING status (uses existing state machine), transitions to RUNNING when containers are up

### Claude's Discretion
- Exact YAML diff library choice (jsdiff, diff-match-patch, or custom)
- Wizard step validation schema structure (single Zod schema vs per-step schemas)
- Settings key names for wizard progress tracking (if user exits mid-wizard and returns later)
- Docker volume data copy command details (docker run alpine vs docker volume inspect + rsync)
- Error boundary behavior if user closes browser mid-migration (graceful continuation vs abort)
- Scan results table column design (what metadata to show: service count, image count, directory size)
- Whether brownfield scan is a separate page (`/setup/scan`) or always embedded in wizard step 5

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §First-Run Wizard — WIZ-01 through WIZ-07 (all first-run wizard requirements)
- `.planning/REQUIREMENTS.md` §Brownfield Import — BF-01 through BF-05 (all brownfield import requirements)

### Architecture constraints
- `.planning/PROJECT.md` §Context — "YAML-first: compose file on disk is source of truth"
- `.planning/PROJECT.md` §Context — "Bind mounts only: named Docker volumes are rejected; all data in ./volumes/ subdir"
- `.planning/PROJECT.md` §Key Decisions — Table row: "Bind mounts only (no named volumes)" with rationale

### Prior phase patterns
- `.planning/phases/04-backup-restore/04-CONTEXT.md` <decisions> §Restore flow — Typed stack name confirmation pattern for destructive operations
- `.planning/phases/04-backup-restore/04-CONTEXT.md` <code_context> — Background async operation with toast + notification pattern
- `.planning/phases/01-mvp-completion/01-CONTEXT.md` <code_context> — Settings page tabs pattern, requireAuth hook usage

### Existing auth
- `server/src/routes/auth.ts` — better-auth integration via `toNodeHandler(auth)`
- `server/src/lib/auth.ts` — auth instance configuration
- `server/prisma/schema/auth.prisma` — User model structure

No external specs — requirements fully captured in REQUIREMENTS.md and decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/lib/auth-middleware.ts`: `requireAuth` hook — `/setup` route explicitly excludes this
- `server/src/lib/auth.ts`: better-auth instance — use `auth.api.signUpEmail` for step 1 user creation
- `server/src/repositories/settings-repository.ts`: `upsertSetting()` — reuse for wizard progress tracking (if needed)
- `server/src/domain/compose-parser.ts`: parse compose YAML — use for volume/env extraction during migration
- `server/src/infrastructure/docker-executor.ts`: `DockerExecutor` — reuse for `docker compose up` after migration
- `server/src/infrastructure/stack-filesystem.ts`: `StackFilesystem` — extend with migration file operations
- `client/src/components/ui/`: `Stepper` component (if exists) or install from shadcn — use for wizard progress indicator
- `client/src/components/common/layout/page.tsx`: `Page` layout components — `/setup` uses same layout shell
- `client/src/routes/app/settings.tsx`: Multi-tab settings pattern — wizard steps use similar Card-based sectioned layout

### Established Patterns
- **Middleware redirect pattern:** Check in `server/src/app.ts` `onRequest` hook before routes execute
- **Public routes:** Auth routes (`/api/auth/*`) already exclude `requireAuth` — follow same pattern for `/setup` and `/api/setup/*`
- **Toast notifications:** `client/src/lib/notifications-api.ts` pattern — async operations show toast.promise() with loading/success/error
- **Confirmation modals:** Restore confirmation from Phase 4 uses `AlertDialog` + typed name input — reuse for migration cleanup
- **Background jobs:** Phase 4 backup scheduler pattern — migration can use similar fire-and-forget spawn for long-running file operations
- **State machine:** Stack transitions to DEPLOYING during migration (existing state), then RUNNING when complete

### Integration Points
- **Server:** New route file `server/src/routes/setup.ts` (registered in `server/src/app.ts`, public)
- **Server:** New application service `server/src/application/onboarding-service.ts` (brownfield scan + migration orchestration)
- **Server:** New repository `server/src/repositories/brownfield-repository.ts` (scan results caching, migration state tracking)
- **Client:** New route `client/src/routes/setup.tsx` (wizard page, rendered when user count == 0)
- **Client:** New route `client/src/routes/setup/scan.tsx` (brownfield scan results, accessible from wizard step 5)
- **Client:** New API client `client/src/lib/setup-api.ts` (wizard submission, scan trigger, migration trigger)
- **Middleware:** Modify `server/src/app.ts` to add user-count check redirect before auth middleware

</code_context>

<specifics>
## Specific Ideas

- **Volume checklist with warnings:** User explicitly chooses which named volumes to convert and which to keep. Prevents forced conversion of volumes that legitimately need to stay as Docker volumes (e.g., shared database volumes, external storage).
- **Diff preview approval:** User sees exactly what will change in their compose file before migration starts. This transparency builds trust and prevents surprises.
- **Background migration with notifications:** Migration doesn't block the UI. User can explore Docktor (dashboard, settings) while migration runs. Notification on completion keeps them informed.
- **Typed name confirmation for cleanup:** After successful migration, deleting old files requires typing the stack name. Same high-friction pattern as Phase 4 restore — appropriate for destructive file operations.
- **Auto-rollback on failure:** If migration fails at any step, automatic restoration of original state with containers restarted. No manual intervention needed — user's original stack is safe.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-onboarding*
*Context gathered: 2026-04-08*
