---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Completed 04-11-PLAN.md
last_updated: "2026-04-01T09:11:14.219Z"
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 29
  completed_plans: 28
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Users can deploy, monitor, and manage Docker Compose stacks through a browser UI without needing SSH or Docker CLI access.
**Current focus:** Phase 04 — backup-restore

## Current Position

Phase: 04 (backup-restore) — EXECUTING
Plan: 4 of 8

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: StatePoller must skip stacks in transitional states (DEPLOYING, UPDATING, BACKING_UP, RESTORING, MIGRATING) — use optimistic locking on DB writes
- Phase 1: dockerode log stream on SSE client disconnect — RESOLVED in P06: request.raw.on('close', () => streams.forEach(s => s.destroy())) wired in /api/stacks/:id/logs route
- Phase 4: S3/SFTP restic backend auth has non-trivial patterns — may need /gsd:research-phase during Phase 4 planning
- Phase 6: NPM API is undocumented and version-sensitive — needs /gsd:research-phase before Phase 6 implementation begins

## Session Continuity

Last session: 2026-04-01T09:11:14.212Z
Stopped at: Completed 04-11-PLAN.md
Resume file: None
