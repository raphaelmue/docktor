# Phase 5: Onboarding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 05-onboarding
**Areas discussed:** Wizard flow and structure, Wizard routing and auth bypass, Brownfield discovery and adoption, Migration safety and cleanup, Volume/compose handling

---

## Wizard flow and structure

| Option | Description | Selected |
|--------|-------------|----------|
| Required core + optional features | User must complete steps 1-2 (account + settings) to use Docktor. Steps 3-5 (backup, notifications, brownfield) can be skipped and configured later in Settings. | ✓ |
| All steps required, linear | User must go through all 5 steps in order. Can't skip any step — ensures complete setup before first use. | |
| Free navigation with validation at end | User sees all 5 steps but can jump to any step directly via step indicators (stepper component). Validates only when trying to finish. | |

**User's choice:** Required core + optional features

---

| Option | Description | Selected |
|--------|-------------|----------|
| Next/Back buttons (recommended) | Each step has Next/Back buttons. Next validates current step. On final step, button says "Finish". Standard wizard pattern. | |
| Clickable stepper with validation at end | Clickable progress indicator at top lets user jump between steps. Validates when clicking Finish. More flexible but can lead to incomplete setup. | |
| Forward-only (no back button) | Step-by-step navigation with no back button — force commit before advancing. Rarely used except for critical flows. | |

**User's choice:** Clickable stepper with next and back buttons
**Notes:** Hybrid approach combining both navigation methods

---

| Option | Description | Selected |
|--------|-------------|----------|
| Numbered steps with titles (recommended) | Linear stepper showing step numbers and titles. Example: "1. Account → 2. Settings → 3. Backup → 4. Notifications → 5. Import". Current step highlighted. | ✓ |
| Progress dots without labels | Progress dots/circles without titles. "● ● ○ ○ ○" pattern. More compact but less informative. | |
| Progress bar with percentage | Percentage-based progress bar ("40% complete"). Clean but gives no context about what steps remain. | |

**User's choice:** Numbered steps with titles (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Skip button per optional step | Each optional step (3-5) has a "Skip" button. User explicitly skips, lands on next step. Clear intent. | ✓ |
| Collapsible optional section | Optional steps are in a collapsible "Advanced" section after step 2. User expands to configure or ignores to skip. Less clutter. | |
| Single prompt after required steps | After step 2 completes, show modal: "Setup complete! Configure backup/notifications now or later?" with Continue/Skip buttons. One decision point. | |

**User's choice:** Skip button per optional step

---

## Wizard routing and auth bypass

| Option | Description | Selected |
|--------|-------------|----------|
| Middleware redirect based on user count (recommended) | Server checks User count on every request. If zero, redirects to /setup. After user creation, /setup redirects to dashboard. Clean separation. | ✓ |
| Conditional rendering at root route | Root route (/) checks user count and conditionally renders <SetupWizard> or <LoginPage>. Setup and login share the same route with conditional rendering. | |
| Manual /setup route (no redirect) | Dedicated /setup route always accessible. User manually visits /setup, creates account, then visits /login. No automatic redirect. | |

**User's choice:** Middleware redirect based on user count (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Public /setup, auto-login after step 1 (recommended) | /setup is public (no requireAuth hook). Step 1 creates user via better-auth signup, then logs them in automatically. Subsequent steps are authenticated. Standard flow. | ✓ |
| Fully unauthenticated wizard, manual login after | /setup runs entirely without auth. Creates user in step 1 but doesn't log in until wizard completes. After finish, redirects to /login. Simpler but extra login step. | |
| Conditional auth bypass (only when no users) | /setup bypasses auth only if User count == 0. Once first user exists, /setup requires auth (for re-running wizard later). Flexible but adds complexity. | |

**User's choice:** Public /setup, auto-login after step 1 (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Block /setup access after completion (recommended) | After wizard finish, /setup redirects to /dashboard. Middleware stops redirecting to /setup once User count > 0. Visiting /setup directly shows "Setup already complete" message. | ✓ |
| Allow re-running wizard (reconfigure mode) | After wizard, /setup remains accessible for re-running setup or resetting instance. Wizard detects existing user and changes to "Reconfigure" mode. | |
| Remove /setup route after first user | After wizard, /setup route is deleted from router entirely (conditional route registration). Prevents accidental access. Requires restart to re-enable. | |

