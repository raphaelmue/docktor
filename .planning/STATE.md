---
gsd_state_version: 1.0
milestone: v1.0
current_phase: 02
current_phase_name: Observability
status: Phase 02 gap-closure complete — all 12 plans done (02-08 through 02-12 verified on real deployments)
stopped_at: Completed 02-14-PLAN.md
last_updated: "2026-08-28T20:11:28.946Z"
state_head: 6057a98dca5f49eeb3f8207bae24cdc3f4b4d62c
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 49
  completed_plans: 47
milestone_name: milestone
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Users can deploy, monitor, and manage Docker Compose stacks through a browser UI without needing SSH or Docker CLI access.
**Current focus:** Phase 02 — Observability

## Current Position

Phase: 02 (Observability) — EXECUTING
Plan: 3 of 4

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-mvp-completion P01 | 284 | 2 tasks | 6 files |
| Phase 01-mvp-completion P02 | 19 | 2 tasks | 8 files |
| Phase 01-mvp-completion P03 | 15 | 2 tasks | 4 files |
| Phase 01-mvp-completion P04 | 6 | 2 tasks | 5 files |
| Phase 01-mvp-completion P06 | 35 | 2 tasks | 7 files |
| Phase 01-mvp-completion P07 | 20 | 2 tasks | 5 files |
| Phase 01-mvp-completion P05 | 15 | 2 tasks | 5 files |
| Phase 02-observability P02 | 12 | 2 tasks | 6 files |
| Phase 02-observability P03 | 6 | 2 tasks | 4 files |
| Phase 02-observability P04 | 6 | 2 tasks | 5 files |
| Phase 02-observability P05 | 25 | 2 tasks | 9 files |
| Phase 02-observability P06 | 2 | 2 tasks | 2 files |
| Phase 02-observability P07 | 3 | 2 tasks | 8 files |
| Phase 02-observability P08 | - | 3 tasks | 13 files |
| Phase 03-notifications P01 | 12 | 2 tasks | 7 files |
| Phase 03-notifications P02 | 10 | 2 tasks | 10 files |
| Phase 03-notifications P03 | 10 | 2 tasks | 3 files |
| Phase 03-notifications P04 | 35 | 3 tasks | 3 files |
| Phase 03-notifications P05 | 52 | 2 tasks | 12 files |
| Phase 04-backup-restore P01 | 4 | 2 tasks | 6 files |
| Phase 04-backup-restore P02 | 2 | 2 tasks | 2 files |
| Phase 04-backup-restore P05 | 171 | 2 tasks | 5 files |
| Phase 04-backup-restore P04 | 2 | 1 tasks | 2 files |
| Phase 04 P06 | 15 | 3 tasks | 9 files |
| Phase 04-backup-restore P08 | 133 | 3 tasks | 1 files |
| Phase 04 P07 | 6 | 2 tasks | 0 files |
| Phase 04 P11 | 3 | 3 tasks | 1 files |
| Phase 04 P10 | 7 | 3 tasks | 2 files |
| Phase 04 P12 | 161 | 2 tasks | 4 files |
| Phase 04 P13 | 373 | 2 tasks | 4 files |
| Phase 04 P14 | 5 | 2 tasks | 2 files |
| Phase 05-onboarding P01 | 5 | 3 tasks | 6 files |
| Phase 05 P02 | 7 | 2 tasks | 4 files |
| Phase 05 P03 | 8 | 2 tasks | 4 files |
| Phase 05 P08 | 91 | 2 tasks | 2 files |
| Phase 05 P05 | 7 | 2 tasks | 4 files |
| Phase 05 P04 | 7 | 2 tasks | 4 files |
| Phase 05 P07 | 3 | 3 tasks | 5 files |
| Phase 05 P06 | 4 | 3 tasks | 4 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02-observability P13 | 25min | 2 tasks | 4 files |
| Phase 02-observability P14 | 15min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Single Fastify process: No separate frontend server; SSE via reply.hijack() + reply.raw
- YAML-first: Compose file on disk is source of truth; DB stores derived metadata only
- Bind mounts only: Named Docker volumes rejected; all data in ./volumes/ subdir
- [Phase 01-mvp-completion]: StatePoller accepts DockerodeClient and StackRepository via constructor for testability (not module-level mocks)
- [Phase 01-mvp-completion]: log-viewer tests use it.todo() for render-level assertions that need the component to exist
- [Phase 01-mvp-completion]: DockerodeClient uses factory pattern (not new) to support vi.fn() arrow function mocking in tests
- [Phase 01-mvp-completion]: vitest.config.ts regex resolve alias added to handle deep relative test imports (../../../../src/)
- [Phase 01-mvp-completion]: StatePoller uses lazy dynamic import() for StackRepository to avoid db.ts in module graph during unit tests
- [Phase 01-mvp-completion]: StatePoller TRANSITIONAL_STATES uses Set<string> (not StackStatus enum) to avoid importing missing prisma enums in test env
- [Phase 01-mvp-completion]: IANA timezone validation uses Intl.supportedValuesOf + Intl.DateTimeFormat fallback because some Node.js environments omit UTC from supportedValuesOf
- [Phase 01-mvp-completion Plan 06]: Native <select> HTML element used in LogViewer toolbar — Radix Select renders two role=combobox elements in jsdom; native select has exactly one as expected by tests
- [Phase 01-mvp-completion Plan 06]: afterEach(cleanup) explicitly added to test/setup.ts — React Testing Library v16 auto-cleanup requires vitest globals:true which is not configured
- [Phase 01-mvp-completion Plan 06]: Global EventSource stub added to test/setup.ts — jsdom lacks EventSource; component tests using useLogStream would throw without it
- [Phase 01-mvp-completion Plan 07]: Used radix-ui Popover directly (not shadcn CLI) for popover.tsx - consistent with existing dialog.tsx and select.tsx pattern
- [Phase 01-mvp-completion Plan 07]: TimezoneCombobox is unexported component in settings.tsx - no other page needs it in Phase 1
- [Phase 01-mvp-completion]: Added healthStatus to Service interface — SSE events include it but DB type was missing it
- [Phase 01-mvp-completion]: ServiceStatusBadge inline in [id].tsx — too small to warrant separate file
- [Phase 02-observability]: Used db push instead of migrate dev due to DB schema drift in dev environment — appropriate for dev without strict migration history
- [Phase 02-observability]: FileWatcher.stop() is async to properly await chokidar watcher.close() Promise
- [Phase 02-observability]: FileWatcherRepo uses composeFilePath/hash field names matching 02-01 test scaffold (not hostPath/lastKnownHash from plan spec)
- [Phase 02-observability]: Jobs registry pattern: all background jobs registered in jobs/index.ts; app.ts only calls startJobs/stopJobs
- [Phase 02-observability]: Date tag parsing runs before semver coerce in compareVersions() — semver.coerce('2024-01-01') yields '2024.0.0' losing month/day
- [Phase 02-observability]: getNextImageToCheck() exported as pure function matching 02-01 test scaffold; UpdateCheckerRepo interface uses test mock method names with production adapter in createProductionRepo()
- [Phase 02-observability]: DockerExecutor singleton export added (dockerExecutor) for UpdateChecker DI; existing code continues using new DockerExecutor() per service
- [Phase 02-observability]: clearConfigChanged() added to restartStack() success path — restart applies current config intent, clearing the flag is correct
- [Phase 02-observability]: GET /api/stacks/:id augments response inline with imageUpdateCheckRepository (route-level join) — keeps StackService free of cross-repo concerns
- [Phase 02-observability]: parseComposeContent throws for missing/empty services key instead of returning [] — enables FileWatcher catch block to broadcast config_error SSE events
- [Phase 02-observability]: FileWatcher calls replaceServices before updateStackHash — if service sync fails, hash stays stale and reconcile retries, ensuring data consistency
- [Phase 02-observability]: Update Images button uses inline async onClick instead of handleAction — handleAction discards return value, noUpdates detection requires reading the response
- [Phase 02-observability]: noUpdates detection: pullOutput.toLowerCase().includes('up to date') OR empty stdout — covers docker compose pull messages and edge cases
- [Phase 02-observability P08]: syncServicesFromCompose() writes only image/imageTag/ports/volumes on config-only sync — never touches containerId/containerState/healthStatus/restartCount, so StatePoller-owned runtime state survives an external compose edit; replaceServices() (deploy path) keeps its wipe-and-recreate semantics unchanged
- [Phase 02-observability P08]: chokidar ignored filter must key off stats?.isFile() defaulting falsy, not stats?.isDirectory() ?? false — the inverted form silently blocks all directory traversal (not just on Windows); root-caused via live diagnostic scripting after 3 other hypotheses were refuted
- [Phase 02-observability P08]: DOCKTOR_FS_POLLING env override added — process.platform inside the container is always "linux" even when the Docker host is Windows/Mac Desktop, so platform auto-detection can't see through Docker Desktop's virtualized bind mounts
- [Phase 02-observability P08]: BETTER_AUTH_URL (not DOCKTOR_BASE_URL) is the canonical env var per .env.example/.env.development/INTEGRATIONS.md/STACK.md; DOCKTOR_BASE_URL is separately confirmed dead code
- [Phase 02-observability P08]: DOCKTOR_STACKS_DIR/DOCKTOR_DATA_DIR/DOCKTOR_BACKUP_DIR moved from docker-compose.yml environment to fixed Dockerfile ENV — they're container-side mount points, not deployment-varying config
- [Phase 02-observability P08]: deployStack()/updateImages() now wrap all post-docker-call logic in try/catch that transitions to ERROR on failure — previously an unhandled failure there (compose re-parse, DB write) permanently wedged the stack in DEPLOYING/UPDATING with no recoverable action and no StatePoller self-heal
- [Phase 03-notifications]: AES-256-GCM storage format: iv(12 bytes) + tag(16 bytes) + ciphertext, all hex-encoded as single string
- [Phase 03-notifications]: getKey() validates both presence and exact 32-byte length of ENCRYPTION_KEY env var
- [Phase 03-notifications]: NotificationService.notify() delegates to this.settings.getSmtpConfig() — matches test scaffold mock expectations and separates config retrieval
- [Phase 03-notifications]: getSmtpConfig() added to SettingsService with decrypt support — SMTP config retrieval is a settings concern; NotificationSettings interface enables DI flexibility
- [Phase 03-notifications]: vi.hoisted() + vi.mock() used for ESM nodemailer mocking in vitest — vi.doMock cannot intercept already-loaded ESM modules
- [Phase 03-notifications]: NotificationWatcher constructor takes two positional args (notificationService, broadcaster) matching test scaffold — no stackRepo needed as displayName falls back to stackId
- [Phase 03-notifications]: DiskChecker uses combined settings object (getMany + findLastDiskAlert + setDiskAlertActive) and imports from ../application/index.js for production singletons
- [Phase 03-notifications]: Notifications Settings UI sub-components (SmtpCard, NotificationTriggersCard, NotificationLogCard) defined inline in settings.tsx — no other route needs them
- [Phase 03-notifications]: DOCKER_DATA_PATH env var for platform-specific disk monitoring (Windows: '.', Linux: '/var/lib/docker')
- [Phase 03-notifications]: notification_created SSE event type for real-time notification log updates
- [Phase 03-notifications]: SMTP 'from' field saved before password encryption to avoid silent save failures
- [Phase 04-backup-restore]: RESTORE added to BackupTrigger enum to track restore operations in Backup audit trail
- [Phase 04-backup-restore]: logLines String[] on Backup model stores restic stdout for detail page without extra table
- [Phase 04-backup-restore]: backupSettingsSchema superRefine validates conditional required fields per repoType (local/sftp/s3)
- [Phase 04-backup-restore]: ResticExecutor.run() uses positional args (args, env, onLine?) not ResticRunOptions object — matches test scaffold API contract
- [Phase 04-backup-restore]: buildBackupArgs omits 'backup' subcommand from returned array — test expects stackPath at args[0]
- [Phase 04-backup-restore]: BackupRepository.update() is unified method — test mock expects single update fn; named helpers also provided for production clarity
- [Phase 04-backup-restore]: BackupRepositoryCard and BackupDefaultsCard defined inline in settings.tsx following established inline sub-component pattern
- [Phase 04-backup-restore]: saveBackupSettings/saveBackupDefaults accept Record<string, unknown> to avoid coupling client to server schema for conditional fields
- [Phase 04-backup-restore]: BackupService.runBackup route fetches (backupRecord, stack, repoConfig) via Promise.all — actual signature differs from plan interface spec
- [Phase 04]: Action bar uses Deploy primary + ellipsis dropdown (per 04-CONTEXT locked decision)
- [Phase 04]: Section components co-located in routes/app/stacks/components/ (only used by stack detail page)
- [Phase 04-backup-restore]: ResticExecutor.run() throws Error with exitCode property on non-zero exit codes for proper error handling
- [Phase 04]: Prisma 7 requires --config flag when config is not in default location
- [Phase 04-11]: Fire-and-forget pattern for scheduled backup execution matches routes/backups.ts pattern
- [Phase 04-backup-restore]: ResticExecutor emits stderr lines to onLine callback with [stderr] prefix for UI diagnosis
- [Phase 04]: Breadcrumb preserves tab context for all non-overview tabs (not just backups)
- [Phase 04]: ScrollArea limited to h-96 (384px) for backup history table
- [Phase 04]: Snapshots sorted by time descending using Date.getTime() comparison
- [Phase 04]: Invalid restic commands removed entirely; TODO added for docker compose orchestration
- [Phase 04-backup-restore]: Use path.resolve() instead of path.join() for absolute path concatenation on Windows to prevent drive letter duplication
- [Phase 04-backup-restore]: Hide repository path field for local backend in Settings UI with informational alert - field is never used for local backups
- [Phase 04-14]: buildBackupArgs() excludes both /logs and /backups directories to prevent circular backup and log noise
- [Phase 05-01]: Per-step Zod schemas (wizardStep1Schema through wizardStep5Schema) for granular wizard validation
- [Phase 05-01]: Reuse backupSettingsSchema from Phase 4 for wizard step 3 (backup config)
- [Phase 05-01]: Server unit tests use expect(true).toBe(false) for RED state; E2E tests use test.skip()
- [Phase 05-03]: OnboardingService uses constructor DI for better-auth, settings, crypto, stack repo
- [Phase 05-05]: Custom WizardStepper component built instead of third-party to avoid registry safety gate
- [Phase 05-06]: Fire-and-forget migration pattern with toast notifications — modal closes immediately after user confirms, migration runs in background
- [Phase 02]: [Phase 02-observability P13]: noUpdates decision moved from free-text pull-output scanning to before/after local image digest comparison (imageDigest); toImageRef() duplicates buildImageRefFromService()'s normalization to keep domain/ free of jobs/'s module graph, guarded by a parity test
- [Phase 02]: [Phase 02-observability P14]: fetchStack(mode) replaces useStack's single fetch() — 'initial' mode preserves the existing loading/error behavior; 'background' mode (SSE handlers + refetch()) sets isRefreshing only and never touches loading or error, so a full-tree remount can no longer be triggered by a background refresh
- [Phase 02]: [Phase 02-observability P14]: StackDetailPage's placeholder early-return changed from 'if (loading)' to 'if (loading && !stack)' — reachable only before the first successful load, closing UAT gap G-02-12 (FW-02)

