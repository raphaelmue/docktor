# Roadmap: Docktor

## Overview

Docktor's foundation (auth, stack CRUD, state machine, dashboard, detail page) is fully shipped. This roadmap covers Milestone 2: completing the product from functional to compelling. The path begins with the three remaining MVP blockers (settings, container state poller, live log streaming), then extends the platform with observability, notifications, backup/restore, onboarding, and proxy configuration — each phase delivering a complete, independently verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: MVP Completion** - Complete the three remaining blockers: settings persistence, container state poller, and live log streaming
- [ ] **Phase 2: Observability** - Detect external compose file changes and surface image update availability
- [ ] **Phase 3: Notifications** - Alert users on container errors, disk warnings, and backup failures via SMTP
- [ ] **Phase 4: Backup & Restore** - Enable encrypted, versioned stack backups with manual and scheduled restore
- [ ] **Phase 5: Onboarding** - Guide new installs through setup with a first-run wizard and adopt existing stacks via brownfield import
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
**Plans**: 5 plans

Plans:
- [ ] 02-01-PLAN.md — Test scaffolds (Wave 0 RED state for FW-01/02/03 and UPD-01/02/04)
- [ ] 02-02-PLAN.md — DB schema (StackEvent + ImageUpdateCheck) + StateBroadcaster extension + repositories
- [ ] 02-03-PLAN.md — FileWatcher job (chokidar + 60s reconcile) + jobs/index.ts registry
- [ ] 02-04-PLAN.md — UpdateChecker job (staggered registry polling, semver/date/digest) + manifestInspect()
- [ ] 02-05-PLAN.md — Stack detail badges (config changed, update available) + POST /update route + UI

### Phase 3: Notifications
**Goal**: Users receive email alerts for critical events (container errors, disk pressure, backup failures) without needing to watch the UI
**Depends on**: Phase 1, Phase 2
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06
**Success Criteria** (what must be TRUE):
  1. User can configure SMTP connection details in Settings and verify them with a test send
  2. User receives an email when a stack enters ERROR or UNHEALTHY state, including stack name, state, and recent log lines
  3. User receives an email when disk space drops below 10% or 2 GB remaining
  4. User can individually enable or disable each notification trigger in Settings
**Plans**: TBD

### Phase 4: Backup & Restore
**Goal**: Users can take encrypted, versioned backups of any stack and restore from a snapshot without manual restic CLI knowledge
**Depends on**: Phase 1
**Requirements**: BCK-01, BCK-02, BCK-03, BCK-04, BCK-05, BCK-06, BCK-07, BCK-08, BCK-09, BCK-10, BCK-11
**Success Criteria** (what must be TRUE):
  1. User can configure a restic repository (local path, SFTP, or S3) and password in Settings; password is stored encrypted
  2. User can trigger a manual backup for any stack and see streaming progress output in the UI
  3. User can configure a per-stack backup schedule and retention policy; scheduled backups run automatically
  4. User can view a list of available snapshots for a stack and restore the stack from any selected snapshot
  5. A backup failure transitions the stack to ERROR state and triggers a notification if SMTP is configured
**Plans**: TBD

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
**Plans**: TBD

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
| 2. Observability | 0/5 | Ready to execute | - |
| 3. Notifications | 0/? | Not started | - |
| 4. Backup & Restore | 0/? | Not started | - |
| 5. Onboarding | 0/? | Not started | - |
| 6. Proxy Configuration | 0/? | Not started | - |
