# Requirements: Docktor

**Defined:** 2026-03-10
**Core Value:** Users can deploy, monitor, and manage Docker Compose stacks through a browser UI without needing SSH or Docker CLI access.

## v1 Requirements

### Container Observability

- [x] **OBS-01**: Container state updates are event-driven: subscribe to the dockerode event stream (`docker events`) and react to `start`, `stop`, `die`, `kill`, and `health_status` events in real time
- [x] **OBS-02**: On each relevant Docker event, inspect the affected container via dockerode and update the stack/service status in the DB immediately
- [x] **OBS-03**: Event-driven updates skip stacks in Docktor-owned transitional states (DEPLOYING, UPDATING, BACKING_UP, RESTORING, MIGRATING) to avoid overwriting operational status
- [x] **OBS-04**: A 60s reconciliation loop performs a full state sync to catch any events missed during stream reconnects or Docker daemon restarts
- [x] **OBS-05**: User can stream live container logs per service via SSE (Server-Sent Events)
- [x] **OBS-06**: Log stream shows historical tail-N lines on connect, then live output
- [x] **OBS-07**: Log viewer renders ANSI escape codes (color/bold) and prefixes each line with service name
- [x] **OBS-08**: Client reconnects automatically when SSE connection drops
- [x] **OBS-09**: User can filter logs by service in the combined view

### Settings

- [x] **SET-01**: User can set instance name, base URL, and timezone via a Settings page
- [x] **SET-02**: Settings are persisted in the DB Settings key-value model
- [x] **SET-03**: Settings page validates input (valid IANA timezone, valid URL format)

### File Watcher

- [x] **FW-01**: Background process watches `/stacks/*/docker-compose.yml` for changes using chokidar
- [x] **FW-02**: When a compose file changes, the stack is re-hashed (SHA256), DB metadata updated, and stack flagged as "config changed"
- [x] **FW-03**: A polling fallback (60s interval) re-hashes all compose files to catch events missed by inotify (e.g., NFS mounts)

### Update Checker

- [x] **UPD-01**: Background job polls Docker registries to check for newer image versions (semver, date-tag, or digest comparison)
- [x] **UPD-02**: Update checks are rate-limit safe: results cached per image, checks staggered, not triggered on every poll cycle
- [x] **UPD-03**: Stack detail page shows an "update available" badge when newer images are found
- [x] **UPD-04**: User can trigger an update (pull + recreate) from the stack detail page — never automatic

### Notifications

- [x] **NOTF-01**: User can configure SMTP settings (host, port, username, password, from address, recipient) in Settings
- [x] **NOTF-02**: SMTP password is stored AES-encrypted in the DB
- [x] **NOTF-03**: Notification sent when a stack enters ERROR or UNHEALTHY state (includes stack name, state, timestamp, last log lines)
- [x] **NOTF-04**: Notification sent when disk space drops below 10% or 2 GB
- [ ] **NOTF-05**: Notification sent when a backup fails
- [x] **NOTF-06**: Each notification trigger can be individually enabled/disabled in Settings

### Backup & Restore

- [ ] **BCK-01**: User can configure a restic repository (local path, SFTP, or S3-compatible) and password via Settings
- [ ] **BCK-02**: Restic password is stored AES-encrypted in the DB
- [ ] **BCK-03**: User can trigger a manual backup for any stack from the stack detail page
- [ ] **BCK-04**: User can configure a per-stack backup schedule (cron expression)
- [ ] **BCK-05**: User can configure per-stack retention policy (daily/weekly/monthly counts)
- [ ] **BCK-06**: Backup includes the entire stack directory (docker-compose.yml, .env, volumes/) excluding logs/
- [ ] **BCK-07**: Absolute-path volumes outside the stack directory are excluded from backup with a visible warning
- [ ] **BCK-08**: User can view a list of available restic snapshots for a stack
- [ ] **BCK-09**: User can restore a stack from a selected snapshot (stop → restore → redeploy → health check)
- [ ] **BCK-10**: Restic CLI is invoked using spawn (not execFile) to support streaming progress output
- [ ] **BCK-11**: Stack transitions to BACKING_UP state during backup and returns to previous state on completion or ERROR on failure

### First-Run Wizard

- [ ] **WIZ-01**: On first boot with no user in the DB, the UI shows a setup wizard instead of the login page
- [ ] **WIZ-02**: Wizard step 1: create admin account (email + password)
- [ ] **WIZ-03**: Wizard step 2: set instance name, base URL, and timezone (writes to Settings)
- [ ] **WIZ-04**: Wizard step 3 (optional): configure restic backup repository and password
- [ ] **WIZ-05**: Wizard step 4 (optional): configure SMTP notifications
- [ ] **WIZ-06**: Wizard step 5 (optional): trigger brownfield stack scan
- [ ] **WIZ-07**: After wizard completion, user is redirected to the dashboard

### Brownfield Import