**User's choice:** Block /setup access after completion (recommended)

---

## Brownfield discovery and adoption

| Option | Description | Selected |
|--------|-------------|----------|
| User-specified directories (recommended) | Scan user-specified directories only (e.g., /home, /opt, /srv). User enters paths in wizard step 5. No automatic full-disk scan — prevents permission errors and long scan times. | ✓ |
| Preset common locations | Scan common self-hosting locations: /home/*/docker, /opt/*, /srv/*, /var/lib/docker/volumes (if accessible). Fixed list, no user input. Fast but may miss custom locations. | |
| Full filesystem scan with exclusions | Scan entire filesystem recursively, excluding /proc, /sys, /dev. Thorough but slow and may hit permission errors. Shows progress bar during scan. | |

**User's choice:** User-specified directories (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Traffic light scoring (green/yellow/red) (recommended) | Green (ready): bind mounts only, no inline env vars. Yellow (manual migration needed): named volumes or inline env. Red (unsupported): advanced features like configs, secrets. Badge with icon + hover tooltip. | ✓ |
| Binary compatible/incompatible | Simple binary: Compatible or Incompatible. Compatible = can adopt in-place. Incompatible = must migrate. No middle ground. Clear but less informative. | |
| Numeric score with breakdown | Numbered score (0-100). 100 = perfect, 75-99 = adoptable with warnings, <75 = migration required. Detailed breakdown of what reduced score (volumes, env, ports, etc.). | |

**User's choice:** Traffic light scoring (green/yellow/red) (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate flows, user chooses (recommended) | Scan results table has two action buttons per stack: "Adopt in-place" (always available) and "Migrate" (always available). User chooses based on compatibility badge and their preference. Guidance text explains difference. | ✓ |
| Auto-decide based on compatibility | Single "Import" button per stack. System auto-decides: green stacks → adopt in-place, yellow/red → force migration. User has no choice but gets predictable behavior. | |
| Decision wizard per stack | Single "Import" button opens a wizard with: Step 1: show compatibility, Step 2: user chooses adopt or migrate, Step 3: confirmation. Guided but adds extra step. | |

**User's choice:** Two separate flows, user chooses (recommended)

---

## Migration safety and cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic on failure (recommended) | Auto-rollback on any error (copy failed, docker compose up failed, file not found). Restores from backup copy, restarts old stack. User sees error toast + option to retry. | ✓ |
| Manual rollback with button | Migration creates backup but doesn't auto-rollback. If migration fails, user sees error + "Rollback" button. Manual confirmation required to restore. | |
| No rollback (migration is non-destructive) | No rollback capability. If migration fails, old files remain untouched (migration never deletes originals). User manually fixes or re-migrates. | |

**User's choice:** Automatic on failure (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt user to keep or delete (recommended) | After successful migration, show success modal: "Migration complete! Old files preserved at [path]. Delete them?" with "Keep" / "Delete" buttons. Explicit user choice. | ✓ |
| Always keep old files | Leave old files in place permanently. Migration never deletes originals. User manually cleans up via SSH if desired. Safest but leaves disk clutter. | |
| Auto-archive then delete originals | After migration succeeds, archive old files to /tmp/docktor-migration-backup-[timestamp].tar.gz, then delete originals. Auto-cleanup with safety net. | |

**User's choice:** Prompt user to keep or delete (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Modal with live progress steps (recommended) | Modal with step-by-step progress: "Stopping stack... Copying files... Converting volumes... Starting stack..." Each step shows spinner or checkmark. User waits in modal until complete. | |
| Background migration with notification | Migration runs in background. Toast says "Migration started". User navigates away. Notification sent when complete (or dashboard auto-updates if on that page). | ✓ |
| Detailed log page (power user mode) | Full-page migration view with detailed log output (like backup detail page). Shows every file copied, every docker command run. For advanced users who want visibility. | |

**User's choice:** Background migration with notification

---

## Volume and compose handling

| Option | Description | Selected |
|--------|-------------|----------|
| Convert named volumes to bind mounts (recommended) | Migration copies data from Docker named volumes to ./volumes/ subdirs, rewrites compose to use bind mounts. Aligns with Docktor's bind-mount-only architecture. Requires docker cp or volume data extraction. | |
| Keep named volumes, track externally | Migration keeps named volumes as-is (external: true in compose). Docktor tracks them but doesn't back them up. Easier migration but breaks backup assumption. | |
| Block named volumes entirely | Stacks with named volumes marked incompatible (red). User must manually convert before adopting. Enforces architecture but adds friction. | |

**User's choice:** Let user decide which to convert and which not (with warning)
**Notes:** User choice per volume with checklist. Sometimes named volumes are necessary and should remain.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Normalize all to ./volumes/ subdirs (recommended) | Absolute paths like /data/myapp → copy data to ./volumes/myapp, rewrite to ./volumes/myapp. Relative paths like ./data → copy to ./volumes/data. All paths become relative bind mounts under /stacks/[id]/volumes/. | |
| Keep absolute paths, copy relative | Absolute paths stay absolute but tracked (warning: not backed up). Relative paths copied to ./volumes/. Mixed approach — preserves user intent but complicates backup. | |
| Warn on absolute, exclude from backup | Any absolute paths → mark stack yellow, require user confirmation. Absolute paths excluded from backup with visible warning (BCK-07 pattern from Phase 4). | |

**User's choice:** Let user decide which to copy/move, warn on absolutes
**Notes:** Checklist per bind mount path. Absolute paths get warning badge.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Rewrite compose file automatically (recommended) | For each volume marked for conversion: update volume path in compose, create .env entry if path was templated. Write new docker-compose.yml + .env to /stacks/[id]/. Original compose backed up. | |
| Show diff preview, require approval | Show user a diff preview before migration: "These changes will be made to your compose file..." User reviews + confirms before rewrite happens. More transparent. | ✓ |
| Editable compose in migration wizard | Migration wizard has a text editor step showing the new compose file. User can manually edit before finalizing. Power-user mode. | |

**User's choice:** Show diff preview, require approval

---

| Option | Description | Selected |
|--------|-------------|----------|
| DB record only, no file changes (recommended) | Adopt creates a Stack DB record pointing to the existing directory. No files moved. Compose file must already use relative bind mounts. Zero downtime — containers keep running. | ✓ |
| Copy compose, symlink volumes | Adopt copies compose + .env to /stacks/[id]/, creates symlinks from volumes/ back to original paths. Centralizes compose file but preserves data location. | |
| Move directory, restart containers | Adopt moves entire directory to /stacks/[id]/, updates container volume mounts via docker compose down/up. Brief downtime but full integration. | |

**User's choice:** DB record only, no file changes (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Extract to .env automatically (recommended) | Parse compose, extract all environment: key-value pairs to .env file, replace with environment: ${KEY} references. Rewrites compose to use .env pattern (Docktor standard). | ✓ |
| Optional extraction with preview | Stacks with inline env marked yellow. Migration wizard shows: "Found N inline env vars. Extract to .env?" with preview. User approves extraction. | |
| Keep inline, .env editor separate | Leave inline env as-is. Docktor's env editor UI doesn't show them (only edits .env). User must manually move to .env to manage via UI. | |

**User's choice:** Extract to .env automatically (recommended)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-step wizard (volume selection → diff → confirm) (recommended) | Click Migrate → Step 1: Volume conversion checklist (named volumes + bind mounts, checkboxes per item). Step 2: Diff preview. Step 3: Confirm + start. Progress runs in background. | ✓ |
| Single scrollable modal | Click Migrate → Single modal with: volume checklist (top), diff preview (middle), confirm button (bottom). All-in-one view, scroll to review. | |
| Inline editing in diff view | Click Migrate → Immediately show diff + auto-selected conversions. User edits selections inline in diff. Confirm starts migration. Fast but less guided. | |

**User's choice:** Multi-step wizard (volume selection → diff → confirm) (recommended)

---

## Claude's Discretion

Areas where user deferred to Claude for implementation details:
- Exact YAML diff library choice
- Wizard step validation schema structure
- Settings key names for wizard progress tracking
- Docker volume data copy command implementation
- Error boundary behavior for mid-migration browser close
- Scan results table column design and metadata display
- Whether brownfield scan is a separate page or embedded in wizard
