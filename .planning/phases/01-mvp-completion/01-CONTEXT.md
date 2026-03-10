# Phase 1: MVP Completion - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

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
- New "Logs" tab added to existing stack detail Tabs (alongside Overview, Compose, Environment)
- Service filter: dropdown selector above the log area ("All services" + per-service options); combined view prefixes each line with service name
- Log display: dark terminal style (black/dark-gray background, monospace font), fixed height with overflow scroll
- Toolbar controls: auto-scroll toggle, timestamps toggle, line wrap toggle, clear display button
- Service row in the services table has a "Logs" button that switches to the Logs tab pre-filtered to that service

### Service status in detail view
- Services table gets a Status column with a colored badge (consistent with StackStatusBadge pattern)
- Status badge updates silently in place when SSE events arrive (no flash, no toast per update)
- Stack-level status badge in the page header also updates live via the SSE feed (not just on page refresh)

### Settings page UX
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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/routes/stacks.ts`: Fastify plugin pattern with `requireAuth` — new SSE and settings routes follow same structure
- `client/src/hooks/use-stack.ts`: fetch-on-mount hook — extend with SSE subscription for real-time updates
- `client/src/hooks/use-stacks.ts`: list hook — extend with SSE for live dashboard updates
- `server/src/infrastructure/docker-executor.ts`: existing Docker adapter for compose CLI — new `DockerodeClient` adapter follows same interface pattern
- `server/src/application/stack-service.ts`: use-case orchestrator — new `SettingsService` follows same pattern
- `client/src/components/ui/`: shadcn/ui primitives — reuse for settings form (Input, Button, Select/Combobox, Form, Tabs)
- `client/src/components/domain/stack/stack-status-badge.tsx`: existing status badge — reuse or adapt for per-service status column
- `client/src/routes/app/stacks/[id].tsx`: existing Tabs pattern (overview/compose/environment) — add Logs as 4th tab here

### Established Patterns
- Fastify plugin pattern: `const routes: FastifyPluginAsyncZod = async (app) => { ... }`
- `requireAuth` hook added via `app.addHook("onRequest", requireAuth)` on all protected routes
- Zod schema validation at route level via `fastify-type-provider-zod`
- Hooks return `{data, loading, error}` shape
- No formatter configured — 4-space indent, no semicolons, double quotes, trailing commas
- Server imports use `.js` extension on relative imports (Node ESM)
- Client uses `@/` path alias for `client/src/`
- Page layout uses `Page`, `PageHeader`, `PageContent`, `PageActions`, `PageTitle` components from `@/components/common/layout/page`

### Integration Points
- New SSE state route: `GET /api/events` or `GET /api/stacks/events` — registered in `server/src/app.ts`
- New log SSE route: `GET /api/stacks/:id/logs` — added to `server/src/routes/stacks.ts`
- New settings routes: `server/src/routes/settings.ts` — registered in `server/src/app.ts`
- Background jobs start in `server/src/app.ts` `onReady` hook — new Docker event listener registered there
- `server/src/jobs/index.ts` — job registry that `app.ts` calls on ready
- Sidebar navigation: new Settings item added to `client/src/components/app-sidebar.tsx`
- Router: new `/settings` route added to router configuration

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose skeleton (not stale data) for initial load — this is a deliberate UX preference, not a default
- Event-driven container state (docker events API) was user's suggestion to avoid polling latency — this is a core design choice
- "Logs" button in service row should pre-select that service in the Logs tab dropdown (programmatic tab + filter switch)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-mvp-completion*
*Context gathered: 2026-03-10*
