# Phase 3: Notifications - Research

**Researched:** 2026-03-17
**Domain:** SMTP email delivery, AES encryption, background jobs, Settings UI expansion, notification log
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Notification trigger deduplication**
- Each trigger fires once per incident: transition to ERROR/UNHEALTHY logs/sends one notification, then suppresses until the stack recovers (RUNNING, HEALTHY, or STOPPED)
- Restart loop / rapid flapping: second ERROR while first is still "active" does NOT re-notify
- UNHEALTHY grace period: only fire if the stack has been continuously UNHEALTHY for >2 minutes — suppresses transient flaps during deploys and restarts
- Disk warning: suppressed until disk recovers above both thresholds
- Track incident state in DB (e.g., a `notificationActive` flag or last-notified-at per stack per trigger type)

**Notification log**
- Global notification log stored in DB (new `Notification` table): records event type, stack name, message, timestamp, and whether email was delivered
- Visible in the UI (Notifications tab on Settings page, or dedicated section)
- Written regardless of SMTP configuration — SMTP is a delivery channel only
- Notifications are logged whenever triggers are enabled; no SMTP = UI-only visibility

**Disk space monitoring**
- Monitors the Docker data directory (`/var/lib/docker`) only
- New dedicated background job running on a ~24h interval (not piggybacked on StatePoller)
- Two independent triggers: below 10% free OR below 2 GB free — either fires the alert
- Both thresholds are configurable in Settings (stored as key-value pairs like General settings)
- Suppressed until disk recovers above the triggered threshold

**SMTP settings and Settings page structure**
- Settings page gains tabbed navigation: General | Notifications tabs
- Notifications tab contains two cards:
  1. SMTP card: host, port, username, password (encrypted), from address, recipient, + Test Send button
  2. Notification Triggers card: per-trigger enable/disable toggles (stack error/unhealthy, disk warning)
- Test Send: fires immediately on click, toast on success/failure — no confirmation dialog
- Trigger toggles are always visible and functional regardless of SMTP config; when SMTP is not configured, triggered events are still written to the notification log (UI-only)

**NOTF-05 (backup failure) — deferred**
- Skipped in Phase 3; will be delivered as part of Phase 4 (Backup & Restore)

**Email content**
- Stack error/unhealthy notification includes: stack name, current state, timestamp, recent log lines
- Disk warning includes: mount point checked, current free space (bytes + percent), which threshold was crossed
- Plain text email acceptable for MVP; HTML not required

### Claude's Discretion
- Exact `Notification` table schema (columns, indexes)
- SMTP library choice (nodemailer is standard for Node.js)
- AES encryption implementation for SMTP password (reuse existing `encrypted` flag pattern in Setting schema)
- Grace period implementation for UNHEALTHY (setTimeout vs. polling check on reconciliation loop)
- Background job interval (default 24h, expressed as cron or ms)
- Notification log UI placement (Settings > Notifications tab, or a top-level nav entry)

### Deferred Ideas (OUT OF SCOPE)
- NOTF-05 (backup failure notification) — delivered in Phase 4 when backup system exists
- HTML email templates — plain text sufficient for MVP
- Notification log as top-level nav entry — kept inside Settings for now; revisit if log grows important
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NOTF-01 | User can configure SMTP settings (host, port, username, password, from address, recipient) in Settings | New Notifications tab on Settings page; SMTP key-value rows in DB via SettingsService |
| NOTF-02 | SMTP password is stored AES-encrypted in the DB | Node.js `crypto` module AES-256-GCM; existing `encrypted Boolean` flag on `Setting` model |
| NOTF-03 | Notification sent when a stack enters ERROR or UNHEALTHY state (includes stack name, state, timestamp, last log lines) | Subscribe to `StateBroadcaster` `container_state` events; NotificationService writes log + sends email via nodemailer |
| NOTF-04 | Notification sent when disk space drops below 10% or 2 GB | New `DiskChecker` job using `fs.promises.statfs`; reads configurable thresholds from Settings |
| NOTF-06 | Each notification trigger can be individually enabled/disabled in Settings | Per-trigger toggle rows (`notify.stackError`, `notify.diskWarning`) checked before firing |
</phase_requirements>

---

## Summary

