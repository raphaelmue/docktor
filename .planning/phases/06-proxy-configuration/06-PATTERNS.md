# Phase 6: Proxy Configuration - Pattern Map

**Mapped:** 2026-09-03
**Files analyzed:** 19
**Analogs found:** 19 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `shared/src/validation/proxy.ts` | config (Zod schema) | request-response | `shared/src/validation/backups.ts` | exact |
| `server/prisma/schema/proxy.prisma` (revise) | model | CRUD | itself (existing, dormant) — pattern from `server/prisma/schema/setting.prisma` for key/value shape | exact (revision, not new) |
| `server/prisma/schema/stack.prisma` (add `isProtected`) | model | CRUD | itself (existing) | exact (revision) |
| `server/src/repositories/proxy-repository.ts` | repository | CRUD | `server/src/repositories/backup-repository.ts` | exact |
| `server/src/lib/compose-proxy-editor.ts` | utility (compose mutation) | transform | `server/src/lib/compose-editor.ts` | exact |
| `server/src/application/proxy-service.ts` | service (application) | CRUD + event-driven (redeploy) | `server/src/application/backup-service.ts` (layering) + `server/src/application/stack-service.ts` (deploy/guard pattern) | exact |
| `server/src/application/settings-service.ts` (extend: `getProxyAcmeEmail`/`getProxySettings`) | service | CRUD | itself (existing `getSmtpConfig()`/`getGeneralSettings()` getters) | exact (extension) |
| `server/src/jobs/proxy-cert-poller.ts` | job (background poller) | event-driven / streaming | `server/src/jobs/state-poller.ts` | exact |
| `server/src/lib/state-broadcaster.ts` (extend: `ProxyCertStatusEvent`) | utility (pub-sub) | pub-sub | itself (existing discriminated union) | exact (extension) |
| `server/src/routes/proxy.ts` | route | request-response | `server/src/routes/backups.ts` | exact |
| `server/src/application/stack-service.ts` (extend: `isProtected` guards in `stopStack`/`restartStack`/`deleteStack`) | service | CRUD | itself (existing `guardTransition` pattern) | exact (extension) |
| `client/src/lib/proxy-api.ts` | api-client | request-response | `client/src/lib/backups-api.ts` | exact |
| `client/src/routes/app/stacks/components/proxy-tab.tsx` | component (tab) | request-response | `client/src/routes/app/stacks/components/backup-config-card.tsx` (form+card shape) + `[id].tsx`'s backups tab wiring | exact |
| `client/src/routes/app/settings/components/proxy-settings-card.tsx` | component | request-response | `client/src/routes/app/stacks/components/backup-config-card.tsx` (settings-card shape); note CLAUDE.md's Known Refactoring Target for `settings.tsx` — extract into `routes/app/settings/components/`, don't add to the monolith | role-match |
| `client/src/routes/setup/components/proxy-step.tsx` | component (wizard step) | request-response | `client/src/routes/setup/components/backup-step.tsx` | exact |
| `client/src/hooks/use-proxy-status.ts` | hook (SSE subscriber) | streaming | existing `useContainerEvents`-style SSE hook (see Shared Patterns — EventSource pattern) | role-match |
| `client/src/routes/app/stacks/components/stack-actions.tsx` (extend: disable actions when `isProtected`) | component | request-response | itself (existing `canStop`/`canDelete` derived-state pattern) | exact (extension) |
| `client/src/routes/app/stacks/[id].tsx` (extend: `"proxy"` tab) | route (page) | request-response | itself (existing `"backups"` tab entry) | exact (extension) |
| `server/prisma/proxy-stack-compose.ts` (or similar — compose skeleton renderer for the `docktor-proxy` stack) | utility | transform | Pattern 3 in RESEARCH.md (nginx-proxy/acme-companion compose skeleton) — no direct in-repo analog; nearest structural precedent is `createComposeConfig`/`StackFilesystem.writeCompose()` call shape in `stack-service.ts:39-64` | role-match |

## Pattern Assignments

### `server/src/repositories/proxy-repository.ts` (repository, CRUD)

**Analog:** `server/src/repositories/backup-repository.ts` (all 120 lines read — small file, full pattern extracted)

