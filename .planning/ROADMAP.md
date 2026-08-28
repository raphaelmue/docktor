# Roadmap: Docktor

## Overview

Docktor's foundation (auth, stack CRUD, state machine, dashboard, detail page) is fully shipped. This roadmap covers Milestone 2: completing the product from functional to compelling. The path begins with the three remaining MVP blockers (settings, container state poller, live log streaming), then extends the platform with observability, notifications, backup/restore, onboarding, and proxy configuration — each phase delivering a complete, independently verifiable capability.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: MVP Completion** - Complete the three remaining blockers: settings persistence, container state poller, and live log streaming
- [x] **Phase 2: Observability** - Detect external compose file changes and surface image update availability (completed 2026-08-28, including gap-closure plans 02-08 through 02-12)
- [x] **Phase 3: Notifications** - Alert users on container errors, disk warnings, and backup failures via SMTP (completed 2026-03-20)
- [ ] **Phase 4: Backup & Restore** - Enable encrypted, versioned stack backups with manual and scheduled restore
- [x] **Phase 5: Onboarding** - Guide new installs through setup with a first-run wizard and adopt existing stacks via brownfield import (completed 2026-04-08)
- [ ] **Phase 6: Proxy Configuration** - Configure domain and TLS for services via Nginx Proxy Manager integration

## Phase Details

### Phase 1: MVP Completion

**Goal**: Users can observe real-time container status and stream live logs, with instance configuration persisted in the database
**Depends on**: Nothing (builds on existing foundation)
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07, OBS-08, OBS-09, SET-01, SET-02, SET-03
**Success Criteria** (what must be TRUE):

  1. Stack and service status updates automatically in the UI without a page refresh when containers start, stop, die, or change health state
  2. User can open a log viewer for any service and see the last 100 lines immediately, followed by live output as it arrives
  3. Log viewer renders colored ANSI output and prefixes each line with the service name; user can filter by service in the combined view
  4. Browser reconnects to the log stream automatically if the SSE connection drops
  5. User can set instance name, base URL, and timezone on a Settings page and have those values survive a server restart

**Plans**: 7 plans

Plans:

- [ ] 01-01-PLAN.md — Test scaffolds (Wave 0 RED state for all 12 requirements)
- [ ] 01-02-PLAN.md — Server foundation: DockerodeClient, StateBroadcaster, Settings backend
- [ ] 01-03-PLAN.md — StatePoller job: Docker event stream + 60s reconciliation + app wiring
- [ ] 01-04-PLAN.md — Shared settings validation schemas + cmdk/Command component install
- [ ] 01-05-PLAN.md — State SSE route + useContainerEvents + dashboard/detail live updates
- [x] 01-06-PLAN.md — Log SSE route + LogViewer component + Logs tab
- [x] 01-07-PLAN.md — Settings page UI + sidebar nav + router registration

### Phase 2: Observability

**Goal**: Users are passively informed when compose files change externally and when newer container images are available
**Depends on**: Phase 1
**Requirements**: FW-01, FW-02, FW-03, UPD-01, UPD-02, UPD-03, UPD-04
**Success Criteria** (what must be TRUE):

  1. When a compose file is edited via SSH while Docktor is running, the stack's "config changed" badge appears without the user refreshing the page
  2. Stack detail page shows an "update available" badge when a newer image version is found in the registry
  3. User can trigger an image pull and container recreate from the stack detail page; the update is never applied automatically
  4. Registry polling does not hit Docker Hub rate limits during normal operation (results cached, checks staggered)