Phase 3 wires an email notification system into the existing Docktor server. The core work is threefold: (1) extend the Settings DB and API with SMTP configuration (password AES-256-GCM encrypted using Node's built-in `crypto` module), (2) create a `NotificationService` that writes to a new `Notification` DB table and optionally delivers email via nodemailer, and (3) hook the two triggers — stack state transitions (via StateBroadcaster subscription) and disk space (a new 24h DiskChecker job using `fs.promises.statfs`).

The Settings page grows a second tab (Notifications) using the existing Radix UI `Tabs` component already present in the client. The notification log is exposed via `GET /api/notifications` and rendered in the same tab. All new server patterns (job class, DI constructor, lazy repo import, node-cron scheduling) are established by prior phases and can be applied verbatim.

The principal design challenge is the deduplication/grace period logic. The UNHEALTHY 2-minute grace period is cleanest with `setTimeout`-based tracking in the `NotificationWatcher` subscriber rather than a polling check, avoiding extra DB reads on every reconcile cycle. Incident tracking belongs in the `Notification` table itself (or a dedicated `NotificationIncident` table) — a `resolvedAt` column approach is simpler than a `notificationActive` boolean on `Stack` because it avoids schema changes to the `Stack` model.

**Primary recommendation:** Implement AES-256-GCM encryption in a new `server/src/lib/crypto.ts` module, `NotificationService` in `server/src/application/notification-service.ts`, a `NotificationWatcher` subscriber in `server/src/jobs/notification-watcher.ts`, and `DiskChecker` in `server/src/jobs/disk-checker.ts` — all following established patterns from prior phases.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nodemailer | 8.0.2 | SMTP email delivery | Dominant Node.js email library; zero external runtime dependencies; built-in SMTP transport with TLS/STARTTLS support |
| @types/nodemailer | 7.0.11 | TypeScript type definitions | Official DefinitelyTyped types for nodemailer; nodemailer itself is JS-only |
| node:crypto | Built-in (Node 24) | AES-256-GCM encryption/decryption | Built-in module; no extra dependency; AEAD mode provides both confidentiality and integrity |
| node:fs/promises.statfs | Built-in (Node 18+) | Disk space measurement | Stable promise API; returns bsize, blocks, bavail — sufficient for % and bytes calculation |
| node-cron | 3.0.3 (already installed) | 24h DiskChecker cron schedule | Already used by StatePoller and UpdateChecker |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 4.3.6 (already installed) | SMTP config input validation | Schema for POST /api/settings/smtp body; reuse existing pattern from settingsRoutes |
| radix-ui Tabs | Present in client/src/components/ui/tabs.tsx | Settings page tab navigation | Already installed; shadcn component wrapping `radix-ui` Tabs primitive |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nodemailer | Postal, Sendgrid SDK | nodemailer is self-contained SMTP; external SDKs would require accounts and API keys — wrong for a self-hosted tool |
| AES-256-GCM (crypto) | bcrypt, external vault | bcrypt is one-way; vault adds infra complexity. AES-GCM is reversible encryption needed to reconstruct SMTP creds at send time |
| fs.promises.statfs | statvfs npm package | `statfs` is built-in since Node 18; no extra dependency needed |
| setTimeout for UNHEALTHY grace | DB polling on reconcile loop | setTimeout is held in process memory (fine — server restarts reset transient incidents anyway); avoids extra DB round-trip per reconcile cycle |

**Installation:**
```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```
(Run in `server/` directory)

**Version verification:**
```bash
npm view nodemailer version     # 8.0.2 confirmed 2026-03-17
npm view @types/nodemailer version  # 7.0.11 confirmed 2026-03-17
```

---

## Architecture Patterns

### Recommended Project Structure

```
server/src/
├── lib/
│   └── crypto.ts              # AES-256-GCM encrypt/decrypt for secrets
├── application/
│   └── notification-service.ts # log to DB + send via nodemailer
├── jobs/
│   ├── notification-watcher.ts # StateBroadcaster subscriber + UNHEALTHY timer
│   ├── disk-checker.ts         # 24h cron job using statfs
│   └── index.ts                # register diskChecker + notificationWatcher
├── repositories/
│   └── notification-repository.ts
├── routes/
│   ├── settings.ts             # extend with SMTP + test-send routes
│   └── notifications.ts        # GET /api/notifications
└── prisma/schema/
    └── notification.prisma     # Notification + NotificationIncident models

client/src/
├── routes/app/settings.tsx     # add Tabs + Notifications tab
└── lib/
    └── notifications-api.ts    # GET /api/notifications, SMTP API calls
```

### Pattern 1: AES-256-GCM Encrypt/Decrypt

**What:** Symmetric encryption for storing SMTP password in DB. Uses a 32-byte key from env var (`ENCRYPTION_KEY`), random 12-byte IV per encryption, GCM auth tag prepended to ciphertext.

**When to use:** Any `Setting` row with `encrypted: true`.

```typescript
// server/src/lib/crypto.ts
// Source: Node.js crypto documentation (built-in module)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY
    if (!key) throw new Error("ENCRYPTION_KEY env var is required")
    const buf = Buffer.from(key, "hex")
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)")
    return buf
}

export function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, getKey(), iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format: iv(12) + tag(16) + ciphertext — all hex-encoded
    return Buffer.concat([iv, tag, encrypted]).toString("hex")
}

export function decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, "hex")
    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
```

### Pattern 2: NotificationService

**What:** Orchestrates logging to DB and optional SMTP delivery. Single public method `notify()` that accepts a typed event, writes a `Notification` row, then calls nodemailer if SMTP is configured and the trigger toggle is enabled.

**When to use:** Called from `NotificationWatcher` (stack events) and `DiskChecker` (disk events).

```typescript
// server/src/application/notification-service.ts
// Source: nodemailer.com/usage (verified 2026-03-17)
import nodemailer from "nodemailer"

export class NotificationService {
    async notify(event: NotificationEvent): Promise<void> {
        // 1. Check trigger toggle
        const toggleKey = event.type === "stack_error" ? "notify.stackError" : "notify.diskWarning"
        const enabled = await this.settings.getSetting(toggleKey)
        if (enabled === "false") return

        // 2. Log to DB (always)
        const notification = await this.repo.create({
            type: event.type,
            stackId: event.stackId ?? null,
            message: event.message,
            emailSent: false,
        })

        // 3. Send email if SMTP configured
        const smtpConfig = await this.getSmtpConfig()
        if (!smtpConfig) return

        const transport = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.port === 465,
            auth: { user: smtpConfig.username, pass: smtpConfig.password },
        })

        try {
            await transport.sendMail({
                from: smtpConfig.from,
                to: smtpConfig.recipient,
                subject: event.subject,
                text: event.message,
            })
            await this.repo.markEmailSent(notification.id)
        } catch (err) {
            console.error("[NotificationService] email send failed:", err)
            // Do not throw — log failure is recorded, UI-log still written
        }
    }

    async testSmtp(smtpConfig: SmtpConfig): Promise<void> {
        const transport = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.port === 465,
            auth: { user: smtpConfig.username, pass: smtpConfig.password },
        })
        await transport.verify()  // Throws on failure — caught by route handler
    }
}
```

### Pattern 3: NotificationWatcher (StateBroadcaster subscriber)

**What:** Subscribes to `stateEventBroadcaster` on startup. Filters `container_state` events for `stackStatus` transitions into ERROR or UNHEALTHY. Implements deduplication via in-process `Map<stackId, Set<triggerType>>` tracking active incidents. UNHEALTHY grace period uses `setTimeout`.

**When to use:** Registered in `jobs/index.ts` alongside StatePoller.

```typescript
// server/src/jobs/notification-watcher.ts
export class NotificationWatcher {
    // Active incidents: stackId → Set<"error" | "unhealthy">
    private readonly activeIncidents = new Map<string, Set<string>>()
    // UNHEALTHY grace timers: stackId → NodeJS.Timeout
    private readonly unhealthyTimers = new Map<string, NodeJS.Timeout>()
    private unsubscribe: (() => void) | null = null

    start(): void {
        this.unsubscribe = stateEventBroadcaster.subscribe(async (event) => {
            if (event.type !== "container_state") return
            await this.handleStateEvent(event)
        })
    }

    stop(): void {
        this.unsubscribe?.()
        // Clear any pending UNHEALTHY timers
        for (const timer of this.unhealthyTimers.values()) clearTimeout(timer)
        this.unhealthyTimers.clear()
    }

    private async handleStateEvent(event: ContainerStateEvent): Promise<void> {
        const { stackId, stackStatus } = event
        const active = this.activeIncidents.get(stackId) ?? new Set()

        if (stackStatus === "ERROR" && !active.has("error")) {
            // Cancel any pending UNHEALTHY timer (ERROR supersedes)
            const timer = this.unhealthyTimers.get(stackId)
            if (timer) { clearTimeout(timer); this.unhealthyTimers.delete(stackId) }

            active.add("error")
            this.activeIncidents.set(stackId, active)
            await this.notificationService.notify({ type: "stack_error", stackId, ... })
        }

        if (stackStatus === "UNHEALTHY" && !active.has("unhealthy") && !this.unhealthyTimers.has(stackId)) {
            // Start 2-minute grace period
            const timer = setTimeout(async () => {
                this.unhealthyTimers.delete(stackId)
                const current = this.activeIncidents.get(stackId) ?? new Set()
                if (!current.has("unhealthy")) {
                    current.add("unhealthy")
                    this.activeIncidents.set(stackId, current)
                    await this.notificationService.notify({ type: "stack_unhealthy", stackId, ... })
                }
            }, 2 * 60 * 1000)
            this.unhealthyTimers.set(stackId, timer)
        }

        // Recovery: clear incidents on RUNNING, HEALTHY, STOPPED
        if (["RUNNING", "HEALTHY", "STOPPED"].includes(stackStatus)) {
            const timer = this.unhealthyTimers.get(stackId)
            if (timer) { clearTimeout(timer); this.unhealthyTimers.delete(stackId) }
            this.activeIncidents.delete(stackId)
        }
    }
}
```

### Pattern 4: DiskChecker job

**What:** 24h cron job that reads `/var/lib/docker` disk stats via `fs.promises.statfs`. Checks both thresholds independently. Uses the same `notificationActive` / recovery pattern tracked in DB (unlike NotificationWatcher which uses in-process state, DiskChecker stores last-alert state in DB because disk state persists across restarts).

**When to use:** Registered alongside other jobs in `jobs/index.ts`.

```typescript
// server/src/jobs/disk-checker.ts
import { statfs } from "node:fs/promises"
import cron from "node-cron"

export class DiskChecker {
    private cronTask: cron.ScheduledTask | null = null

    start(): void {
        // Run immediately on start, then every 24h
        void this.check()
        this.cronTask = cron.schedule("0 0 * * *", () => void this.check())
    }

    stop(): void { this.cronTask?.stop(); this.cronTask = null }

    async check(): Promise<void> {
        const settings = await this.getSettings()
        if (settings["notify.diskWarning"] === "false") return

        const thresholdPercent = Number(settings["disk.thresholdPercent"] ?? "10")
        const thresholdBytes = BigInt(settings["disk.thresholdBytes"] ?? "2147483648")

        try {
            const stats = await statfs("/var/lib/docker")
            const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize)
            const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize)
            const freePercent = Number(freeBytes * 100n / totalBytes)

            const belowPercent = freePercent < thresholdPercent
            const belowBytes = freeBytes < thresholdBytes
            const triggered = belowPercent || belowBytes

            // Read last disk alert state from DB
            const lastAlert = await this.repo.getLastDiskAlert()
            if (triggered && !lastAlert?.active) {
                await this.repo.setDiskAlertActive(true)
                await this.notificationService.notify({
                    type: "disk_warning",
                    message: buildDiskMessage(freeBytes, freePercent, thresholdPercent, Number(thresholdBytes), belowPercent, belowBytes),
                })
            } else if (!triggered && lastAlert?.active) {
                await this.repo.setDiskAlertActive(false)
            }
        } catch (err) {
            console.error("[DiskChecker] statfs error:", err)
        }
    }
}
```

### Pattern 5: Settings page Tabs refactor

**What:** Wrap existing Settings page content in `<Tabs>`. The existing General card becomes the first tab panel; Notifications is the new second tab.

```typescript
// client/src/routes/app/settings.tsx (structure only)
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export default function SettingsPage() {
    return (
        <Page>
            <PageHeader>...</PageHeader>
            <PageContent>
                <Tabs defaultValue="general">
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="notifications">Notifications</TabsTrigger>
                    </TabsList>
                    <TabsContent value="general">
                        {/* existing General card unchanged */}
                    </TabsContent>
                    <TabsContent value="notifications">
                        {/* SMTP card + Notification Triggers card + Log table */}
                    </TabsContent>
                </Tabs>
            </PageContent>
        </Page>
    )
}
```

### Anti-Patterns to Avoid

- **Re-creating nodemailer transport on every send:** Create transport per-send (stateless), since SMTP config can change between notifications. Do not cache a transport singleton.
- **Storing SMTP password in plaintext:** Always set `encrypted: true` when upserting the `smtp.password` key; always decrypt before constructing the transport.
- **Throwing on email send failure:** NotificationService must catch nodemailer errors and log them without propagating — the notification log entry is more important than the delivery.
- **Piggybacking disk checks on StatePoller:** The 60s reconcile loop would make disk checks 24x too frequent and adds unrelated concerns to StatePoller.
- **Storing UNHEALTHY timer state in DB:** In-process `setTimeout` is correct. Timer resets on restart, which is acceptable — a new UNHEALTHY event after restart will re-arm the 2-minute grace period.
- **Using AES-256-CBC instead of GCM:** CBC lacks authentication — an attacker can tamper with ciphertext. GCM provides authenticated encryption; mandatory for secrets.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SMTP delivery | Custom TCP SMTP client | nodemailer | STARTTLS negotiation, auth mechanisms (PLAIN/LOGIN/OAUTH2), connection reuse, error handling are all edge cases |
| AES encryption | XOR / ROT13 / base64 "encoding" | Node crypto AES-256-GCM | Built-in; authentication tag prevents ciphertext tampering; widely audited |
| Disk space stat | Shell `df` via `exec` | `fs.promises.statfs` | Synchronous-safe, no subprocess, no parsing; available Node 18+ |
| Tab navigation | Manual show/hide with `useState` | Radix UI Tabs (already in tabs.tsx) | Accessible, keyboard-navigable; already installed |
| Cron scheduling | `setInterval` + manual drift correction | `node-cron` | Already used; handles DST, provides named schedules |

**Key insight:** Every "simple" custom implementation in this domain (SMTP, encryption, cron) has a long tail of edge cases (TLS negotiation versions, GCM tag verification, timezone drift) that library authors have already solved.

---

## Common Pitfalls

### Pitfall 1: `secure` option misconfiguration in nodemailer

**What goes wrong:** Email fails with TLS error or server rejects connection.
**Why it happens:** `secure: true` should only be set for port 465 (implicit TLS). Port 587 uses STARTTLS (`secure: false`), which still upgrades to TLS after the initial plaintext handshake. Setting `secure: true` on port 587 causes immediate TLS failure.
**How to avoid:** Derive `secure` from port: `secure: port === 465`. Let STARTTLS handle port 587 automatically.
**Warning signs:** `ECONNRESET` or `SSL_ERROR_RX_RECORD_TOO_LONG` in nodemailer error output.

### Pitfall 2: GCM auth tag not persisted correctly

**What goes wrong:** Decryption throws "Unsupported state or unable to authenticate data".
**Why it happens:** AES-256-GCM requires the auth tag (16 bytes) to be stored alongside IV and ciphertext. If the storage format omits the tag or gets the byte offsets wrong, decryption fails.
**How to avoid:** Use the layout: `iv(12 bytes) || tag(16 bytes) || ciphertext` — all stored as a single hex string. Always call `cipher.getAuthTag()` after `cipher.final()`.
**Warning signs:** Decryption errors only on freshly encrypted values that have never been decrypted before.

### Pitfall 3: UNHEALTHY timer not cancelled on recovery

**What goes wrong:** A stack goes UNHEALTHY then recovers within 2 minutes, but the notification fires after recovery.
**Why it happens:** `setTimeout` callback runs even after the stack has returned to RUNNING if the timer wasn't cancelled.
**How to avoid:** In `handleStateEvent`, clear the UNHEALTHY timer whenever status is RUNNING, HEALTHY, or STOPPED.
**Warning signs:** Notification log shows UNHEALTHY entries for stacks currently in RUNNING state.

### Pitfall 4: ENCRYPTION_KEY missing in container env

**What goes wrong:** Server fails to start, or SMTP password cannot be decrypted.
**Why it happens:** `ENCRYPTION_KEY` is a new required env var that does not exist in current `.env` or Docker Compose files.
**How to avoid:** Document the new env var clearly. In development, generate with `openssl rand -hex 32`. Add validation at startup that throws if missing.
**Warning signs:** `Error: ENCRYPTION_KEY env var is required` in server startup logs.

### Pitfall 5: `statfs` path not accessible in container

**What goes wrong:** DiskChecker throws `ENOENT` or `EACCES` for `/var/lib/docker`.
**Why it happens:** The Docker data directory may not be accessible inside the Docktor container depending on volume mounts and privileges.
**How to avoid:** Catch `statfs` errors and log them rather than crashing the job. Consider making the monitored path configurable with `/var/lib/docker` as default. Document that Docktor container needs read access to this path.
**Warning signs:** `[DiskChecker] statfs error: ENOENT /var/lib/docker` in logs on every check cycle.

### Pitfall 6: DB incident state inconsistency on NotificationWatcher restart

**What goes wrong:** Server restarts mid-incident; `activeIncidents` Map is empty; next ERROR event for an already-notified incident fires again.
**Why it happens:** In-process Map does not survive process restart.
**How to avoid:** For stack incidents, the NotificationWatcher can query the DB on startup for stacks currently in ERROR/UNHEALTHY status and pre-populate `activeIncidents`. This is a one-time query at `start()` time, not on every event.
**Warning signs:** Duplicate notifications in the log after server restarts.

---

## Code Examples

Verified patterns from official sources and codebase inspection:

### nodemailer createTransport + sendMail

```typescript
// Source: nodemailer.com/usage (verified 2026-03-17)
import nodemailer from "nodemailer"

const transport = nodemailer.createTransport({
    host: "smtp.example.com",
    port: 587,
    secure: false, // true for 465, false for all other ports (STARTTLS)
    auth: {
        user: "user@example.com",
        pass: "password",
    },
})

// Verify connection (throws on failure)
await transport.verify()

// Send email
await transport.sendMail({
    from: '"Docktor" <noreply@example.com>',
    to: "admin@example.com",
    subject: "Stack error: my-nextcloud",
    text: "Stack my-nextcloud entered ERROR state at 2026-03-17T14:00:00Z\n\nLast logs:\n...",
})
```

### Node crypto AES-256-GCM

```typescript
// Source: Node.js built-in crypto module (Node 24 - verified working)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// Encrypt
const iv = randomBytes(12)
const cipher = createCipheriv("aes-256-gcm", key32bytes, iv)
const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
const tag = cipher.getAuthTag() // MUST be called after final()
const stored = Buffer.concat([iv, tag, ciphertext]).toString("hex")

// Decrypt
const buf = Buffer.from(stored, "hex")
const decipher = createDecipheriv("aes-256-gcm", key32bytes, buf.subarray(0, 12))
decipher.setAuthTag(buf.subarray(12, 28))
const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")
```

### fs.promises.statfs disk space check

```typescript
// Source: Node.js built-in fs module (Node 18+, confirmed working Node 24)
import { statfs } from "node:fs/promises"

const stats = await statfs("/var/lib/docker")
const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize)
const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize)
const freePercent = Number(freeBytes * 100n / totalBytes)
// bavail = free blocks available to unprivileged user (use this, not bfree)
```

### SettingsRepository encrypted upsert

```typescript
// Source: server/src/repositories/settings-repository.ts (existing codebase)
// The prisma Setting model already has: encrypted Boolean @default(false)
// SettingsRepository.upsert only sets value; encrypted flag needs direct prisma call:
await prisma.setting.upsert({
    where: { key: "smtp.password" },
    create: { key: "smtp.password", value: encryptedValue, encrypted: true },
    update: { value: encryptedValue, encrypted: true },
})
```

### StateBroadcaster subscription pattern

```typescript
// Source: server/src/lib/state-broadcaster.ts (existing codebase)
// subscribe() returns an unsubscribe function — store it for cleanup
const unsubscribe = stateEventBroadcaster.subscribe(async (event) => {
    if (event.type === "container_state") {
        // event.stackStatus is the new derived status
        // event.stackId identifies the affected stack
    }
})
// In stop(): unsubscribe()
```

### jobs/index.ts registration pattern

```typescript
// Source: server/src/jobs/index.ts (existing codebase)
import { diskChecker } from "./disk-checker.js"
import { notificationWatcher } from "./notification-watcher.js"

export async function startJobs(): Promise<void> {
    await statePoller.start()
    await fileWatcher.start()
    await updateChecker.start()
    diskChecker.start()           // new
    notificationWatcher.start()  // new
}

export function stopJobs(): void {
    statePoller.stop()
    void fileWatcher.stop()
    updateChecker.stop()
    diskChecker.stop()           // new
    notificationWatcher.stop()  // new
}
```

---

## Prisma Schema Design

### Notification table

```prisma
// server/prisma/schema/notification.prisma
enum NotificationType {
  stack_error
  stack_unhealthy
  disk_warning
}

model Notification {
  id        String           @id @default(cuid())
  type      NotificationType
  stackId   String?          // null for disk_warning
  stack     Stack?           @relation(fields: [stackId], references: [id], onDelete: SetNull)
  message   String           // human-readable details
  emailSent Boolean          @default(false)
  createdAt DateTime         @default(now())

  @@index([createdAt])
  @@index([stackId, createdAt])
}
```

### Disk alert state (stored as Setting key)

Rather than a separate table, store disk alert state as a Setting key:
- `disk.alertActive` = `"true"` / `"false"` — avoids a new schema migration for a single boolean

### Stack incident tracking

For stack incidents, use a `StackIncident` table or — simpler — check the most recent `Notification` of that type for the stack. The NotificationWatcher pre-populates its in-process Map on startup by querying stacks currently in ERROR/UNHEALTHY state, so the DB serves as the restart-safe source of truth for incident state.

```prisma
// server/prisma/schema/notification.prisma (incident tracking)
model StackIncident {
  id          String    @id @default(cuid())
  stackId     String
  stack       Stack     @relation(fields: [stackId], references: [id], onDelete: Cascade)
  triggerType String    // "error" | "unhealthy"
  resolvedAt  DateTime? // null = active incident
  createdAt   DateTime  @default(now())

  @@unique([stackId, triggerType, resolvedAt])
  @@index([stackId, triggerType])
}
```

---

## API Routes

### New routes to add

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/smtp` | Returns SMTP settings (password masked) |
| PUT | `/api/settings/smtp` | Saves SMTP settings (encrypts password) |
| POST | `/api/settings/smtp/test` | Fires a test email immediately |
| GET | `/api/settings/notification-triggers` | Returns per-trigger toggle values |
| PUT | `/api/settings/notification-triggers` | Updates toggle values |
| GET | `/api/notifications` | Returns notification log (paginated or last 100) |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AES-256-CBC | AES-256-GCM | Node.js 10+ | GCM provides authenticated encryption; CBC does not |
| nodemailer v6 CommonJS | nodemailer v8 ESM-compatible | 2024 | v8 is fully ESM-compatible; project uses `"type": "module"` — no changes needed |
| `fs.statfs` callback | `fs.promises.statfs` | Node 18+ | Promise-based; cleaner async/await usage |

**Deprecated/outdated:**
- `AES-256-CBC for secrets`: Use GCM. CBC has no authentication tag, enabling padding oracle attacks.
- `nodemailer v6 `createTestAccount``: Not relevant for production SMTP — only useful for Ethereal testing.

---

## Open Questions

1. **ENCRYPTION_KEY rotation strategy**
   - What we know: AES-256-GCM key is stored in env; changing the key renders existing encrypted values unreadable
   - What's unclear: Phase 3 introduces the first encrypted secret; rotation is not required for MVP
   - Recommendation: Document key rotation as a known limitation; implement single-key pattern for Phase 3; Phase 4 (backup restic password) will also use it

2. **`/var/lib/docker` accessibility in Docker container**
   - What we know: Docktor runs inside a container; `/var/lib/docker` may not be mounted
   - What's unclear: Whether the project's `docker-compose.yml` mounts the Docker socket or data dir
   - Recommendation: Make the disk path configurable (`disk.monitorPath` setting, default `/var/lib/docker`). DiskChecker catches `ENOENT`/`EACCES` and logs a warning without crashing.

3. **Notification log pagination**
   - What we know: `GET /api/notifications` returns all records; log could grow large
   - What's unclear: Expected volume; whether UI needs infinite scroll or simple last-N
   - Recommendation: Return last 100 records by default (`orderBy: createdAt desc, take: 100`) — sufficient for MVP

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `server/vitest.config.ts` |
| Quick run command | `cd server && npm run test:unit` |
| Full suite command | `cd server && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTF-01 | SMTP settings saved/retrieved via SettingsService | unit | `cd server && npm run test:unit -- --reporter=verbose` | ❌ Wave 0 |
| NOTF-02 | AES-256-GCM encrypt/decrypt round-trip; encrypted flag written to DB | unit | `cd server && npm run test:unit -- --reporter=verbose` | ❌ Wave 0 |
| NOTF-03 | NotificationWatcher fires on ERROR; suppresses duplicate; cancels UNHEALTHY timer on recovery | unit | `cd server && npm run test:unit -- --reporter=verbose` | ❌ Wave 0 |
| NOTF-04 | DiskChecker calls statfs; triggers notification below threshold; suppresses when active | unit | `cd server && npm run test:unit -- --reporter=verbose` | ❌ Wave 0 |
| NOTF-06 | Toggle disabled = no notification fired | unit | `cd server && npm run test:unit -- --reporter=verbose` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd server && npm run test:unit`
- **Per wave merge:** `cd server && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/test/unit/lib/crypto.test.ts` — covers NOTF-02 (encrypt/decrypt round-trip, GCM tamper detection)
- [ ] `server/test/unit/application/notification-service.test.ts` — covers NOTF-01, NOTF-06 (toggle check, DB log, email send mock)
- [ ] `server/test/unit/jobs/notification-watcher.test.ts` — covers NOTF-03 (state transitions, deduplication, UNHEALTHY grace, recovery)
- [ ] `server/test/unit/jobs/disk-checker.test.ts` — covers NOTF-04 (statfs mock, threshold checks, suppression)

---

## Sources

### Primary (HIGH confidence)

- Node.js built-in `crypto` module (Node 24, tested locally) — AES-256-GCM encrypt/decrypt pattern verified
- Node.js built-in `fs.promises.statfs` (Node 24, tested locally) — returns `{bsize, blocks, bavail, bfree, files, ffree}`
- Codebase inspection: `server/src/jobs/state-poller.ts`, `server/src/jobs/update-checker.ts`, `server/src/jobs/index.ts` — job class pattern, constructor DI, lazy repo, node-cron usage
- Codebase inspection: `server/src/lib/state-broadcaster.ts` — `subscribe()` returns unsubscribe function; `ContainerStateEvent` carries `stackStatus`
- Codebase inspection: `server/prisma/schema/setting.prisma` — `encrypted Boolean @default(false)` already on Setting model
- Codebase inspection: `server/src/repositories/settings-repository.ts` — `upsert(key, value)` signature; `getMany(keys)` batch read
- Codebase inspection: `client/src/components/ui/tabs.tsx` — Radix UI Tabs already installed and wrapped
- npm registry: nodemailer@8.0.2 (latest, confirmed 2026-03-17)
- npm registry: @types/nodemailer@7.0.11 (latest, confirmed 2026-03-17)

### Secondary (MEDIUM confidence)

- nodemailer.com/usage (WebFetch verified 2026-03-17) — `createTransport`, `sendMail`, `verify` API confirmed; `secure: port === 465` guidance confirmed
- WebSearch (2026-03-17) — `secure: true` only for port 465, STARTTLS for 587; multiple sources agree

### Tertiary (LOW confidence)

- None — all claims verified by primary or secondary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nodemailer version confirmed via npm registry; Node built-ins tested locally
- Architecture: HIGH — all patterns derived from existing codebase files (StatePoller, UpdateChecker, SettingsService, StateBroadcaster)
- Pitfalls: HIGH — nodemailer TLS pitfall is documented by official source; crypto pitfalls are standard AES-GCM usage; others derived from code inspection

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (nodemailer is stable; Node built-ins don't change)
