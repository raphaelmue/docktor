# Phase 1: MVP Completion - Research

**Researched:** 2026-03-10
**Domain:** Real-time Docker event streaming (dockerode), SSE (Fastify + native EventSource), ANSI log rendering (React), settings persistence (Prisma key-value)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Real-time state propagation**
- SSE push for container state updates (not polling, not manual refresh)
- Single global SSE event feed — both dashboard (stack list, status counts) and stack detail page subscribe to the same stream
- Auto-reconnect with backoff using native EventSource behavior (no custom reconnect logic needed)
- On initial page load: show skeleton until SSE connection is established (not stale REST data)

**Log viewer layout**
- New "Logs" tab added to existing stack detail Tabs (alongside Overview, Compose, Environment)
- Service filter: dropdown selector above the log area ("All services" + per-service options); combined view prefixes each line with service name
- Log display: dark terminal style (black/dark-gray background, monospace font), fixed height with overflow scroll
- Toolbar controls: auto-scroll toggle, timestamps toggle, line wrap toggle, clear display button
- Service row in the services table has a "Logs" button that switches to the Logs tab pre-filtered to that service

**Service status in detail view**
- Services table gets a Status column with a colored badge (consistent with StackStatusBadge pattern)
- Status badge updates silently in place when SSE events arrive (no flash, no toast per update)
- Stack-level status badge in the page header also updates live via the SSE feed (not just on page refresh)

**Settings page UX**
- Settings lives as a dedicated sidebar nav item (same level as Dashboard and Stacks)
- Sectioned layout: one Card per logical category ("General" for Phase 1; later phases add Notifications, Backup, etc.)
- Timezone field: searchable combobox (user types to filter IANA timezone list — no free-text input)
- Save behavior: Save button per card section (each section saves independently)

### Claude's Discretion
- SSE event schema/format (what fields each state event contains)
- Whether state SSE and log SSE share a single connection or use separate endpoints
- Exact skeleton design for initial load
- dockerode client adapter structure (parallel to DockerExecutor)
- State poller reconciliation implementation details
- Exact fixed height for log viewer terminal area
- ANSI color rendering library choice

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBS-01 | Container state updates are event-driven: subscribe to dockerode event stream (`docker events`) and react to `start`, `stop`, `die`, `kill`, and `health_status` events in real time | DockerodeClient adapter using `docker.getEvents()` with filter; stream emits raw JSON chunks |
| OBS-02 | On each relevant Docker event, inspect the affected container via dockerode and update the stack/service status in the DB immediately | `docker.getContainer(id).inspect()` returns State.Status and Health.Status; update Service.containerState/healthStatus in DB |
| OBS-03 | Event-driven updates skip stacks in Docktor-owned transitional states (DEPLOYING, UPDATING, BACKING_UP, RESTORING, MIGRATING) | Check stack.status before writing; existing StackStatus enum covers all transitional states |
| OBS-04 | A 60s reconciliation loop performs a full state sync to catch any events missed during stream reconnects or Docker daemon restarts | Background job using node-cron (already installed); full `listContainers` sweep then bulk DB update |
| OBS-05 | User can stream live container logs per service via SSE | `GET /api/stacks/:id/logs?service=X` using reply.raw for SSE; `container.logs({follow:true, tail:100})` streams to client |
| OBS-06 | Log stream shows historical tail-N lines on connect, then live output | dockerode `container.logs({follow:true, stdout:true, stderr:true, tail:100, timestamps:true})` handles both in one stream |
| OBS-07 | Log viewer renders ANSI escape codes (color/bold) and prefixes each line with service name | `ansi-to-react` v6.2.6 (actively maintained, Jan 2026) renders ANSI in React; prefix added server-side or client-side |
| OBS-08 | Client reconnects automatically when SSE connection drops | Native EventSource auto-reconnects; no custom logic needed |
| OBS-09 | User can filter logs by service in the combined view | Log SSE endpoint accepts `service` query param; client-side dropdown switches param and reconnects EventSource |
| SET-01 | User can set instance name, base URL, and timezone via a Settings page | New `/settings` route; new `server/src/routes/settings.ts` plugin; existing Setting KV model in DB |
| SET-02 | Settings are persisted in the DB Settings key-value model | `prisma.setting.upsert({where:{key}, create:{key,value}, update:{value}})` pattern |
| SET-03 | Settings page validates input (valid IANA timezone, valid URL format) | `Intl.supportedValuesOf('timeZone')` gives canonical list; Zod `z.string().url()` for base URL; validated in shared schema |
</phase_requirements>

