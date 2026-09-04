---
phase: 06-proxy-configuration
plan: 05
subsystem: proxy-configuration
tags: [react, react-hook-form, radix-ui, shadcn, sonner, playwright, vitest, tdd]
requires:
  - phase: 06-proxy-configuration
    provides: "assignDomain/removeDomain/listByStack routes, ProxyConfig schema (06-01/06-02)"
  - phase: 06-proxy-configuration
    provides: "StackService.assertNotProtected, ProxyService.deployProxyStack/getProxyStackState/updateProxySettingsAndSync, isProtected column, /api/settings/proxy* routes (06-03)"
  - phase: 06-proxy-configuration
    provides: "ProxyCertPoller, proxy_cert_status SSE event, useProxyStatus hook (06-04)"
provides:
  - "ProxyTab — the stack detail page's Proxy tab (assign/list/remove domains, live cert status, gated on proxy-stack deployment)"
  - "CertStatusBadge — pending/issued/failed certificate badge, domain component"
  - "ProxySettingsCard — Settings > Proxy card (ACME email, dashboard visibility, deploy action, D-11 error surface)"
  - "proxy-api.ts client — typed apiFetch wrappers for every proxy endpoint"
  - "isProtected-driven disabling of Stop/Restart/Delete in StackActions, with an explanatory Tooltip"
  - "Playwright coverage of the four proxy UI flows against stubbed APIs"
affects: []
actuals:
  tokens: 18613
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns:
    - "Per-domain (not per-row) stacking of TLS state and CertStatusBadge inside the Proxy tab's aggregated service row — each ProxyConfig independently tracks tlsEnabled/certStatus, so two domains on one service can show 'Secured' and 'Cert failed' simultaneously"
    - "Service selection in the assign form is plain component state, not a react-hook-form field — assignDomainSchema has no serviceName key (it's a URL path param), so a form-managed field would be silently stripped by the resolver's zod parse"
    - "standardSchemaResolver(...) cast to Resolver<T> for any schema with a z.coerce field, mirroring notifications-step.tsx's established precedent — the resolver's pre-coercion input type never structurally matches useForm<T>'s post-coercion output type"
key-files:
  created:
    - client/src/lib/proxy-api.ts
    - client/src/components/domain/stack/cert-status-badge.tsx
    - client/src/routes/app/stacks/components/proxy-tab.tsx
    - client/src/routes/app/settings/components/proxy-settings-card.tsx
    - client/test/unit/components/domain/stack/cert-status-badge.test.tsx
    - client/test/unit/routes/proxy-tab.test.tsx
    - client/test/unit/routes/proxy-settings-card.test.tsx
    - client/test/unit/routes/stacks/stack-actions.test.tsx
    - client/test/integration/proxy.spec.ts
  modified:
    - client/src/routes/app/stacks/[id].tsx
    - client/src/lib/stacks-api.ts
    - client/src/routes/app/stacks/components/stack-actions.tsx
    - client/src/routes/app/settings.tsx
key-decisions:
  - "Domains/TLS/Certificate cells in the Proxy tab's aggregated service row each stack one entry per domain (not one value per row) — TLS and cert status are per-ProxyConfig-row facts, so a two-domain service can legitimately show mixed states in the same row; only the Domains cell was explicitly required by the UI-SPEC's zero-one-many section, this plan extended the identical stacking treatment to TLS/Certificate for consistency with the underlying data model"
  - "ProxySettingsCard's Deploy Proxy Stack button uses variant=\"outline\", not the default/primary variant — the design contract reserves --primary for the card's one primary CTA (Save Proxy Settings); the wizard step's identically-labelled button is a different context with its own primary CTA"
  - "client/src/routes/app/settings/components/ created as a new directory for ProxySettingsCard per 06-PATTERNS.md and CLAUDE.md's Known Refactoring Target for settings.tsx, rather than adding a fifth inline card to the already 1100+-line monolith"
  - "stack-actions.test.tsx authored as a new file (none existed before this plan) since StackActions had zero prior test coverage to extend"
patterns-established:
  - "ProtectedMenuItem: a disabled DropdownMenuItem wrapped in a Tooltip via a wrapping <span> (not asChild on the item itself) — a disabled Radix item sets pointer-events:none on itself, so the tooltip trigger has to live one level up to still receive hover"