**Plans**: 13/16 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Test scaffolds (Wave 0 RED state for FW-01/02/03 and UPD-01/02/04)
- [x] 02-02-PLAN.md — DB schema (StackEvent + ImageUpdateCheck) + StateBroadcaster extension + repositories
- [x] 02-03-PLAN.md — FileWatcher job (chokidar + 60s reconcile) + jobs/index.ts registry
- [x] 02-06-PLAN.md — Gap closure: FileWatcher service sync + parser error handling
- [x] 02-07-PLAN.md — Gap closure: test mock fixes, compose-parser throw tests, Update Images UX feedback
- [x] 02-08-PLAN.md — Gap closure (UAT gap 1): runtime-state-preserving service sync in FileWatcher; parser sequence guard
- [x] 02-09-PLAN.md — Gap closure (UAT gap 4a): currentDigest, imageRef splitting, badge lookup key

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-04-PLAN.md — UpdateChecker job (staggered registry polling, semver/date/digest) + manifestInspect()
- [x] 02-10-PLAN.md — Gap closure (UAT gap 4b): RegistryClient tag listing, live latestTag comparison, tags route

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-05-PLAN.md — Stack detail badges (config changed, update available) + POST /update route + UI
- [x] 02-11-PLAN.md — Gap closure (UAT gap 5a): compose version rewrite, upgrade endpoint, rollback

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-12-PLAN.md — Gap closure (UAT gap 5b): version-selection dialog, services-tab extraction

**Re-verification gap closure — Wave 1** *(UAT 2026-08-28, plans 02-13 through 02-16)*

- [x] 02-13-PLAN.md — Gap closure (G-02-11): digest-based noUpdates detection replaces the pull-output text scrape
- [ ] 02-14-PLAN.md — Gap closure (G-02-12): useStack background refresh no longer remounts the detail page

**Re-verification gap closure — Wave 2** *(blocked on 02-13)*

- [ ] 02-15-PLAN.md — Gap closure (G-02-16): GET /api/stacks/:id/events + single StackEvent write path

**Re-verification gap closure — Wave 3** *(blocked on 02-14 and 02-15)*

- [ ] 02-16-PLAN.md — Gap closure (G-02-16): stack events API client, hook, Event Log card, Status Log extraction

### Phase 3: Notifications

**Goal**: Users receive email alerts for critical events (container errors, disk pressure, backup failures) without needing to watch the UI
**Depends on**: Phase 1, Phase 2
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06
**Success Criteria** (what must be TRUE):

  1. User can configure SMTP connection details in Settings and verify them with a test send
  2. User receives an email when a stack enters ERROR or UNHEALTHY state, including stack name, state, and recent log lines
  3. User receives an email when disk space drops below 10% or 2 GB remaining
  4. User can individually enable or disable each notification trigger in Settings

**Plans**: 5 plans

Plans:

- [x] 03-01-PLAN.md — Prisma schema (Notification + StackIncident) + AES-256-GCM crypto module + RED test scaffolds
- [x] 03-02-PLAN.md — NotificationRepository + NotificationService + SMTP/trigger/log API routes
- [x] 03-03-PLAN.md — NotificationWatcher (StateBroadcaster subscriber) + DiskChecker (24h cron) + jobs registration
- [x] 03-04-PLAN.md — Settings page Tabs refactor + Notifications tab UI (SMTP, triggers, log)
- [x] 03-05-PLAN.md — Gap closure: UAT fixes for SMTP storage, disk checker Windows, threshold inputs, SSE refresh

### Phase 4: Backup & Restore

**Goal**: Users can take encrypted, versioned backups of any stack and restore from a snapshot without manual restic CLI knowledge
**Depends on**: Phase 1
**Requirements**: BCK-01, BCK-02, BCK-03, BCK-04, BCK-05, BCK-06, BCK-07, BCK-08, BCK-09, BCK-10, BCK-11
**Success Criteria** (what must be TRUE):

  1. User can configure a restic repository (local path, SFTP, or S3-compatible) and password in Settings; password is stored encrypted
  2. User can trigger a manual backup for any stack and see streaming progress output in the UI
  3. User can configure a per-stack backup schedule and retention policy; scheduled backups run automatically
  4. User can view a list of available snapshots for a stack and restore the stack from any selected snapshot
  5. A backup failure transitions the stack to ERROR state and triggers a notification if SMTP is configured

**Plans**: 13 plans

Plans:

