# Phase 1: MVP Completion - Context

**Gathered:** 2026-03-10
**Status:** Partial — log viewer and settings UX still need discussion (run /gsd:discuss-phase 1 to continue)

<domain>
## Phase Boundary

Users can observe real-time container status in both the dashboard and stack detail views, stream live logs per service, and configure instance-level settings (name, base URL, timezone). No new capabilities — builds on existing stack CRUD foundation.

</domain>

<decisions>
## Implementation Decisions

### Real-time state propagation
- SSE push for container state updates (not polling, not manual refresh)
- Single global SSE event feed — both dashboard (stack list, status counts) and stack detail page subscribe to the same stream
- Auto-reconnect with backoff using native EventSource behavior (no custom reconnect logic needed)
- On initial page load: show skeleton until SSE connection is established (not stale REST data)

### Log viewer layout
- TBD — discuss in next session via /gsd:discuss-phase 1

### Settings page UX
- TBD — discuss in next session via /gsd:discuss-phase 1

### Claude's Discretion
- SSE event schema/format (what fields each state event contains)
- Whether state SSE and log SSE share a single connection or use separate endpoints
- Exact skeleton design for initial load
- dockerode client adapter structure (parallel to DockerExecutor)
- State poller reconciliation implementation details

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/routes/stacks.ts`: Fastify plugin pattern with `requireAuth` — new SSE and settings routes follow same structure
- `client/src/hooks/use-stack.ts`: fetch-on-mount hook — extend with SSE subscription for real-time updates
- `client/src/hooks/use-stacks.ts`: list hook — extend with SSE for live dashboard updates
- `server/src/infrastructure/docker-executor.ts`: existing Docker adapter for compose CLI — new `DockerodeClient` adapter follows same interface pattern
- `server/src/application/stack-service.ts`: use-case orchestrator — new `SettingsService` follows same pattern
- shadcn/ui primitives in `client/src/components/ui/` — reuse for settings form (Input, Button, Select, Form)

### Established Patterns
- Fastify plugin pattern: `const routes: FastifyPluginAsyncZod = async (app) => { ... }`
- `requireAuth` hook added via `app.addHook("onRequest", requireAuth)` on all protected routes
- Zod schema validation at route level via `fastify-type-provider-zod`
- Hooks return `{data, loading, error}` shape
- No formatter configured — 4-space indent, no semicolons, double quotes, trailing commas
- Server imports use `.js` extension on relative imports (Node ESM)
- Client uses `@/` path alias for `client/src/`

### Integration Points
- New SSE state route: `GET /api/events` or `GET /api/stacks/events` — registered in `server/src/app.ts`
- New log SSE route: `GET /api/stacks/:id/logs` — added to `server/src/routes/stacks.ts`
- New settings routes: `server/src/routes/settings.ts` — registered in `server/src/app.ts`
- Background jobs start in `server/src/app.ts` `onReady` hook — new Docker event listener registered there
- `server/src/jobs/index.ts` — job registry that `app.ts` calls on ready

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose skeleton (not stale data) for initial load — this is a deliberate UX preference, not a default
- Event-driven container state (docker events API) was user's suggestion to avoid polling latency — this is a core design choice

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-mvp-completion*
*Context gathered: 2026-03-10 (partial — continue with /gsd:discuss-phase 1)*