---

## Summary

Phase 1 adds three distinct capabilities on top of the existing Fastify + React + Prisma foundation: (1) real-time container state propagation via Docker event subscription and SSE push, (2) live log streaming per service with ANSI rendering and toolbar controls, and (3) a settings page with IANA timezone search. All server-side work follows established patterns — Fastify plugin with `requireAuth`, service-class in `application/`, repository pattern with Prisma.

The most technically novel work is the `DockerodeClient` adapter that wraps `dockerode`'s event and log streaming APIs. Dockerode is already installed (`^4.0.4`). For SSE, the project can use `reply.raw` directly (no plugin required) with a simple `request.raw.on('close', stream.destroy)` teardown — this avoids adding `@fastify/sse` as a dependency for what amounts to two streaming endpoints. For ANSI rendering, `ansi-to-react` (v6.2.6, actively maintained January 2026) is the right choice: it renders as React elements (not HTML strings), needs no `dangerouslySetInnerHTML`, and pairs well with a `<pre>` terminal container.

The shadcn `combobox` component (Popover + Command/cmdk) is NOT yet installed. The timezone searchable combobox requires `cmdk` which is a peer dependency. Because `cmdk` is not in the project, the planner must include a wave to install and wire the `Command` component before building the timezone UI.

**Primary recommendation:** Implement state SSE and log SSE as separate Fastify routes on `reply.raw`. State SSE broadcasts a compact JSON event per container change. Log SSE pipes dockerode's multiplexed stream with demux for non-TTY containers. Settings routes follow the existing `stacks.ts` plugin pattern exactly.

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| dockerode | ^4.0.4 | Docker Remote API client | Already in server deps; covers events, inspect, logs |
| node-cron | ^3.0.3 | Cron scheduler for 60s reconciliation loop | Already in server deps |
| fastify | ^5.2.1 | HTTP server + SSE via reply.raw | Existing server framework |
| prisma (via generated client) | Existing | DB persistence for service state + settings | Existing ORM |
| ansi-to-react | 6.2.6 (to install) | Render ANSI escape codes as React elements | Actively maintained Jan 2026, no dangerouslySetInnerHTML |

### To Install
| Library | Package | Purpose | Where |
|---------|---------|---------|-------|
| ansi-to-react | `ansi-to-react` | ANSI color rendering in log viewer | client |
| cmdk | `cmdk` | Command/combobox primitive for timezone search | client (via shadcn add command) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ansi-to-react` | `ansi-to-html` + `dangerouslySetInnerHTML` | ansi-to-html produces HTML strings requiring unsafe injection; ansi-to-react produces React elements cleanly |
| `reply.raw` SSE | `@fastify/sse` plugin | @fastify/sse v0.4.0 adds value for complex SSE (replay, keepAlive) but adds a dependency for two simple streaming routes; reply.raw is sufficient |
| Native EventSource reconnect | Custom reconnect with backoff | User explicitly chose native EventSource behavior; no custom reconnect logic |
| `cmdk` via shadcn | Custom filtered dropdown | cmdk is the shadcn ecosystem's standard; avoids reimplementing keyboard-navigable filtered list |

**Installation:**
```bash
# Client side
yarn workspace @docktor/client add ansi-to-react
npx --prefix client shadcn add command  # installs cmdk + adds client/src/components/ui/command.tsx

# Server side — nothing new, dockerode already installed
```

---

## Architecture Patterns

### Recommended Project Structure (new files only)
```
server/src/
├── infrastructure/
│   └── dockerode-client.ts      # NEW: DockerodeClient adapter (events, inspect, logs)
├── application/
│   └── settings-service.ts      # NEW: SettingsService (get/set key-value settings)
├── repositories/
│   └── settings-repository.ts   # NEW: SettingsRepository (prisma.setting CRUD)
├── jobs/
│   └── state-poller.ts          # NEW: Docker event listener + 60s reconciliation loop
├── routes/
│   └── settings.ts              # NEW: GET/PUT /api/settings routes