### Quick Tasks Completed

| ID | Description | Commit | Duration |
|----|-------------|--------|----------|
| Q001 | Fix restic restore target path (Windows permission error) | 75b8db2 | 10 min |
| Q002 | Fix restic to use relative paths for backup/restore | c0302fa | 20 min |
| Q003 | Complete restore operation with stop/restore/deploy cycle | 5f4839c | 30 min |

### Pending Todos

- [major] Document deployment config: clean .env and docker-compose.yml — `.planning/todos/pending/2026-08-27-document-deployment-config-clean-env-and-docker-compose.md`
- [blocker] Fix integration/e2e tests — `.planning/todos/pending/2026-08-28-fix-integration-e2e-tests.md`
- [major] config_error has no client-side handling or UI badge — `.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md`
- [major] Manual stack actions (deploy/stop/restart/update/backup/restore) never broadcast SSE status updates — `.planning/todos/pending/2026-08-28-manual-actions-dont-broadcast-sse.md`
- [minor] Service status badges show "unknown" for up to 60s after every deploy — `.planning/todos/pending/2026-08-28-container-status-unknown-after-deploy.md`
- [blocker] No schema sync step on container startup (fresh deploy 500s on missing tables) — `.planning/todos/pending/2026-08-28-no-schema-sync-on-container-startup.md`
- [major] No redirect to /setup wizard on first run — `.planning/todos/pending/2026-08-28-no-redirect-to-setup-wizard.md`
- [minor] Redesign UI/UX — service colors, tab layout, mobile support — `.planning/todos/pending/2026-08-28-redesign-ui-ux-service-colors-mobile.md`
- [minor] Add a sophisticated compose YAML editor and env editor — `.planning/todos/pending/2026-08-28-add-yaml-env-editor.md`
- [minor] Redesign dashboard with richer statistics — `.planning/todos/pending/2026-08-28-redesign-dashboard-statistics.md`
- [minor] Audit frontend for reusable-component refactors — `.planning/todos/pending/2026-08-28-frontend-refactor-audit.md`
- [minor] Add configurable docker-compose linting/formatting checks — `.planning/todos/pending/2026-08-28-configurable-compose-linting.md`
- [major] Backup can be triggered without a configured repo, wedging the stack in BACKING_UP forever — `.planning/todos/pending/2026-08-28-backup-without-config-wedges-stack.md`
- [blocker] Setup routes (scan/adopt/migration) are unauthenticated, and post-setup import has no UI — `.planning/todos/pending/2026-08-28-setup-routes-unauthenticated-no-postsetup-import.md`
- [major] Env file changes (via app or externally) never set the config-changed badge — `.planning/todos/pending/2026-08-28-env-file-changes-dont-flag-config-changed.md`
- [blocker] Docker-outside-of-Docker path mismatch resolves relative bind mounts to the wrong host location (likely breaks backups too) — `.planning/todos/pending/2026-08-28-dood-bind-mount-path-mismatch.md`
- [minor] Restic is installed via apt, pinning it to a 3+ year old version (0.14.0) — `.planning/todos/pending/2026-08-28-restic-version-pinned-too-old.md`
- [minor] No way to manually trigger an image update check (6h/N stagger blocks re-checks after a fix ships) — `.planning/todos/pending/2026-08-28-no-manual-update-check-trigger.md`
- [minor] "Update available" only shown per-service, never at the stack level — `.planning/todos/pending/2026-08-28-update-available-badge-missing-at-stack-level.md`
- [cosmetic] Stale ImageUpdateCheck rows never pruned when a service's tag changes — `.planning/todos/pending/2026-08-28-stale-imageupdatecheck-rows-never-pruned.md`
- [minor] Upgrade dialog shows "not checked yet" for a moving-tag service that was actually checked — `.planning/todos/pending/2026-08-28-upgrade-dialog-wrong-message-for-moving-tags.md`
- [minor] "Update available" badge shows even when there's no latestTag to point to — `.planning/todos/pending/2026-08-28-update-badge-shown-with-null-latest-tag.md`
- [minor] Support authenticated/private container registries for update checking — `.planning/todos/pending/2026-08-28-support-authenticated-custom-registries.md`