- [x] 04-01-PLAN.md — Prisma schema (RESTORE trigger + logLines) + shared Zod schemas + RED test scaffolds
- [x] 04-02-PLAN.md — ResticExecutor (spawn wrapper) + BackupRepository (Backup CRUD)
- [x] 04-03-PLAN.md — BackupService (backup/restore orchestration + NOTF-05) + BackupScheduler (per-stack cron)
- [x] 04-04-PLAN.md — Backup routes (trigger, restore, SSE stream, snapshots, settings endpoints)
- [x] 04-05-PLAN.md — Client API client + SSE hook + Settings Backup tab + NOTF-05 toggle
- [x] 04-06-PLAN.md — Stack detail action bar refactor + Backups tab + backup detail page + route registration
- [x] 04-07-PLAN.md — Gap closure: logLines database column sync + backup record validation
- [x] 04-08-PLAN.md — Gap closure: ResticExecutor throw on non-zero exit codes
- [x] 04-10-PLAN.md — Gap closure: stderr capture in backup logs
- [x] 04-11-PLAN.md — Gap closure: BackupScheduler crash fix + repository wiring
- [x] 04-12-PLAN.md — Gap closure: stackPath undefined handling
- [x] 04-13-PLAN.md — Gap closure: Windows path handling + repository field UI clarity
- [x] 04-14-PLAN.md — Fix circular backup issue causing snapshot corruption

### Phase 5: Onboarding

**Goal**: New users reach a fully configured instance through a guided wizard; existing self-hosters can adopt running stacks into Docktor without downtime
**Depends on**: Phase 1, Phase 2, Phase 4
**Requirements**: WIZ-01, WIZ-02, WIZ-03, WIZ-04, WIZ-05, WIZ-06, WIZ-07, BF-01, BF-02, BF-03, BF-04, BF-05
**Success Criteria** (what must be TRUE):

  1. On first boot with no user in the database, the browser shows a multi-step setup wizard instead of the login page
  2. After completing the wizard, a new user has an account, basic settings configured, and is redirected to the dashboard
  3. User can scan the host filesystem for existing docker-compose.yml files and see a compatibility assessment for each
  4. User can adopt a discovered stack in-place with zero downtime, and it immediately appears in the dashboard with live status
  5. User can run the full migration wizard to move a stack into Docktor's directory structure, with automatic rollback on failure

**Plans**: 8 plans

Plans:

- [x] 05-01-PLAN.md — Shared wizard schemas + RED test scaffolds + E2E test scaffold (Wave 1)
- [x] 05-02-PLAN.md — BrownfieldScanner + ComposeAnalyzer infrastructure (Wave 2)
- [x] 05-03-PLAN.md — OnboardingService + setup routes + middleware redirect (Wave 2)
- [x] 05-04-PLAN.md — ComposeRewriter + VolumeMigrator + MigrationService (Wave 3)
- [x] 05-05-PLAN.md — Setup API client + WizardStepper + setup page shell (Wave 3)
- [x] 05-06-PLAN.md — BrownfieldStep + MigrationWizard modal + adopt-in-place (Wave 4)
- [x] 05-07-PLAN.md — Wizard step components (AccountStep, SettingsStep, BackupStep, NotificationsStep) (Wave 3)
- [x] 05-08-PLAN.md — CompatibilityBadge + DiffViewer components (Wave 3)

### Phase 6: Proxy Configuration

**Goal**: Users can configure domain and TLS exposure for any service directly from the stack detail page, without touching Nginx configuration manually
**Depends on**: Phase 1
**Requirements**: PRXY-01, PRXY-02, PRXY-03, PRXY-04, PRXY-05
**Success Criteria** (what must be TRUE):

  1. User can configure NPM API credentials (URL, username, password) in Settings
  2. User can assign a domain, internal port, and TLS setting to a service from the stack detail page; the corresponding NPM proxy host is created or updated automatically
  3. User can remove a proxy configuration from the UI; the NPM proxy host is deleted
  4. Proxy operations are idempotent: reconfiguring an existing domain updates the NPM host rather than creating a duplicate

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. MVP Completion | 6/7 | In Progress|  |
| 2. Observability | 13/16 | In Progress|  |
| 3. Notifications | 5/5 | Complete   | 2026-03-20 |
| 4. Backup & Restore | 5/6 | In Progress|  |
| 5. Onboarding | 8/8 | Complete   | 2026-04-08 |
| 6. Proxy Configuration | 0/? | Not started | - |