- [ ] **BF-01**: User can trigger a scan of the host filesystem for docker-compose.yml files
- [ ] **BF-02**: Scan results show: directory path, service names, images, container state, and compatibility assessment (named volumes, inline env vars, non-standard paths)
- [ ] **BF-03**: User can adopt a discovered stack in-place: registers it in the DB without moving files (zero downtime, zero risk)
- [ ] **BF-04**: User can run a full migration wizard: stop → copy to /stacks/<id>/ → convert named volumes to bind mounts → extract env vars to .env → rewrite paths → restart
- [ ] **BF-05**: Full migration includes rollback on failure and user-initiated cleanup of old files after confirming success

### Proxy Configuration

- [ ] **PRXY-01**: User can configure a domain, internal service/port, and TLS setting for a stack's service via the stack detail page
- [ ] **PRXY-02**: When Nginx Proxy Manager is configured, Docktor creates/updates proxy hosts via the NPM API
- [ ] **PRXY-03**: NPM API credentials (URL + username + password) are configurable in Settings
- [ ] **PRXY-04**: User can remove a proxy configuration, which deletes the corresponding NPM proxy host
- [ ] **PRXY-05**: Proxy operations are idempotent (re-creating an existing proxy host updates it rather than erroring)

## v2 Requirements

### Marketplace
- **MKT-01**: Bundled templates for common self-hosting apps (Nextcloud, Vaultwarden, Gitea, Immich, etc.)
- **MKT-02**: Remote template index fetched from marketplace.docktor.io
- **MKT-03**: Community templates display a review warning before deployment

### Registry Credentials
- **REG-01**: User can add authenticated private registry credentials (URL, username, password, encrypted)
- **REG-02**: Registered credentials are used automatically for image pulls and update checks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Marketplace (v1) | Deferred to v2 — requires separate infrastructure |
| RBAC / multi-user | Single-user model sufficient for personal server use case |
| Inter-stack networking | Users can use `external: true` manually in compose files |
| Metrics dashboards | Out of product scope (Prometheus/Grafana integration) |
| OAuth / LDAP | better-auth email/password sufficient |
| Docker Secrets | Filesystem permissions + encrypted restic backups covers MVP security |
| Plugin system | Adds complexity without near-term user benefit |
| Docktor self-update via UI | Users run `docker compose pull && up -d` from host |
| Auto-updates (containers) | Never automatic — always user-initiated |
| Named Docker volumes | Rejected by design — bind mounts only |
| WebSocket log streaming | SSE is sufficient for unidirectional log display |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | Phase 1 | Complete |
| OBS-02 | Phase 1 | Complete |
| OBS-03 | Phase 1 | Complete |
| OBS-04 | Phase 1 | Complete |
| OBS-05 | Phase 1 | Complete |
| OBS-06 | Phase 1 | Complete |
| OBS-07 | Phase 1 | Complete |
| OBS-08 | Phase 1 | Complete |
| OBS-09 | Phase 1 | Complete |
| SET-01 | Phase 1 | Complete |
| SET-02 | Phase 1 | Complete |
| SET-03 | Phase 1 | Complete |
| FW-01 | Phase 2 | Complete |
| FW-02 | Phase 2 | Complete |
| FW-03 | Phase 2 | Complete |
| UPD-01 | Phase 2 | Complete |
| UPD-02 | Phase 2 | Complete |
| UPD-03 | Phase 2 | Complete |
| UPD-04 | Phase 2 | Complete |
| NOTF-01 | Phase 3 | Complete |
| NOTF-02 | Phase 3 | Complete |
| NOTF-03 | Phase 3 | Complete |
| NOTF-04 | Phase 3 | Complete |
| NOTF-05 | Phase 3 | Pending |
| NOTF-06 | Phase 3 | Complete |
| BCK-01 | Phase 4 | Pending |
| BCK-02 | Phase 4 | Pending |
| BCK-03 | Phase 4 | Pending |
| BCK-04 | Phase 4 | Pending |
| BCK-05 | Phase 4 | Pending |
| BCK-06 | Phase 4 | Pending |
| BCK-07 | Phase 4 | Pending |
| BCK-08 | Phase 4 | Pending |
| BCK-09 | Phase 4 | Pending |
| BCK-10 | Phase 4 | Pending |
| BCK-11 | Phase 4 | Pending |
| WIZ-01 | Phase 5 | Pending |
| WIZ-02 | Phase 5 | Pending |
| WIZ-03 | Phase 5 | Pending |
| WIZ-04 | Phase 5 | Pending |
| WIZ-05 | Phase 5 | Pending |
| WIZ-06 | Phase 5 | Pending |
| WIZ-07 | Phase 5 | Pending |
| BF-01 | Phase 5 | Pending |
| BF-02 | Phase 5 | Pending |
| BF-03 | Phase 5 | Pending |
| BF-04 | Phase 5 | Pending |
| BF-05 | Phase 5 | Pending |
| PRXY-01 | Phase 6 | Pending |
| PRXY-02 | Phase 6 | Pending |
| PRXY-03 | Phase 6 | Pending |
| PRXY-04 | Phase 6 | Pending |
| PRXY-05 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 50 total
- Mapped to phases: 50
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