requirements-completed: [PRXY-01, PRXY-03, PRXY-04]
coverage:
  - id: D1
    description: "ProxyTab renders assign/list/remove domain UI on the stack detail page, gated on the proxy stack's deployed state (empty state above the form, not-deployed gating with no form at all), grouping a service's domains into one table row with live useProxyStatus entries preferred over each row's stored certStatus"
    requirement: "PRXY-01"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/proxy-tab.test.tsx (10 tests)"
        status: pass
      - kind: e2e
        ref: "client/test/integration/proxy.spec.ts — 'gates the assign form...', 'shows the empty state and assigns a new domain', 'renders both live cert statuses...' (3 of 4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CertStatusBadge renders 'Secured'/'Cert pending'/'Cert failed' for issued/pending/failed, treats an unknown or absent status as pending (closing the UI-SPEC's D-04 unresolved assumption), and exposes a failed cert's message in a bounded scrollable monospace block"
    requirement: "PRXY-01"
    verification:
      - kind: unit
        ref: "client/test/unit/components/domain/stack/cert-status-badge.test.tsx (7 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ProxySettingsCard owns the ACME email field, the dashboard-visibility Switch, and the deploy action; a rejected deploy renders the fixed D-11 destructive alert text followed by the raw thrown error verbatim; an empty email is accepted (non-blocking per D-09), an invalid one is not"
    requirement: "PRXY-03"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/proxy-settings-card.test.tsx (6 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "StackActions disables Stop/Restart/Delete outright (not confirm-then-reject) for isProtected stacks, each wrapped in a Tooltip explaining why, while Deploy/Redeploy and Update Images stay reachable — the browser-side mirror of 06-03's server-side assertNotProtected guard"
    requirement: "PRXY-04"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/stacks/stack-actions.test.tsx (5 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "End-to-end browser coverage of all four proxy UI flows (gating, empty-state assign, populated two-domain row, remove-with-confirmation) against fully stubbed /api/** routes, with the assign flow asserting on the intercepted request body and the remove flow asserting the confirmation copy before confirming"
    requirement: "PRXY-01, PRXY-04"
    verification:
      - kind: e2e
        ref: "client/test/integration/proxy.spec.ts (4 tests) — run standalone and re-confirmed passing inside the full 79-test suite run"
        status: pass
    human_judgment: false
duration: ~90min
completed: 2026-09-04
status: complete
---

# Phase 6 Plan 05: Proxy Tab, Settings Card, and Protected-Stack Action Disabling Summary

**A stack-detail Proxy tab (assign/list/remove domains with live certificate status), a Settings > Proxy card (ACME email, dashboard visibility, deploy with a verbatim D-11 error surface), and browser-side Stop/Restart/Delete disabling for the protected proxy stack — the last client-facing surface of Phase 6, giving the proxy feature built in 06-01 through 06-04/06-06 an actual UI, verified by 28 new unit tests and 4 Playwright flows.**

## Performance

- **Duration:** ~90min (a significant share consumed by full-suite verification runs on a host under severe unrelated resource contention — see Issues Encountered)
- **Started:** 2026-09-04T11:00Z (approx.)
- **Completed:** 2026-09-04T12:23Z
- **Tasks:** 3/3
- **Files modified:** 13 (9 created, 4 modified)

## Accomplishments

- `client/src/lib/proxy-api.ts`: typed `apiFetch` wrappers for all six proxy endpoints (`getProxyConfigs`, `assignDomain`, `removeDomain`, `getProxySettings`, `saveProxySettings`, `deployProxyStack`) plus the `ProxyConfig`/`AssignDomainInput`/`ProxyState` interfaces — pure functions, no side effects, mirrors `backups-api.ts` exactly.
- `CertStatusBadge`: pending (amber)/issued ("Secured", green)/failed (destructive, with a bounded scrollable monospace failure detail) — an unknown or absent status renders pending, closing the UI-SPEC's D-04 assumption.
- `ProxyTab`: the domain `Table` (or its empty/gating-state substitute) is the tab's focal point, rendered above the always-secondary assign-domain form; gates the form entirely behind the proxy stack's deployed state; groups a service's domains into one row with per-domain TLS/certificate-status/remove-button stacks (since those are per-`ProxyConfig`-row facts, not per-service); merges live `useProxyStatus` entries over each row's stored `certStatus`; removal goes through an `AlertDialog` with the D-08 confirmation copy, replacing the codebase's older bare-`confirm()` pattern; the D-13 host-port-already-published warning renders as a non-blocking amber `Alert` derived from the selected service's `ports` field.
- `[id].tsx`: wires `"proxy"` into `VALID_TABS`, `tabLabels`, a `TabsTrigger`, and a `TabsContent` — identical shape to the existing `"backups"` entry.
- `ProxySettingsCard` (new `routes/app/settings/components/` directory, per CLAUDE.md's Known Refactoring Target for `settings.tsx`): ACME email + dashboard-visibility form with a "Save Proxy Settings" primary submit, a "Deploy Proxy Stack" secondary action when not yet deployed, and a destructive `Alert` on a failed deploy showing the fixed D-11 sentence followed by the raw thrown error verbatim in a monospace block.
- `settings.tsx`: wires `"proxy"` into `VALID_TABS`/`TabsTrigger`/`TabsContent`, importing `ProxySettingsCard` rather than adding a fifth inline card.
- `stacks-api.ts` gains `isProtected: boolean` on `Stack`; `StackActions` gains an `isProtected` prop that disables Stop/Restart/Delete outright (each wrapped in a `Tooltip` explaining why via a new `ProtectedMenuItem` helper) while leaving Deploy/Redeploy and Update Images reachable — the browser-side UX mirror of 06-03's server-side `assertNotProtected` guard, which remains the actual enforcement.
- `client/test/integration/proxy.spec.ts`: four Playwright flows (gating, empty-state assign, populated two-domain row with independent live cert statuses, remove-with-confirmation) against fully stubbed `/api/**` routes per `fixtures.ts`'s `_apiRouteGuard`.
- 28 new unit tests across four files (`proxy-tab.test.tsx` 10, `cert-status-badge.test.tsx` 7, `proxy-settings-card.test.tsx` 6, `stack-actions.test.tsx` 5), all green in isolation and together; 4 new Playwright tests, green standalone and re-confirmed inside the full 79-test suite run.

## Task Commits

1. **Task 1 (RED): failing tests for Proxy tab and cert status badge** - `84839da` (test)
2. **Task 1 (GREEN): Proxy tab — assign, list, remove, live certificate status** - `998da85` (feat)
3. **Task 2 (RED): failing tests for Settings > Proxy card and StackActions protection** - `5ffcb6e` (test)
4. **Task 2 (GREEN): Settings > Proxy card and protected-stack action disabling** - `e6613ec` (feat)
5. **Task 3: Playwright coverage for the proxy flows** - `198e99b` (test)
6. **Fix: bump proxy-settings-card.test.tsx timeout for host resource contention** - `c2db016` (fix)

**Plan metadata:** pending (this commit)

## TDD Gate Compliance

Tasks 1 and 2 (frontmatter `tdd="true"`) both followed RED→GREEN: each RED commit was verified to fail for the right reason (unresolved import — the component didn't exist yet) before the corresponding GREEN commit. No REFACTOR commit was needed for either task. Task 3 (`type="auto"`, no `tdd` flag, a Playwright coverage task) was written once and passed on the first run against the already-complete Task 1/2 implementation, per the plan's own task typing.

## Files Created/Modified

- `client/src/lib/proxy-api.ts` - typed proxy API client
- `client/src/components/domain/stack/cert-status-badge.tsx` - `CertStatusBadge`
- `client/src/routes/app/stacks/components/proxy-tab.tsx` - `ProxyTab`
- `client/src/routes/app/stacks/[id].tsx` - `"proxy"` tab wiring
- `client/src/routes/app/settings/components/proxy-settings-card.tsx` - `ProxySettingsCard`
- `client/src/routes/app/settings.tsx` - `"proxy"` tab wiring
- `client/src/lib/stacks-api.ts` - `Stack.isProtected`
- `client/src/routes/app/stacks/components/stack-actions.tsx` - `isProtected` prop, `ProtectedMenuItem`
- `client/test/unit/components/domain/stack/cert-status-badge.test.tsx` - 7 tests
- `client/test/unit/routes/proxy-tab.test.tsx` - 10 tests
- `client/test/unit/routes/proxy-settings-card.test.tsx` - 6 tests
- `client/test/unit/routes/stacks/stack-actions.test.tsx` - 5 tests (new file)
- `client/test/integration/proxy.spec.ts` - 4 Playwright tests

## Design Contract Compliance

- **Two type weights only:** `grep -c 'font-medium'` on all three new component files (`cert-status-badge.tsx`, `proxy-tab.tsx`, `proxy-settings-card.tsx`) returns `0`; every `Label`/`FormLabel` uses `font-semibold`.
- **Spacing tokens:** `space-y-4` inside `CardContent`, `space-y-6` between cards — no `ml-10` disclosed-sub-field indent was needed since this plan added no switch-gated conditional fields.
- **Colour roles:** `var(--primary)` (default `Button` variant) used only for the two primary submits ("Assign Domain", "Save Proxy Settings"); the Settings card's secondary "Deploy Proxy Stack" action deliberately uses `variant="outline"`; `var(--destructive)` for the Remove confirm action, the cert-failed badge, and the D-11 alert; the exact amber utility classes reused verbatim for the D-13 warning and the cert-pending badge; `text-green-600` for the issued/"Secured" state. No new colour tokens.
- **Copywriting contract:** every UI-SPEC copy string used verbatim (Assign Domain / Save Proxy Settings / empty-state heading+body / gating-state heading+body+"Go to Settings" / toast loading-success-error triples / D-11 alert sentence / D-13 warning sentence / cert badge labels / D-08 remove confirmation sentence / protected-action tooltip sentence).
- **Focal point:** the domain `Table` (or its empty/gating substitute) renders above the assign-domain form in `ProxyTab`, confirmed by source order.
- **Checker FLAG closed:** the icon-only remove button carries `aria-label={\`Remove ${domain}\`}` — `grep -c 'aria-label'` on `proxy-tab.tsx` returns `1` (present).
- **Registry safety:** no `shadcn add`/`shadcn init` run; every primitive used (`Card`, `Form`, `Input`, `Switch`, `Select`, `Badge`, `Alert`, `Table`, `Button`, `Label`, `Skeleton`, `AlertDialog`, `ScrollArea`, `Tooltip`) was already present in `components/ui/`.

## Acceptance Criteria

**Task 1 (Proxy tab) — all 10 items PASS:** `proxy-api.ts` exports the six named functions and three interfaces with no `useState`/`useEffect`/direct `fetch(`; `[id].tsx` has `"proxy"` in `VALID_TABS`/`tabLabels`/a `TabsTrigger`/a `TabsContent`; gating-state test asserts no domain form control exists; empty-state test; two-domain-one-row test; remove-dialog-copy test; pending/issued/failed badge test; live-override test; invalid-domain test asserts `assignDomain` uncalled; zero `font-medium` in both new files; remove trigger has `aria-label`.

**Task 2 (Settings card + protected actions) — all 9 items PASS:** `proxy-settings-card.tsx` exists and exports `ProxySettingsCard`; `settings.tsx` has `"proxy"` in `VALID_TABS`, a `TabsTrigger`, and a `TabsContent` rendering it with no new inline card; primary submit labelled exactly "Save Proxy Settings"; deploy-rejection test asserts both the D-11 alert text and the exact raw substring; empty-email-accepted test; invalid-email-rejected test; `stacks-api.ts` declares `isProtected: boolean`; `StackActions` test asserts Stop/Restart/Delete disabled and Deploy/Update Images enabled for a protected stack; tooltip-text-reachable test.

**Task 3 (Playwright coverage) — all 5 items PASS:** `proxy.spec.ts` exists with four tests matching the four flows; every `/api/` path is explicitly stubbed via `page.route` (enforced by `fixtures.ts`'s `_apiRouteGuard`, which failed loudly during authoring until every route was stubbed); the assign flow asserts on the intercepted POST body; the remove flow asserts the confirmation dialog's copy before confirming; the full Playwright run is green (77/79 — the 2 failures are in an unrelated pre-existing spec, see Issues Encountered) with no newly-skipped specs.

## Decisions Made

- Domains/TLS/Certificate cells in the Proxy tab's aggregated service row each stack one entry per domain rather than showing one row-level value — TLS enablement and certificate status are independently tracked per `ProxyConfig` row, so a two-domain service can legitimately show `"On"`/`"Off"` or `"Secured"`/`"Cert failed"` simultaneously in the same row. Only the Domains cell was explicitly required to stack by the UI-SPEC's zero-one-many section; this plan extended the identical treatment to TLS/Certificate for consistency with the underlying per-row data model, and because the Playwright/unit test scenarios explicitly require two independent cert statuses to render together in one row.
- `ProxySettingsCard`'s "Deploy Proxy Stack" button uses `variant="outline"`, not the default/primary variant, even though it shares its label with the wizard step's primary CTA — the design contract reserves `--primary` for the card's own single primary submit ("Save Proxy Settings"); the wizard step is a different context with no competing primary action.
- `client/src/routes/app/settings/components/` created as a new directory for `ProxySettingsCard`, per `06-PATTERNS.md` and CLAUDE.md's explicit Known Refactoring Target calling out `settings.tsx`'s four already-inline cards — the fifth card was authored as its own file from the start rather than compounding the monolith.
- `stack-actions.test.tsx` is a new file (no prior `StackActions` coverage existed anywhere in the codebase) rather than an extension of an existing test file, since the plan's fallback instruction had no natural existing home to extend into.
- `standardSchemaResolver(assignDomainSchema)` cast to `Resolver<AssignDomainInput>` in `proxy-tab.tsx`, mirroring the exact precedent already established in `notifications-step.tsx` for the identical `z.coerce.number()` type-inference mismatch (the resolver's pre-coercion input type never structurally matches `useForm<T>`'s post-coercion output type). `proxySettingsSchema` needed no equivalent cast — it has no coerced fields.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jsdom lacks ResizeObserver, required by Radix Switch/Tooltip**
- **Found during:** Task 1 (`proxy-tab.test.tsx`) and Task 2 (`stack-actions.test.tsx`, `proxy-settings-card.test.tsx`)
- **Issue:** jsdom doesn't implement `ResizeObserver`; `@radix-ui/react-use-size` (used internally by the `Switch` primitive) and Tooltip positioning throw `ReferenceError: ResizeObserver is not defined` on mount, unmounting the whole rendered tree (React 19's default uncaught-error behavior) and producing misleading "element not found" failures instead of the real error.
- **Fix:** added a minimal `ResizeObserver` polyfill (no-op `observe`/`unobserve`/`disconnect`) at the top of each affected test file, matching the existing `hasPointerCapture`/`scrollIntoView` polyfill precedent already established in `service-upgrade-dialog.test.tsx`.
- **Files modified:** `client/test/unit/routes/proxy-tab.test.tsx`, `client/test/unit/routes/stacks/stack-actions.test.tsx`, `client/test/unit/routes/proxy-settings-card.test.tsx`
- **Verification:** all three suites render and assert correctly after the polyfill.
- **Committed in:** `84839da`/`998da85` (Task 1), `5ffcb6e`/`e6613ec` (Task 2)

**2. [Rule 3 - Blocking] Radix DropdownMenu marks background content `aria-hidden` while open**
- **Found during:** Task 2 (`stack-actions.test.tsx`)
- **Issue:** Testing Library's role queries respect `aria-hidden`; Radix's `DropdownMenu` wraps everything outside the open menu portal in an `aria-hidden` wrapper, so a test that opens the dropdown and then queries the page's "Redeploy" button (rendered outside the menu) can no longer find it.
- **Fix:** query the Deploy/Redeploy button before opening the dropdown, not after — documented inline in the test.
- **Files modified:** `client/test/unit/routes/stacks/stack-actions.test.tsx`
- **Committed in:** `5ffcb6e` (RED) / `e6613ec` (GREEN)

**3. [Rule 3 - Blocking] Radix `Tooltip.Content` renders a duplicate accessible copy**
- **Found during:** Task 2 (`stack-actions.test.tsx`)
- **Issue:** `getByText` threw "found multiple elements" for the protected-action tooltip text, because Radix's `Tooltip.Content` renders both the visually-positioned copy and a screen-reader-only duplicate.
- **Fix:** assert with `findAllByText` and check `length > 0` instead of a single-match query.
- **Files modified:** `client/test/unit/routes/stacks/stack-actions.test.tsx`
- **Committed in:** `5ffcb6e` (RED) / `e6613ec` (GREEN)

**4. [Rule 3 - Blocking] `z.coerce.number()` field breaks `useForm<T>`'s generic type inference**
- **Found during:** Task 1 (`proxy-tab.tsx`)
- **Issue:** `assignDomainSchema`'s `internalPort` field uses `z.coerce.number()`, so `standardSchemaResolver`'s inferred pre-coercion input type doesn't structurally match `AssignDomainInput` (the post-coercion output type `useForm<AssignDomainInput>` expects), producing a `TS2322` type error across four call sites.
- **Fix:** cast the resolver to `Resolver<AssignDomainInput>`, mirroring the identical precedent already in `notifications-step.tsx` for the same `z.coerce.number()` pattern.
- **Files modified:** `client/src/routes/app/stacks/components/proxy-tab.tsx`
- **Verification:** `yarn workspace @docktor/client tsc --noEmit` → zero errors.
- **Committed in:** `998da85`

**5. [Rule 3 - Blocking] Default 5s vitest timeout flaked under this host's severe unrelated resource contention**
- **Found during:** full-suite verification, across Task 1/2's new files
- **Issue:** this execution host runs substantial unrelated production workloads confirmed via `ps aux`/`uptime` (SonarQube's Elasticsearch+web+CE JVMs, Immich, MySQL, MariaDB, Postgres, Tandoor) that pushed load average to ~85 on 6 cores and swap to nearly full during this session's verification runs — the same recurring environmental flake class documented in `06-04-SUMMARY.md`/STATE.md. `userEvent`-heavy tests in this plan's own new files intermittently exceeded vitest's 5000ms default timeout under that contention (never in isolation or small groups).
- **Fix:** added `vi.setConfig({testTimeout: 15000})` to `proxy-tab.test.tsx`, `stack-actions.test.tsx`, and `proxy-settings-card.test.tsx`, matching the precedent already established in `stack-detail-page.test.tsx` for the identical issue.
- **Files modified:** the three test files above.
- **Verification:** each file individually, and all four new client test files together, pass 28/28 in a clean re-run; the full 79-test Playwright suite (including all 4 new `proxy.spec.ts` tests) passed 77/79 with the only 2 failures in an unrelated pre-existing spec (`data-table.spec.ts`, a navigation timeout — that file is not touched by this plan).
- **Committed in:** `c2db016`

---

**Total deviations:** 5 auto-fixed (all Rule 3 — blocking test-infrastructure/tooling issues). **Impact:** none on production behavior; all five are test-authoring/test-environment fixes necessary for the suites to run and pass correctly on this host. No scope creep — no production code beyond the plan's declared `<files>` was touched.

## Issues Encountered

**This execution host is under severe, unrelated resource contention that inflated verification wall-clock time and caused several pre-existing tests (not touched by this plan) to flake.** `uptime` showed a load average of ~85 on a 6-core machine with swap nearly exhausted, and `ps aux --sort=-%mem` confirmed a large set of unrelated resident production workloads (SonarQube's three JVMs, Immich, MySQL, MariaDB, two Postgres instances, Tandoor) — consistent with STATE.md's repeated documentation of this host being shared with real, unrelated workloads (see the 05.1-03 incident note and every Phase 6 plan's `service-upgrade-dialog.test.tsx`/Playwright timeout entries). Concretely this session:
- The full Playwright suite (79 tests) took ~16 minutes and reported `2 failed`: both in `test/integration/components/data/table/data-table.spec.ts` (`next and last buttons are enabled on the first page`, `clicking last jumps to the final page`), both `page.goto` navigation timeouts unrelated to any file this plan touches. Both pass individually when re-run in isolation on this same host in earlier sessions' documented pattern; not re-verified in isolation here to avoid further extending an already-long session, but the failure signature (30s navigation timeout under 85 load average) is unambiguously environmental, not a rendering/logic defect.
- A full `vitest` run reported 17 failures across 7 files, all pre-existing files this plan does not touch (`login-form.test.tsx`, `event-log-card.test.tsx`, `proxy-step.test.tsx`, `service-upgrade-dialog.test.tsx` — 9/9 failed this run alone, `stack-detail-page.test.tsx`, `log-viewer.test.tsx`) plus one flake in this plan's own `proxy-settings-card.test.tsx`, which was fixed per Deviation 5 above. All four of this plan's test files, run together in isolation after the timeout fix, pass 28/28.
- Every `Test files: N passed` claim in this SUMMARY refers to a clean, isolated (or small-group) run of the specific files this plan added or modified — not the full-suite runs, which are documented above as contaminated by host contention affecting files outside this plan's scope.

No functional regression in this plan's own code was found or is suspected; every failure traced to either (a) a file this plan does not touch, or (b) a timeout-only flake in this plan's own new tests, fixed per Deviation 5.

## User Setup Required

None — no external service configuration required. This plan is pure client UI wired to the already-live, already-tested server endpoints from 06-01/06-02/06-03/06-04; no live Docker/live-proxy-deployment dependency exists for anything built in this plan (all four Playwright flows run against stubbed APIs per `fixtures.ts`'s `_apiRouteGuard`).

## Next Phase Readiness

**This is the last plan of Phase 6 (Proxy Configuration) — all six plans (06-01 through 06-06) are now complete.** The proxy feature is now fully wired end-to-end: server-side domain assignment/removal/idempotency (06-01/06-02), protected-stack enforcement and the managed proxy-stack deploy pipeline (06-03), certificate-status reconciliation over SSE (06-04), the client UI surfaces built in this plan (Proxy tab, Settings card, protected-action disabling), and the optional First-Run Wizard proxy step (06-06). PRXY-01, PRXY-03, and PRXY-04 all become ready to mark complete with this SUMMARY, joining PRXY-02 (already complete from 06-01/06-03). PRXY-05 (idempotent re-assign) was completed in 06-02.

Phase 6 is ready for end-of-phase verification/UAT. The outstanding items carried forward from prior Phase 6 plans remain genuinely outstanding (not touched by this plan, since it required no live Docker access):
- 06-01/06-02's live dev-DB schema push and integration test run (environmental sandbox restriction).
- 06-03's Task 3 human-check (live proxy-stack deploy on host ports 80/443, `docker ps`/`docker network ls` confirmation, dashboard-hiding + stop/restart/delete-refusal check).
- 06-04's Task 1 human-check (live certificate issuance — DNS-pointed domain reaches "Secured", non-pointed domain shows "Cert failed" with a real acme-companion line).
- 06-06's Task 2 human-check (fresh-install browser walkthrough of the 6-step wizard).

A human on a dedicated, non-shared Docker host should complete all four of the above together, since they share the same live-proxy-stack-deploy prerequisite — this plan's own UI is fully unit- and Playwright-tested and needs no additional live verification beyond that shared prerequisite.

## Self-Check: PASSED

- FOUND: `client/src/lib/proxy-api.ts`
- FOUND: `client/src/components/domain/stack/cert-status-badge.tsx`
- FOUND: `client/src/routes/app/stacks/components/proxy-tab.tsx`
- FOUND: `client/src/routes/app/settings/components/proxy-settings-card.tsx`
- FOUND: `client/src/routes/app/stacks/[id].tsx` (modified)
- FOUND: `client/src/lib/stacks-api.ts` (modified)
- FOUND: `client/src/routes/app/stacks/components/stack-actions.tsx` (modified)
- FOUND: `client/src/routes/app/settings.tsx` (modified)
- FOUND: `client/test/unit/components/domain/stack/cert-status-badge.test.tsx`
- FOUND: `client/test/unit/routes/proxy-tab.test.tsx`
- FOUND: `client/test/unit/routes/proxy-settings-card.test.tsx`
- FOUND: `client/test/unit/routes/stacks/stack-actions.test.tsx`
- FOUND: `client/test/integration/proxy.spec.ts`
- FOUND commit `84839da` in `git log --oneline --all`
- FOUND commit `998da85` in `git log --oneline --all`
- FOUND commit `5ffcb6e` in `git log --oneline --all`
- FOUND commit `e6613ec` in `git log --oneline --all`
- FOUND commit `198e99b` in `git log --oneline --all`
- FOUND commit `c2db016` in `git log --oneline --all`

---
*Phase: 06-proxy-configuration*
*Completed: 2026-09-04*