**Full shape to mirror** (class with singleton export at bottom, `prisma` import from `../lib/db.js`, `NotFoundError` from `../lib/errors.js`):
```typescript
import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";

export class ProxyRepository {
    async create(data: {stackId: string; serviceName: string; domain: string; internalPort: number; tlsEnabled: boolean}) {
        return prisma.proxyConfig.create({data});
    }

    async findById(id: string) {
        return prisma.proxyConfig.findUnique({where: {id}});
    }

    async findByIdOrThrow(id: string) {
        const config = await prisma.proxyConfig.findUnique({where: {id}});
        if (!config) throw new NotFoundError(`ProxyConfig "${id}" not found`);
        return config;
    }

    // Mirrors findByStackId — but proxy also needs a (stackId, serviceName)
    // grouping to aggregate multiple domains into one comma-separated env
    // var value (see compose-proxy-editor.ts pattern / Pitfall 1 in RESEARCH.md)
    async findByStackId(stackId: string) {
        return prisma.proxyConfig.findMany({where: {stackId}, orderBy: {createdAt: "asc"}});
    }

    async findByStackAndService(stackId: string, serviceName: string) {
        return prisma.proxyConfig.findMany({where: {stackId, serviceName}, orderBy: {createdAt: "asc"}});
    }

    async delete(id: string) {
        return prisma.proxyConfig.delete({where: {id}});
    }
}

export const proxyRepository = new ProxyRepository();
```
Note: `@@unique([domain])` (D-07) means `create()` must let the Prisma unique-constraint violation surface — translate it to `ConflictError` in the service layer (see `proxy-service.ts` below), matching `StackService.createStack()`'s slug-conflict translation, not inside the repository itself (repository stays a thin Prisma wrapper, per every existing repository in this codebase).

---

### `server/src/lib/compose-proxy-editor.ts` (utility, transform)

**Analog:** `server/src/lib/compose-editor.ts` (full file, 104 lines, read verbatim)

**Imports pattern** (lines 1):
```typescript
import {isScalar, parseDocument, type Scalar} from "yaml";
```

**Error class pattern** (lines 16-24) — mirror exactly, new reason enum:
```typescript
export type ComposeProxyEditErrorReason = "no-services" | "service-not-found" | "proxy-network-missing";

export class ComposeProxyEditError extends Error {
    constructor(message: string, public readonly reason: ComposeProxyEditErrorReason) {
        super(message);
        this.name = "ComposeProxyEditError";
    }
}
```

**Core surgical-mutation pattern** (lines 86-104, `setServiceImageTag`) — mirror this exact shape for `setServiceProxyEnv`/`removeServiceProxyEnv`, targeting `["services", serviceName, "environment", "VIRTUAL_HOST"]` etc. and `["services", serviceName, "networks"]` instead of `["services", serviceName, "image"]`:
```typescript
export function setServiceProxyEnv(
    content: string,
    serviceName: string,
    env: {virtualHost: string; virtualPort: string; letsencryptHost: string | null},
): string {
    const doc = parseDocument(content);
    if (!doc.hasIn(["services", serviceName])) {
        throw new ComposeProxyEditError(`Service "${serviceName}" not found in compose file`, "service-not-found");
    }

    setEnvScalar(doc, serviceName, "VIRTUAL_HOST", env.virtualHost);
    setEnvScalar(doc, serviceName, "VIRTUAL_PORT", env.virtualPort);
    if (env.letsencryptHost) {
        setEnvScalar(doc, serviceName, "LETSENCRYPT_HOST", env.letsencryptHost);
    } else {
        doc.deleteIn(["services", serviceName, "environment", "LETSENCRYPT_HOST"]);
    }

    // Add the shared external network if not already present (D-03)
    const networksPath = ["services", serviceName, "networks"];
    const existing = (doc.getIn(networksPath) as unknown as string[] | undefined) ?? [];
    if (!existing.includes("docktor_proxy")) {
        doc.setIn(networksPath, [...existing, "docktor_proxy"]);
    }
    doc.setIn(["networks", "docktor_proxy", "external"], true);

    return doc.toString({lineWidth: 0});
}

function setEnvScalar(doc: ReturnType<typeof parseDocument>, serviceName: string, key: string, value: string) {
    const path = ["services", serviceName, "environment", key];
    const node = doc.getIn(path, true);
    if (isScalar(node)) {
        (node as Scalar).value = value;
    } else {
        doc.setIn(path, value);
    }
}
```

