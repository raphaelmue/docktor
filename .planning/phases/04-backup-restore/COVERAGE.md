# Phase 04 — API Coverage Decision

**Detector result:** `detected: true`
**Signal that fired:** `(surface) api` — the string "Client API functions exist for all backup endpoints", lifted from an existing Phase 04 plan's must-haves.

## Declaration

**No external API integration: every "API" in this phase's scope is Docktor's own HTTP surface or a local subprocess.**

The detector matched on the word "endpoints" describing `GET /api/stacks/:id/backups`, `GET /api/backups/:id`, `GET /api/backups/:id/stream`, `POST /api/stacks/:id/backup` and `POST /api/stacks/:id/restore`. Those are routes this repository implements in `server/src/routes/backups.ts` and consumes from `client/src/lib/backups-api.ts`. Both sides are in-tree, versioned together, and covered by this repository's own tests — there is no third-party capability surface to enumerate, no vendor SDK whose features could be silently under-used, and no upstream contract that could drift without a lockfile change.

The one external executable this phase drives is **restic**, invoked with `spawn` from `server/src/infrastructure/restic-executor.ts`. It is a local CLI subprocess, not a remote API: no network client, no authentication handshake with a vendor, no rate limit, no SDK. Its capability surface is already bounded by the argument builders in that file (`buildBackupArgs`, `buildForgetArgs`, `buildInitArgs`, `snapshots`, `checkVersion`) and by `04-RESEARCH.md`.

The SFTP and S3 repository backends are configuration passed through to restic as `RESTIC_REPOSITORY` and AWS credential environment variables. Docktor never speaks S3 or SFTP itself; restic does. Those backends therefore add no first-party integration surface either, which is why `04-RESEARCH.md` treats them as configuration rather than as integrations.

## Scope of this declaration

Re-checked at gap-closure planning for plans `04-15` and `04-16`. Neither plan adds an external client, a vendor SDK, or a new outbound network call. `04-15` touches the SSE payload shape, an application-service method and two internal call sites; `04-16` touches one React hook and one page component. No capability matrix is warranted.

Toggle: `workflow.api_coverage_gate`.