client/src/
├── hooks/
│   ├── use-container-events.ts  # NEW: SSE subscription hook for state events
│   └── use-log-stream.ts        # NEW: SSE hook for log streaming
├── lib/
│   └── settings-api.ts          # NEW: apiFetch wrappers for settings endpoints
├── components/
│   └── ui/
│       └── command.tsx           # NEW: added via shadcn (cmdk wrapper)
│   └── domain/stack/
│       └── log-viewer.tsx        # NEW: terminal-style log display with toolbar
└── routes/app/
    └── settings.tsx              # NEW: /settings page
```

### Pattern 1: DockerodeClient Adapter
**What:** Wraps dockerode's callback/promise API with a clean async interface; parallel to existing `DockerExecutor` for compose CLI.
**When to use:** All container inspection, event subscription, and log streaming.
**Example:**
```typescript
// server/src/infrastructure/dockerode-client.ts
import Dockerode from "dockerode"

export class DockerodeClient {
    private docker = new Dockerode({socketPath: "/var/run/docker.sock"})

    // Returns a readable stream of raw JSON event chunks
    // Filter: type=container, events=[start,stop,die,kill,health_status]
    async getEventStream(signal?: AbortSignal): Promise<NodeJS.ReadableStream> {
        return this.docker.getEvents({
            abortSignal: signal,
            filters: JSON.stringify({
                type: ["container"],
                event: ["start", "stop", "die", "kill", "health_status"],
            }),
        })
    }

    // Inspect a single container to get its runtime state
    async inspectContainer(containerId: string) {
        const container = this.docker.getContainer(containerId)
        return container.inspect()  // returns ContainerInspectInfo
    }

    // List all containers including stopped ones, optionally filter by label
    async listContainers(all = true) {
        return this.docker.listContainers({all})
    }

    // Returns a multiplexed log stream (needs demux for non-TTY containers)
    async getLogStream(containerId: string, tail = 100): Promise<NodeJS.ReadableStream> {
        const container = this.docker.getContainer(containerId)
        return container.logs({
            stdout: true,
            stderr: true,
            follow: true,
            tail,
            timestamps: true,
        })
    }
}
```

### Pattern 2: State SSE Route (reply.raw)
**What:** Single endpoint at `GET /api/events` that holds the HTTP response open and writes SSE-formatted events when container state changes.
**When to use:** Dashboard and stack detail page both connect to this same endpoint.
**Example:**
```typescript
// Inside a Fastify plugin route handler
app.get("/api/events", async (request, reply) => {
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",   // important: disables nginx buffering
    })

    // Subscribe client to the broadcaster
    const unsubscribe = stateEventBroadcaster.subscribe((event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    // Cleanup on client disconnect
    request.raw.on("close", () => {
        unsubscribe()
    })

    // Keep connection open until client disconnects
    await new Promise<void>((resolve) => {
        request.raw.on("close", resolve)
    })
})
```

### Pattern 3: State Event Broadcaster (in-process pub/sub)
**What:** A lightweight in-process event emitter that the `StatePoller` publishes to, and SSE route handlers subscribe to. No Redis required for single-process Fastify.
**When to use:** Decouples Docker event listener from HTTP response lifecycle.
**Example:**
```typescript
// server/src/lib/state-broadcaster.ts
import {EventEmitter} from "node:events"

export interface ContainerStateEvent {
    type: "container_state"
    stackId: string
    serviceName: string
    containerState: string
    healthStatus: string | null
    stackStatus: string
}

class StateBroadcaster extends EventEmitter {
    publish(event: ContainerStateEvent) {
        this.emit("event", event)
    }
    subscribe(handler: (event: ContainerStateEvent) => void): () => void {
        this.on("event", handler)
        return () => this.off("event", handler)
    }
}

export const stateEventBroadcaster = new StateBroadcaster()
```

### Pattern 4: Docker Event Listener + Reconciliation (StatePoller)
**What:** Background job that starts in `app.ts` `onReady` hook. Opens docker event stream, parses events, skips transitional stacks, inspects affected container, updates DB, broadcasts to SSE clients. Also runs a 60s cron for full reconciliation.
**When to use:** Registered once in server startup; never restarted mid-request.
**Example:**
```typescript
// server/src/jobs/state-poller.ts
export class StatePoller {
    private abortController = new AbortController()

    async start() {
        this.startEventStream()
        // 60s reconciliation loop
        cron.schedule("*/60 * * * * *", () => this.reconcile())
    }