**Pitfall guard (from RESEARCH.md Pitfall 1):** the caller (`proxy-service.ts`) must always re-read ALL `ProxyConfig` rows for `(stackId, serviceName)` and pass one comma-joined `virtualHost`/`letsencryptHost` value — never call this function once per domain.

---

### `server/src/application/proxy-service.ts` (application service, CRUD + event-driven)

**Analog 1 (layering/idempotency/error translation):** `server/src/application/backup-service.ts` (815 lines — grep-targeted read; conflict/idempotency error-translation pattern) — the ConflictError-on-slug-exists pattern actually lives in `stack-service.ts:45-47`:
```typescript
// server/src/application/stack-service.ts:45-47 — mirror for domain uniqueness (D-07)
if (await this.repo.exists(id)) {
    throw new ConflictError(`Stack "${id}" already exists`);
}
```
For `assignDomain`, catch the Prisma `P2002` unique-constraint error on `domain` and translate to `ConflictError(\`Domain "${domain}" is already assigned to another service\`)`.

**Analog 2 (deploy-stack-as-Stack-row + guard pattern):** `server/src/application/stack-service.ts:39-64` (`createStack`) and `:165-232` (`deployStack`) — read verbatim above. Reuse this exact call shape for `deployProxyStack()`:
```typescript
async deployProxyStack(): Promise<void> {
    const id = "docktor-proxy";
    if (await this.stackRepo.exists(id)) return; // idempotent

    await assertHostPortsFree([80, 443]); // D-11 — see Common Pitfalls in RESEARCH.md

    const acmeEmail = await this.settings.getProxyAcmeEmail();
    const composeContent = renderProxyStackCompose({acmeEmail});
    const hostPath = await this.fs.createDirectory(id);
    await this.fs.writeCompose(id, composeContent);
    const composeConfig = createComposeConfig(composeContent);

    await this.stackRepo.create({id, displayName: "Docktor Proxy", hostPath, composeConfig, isProtected: true});
    await this.stackService.deployStack(id);
}
```

