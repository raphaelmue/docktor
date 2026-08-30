# Phase 02 — UI Review

**Audited:** 2026-08-30
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md exists for this phase)
**Screenshots:** Captured, but not usable — desktop/mobile captures of `localhost:3000` rendered blank (client-side auth redirect never resolved in a headless one-shot `playwright screenshot`, no session cookie). Audit conducted as a code-only review of the implemented components.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Solid, specific copy throughout; one real gap — "Upgrading a moving tag" produces a misleading "not checked yet" message (known, filed as a todo, not fixed) |
| 2. Visuals | 2/4 | `config_error` — one of the three core observability event types this phase exists to surface — has **no visual indicator anywhere on the page**, only a buried Event Log row |
| 3. Color | 2/4 | Four separate hand-rolled badge implementations duplicate the same `bg-{color}-100 text-{color}-800 dark:bg-{color}-900 …` string instead of the shadcn `Badge` component/variant system already used one file over (`event-log-card.tsx`) |
| 4. Typography | 4/4 | 2 font sizes (`text-xs`, `text-sm`), 1 weight (`font-medium`) across observability surfaces — well within scale |
| 5. Spacing | 4/4 | Exclusively scale-conformant Tailwind spacing tokens (`gap-1/2/3`, `space-y-2/3/4`, `px-2 py-0`); zero arbitrary `[…px]` values found |
| 6. Experience Design | 3/4 | Loading/error/empty states are thorough and well-composed (4-state dialog, isRefreshing split, no-remount SSE refresh) — but `config_error` state handling is a UI dead end, and the update-available badge only exists at the service row level, not the stack list/dashboard level |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **`config_error` has zero visible indication outside the Event Log** — User impact: a stack with an actively broken/invalid compose file (the exact failure mode this phase's FileWatcher was built to catch) shows no badge on the stack list, no alert on the stack detail page, and no icon anywhere — the only way to discover it is to open the stack, scroll to "Event Log," and recognize a `destructive`-badged row among a list. Concrete fix: add a `config_error` badge to `StackList`'s Status column (same slot as the existing yellow `config changed` badge) and a red `Alert` block on `[id].tsx` mirroring the existing yellow `configChanged` alert at line 213-221 of `client/src/routes/app/stacks/[id].tsx`. This is not new work to invent — 02-08's summary and a checked-in todo (`2026-08-28-config-error-ui-indication-missing.md`) already documents this exact gap; it was never closed.

2. **Update-available and config-changed badges duplicate hardcoded Tailwind color strings across 4+ files instead of using the shadcn `Badge` component** — User impact: none directly, but it's a maintainability/consistency defect that will drift (e.g. `service-status-badge.tsx` and `services-tab.tsx` already use two different blues for what should be the same "informational" semantic). Concrete fix: replace the raw `<span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-{color}-100 …">` pattern in `client/src/components/domain/stack/stack-list.tsx:32`, `client/src/routes/app/stacks/components/services-tab.tsx:82`, and `client/src/components/domain/stack/service-status-badge.tsx:16-32` with `<Badge variant="...">`, matching the pattern `event-log-card.tsx` already correctly established for the exact same event-type vocabulary in the same phase.

3. **The moving-tag upgrade dialog shows a factually wrong message** — User impact: a service pinned to a moving tag (e.g. `stable`, `latest`) that legitimately has `updateAvailable: true` (digest-based) opens `ServiceUpgradeDialog` and sees "The registry has not been checked for this image yet" (`service-upgrade-dialog.tsx:162-169`), which is false — the registry *was* checked, there's simply no discrete version to offer. This was found and explicitly deferred during the phase's own live verification (02-12's Task 5 notes, filed as `2026-08-28-upgrade-dialog-wrong-message-for-moving-tags.md`). Concrete fix: branch the empty-candidates message on whether the underlying image tag is a "moving" tag (no discrete version list expected) vs. genuinely unchecked, and point the user at "Update Images" instead.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

- Copy is specific and contextual throughout: `service-upgrade-dialog.tsx:93-98` distinguishes "Upgrading {name}..." / "{name} upgraded to {tag}" / "{name} is already on {tag}" — no generic "Success"/"Error" fallback strings.
- `event-log-card.tsx` and `status-log-card.tsx` both have distinct, accurate empty-state copy ("No events recorded" vs "No status changes") rather than a shared generic "No data" string.
- **Defect:** `service-upgrade-dialog.tsx:162-169` — the "never checked yet" empty state is shown for both the genuinely-never-checked case and the moving-tag case, producing a false claim for the latter. Confirmed as a known, unfixed gap in 02-12's own summary (`2026-08-28-upgrade-dialog-wrong-message-for-moving-tags.md`).
- Generic-label grep (`Cancel`/`Submit`/`OK`/bare `Save`) returned zero hits inside the observability surfaces audited — buttons are all contextually labeled ("Retry", "Upgrade", "Cancel" paired with a `DialogTitle` that names the action).

### Pillar 2: Visuals (2/4)

- Per-service update-available indicator (`services-tab.tsx:81-85`) has a clear focal point (inline badge + arrow icon trigger, `ArrowUpCircle`) directly in the row it concerns — good placement.
- Icon-only buttons are paired with `title` attributes (`services-tab.tsx:113-117`, `:126`) — acceptable but note `title` alone (no `aria-label`) is a weaker a11y signal than `aria-label`; tooltips are not used at all in this phase's new components.
- **Defect (BLOCKER-adjacent):** `config_error` — one of exactly three event types this phase's SSE/event pipeline broadcasts (`config_changed`, `config_error`, `update_available`) — has no badge, no icon, no page-level alert. `config_changed` gets a page-level yellow `Alert` (`[id].tsx:213-221`) and a list-level badge (`stack-list.tsx:31-35`); `update_available` gets a row-level badge (`services-tab.tsx:81-85`). `config_error` gets neither — it is only discoverable inside `EventLogCard`'s scrollable list, requiring the user to already suspect a problem and go looking. For a phase literally named "observability," the failure state of its own core mechanism (invalid compose YAML) is the least visible thing on the page.
- No focal-point regression elsewhere: `StatusLogCard`/`EventLogCard` are correctly split into two visually distinct, separately-headed cards (confirmed via `role="heading" aria-level={2}` on both `CardTitle`s), addressing the exact UAT gap (G-02-16) that caused this split.

### Pillar 3: Color (2/4)

- Accent/semantic color usage count across the 6 audited observability files: 9 raw hardcoded Tailwind color-scale classes (`bg-yellow-100`, `bg-blue-100`, `bg-green-100`, `bg-red-100`, `text-green-600`, `text-red-600`, etc.) versus 2 uses of the shadcn `Badge` component's `variant` prop (`event-log-card.tsx:109`) — i.e. two different color systems for the same "status indicator" concept are in active use in the same phase.
- Specific duplication:
  - `stack-list.tsx:32` — yellow badge, hand-rolled
  - `services-tab.tsx:82` — blue badge, hand-rolled
  - `service-status-badge.tsx:16,19,22,28` — green/red/blue/yellow badges, hand-rolled, 4 separate className strings
  - `[id].tsx:214,216` — yellow Alert, hand-rolled (acceptable if `Alert` has no warning variant, but still not deduplicated with the yellow badge one file over)
  - `[id].tsx:273,277` — bare `text-green-600`/`text-red-600` with no badge wrapper at all (Deployments table Success/Failed), a third distinct visual treatment for status again
- `event-log-card.tsx` is the one file in this phase that does it correctly — `VARIANTS: Record<StackEventType, BadgeVariant>` mapped through the real `Badge` component (`default`/`secondary`/`destructive`), guaranteeing every event type is visually distinct without hand-tuning hex/Tailwind scales. This should have been the template for the other three.
- No literal hex/`rgb()` values found in the audited files — all color use is at least Tailwind-class-based, just not token-based.

### Pillar 4: Typography (4/4)

- Font sizes in the 6 audited files: only `text-xs` and `text-sm` (19 occurrences total, 2 distinct sizes) — well under the 4-size threshold.
- Font weights: only `font-medium` (11 occurrences, 1 distinct weight) — well under the 2-weight threshold.
- No arbitrary font-size or line-height values found.

### Pillar 5: Spacing (4/4)

- Spacing classes used: `gap-1/2/3`, `space-y-2/3/4`, `px-2`, `py-0` — all standard Tailwind scale values, no arbitrary `[…px]`/`[…rem]` values found in any of the 6 audited files.
- Consistent card padding/gap conventions across `EventLogCard`, `StatusLogCard`, and `ServicesTab` (all `CardContent` + `space-y-*` for stacked rows) — no drift between the newly-added cards and the pre-existing ones.

### Pillar 6: Experience Design (3/4)

- Strong state coverage in `ServiceUpgradeDialog`: 4 mutually exclusive branches (loading/error/populated/two distinct empty states) plus 3 independent confirm-disable conditions — genuinely thorough, unit-tested per the 02-12 summary.
- `useStack`/`useStackEvents`'s `loading` vs `isRefreshing` split (02-14, 02-16) is a real fix for a concrete regression (full-page remount on every SSE tick) — background failures degrade silently to stale-but-rendered data rather than replacing the UI with an error screen, which is the correct behavior for a live dashboard.
- Destructive-adjacent action (image upgrade) has no confirmation dialog beyond the version-selection dialog itself — acceptable, since selecting+confirming a version is itself the confirmation step, and the action is reversible (redeploy).
- **Defect:** `config_error`'s only client-side handling is the Event Log row (see Pillar 2) — there is no error state surfaced anywhere else even though the server has broadcast this event since plan 02-03 (five plans before any client type for it existed at all, per 02-16's summary: "the server has published this event since plan 02-03 but no client type existed for it").
- **Defect:** update-available detection only surfaces at the individual-service level (`services-tab.tsx`) — there's no stack-list/dashboard-level "an update is available somewhere in this stack" indicator, unlike `configChanged`, which does have both a list-level and detail-level indicator. Confirmed via `stack-list.tsx`: only `configChanged` is checked in the Status column, not any update-available equivalent.

---

## Files Audited

- `client/src/routes/app/stacks/[id].tsx`
- `client/src/routes/app/stacks/components/service-upgrade-dialog.tsx`
- `client/src/routes/app/stacks/components/services-tab.tsx`
- `client/src/routes/app/stacks/components/event-log-card.tsx`
- `client/src/routes/app/stacks/components/status-log-card.tsx`
- `client/src/components/domain/stack/stack-list.tsx`
- `client/src/components/domain/stack/service-status-badge.tsx`
- `client/src/hooks/use-stack.ts`
- `client/src/hooks/use-stack-events.ts`
- `client/src/hooks/use-container-events.ts`
- `client/src/lib/stacks-api.ts`

Registry audit: not applicable — `components.json` exists (shadcn initialized) but no UI-SPEC.md exists for this phase to declare third-party registries, so the registry safety audit was skipped per its own gating rule.