    private async startEventStream() {
        try {
            const stream = await dockerodeClient.getEventStream(
                this.abortController.signal
            )
            stream.on("data", (chunk: Buffer) => {
                const event = JSON.parse(chunk.toString())
                this.handleEvent(event)
            })
            stream.on("end", () => {
                // Reconnect after 2s if not aborted
                if (!this.abortController.signal.aborted) {
                    setTimeout(() => this.startEventStream(), 2000)
                }
            })
        } catch (err) {
            // Log and retry
        }
    }

    private async handleEvent(event: DockerEvent) {
        const TRANSITIONAL = new Set(["DEPLOYING","UPDATING","BACKING_UP","RESTORING","MIGRATING"])

        // Find stack by matching container label (com.docker.compose.project)
        const stackId = event.Actor?.Attributes?.["com.docker.compose.project"]
        if (!stackId) return

        const stack = await stackRepo.findById(stackId)
        if (!stack || TRANSITIONAL.has(stack.status)) return

        // Inspect container to get current state
        const info = await dockerodeClient.inspectContainer(event.Actor.ID)
        // Update DB service row
        // Derive and update stack status
        // Broadcast to SSE clients
        stateEventBroadcaster.publish({...})
    }

    private async reconcile() {
        // Full sweep: listContainers, match to services by label, bulk-update DB
    }

    stop() {
        this.abortController.abort()
    }
}
```

### Pattern 5: Log SSE Route
**What:** `GET /api/stacks/:id/logs` — streams dockerode log output for a specific container to the client as SSE text lines.
**When to use:** Client opens when user navigates to Logs tab; closes when tab changes or page unmounts.
**Example:**
```typescript
app.get("/api/stacks/:id/logs", {schema: {params: stackParamsSchema, querystring: logQuerySchema}},
    async (request, reply) => {
        const {id} = request.params
        const {service} = request.query  // "all" or specific service name

        // Look up container ID for the service
        const containerId = await resolveContainerId(id, service)

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        })

        const logStream = await dockerodeClient.getLogStream(containerId, 100)

        // Dockerode returns a multiplexed stream for non-TTY containers
        // Each chunk has an 8-byte header: [stream_type, 0, 0, 0, size_bytes...]
        // Use docker.modem.demuxStream to split stdout/stderr
        logStream.on("data", (chunk: Buffer) => {
            const line = stripDockerMultiplexHeader(chunk)
            reply.raw.write(`data: ${JSON.stringify({line})}\n\n`)
        })

        // MANDATORY: destroy stream on client disconnect
        request.raw.on("close", () => {
            logStream.destroy()
        })

        await new Promise<void>((resolve) => {
            request.raw.on("close", resolve)
        })
    }
)
```

### Pattern 6: useContainerEvents Hook
**What:** React hook that opens an EventSource to `/api/events`, dispatches state updates into component state. Used in both dashboard and stack detail.
**When to use:** Replace/augment existing `useStacks` and `useStack` hooks.
**Example:**
```typescript
// client/src/hooks/use-container-events.ts
export function useContainerEvents(onEvent: (event: ContainerStateEvent) => void) {
    useEffect(() => {
        const es = new EventSource("/api/events", {withCredentials: true})
        es.onmessage = (e) => {
            const event = JSON.parse(e.data) as ContainerStateEvent
            onEvent(event)
        }
        es.onerror = () => {
            // Native EventSource auto-reconnects with exponential backoff
        }
        return () => es.close()
    }, [onEvent])
}
```

### Pattern 7: Settings Service + Repository
**What:** Follows the exact `StackService` / `StackRepository` pattern. `SettingsRepository` wraps `prisma.setting.upsert`. `SettingsService` validates and delegates.
**When to use:** `GET /api/settings` and `PUT /api/settings/:key` routes.
**Example:**
```typescript
// Settings key constants — avoids magic strings
export const SETTING_KEYS = {
    INSTANCE_NAME: "instance.name",
    BASE_URL: "instance.baseUrl",
    TIMEZONE: "instance.timezone",
} as const