### Blockers/Concerns

- Phase 1: StatePoller must skip stacks in transitional states (DEPLOYING, UPDATING, BACKING_UP, RESTORING, MIGRATING) — use optimistic locking on DB writes. [Phase 02-observability P08]: this skip is unconditional with no staleness/timeout recovery — deployStack()/updateImages() were hardened to always exit their transitional state on failure, but a stack wedged by any other future bug still has no self-heal path. See also the deferred SSE-broadcast and unknown-status todos, which are downstream of this same skip.
- Phase 1: dockerode log stream on SSE client disconnect — RESOLVED in P06: request.raw.on('close', () => streams.forEach(s => s.destroy())) wired in /api/stacks/:id/logs route
- Phase 4: S3/SFTP restic backend auth has non-trivial patterns — may need /gsd:research-phase during Phase 4 planning
- Phase 6: NPM API is undocumented and version-sensitive — needs /gsd:research-phase before Phase 6 implementation begins
- [Phase 02-observability P10]: `ImageUpdateCheck.availableTags String?` was added to schema.prisma and `prisma generate` was run, but `yarn db:push` could not be run against a reachable database in the execution sandbox — must be run against the real dev/prod database before the next deploy, or `upsert` calls touching this column will fail at runtime (not at boot, since Prisma doesn't validate live schema at startup).
- [Phase 02-observability P12]: RESOLVED — Task 5 checkpoint approved 2026-08-28 after live verification against a real registry and Docker daemon. Verification itself surfaced and got two real registry-logic bugs fixed inline (RegistryClient pagination, selectUpgradeCandidates version-shape matching — commit f200351); several smaller gaps found along the way were deferred as todos instead (see Pending Todos).

## Session Continuity

Last session: 2026-08-28T20:11:28.700Z
Stopped at: Completed 02-14-PLAN.md
Resume file: None