**Core `assignDomain`/`removeDomain` orchestration shape** (mirrors `stack-service.ts`'s try/catch-with-error-translation around `docker` calls, `:165-232`):
```typescript
async assignDomain(stackId: string, serviceName: string, input: {domain: string; internalPort: number; tlsEnabled: boolean}) {
    const proxyStack = await this.stackRepo.findById("docktor-proxy");
    if (!proxyStack) {
        throw new BadRequestError("Proxy stack is not deployed. Deploy it in Settings first.");
    }

    try {
        await this.proxyRepo.create({stackId, serviceName, ...input});
    } catch (err) {
        throw this.translateProxyConfigError(err); // P2002 -> ConflictError, mirrors stack-service.ts's translateComposeEditError shape
    }

    await this.rewriteServiceProxyEnvAndRedeploy(stackId, serviceName); // aggregates all rows, calls compose-proxy-editor, then this.stackService.deployStack(stackId)
}
```

**Error translation pattern to mirror** (`server/src/application/stack-service.ts:566-577`, verbatim):
```typescript
private translateComposeEditError(err: unknown): Error {
    if (err instanceof ComposeEditError) {
        if (err.reason === "service-not-found") {
            return new NotFoundError(err.message);
        }
        return new BadRequestError(err.message);
    }
    return err instanceof Error ? err : new Error(String(err));
}
```

---

### `server/src/application/settings-service.ts` (extend)

**Analog:** itself, `getSmtpConfig()` (lines 42-77) and `getGeneralSettings()`/`updateGeneralSettings()` (lines 79-135) — full file read (136 lines).

**Getter/setter convention to extend with `proxy.acmeEmail`/`proxy.showInDashboard` keys** (mirrors `SETTING_KEYS` const + `getGeneralSettings()` shape at lines 8-12, 79-91):
```typescript
const PROXY_SETTING_KEYS = {
    ACME_EMAIL: "proxy.acmeEmail",
    SHOW_IN_DASHBOARD: "proxy.showInDashboard",
} as const

export interface ProxySettings {
    acmeEmail: string
    showInDashboard: boolean
}

async getProxySettings(): Promise<ProxySettings> {
    const values = await this.repo.getMany([PROXY_SETTING_KEYS.ACME_EMAIL, PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD])
    return {
        acmeEmail: values[PROXY_SETTING_KEYS.ACME_EMAIL] ?? "",
        showInDashboard: values[PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD] === "true",
    }
}

async updateProxySettings(data: Partial<ProxySettings>): Promise<void> {
    const updates: Array<{key: string; value: string}> = []
    if (data.acmeEmail !== undefined) updates.push({key: PROXY_SETTING_KEYS.ACME_EMAIL, value: data.acmeEmail})
    if (data.showInDashboard !== undefined) updates.push({key: PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD, value: String(data.showInDashboard)})
    await Promise.all(updates.map(({key, value}) => this.repo.upsert(key, value)))
}
```
No encryption needed (ACME email is not a secret) — unlike `smtp.password`, skip the `decrypt()` step entirely; `crypto.ts` is not needed for this phase's settings.

---

### `server/src/jobs/proxy-cert-poller.ts` (job, event-driven/streaming)

**Analog:** `server/src/jobs/state-poller.ts` (constructor + `start()`/`stop()`, lines 78-122, read verbatim).

**Cron + lifecycle pattern to mirror exactly:**
```typescript
export class ProxyCertPoller {
    private cronTask: cron.ScheduledTask | null = null
    private readonly broadcaster: Pick<StateBroadcaster, "publish">

    constructor(broadcaster?: Pick<StateBroadcaster, "publish">) {
        this.broadcaster = broadcaster ?? stateEventBroadcaster
    }

    async start(): Promise<void> {
        this.cronTask = cron.schedule("*/60 * * * * *", async () => {
            try {
                await this.reconcile()
            } catch (err) {
                console.error("[ProxyCertPoller] reconcile error:", err)
            }
        })
    }

    stop(): void {
        if (this.cronTask) {
            this.cronTask.stop()
            this.cronTask = null
        }
    }

    private async reconcile(): Promise<void> {
        // per D-05: stat() the bind-mounted certs dir for each ProxyConfig's
        // domain, and/or tail acme-companion's log via DockerodeClient.getLogStream()
        // (see below), then this.broadcaster.publish({type: "proxy_cert_status", ...})
    }
}
```

**Log-tail primitive** (`server/src/infrastructure/dockerode-client.ts:35-42`, verbatim, already tracked/verified):
```typescript
async getLogStream(containerId: string, tail = 100): Promise<NodeJS.ReadableStream> {
    return this.docker.getContainer(containerId).logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail,
        timestamps: true,
    }) as unknown as NodeJS.ReadableStream
}
```

---

### `server/src/lib/state-broadcaster.ts` (extend)

**Analog:** itself (full file, 71 lines, read verbatim above).

**Add new discriminated-union member, mirroring `ConfigChangedEvent`'s shape (lines 25-29):**
```typescript
export interface ProxyCertStatusEvent {
    type: "proxy_cert_status"
    proxyConfigId: string
    domain: string
    status: "pending" | "issued" | "failed"
    message?: string
}

export type StateEvent =
    | ContainerStateEvent
    | StackStatusEvent
    | ConfigChangedEvent
    | ConfigErrorEvent
    | UpdateAvailableEvent
    | NotificationCreatedEvent
    | ProxyCertStatusEvent   // new
```

---

### `server/src/routes/proxy.ts` (route, request-response)

**Analog:** `server/src/routes/backups.ts` (imports + plugin shape, lines 1-30 read verbatim; full file is 427 lines, grep-targeted for the shape only).

**Imports + plugin registration pattern:**
```typescript
import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {z} from "zod"
import {assignDomainSchema, removeDomainSchema} from "@docktor/shared"
import {requireAuth} from "../lib/auth-middleware.js"
import {proxyService} from "../application/index.js"

const stackServiceParamsSchema = z.object({id: z.string(), serviceName: z.string()})

const proxyPlugin: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    app.post(
        "/api/stacks/:id/services/:serviceName/proxy",
        {schema: {params: stackServiceParamsSchema, body: assignDomainSchema}},
        async (request, reply) => {
            const {id, serviceName} = request.params
            const config = await proxyService.assignDomain(id, serviceName, request.body)
            return reply.status(201).send(config)
        },
    )

    app.delete(
        "/api/proxy-configs/:proxyConfigId",
        {schema: {params: z.object({proxyConfigId: z.string()})}},
        async (request, reply) => {
            await proxyService.removeDomain(request.params.proxyConfigId)
            return reply.status(204).send()
        },
    )
}

export default proxyPlugin
```
Thin handlers — all logic delegates to `proxyService`, per CLAUDE.md's "Routes only call application services" rule.

---

### `server/src/application/stack-service.ts` (extend — D-12 protected-stack guard)

**Analog:** itself, `guardTransition` (lines 555-564) and each action method's opening two lines (`stopStack` lines 234-236, `deleteStack` lines 150-152, `restartStack` lines 258-260), all read verbatim above.

**Pattern to add — insert an `isProtected` check before `guardTransition` in each of `stopStack`/`restartStack`/`deleteStack` (per RESEARCH.md Pitfall 4, server-side enforcement is the actual guarantee, not just client-side disabling):**
```typescript
async stopStack(id: string) {
    const stack = await this.repo.findByIdOrThrow(id);
    if (stack.isProtected) {
        throw new BadRequestError(`Stack "${id}" is managed by Docktor and cannot be stopped directly`);
    }
    this.guardTransition(stack.status as StackStatus, "STOP");
    // ...unchanged
}
```
Apply the identical two-line guard to `restartStack` and `deleteStack`. `deployStack` and `updateImages` are NOT blocked (the proxy stack must still be deployable/updatable by `proxy-service.ts`'s own internal calls) — only user-facing destructive/interrupting actions (stop/restart/delete) are guarded, per D-12's wording ("stop/delete/restart").

---

### `client/src/lib/proxy-api.ts` (api-client, request-response)

**Analog:** `client/src/lib/backups-api.ts` (full file, 139 lines, read verbatim).

**Shape to mirror exactly** (interfaces + pure `apiFetch<T>` functions, no side effects):
```typescript
import {apiFetch} from "@/lib/api"

export interface ProxyConfig {
    id: string
    stackId: string
    serviceName: string
    domain: string
    internalPort: number
    tlsEnabled: boolean
    createdAt: string
    updatedAt: string
}

export interface AssignDomainInput {
    domain: string
    internalPort: number
    tlsEnabled: boolean
}

export async function getProxyConfigs(stackId: string): Promise<ProxyConfig[]> {
    return apiFetch<ProxyConfig[]>(`/api/stacks/${stackId}/proxy-configs`)
}

export async function assignDomain(stackId: string, serviceName: string, data: AssignDomainInput): Promise<ProxyConfig> {
    return apiFetch<ProxyConfig>(`/api/stacks/${stackId}/services/${serviceName}/proxy`, {
        method: "POST",
        body: JSON.stringify(data),
    })
}

export async function removeDomain(proxyConfigId: string): Promise<void> {
    await apiFetch(`/api/proxy-configs/${proxyConfigId}`, {method: "DELETE"})
}

// Global proxy-stack settings (mirrors getBackupSettings/saveBackupSettings)
export interface ProxySettings {
    acmeEmail: string
    showInDashboard: boolean
}

export async function getProxySettings(): Promise<ProxySettings> {
    return apiFetch<ProxySettings>("/api/settings/proxy")
}

export async function saveProxySettings(data: Partial<ProxySettings>): Promise<void> {
    await apiFetch("/api/settings/proxy", {method: "PUT", body: JSON.stringify(data)})
}

export async function deployProxyStack(): Promise<void> {
    await apiFetch("/api/settings/proxy/deploy", {method: "POST"})
}
```

---

### `client/src/routes/app/stacks/components/proxy-tab.tsx` (component, request-response)

**Analog:** `client/src/routes/app/stacks/components/backup-config-card.tsx` (full file, 276 lines, read verbatim) for the card+form+load-effect shape; `[id].tsx` for tab wiring.

**Load-effect + loading-state pattern to mirror** (lines 26-76, 116-127):
```typescript
const [configs, setConfigs] = useState<ProxyConfig[] | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
    let cancelled = false;
    async function load() {
        setLoading(true);
        try {
            const data = await getProxyConfigs(stackId);
            if (!cancelled) setConfigs(data);
        } catch { /* silently fail — mirrors backup-config-card.tsx:65-66 */ }
        finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
}, [stackId]);

if (loading || !configs) {
    return <Card><CardHeader><CardTitle>Proxy</CardTitle></CardHeader>
      <CardContent><Skeleton className="h-24" /></CardContent></Card>; // UI-SPEC prescribes Skeleton over backup-config-card's plain text
}
```

**`toast.promise` submit pattern to mirror** (lines 109-114, verbatim shape, copy strings per UI-SPEC's Copywriting Contract):
```typescript
function handleAssign(data: AssignDomainInput) {
    toast.promise(assignDomain(stackId, serviceName, data).then(() => reloadConfigs()), {
        loading: "Assigning domain...",
        success: "Domain assigned",
        error: (err: Error) => err?.message ?? "Assign domain failed",
    });
}
```

**Tab wiring in `[id].tsx`** — `VALID_TABS` array is at line 41 (`["overview", "compose", "environment", "logs", "backups"]`), `tabLabels` map at line 154, `<TabsTrigger value="backups">` at line 240, `<TabsContent value="backups">` at line 371 — add `"proxy"` to all four locations following the exact same shape as the existing `"backups"` entry.

---

### `client/src/routes/app/settings/components/proxy-settings-card.tsx` (component, request-response)

**Analog:** `client/src/routes/app/stacks/components/backup-config-card.tsx` (Switch + Label + toast.promise save pattern, lines 145-174, 271-273).

Per CLAUDE.md's Known Refactoring Target for `settings.tsx` — this must be a new file under `routes/app/settings/components/` from the start, not added inline to the settings page monolith.

---

### `client/src/routes/setup/components/proxy-step.tsx` (component, wizard step)

**Analog:** `client/src/routes/setup/components/backup-step.tsx` (full file, 212 lines, read verbatim).

**Full form shape to mirror** — `useForm` + `standardSchemaResolver`, optional-step footer with Back/Skip/Next buttons (lines 1-35, 199-207):
```typescript
const form = useForm<ProxyStepInput>({
    resolver: standardSchemaResolver(proxyStepSchema),
    defaultValues: {acmeEmail: ""},
});

// ...CardFooter:
<CardFooter className="flex justify-between">
    <Button type="button" variant="outline" onClick={onBack}>Back</Button>
    <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onSkip}>Skip</Button>
        <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Deploy Proxy Stack"}</Button>
    </div>
</CardFooter>
```
Copy per UI-SPEC's Copywriting Contract: primary CTA is "Deploy Proxy Stack" (not "Next" — this step submits + deploys, matching D-10's "deployed at First-Run Wizard time" semantics), secondary "Skip".

---

### `client/src/hooks/use-proxy-status.ts` (hook, streaming/SSE)

**Analog:** no `use-*-status.ts` SSE hook file was read directly this session, but `state-broadcaster.ts`'s `ProxyCertStatusEvent` (added above) is the payload shape this hook must subscribe to via the existing SSE endpoint/EventSource plumbing already used by other real-time hooks in `client/src/hooks/`. Mirror the existing hook's `EventSource` open/cleanup convention (per CLAUDE.md: "Hooks must close the `EventSource` in the cleanup function to prevent connection leaks").

---

### `shared/src/validation/proxy.ts` (Zod schemas)

**Analog:** `shared/src/validation/backups.ts` (full file, 68 lines, read verbatim) — same file-organization convention (grouped by use case, `z.infer` type exports, `superRefine` for cross-field rules where needed).

```typescript
import {z} from "zod";

const hostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export const assignDomainSchema = z.object({
    domain: z.string().min(1).regex(hostnamePattern, "Must be a valid hostname"),
    internalPort: z.coerce.number().int().min(1).max(65535),
    tlsEnabled: z.boolean().default(true),
});
export type AssignDomainInput = z.infer<typeof assignDomainSchema>;

export const proxySettingsSchema = z.object({
    acmeEmail: z.string().email().or(z.literal("")).optional(),
    showInDashboard: z.boolean().optional(),
});
export type ProxySettingsInput = z.infer<typeof proxySettingsSchema>;

export const proxyStepSchema = z.object({
    acmeEmail: z.string().email().or(z.literal("")).optional(),
});
export type ProxyStepInput = z.infer<typeof proxyStepSchema>;
```
Security note (RESEARCH.md's Known Threat Patterns): the `hostnamePattern` regex is the domain-injection mitigation required before any value reaches `compose-proxy-editor.ts` — validate at this Zod boundary in `routes/proxy.ts`, do not rely on the compose editor alone.

## Shared Patterns

### Authentication
**Source:** `server/src/routes/backups.ts:24` — `app.addHook("onRequest", requireAuth)`
**Apply to:** `server/src/routes/proxy.ts` (all endpoints)

### Error Handling / Translation
**Source:** `server/src/application/stack-service.ts:566-577` (`translateComposeEditError`)
**Apply to:** `proxy-service.ts`'s translation of `ComposeProxyEditError` → `NotFoundError`/`BadRequestError`, and Prisma `P2002` → `ConflictError` for domain uniqueness (D-07)

### Toast feedback (client)
**Source:** `client/src/routes/app/stacks/components/backup-config-card.tsx:109-114`, `stack-actions.tsx:41-52`
**Apply to:** `proxy-tab.tsx` (assign/remove domain), `proxy-settings-card.tsx` (save settings), copy strings per UI-SPEC's Copywriting Contract table

### Settings key/value convention
**Source:** `server/src/application/settings-service.ts:8-12, 79-91` (`SETTING_KEYS` const + getter/setter), `server/src/repositories/settings-repository.ts` (`upsert`/`getMany`)
**Apply to:** `proxy.acmeEmail`, `proxy.showInDashboard` setting keys — no encryption needed (unlike `smtp.password`)

### Protected/guarded stack actions (D-12)
**Source:** `server/src/application/stack-service.ts:555-564` (`guardTransition`) + each action method's `findByIdOrThrow`→check→`guardTransition` opening (lines 150-152, 234-236, 258-260)
**Apply to:** new `isProtected` check inserted as the first check (before `guardTransition`) in `stopStack`/`restartStack`/`deleteStack`; client-side mirror in `stack-actions.tsx`'s `canStop`/`canRestart`/`canDelete` derived booleans (lines 31-34)

### Compose surgical-edit primitive
**Source:** `server/src/lib/compose-editor.ts` (full file — `parseDocument`/`isScalar`/`Scalar`/`doc.toString({lineWidth: 0})`)
**Apply to:** `compose-proxy-editor.ts` — never use `compose-rewriter.ts`'s full-restringify approach for repeated per-service edits (see RESEARCH.md Anti-Patterns)

### Background poller (cron reconcile + SSE publish)
**Source:** `server/src/jobs/state-poller.ts:78-122` (constructor/`start()`/`stop()`/cron shape), `server/src/lib/state-broadcaster.ts` (publish/subscribe)
**Apply to:** `proxy-cert-poller.ts`

### One-component-per-tab (stack detail page)
**Source:** `client/src/routes/app/stacks/[id].tsx` — `VALID_TABS` (line 41), `tabLabels` (line 154), `TabsTrigger`/`TabsContent value="backups"` (lines 240, 371)
**Apply to:** new `"proxy"` tab entry, identical shape

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `server/src/lib/proxy-stack-compose.ts` (compose skeleton renderer for `nginx-proxy`+`acme-companion`) | utility | transform | No existing Docktor code renders a compose file from a template for a Docktor-authored stack (all existing stacks' compose content comes from the user). Use RESEARCH.md's Pattern 3 code example (verified against official `nginxproxy/nginx-proxy`/`acme-companion` docs) as the base template instead of an in-repo analog. |
| `client/src/hooks/use-proxy-status.ts` (SSE subscriber) | hook | streaming | No hook file was read directly this session; grep for existing `EventSource`-based hooks in `client/src/hooks/` before writing, to confirm the exact subscribe/cleanup convention beyond what CLAUDE.md documents in prose. |
| host-port-free check for D-11 (`assertHostPortsFree([80, 443])`) | utility | — | No existing Docktor code checks port availability (confirmed in RESEARCH.md's Don't Hand-Roll table); nearest precedent in spirit is `assertStacksDirMatchesHost()` in `server/src/index.ts` (fail-loud pattern, not port-check logic) — write new, following RESEARCH.md's Pitfall 3 guidance (inspect `dockerode.listContainers()` port bindings; rely on relaying real `docker compose up` stderr for the case a bind test can't catch). |

## Metadata

**Analog search scope:** `server/src/{repositories,application,lib,jobs,routes,infrastructure}`, `client/src/{lib,routes,hooks}`, `shared/src/validation`, `server/prisma/schema`
**Files scanned:** 19 read/grepped directly this session (all confirmed git-tracked via `git ls-files`)
**Pattern extraction date:** 2026-09-03