// Repository
async upsert(key: string, value: string): Promise<Setting> {
    return prisma.setting.upsert({
        where: {key},
        create: {key, value},
        update: {value},
    })
}
```

### Anti-Patterns to Avoid
- **Polling container state from the client:** The user explicitly chose event-driven SSE push. Never add `setInterval` fetch loops for status updates.
- **Using `reply.hijack()` for SSE:** `reply.raw` with `writeHead` is sufficient and less complex. `reply.hijack()` bypasses all Fastify hooks.
- **Destroying log streams without the close handler:** Dockerode log streams are open HTTP connections to the Docker daemon. Without `request.raw.on('close', stream.destroy)`, they leak on client disconnect.
- **Free-text timezone input:** User decided on searchable combobox from IANA list. Do not allow arbitrary string input for timezone.
- **Writing stale REST data before SSE connects:** User explicitly chose skeleton loading until SSE is established. Do not show the last REST-fetched status during the SSE handshake window.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ANSI escape code parsing | Custom regex parser | `ansi-to-react` | 256-color, bold, underline, reset sequences — the edge cases are numerous |
| Docker multiplexed stream parsing | Custom 8-byte header stripper | `docker.modem.demuxStream()` | Docker's multiplex protocol has an 8-byte framing header; the modem utility handles it correctly |
| IANA timezone validation | Hardcoded list or regex | `Intl.supportedValuesOf('timeZone')` | Built into V8/Node.js; always current with the runtime's ICU data |
| SSE reconnect logic | Custom EventSource with backoff | Native browser `EventSource` | Spec-compliant auto-reconnect with Last-Event-ID; user explicitly chose this |
| In-process pub/sub | Redis, external queue | `EventEmitter`-based broadcaster | Single Fastify process; EventEmitter is sufficient and zero-dependency |
| Searchable filtered list | Custom dropdown + filter | shadcn `Command` (cmdk) | Keyboard navigation, accessibility, and filter logic are non-trivial to implement correctly |

**Key insight:** The Docker log multiplex format and ANSI escape sequences both have substantial edge cases. Use the libraries designed for them.

---

## Common Pitfalls

### Pitfall 1: Docker Log Stream Multiplex Header
**What goes wrong:** Raw dockerode log stream chunks start with an 8-byte binary header `[stream_type, 0, 0, 0, size_high, size_mid_high, size_mid_low, size_low]`. Sending the raw chunk to the client produces garbage characters at the start of every log line.
**Why it happens:** Docker uses a multiplexed stream for containers not running with a TTY (`tty: false` in compose). The header distinguishes stdout from stderr.
**How to avoid:** Use `docker.modem.demuxStream(stream, stdoutPassthrough, stderrPassthrough)` to split the streams, or write a simple 8-byte header stripper: `chunk.slice(8)` for each frame. Verify by checking if the first byte is `0x01` (stdout) or `0x02` (stderr).
**Warning signs:** Log lines displayed with a square/diamond character prefix, or garbled binary at line starts.

### Pitfall 2: EventSource Requires Cookies for Auth
**What goes wrong:** The native `EventSource` API does not support setting custom headers (no Authorization header possible). In the existing project, auth uses cookies (`@fastify/cookie`), so `withCredentials: true` is required.
**Why it happens:** The EventSource spec only allows `withCredentials` as a configuration option; no headers.
**How to avoid:** Construct `new EventSource(url, {withCredentials: true})` and ensure the SSE route still runs `requireAuth` hook (which reads the session cookie). The existing `@fastify/cors` config already includes `credentials: true`.
**Warning signs:** 401 responses to `/api/events` in the network panel when not using `withCredentials`.

### Pitfall 3: Skipping Transitional State Writes
**What goes wrong:** Docker emits a `start` event when a DEPLOYING stack's container starts. The event handler updates the stack status to RUNNING, overwriting the DEPLOYING status. The deploy route then tries to transition from DEPLOYING → RUNNING and fails or creates a race condition.
**Why it happens:** Docker events and the deploy flow run concurrently with no coordination beyond the DB.
**How to avoid:** In `StatePoller.handleEvent`, always check `stack.status` before writing. Skip if it's in `TRANSITIONAL_STATES = new Set(["DEPLOYING","UPDATING","BACKING_UP","RESTORING","MIGRATING"])`. This is explicitly documented as a blocker in STATE.md.
**Warning signs:** Stack stuck in DEPLOYING after successful deploy; deploy route throwing "transition not allowed" errors.

### Pitfall 4: Docker Event Stream Disconnects
**What goes wrong:** The Docker daemon can restart or the event stream can drop. A one-shot `getEvents()` call will not recover — the stream ends and no more events arrive.
**Why it happens:** Docker's `/events` endpoint closes the stream when the daemon restarts.
**How to avoid:** Add `stream.on("end", () => setTimeout(() => this.startEventStream(), 2000))` in `StatePoller`. The 60s reconciliation cron (OBS-04) catches state drift during any gap.
**Warning signs:** Container state stops updating after Docker daemon restart; reconciliation loop diverges from event-driven state.

### Pitfall 5: nginx Buffering Kills SSE
**What goes wrong:** When deployed behind nginx (or any reverse proxy), SSE events are buffered and not sent to the client until the buffer fills or flushes.
**Why it happens:** HTTP response buffering is the nginx default.
**How to avoid:** Always include `X-Accel-Buffering: no` response header on SSE routes. This disables nginx buffering for the connection.
**Warning signs:** Events arrive in bursts after a long delay rather than in real time.

### Pitfall 6: Log Stream Not Destroyed on Disconnect
**What goes wrong:** If `request.raw.on('close', stream.destroy)` is not wired, the dockerode log stream keeps the HTTP connection to the Docker daemon alive indefinitely after the client navigates away. Each page visit leaks a connection.
**Why it happens:** SSE is long-lived; the server has no way to know the client is gone except via the socket close event.
**How to avoid:** Always wire `request.raw.on('close', () => logStream.destroy())`. This is flagged as a mandatory concern in STATE.md.
**Warning signs:** Increasing number of open connections to Docker socket over time; Docker daemon resource usage growing.

### Pitfall 7: Combobox Component Not Yet Installed
**What goes wrong:** The `Command` shadcn component (needed for timezone combobox) is not in `client/src/components/ui/`. Running the settings page without it causes import errors.
**Why it happens:** `cmdk` is not in the project yet; `radix-ui` v1.4.3 (currently installed) does not include a `Command`/combobox primitive.
**How to avoid:** A Wave 0 task must run `shadcn add command` to install `cmdk` and generate `command.tsx` before the settings UI work begins.
**Warning signs:** Import error for `@/components/ui/command` when building the settings page.

---

## Code Examples

Verified patterns from codebase inspection and dockerode source:

### Docker getEvents() with filter
```typescript
// Source: dockerode/lib/docker.js — getEvents accepts opts.filters as JSON string
const stream = await docker.getEvents({
    filters: JSON.stringify({
        type: ["container"],
        event: ["start", "stop", "die", "kill", "health_status"],
    }),
})
// stream is a Node.js ReadableStream; each 'data' event is a Buffer
stream.on("data", (chunk: Buffer) => {
    const event = JSON.parse(chunk.toString())
    // event.Type, event.Action, event.Actor.ID, event.Actor.Attributes
})
```

### Docker container.inspect()
```typescript
// Source: dockerode/lib/container.js — inspect returns ContainerInspectInfo
const container = docker.getContainer(containerId)
const info = await container.inspect()
// info.State.Status: "running" | "exited" | "restarting" | "dead" | "paused"
// info.State.Health?.Status: "healthy" | "unhealthy" | "starting"
// info.Config.Labels["com.docker.compose.project"] — stack ID
// info.Config.Labels["com.docker.compose.service"] — service name
```

### Docker container.logs() with tail
```typescript
// Source: dockerode/lib/container.js — logs() with follow:true returns ReadableStream
const container = docker.getContainer(containerId)
const stream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    tail: 100,
    timestamps: true,
})
// For non-TTY containers, chunks are multiplexed with 8-byte header
// Strip with: chunk.slice(8) per frame, or use docker.modem.demuxStream()
```

### ansi-to-react usage
```tsx
// Source: github.com/nteract/ansi-to-react — v6.2.6, Jan 2026
import Ansi from "ansi-to-react"

