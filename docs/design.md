# Self-Hosting Platform – Technical Design Document

## Overview

This document outlines the technical architecture and design decisions for a self-hosting management platform. The system provides a UI-driven experience for deploying, updating, and managing Docker-based applications using `docker-compose`. It is designed for users with basic technical knowledge who want a streamlined, centralized solution to self-host apps.

---

## Goals

* Simplify service deployment and updates via a UI.
* Store service configuration in `docker-compose.yml` files.
* Provide a marketplace for community-contributed templates.
* Support email notifications on errors or failures.
* Allow volume and environment file backups per service (stack).

---

## Core Concepts

### Stack

* A "Stack" represents a single `docker-compose` file with one or more Docker services (e.g., app + database).
* Physically stored in a directory (e.g., `/stacks/<stack-id>/`).

Directory structure:

```bash
/stacks/<stack-id>/
├── docker-compose.yml
├── .env
├── backups/
├── logs/
└── .meta.json
```

### Template

* A reusable blueprint for deploying a new stack.
* Includes a versioned `docker-compose.yml` and optional metadata.
* Stored centrally and publicly browsable via the Marketplace.

---

## Technology Stack

* **Framework:** Blitz.js (Next.js + Prisma)
* **Language:** TypeScript
* **ORM:** Prisma (PostgreSQL)
* **Docker Integration:** `dockerode`
* **YAML Parsing:** `yaml` or `js-yaml`
* **UI Editor:** CodeMirror (YAML mode)
* **Auth:** Built-in Blitz.js Auth
* **Notifications:** SMTP Email (via nodemailer)
* **Backup Tool:** `restic`

---

## Database Models

### User

* Standard authentication model.
* One user can manage multiple stacks.

### Stack

* Stores basic metadata and paths.
* Compose content is not duplicated in DB.

### Deployment

* Links templates to created stacks.

### ServiceTemplate

* Versioned template definitions.
* Stored as physical files (not DB-only).

### ProxyConfig

* Defines exposure rules (domain, ports).

### Backup

* References to backup archives and metadata.

### StatusLog

* Captures historic state changes of a stack.

(Models defined in full in `database.prisma` schema.)

---

## Compose File Parsing

### When to Parse:

* On stack creation.
* On manual reload (e.g. "Check for changes").

### What to Extract:

* Service names
* Image names
* Published ports
* Environment variables

### Cache Strategy:

* Hash `docker-compose.yml` (SHA256) to detect changes.
* Store `lastParsedAt` and `lastKnownHash`.
* Re-parse only if hash changes.

---

## UI & User Interaction

### Stack Management

* Create a stack by uploading or pasting YAML.
* View/edit Compose file in CodeMirror.
* Deploy stack (creates directory and runs compose).

### Logs

* Shown via `docker logs`.
* Not persisted (live-only).

### Status

* Based on `docker inspect` and container state.
* Status values: `RUNNING`, `STOPPED`, `ERROR`, `UPDATING`

### Updates

* Periodic job checks Docker registries for newer image versions.
* Manual "Update" button pulls and restarts.

---

## Marketplace

* Hosted server-side with versioned `compose.yml` templates.
* Each template includes:

    * ID
    * Name
    * Description
    * Tags
    * Compose file path
    * Author
    * Created date

---

## Notifications

* Triggered when stack enters `ERROR` state.
* Sent via SMTP (admin-configurable address).

---

## Backup & Restore

### Backup Includes:

* `docker-compose.yml`
* `.env`
* All Docker volumes attached to services

### Backup Format:

* Archive (`.tar.gz`) per backup
* Stored in `/stacks/<stack-id>/backups/`

### Restore:

* Extract archive
* Restart stack using compose

### Restic Integration:

* `restic` is used as the underlying backup engine.
* Backups are encrypted, deduplicated, and versioned.
* Snapshot metadata (e.g., snapshot ID) is stored in the database.
* Backup targets can be local or remote (SFTP, S3, etc.).
* Restore involves:

    1. Selecting a snapshot
    2. Restoring `.env`, `compose.yml`, and volumes to a temp location
    3. Redeploying the stack

---

## Future Roadmap (Out of Scope for MVP)

* Plugin system for extensibility
* Form-based YAML abstraction (JSON Schema rendering)
* Persistent logs and metrics
* OAuth or LDAP integration
* User access control per stack

---

## Summary

This design favors simplicity, file-based configuration, and composability while laying a strong foundation for automation, extensibility, and user-friendly self-hosting. The YAML-first approach makes onboarding easy and leaves the door open for future enhancements.