function LogLine({text}: {text: string}) {
    return (
        <div className="font-mono text-sm leading-relaxed">
            <Ansi>{text}</Ansi>
        </div>
    )
}
```

### IANA timezone list (no dependency)
```typescript
// Source: MDN — Intl.supportedValuesOf() supported in Node.js 18+
const timezones = Intl.supportedValuesOf("timeZone")
// Returns string[] like ["Africa/Abidjan", "America/New_York", "Europe/Paris", ...]
// Use for client-side filtering in the combobox
```

### SSE client hook (React)
```typescript
// Base URL resolution matches existing apiFetch pattern in client/src/lib/api.ts
const BASE = globalThis.location.port === "5173" ? "http://localhost:3000" : ""

export function useContainerEvents(onEvent: (e: ContainerStateEvent) => void) {
    const stableHandler = useRef(onEvent)
    stableHandler.current = onEvent

    useEffect(() => {
        const es = new EventSource(`${BASE}/api/events`, {withCredentials: true})
        es.onmessage = (e) => stableHandler.current(JSON.parse(e.data))
        return () => es.close()
    }, [])
}
```

### Settings upsert (Prisma)
```typescript
// Source: prisma.setting model — existing schema (setting.prisma)
// model Setting { key String @id; value String; encrypted Boolean @default(false) }
await prisma.setting.upsert({
    where: {key: "instance.timezone"},
    create: {key: "instance.timezone", value: "Europe/Paris"},
    update: {value: "Europe/Paris"},
})
```

### Fastify SSE route skeleton (reply.raw pattern)
```typescript
// Source: Fastify docs + codebase pattern — avoids @fastify/sse dependency
app.get("/api/events", async (request, reply) => {
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })
    // write initial heartbeat comment to establish connection
    reply.raw.write(": connected\n\n")

    const unsubscribe = stateEventBroadcaster.subscribe((event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    await new Promise<void>((resolve) => {
        request.raw.on("close", () => {
            unsubscribe()
            resolve()
        })
    })
})
```

---

## SSE Event Schema (Claude's Discretion — Recommended)

Two separate SSE endpoints are recommended:

**`GET /api/events`** — Container state feed (global)
```typescript
// Emitted on every container state change
interface ContainerStateEvent {
    type: "container_state"
    stackId: string           // e.g. "my-nextcloud"
    serviceName: string       // e.g. "nextcloud"
    containerState: string    // "running" | "exited" | "restarting"
    healthStatus: string | null  // "healthy" | "unhealthy" | "starting" | null
    stackStatus: string       // derived stack-level status after this event
}
```

**`GET /api/stacks/:id/logs`** — Log stream (per stack, per service)
```typescript
// Query params: ?service=web (or omit for all services)
// Each SSE event:
interface LogLineEvent {
    type: "log"
    service: string    // service name prefix
    line: string       // raw log text (may contain ANSI codes)
    timestamp?: string // ISO string if timestamps=true
}
```

Rationale for two separate endpoints: (1) state events are global and long-lived; (2) log streams are per-stack, opened only when user is on the Logs tab, and need to be destroyed cleanly on tab exit. Sharing a single EventSource would require multiplexing/demultiplexing in JavaScript and add fragility.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling `/api/stacks/:id/containers` on interval | Docker event stream via SSE push | This phase | Eliminates polling lag; status reflects reality within milliseconds |
| `docker.modem.demuxStream()` with two Passthrough streams | Direct `chunk.slice(8)` per log frame | N/A (both valid) | `slice(8)` is simpler for SSE line-by-line; demuxStream is better for separate stdout/stderr |
| `ansi-html` (HTML output) | `ansi-to-react` (React elements) | ~2022 | No `dangerouslySetInnerHTML`; XSS-safe |

**Deprecated/outdated:**
- Polling container status from the client — explicitly rejected by user in CONTEXT.md
- `fastify-sse-v2` (community plugin) — superseded by official `@fastify/sse`; but for this project `reply.raw` is sufficient

---

## Open Questions

1. **Docker compose project label for stack identification**
   - What we know: Docker labels `com.docker.compose.project` and `com.docker.compose.service` are set by `docker compose up`
   - What's unclear: The project uses slugified stack IDs (e.g. "my-nextcloud") as the compose project name — need to verify this matches the label value exactly
   - Recommendation: In Wave 1, add a smoke test that deploys a stack and confirms `com.docker.compose.project` matches the stack ID slug

2. **demux vs. slice for log lines**
   - What we know: Non-TTY docker containers produce multiplexed streams; TTY containers (`tty: true` in compose) produce a raw byte stream
   - What's unclear: Whether the project's stacks will commonly use `tty: true`
   - Recommendation: Implement with the 8-byte header detection heuristic: if first byte is 0x01 or 0x02 and length > 8, strip the header; otherwise emit raw

3. **Service-to-containerId mapping for log streaming**
   - What we know: `docker.listContainers({all:true})` returns containers with labels including `com.docker.compose.project` and `com.docker.compose.service`
   - What's unclear: How to handle "All services" log mode — one EventSource per service or one combined stream
   - Recommendation: For "All services" mode, open N parallel dockerode log streams server-side (one per service), merge them with service-name prefix per line, and stream all through one SSE connection

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x (server unit), vitest 4.x + jsdom (client unit), Playwright (client integration) |
| Config file | `server/vitest.config.ts`, `client/vitest.config.ts` |
| Quick run command (server) | `yarn workspace @docktor/server test:unit` |
| Quick run command (client) | `yarn workspace @docktor/client test` |
| Full suite command | `yarn test` (workspace-level, all packages) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | DockerodeClient.getEventStream() applies correct filter | unit | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-02 | StatePoller.handleEvent() inspects container and updates DB service row | unit (mock dockerode + mock repo) | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-03 | StatePoller skips stacks in transitional states | unit | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-04 | StatePoller.reconcile() does full state sync | unit (mock listContainers) | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-05 | Log SSE route streams log lines as SSE events | integration (Fastify test instance) | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-06 | Log stream includes historical tail-N lines then live output | unit (mock container.logs) | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| OBS-07 | ansi-to-react renders ANSI codes without HTML injection | unit (React Testing Library) | `yarn workspace @docktor/client test` | ❌ Wave 0 |
| OBS-08 | useContainerEvents closes EventSource on unmount | unit (mock EventSource) | `yarn workspace @docktor/client test` | ❌ Wave 0 |
| OBS-09 | Log SSE endpoint accepts `service` query param | unit | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| SET-01 | Settings routes GET/PUT /api/settings work | unit | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| SET-02 | SettingsRepository.upsert() persists to DB | unit (mock prisma) | `yarn workspace @docktor/server test:unit` | ❌ Wave 0 |
| SET-03 | Zod schema rejects invalid timezone and URL | unit (shared validation) | `yarn workspace @docktor/shared test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn workspace @docktor/server test:unit && yarn workspace @docktor/client test`
- **Per wave merge:** `yarn test` (full workspace suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/test/unit/infrastructure/dockerode-client.test.ts` — covers OBS-01, OBS-06
- [ ] `server/test/unit/jobs/state-poller.test.ts` — covers OBS-02, OBS-03, OBS-04
- [ ] `server/test/unit/application/settings-service.test.ts` — covers SET-01, SET-02
- [ ] `shared/test/unit/validation/settings-phase1.test.ts` — covers SET-03 (timezone + URL validation)
- [ ] `client/test/unit/hooks/use-container-events.test.ts` — covers OBS-08
- [ ] `client/test/unit/components/log-viewer.test.tsx` — covers OBS-07, OBS-09

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection — `server/src/infrastructure/docker-executor.ts`, `server/src/application/stack-service.ts`, `server/src/routes/stacks.ts`, `server/src/app.ts`, all Prisma schemas, client hooks and routes — direct source read
- `node_modules/dockerode/lib/docker.js` and `container.js` — direct source inspection of `getEvents()`, `container.logs()`, `container.inspect()`, `listContainers()` signatures
- `server/package.json` — confirmed dockerode ^4.0.4, node-cron ^3.0.3, fastify ^5.2.1 already installed
- `client/package.json` — confirmed ansi-to-react NOT installed; cmdk NOT installed; radix-ui 1.4.3 has no Command primitive

### Secondary (MEDIUM confidence)
- github.com/nteract/ansi-to-react — v6.2.6, last release January 24 2026; confirmed active
- github.com/fastify/sse — @fastify/sse v0.4.0; reply.raw alternative confirmed via Fastify docs
- MDN Intl.supportedValuesOf('timeZone') — native Node.js API, no dependency needed

### Tertiary (LOW confidence)
- WebSearch: @fastify/sse v0.4.0 peer dependency requirements — version confirmed but Fastify v5 explicit compat not verified from official source
- WebSearch: Docker compose labels `com.docker.compose.project` / `.service` — standard behavior, not verified against dockerode docs directly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core libraries verified from installed node_modules and package.json
- Architecture: HIGH — patterns derived directly from existing codebase patterns (StackService, DockerExecutor, routes/stacks.ts)
- Pitfalls: HIGH — OBS-specific pitfalls documented in STATE.md and verified from dockerode source
- ANSI library choice: MEDIUM — ansi-to-react v6.2.6 confirmed active, but not installed yet

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (30 days — stable ecosystem, dockerode and fastify are mature)
