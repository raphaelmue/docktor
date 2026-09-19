---
phase: 09-deployment-and-release-readiness
plan: 08
subsystem: ui
tags: [react, react-hook-form, radix-select, tls, certificates, proxy, settings]

# Dependency graph
requires:
  - phase: 09-06-deployment-and-release-readiness
    provides: "the typed certificate upload/list/delete API (server/src/routes/certificates.ts) this plan's client wraps with getCertificates/uploadCertificate/deleteCertificate"
  - phase: 09-07-deployment-and-release-readiness
    provides: "certSource-driven ACME suppression and the expiring cert-status vocabulary member this plan's badge and assign-form surface"
provides:
  - "client/src/lib/api.ts — apiFetch omits the JSON content-type for a FormData body (browser sets the multipart boundary), preserves an explicit caller header, still sets it for string/absent bodies"
  - "client/src/lib/certificates-api.ts — Certificate (metadata-only, no secret fields), getCertificates()/uploadCertificate()/deleteCertificate()"
  - "client/src/lib/proxy-api.ts — ProxyConfig.certSource/certificateId, local AssignDomainInput.certSource/certificateId"
  - "client/src/hooks/use-proxy-status.ts — ProxyStatusEntry.status extended with 'expiring'"
  - "client/src/routes/app/settings/components/certificates-card.tsx — upload form (3 file inputs), list with per-row expiry warning, delete with confirmation"
  - "client/src/components/domain/stack/cert-status-badge.tsx — 'Expiring soon' branch (amber outline, not destructive)"
  - "client/src/routes/app/stacks/components/proxy-tab.tsx — certificate-source choice, conditional certificate picker fed by getCertificates(), per-domain source column"
  - ".planning/todos/completed/2026-09-07-add-support-for-custom-tls-certificates.md — scope item 4 closed, Resolution names D-09 through D-13 and their shipping plans"
affects: []

# Actuals (#2632)
actuals:
  tokens: 17044
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "apiFetch's content-type guard checks both 'body is FormData' and 'caller already set a content-type' before applying the JSON default — a single early-decision branch rather than two separate conditionals, so the three behaviors (JSON default, FormData omission, caller override) can never disagree with each other"
    - "Certificate metadata never gains an optional secret field 'just in case' — the Certificate interface's absence of privateKey/certificate/caBundle members is itself the guarantee a component can't render what it was never given a field to hold"
    - "Certificate-source validity rules (custom requires certificateId, acme forbids it, custom requires tlsEnabled) stay entirely in assignDomainSchema's superRefine — proxy-tab.tsx only renders the resulting field messages, never re-implements the pairing logic"
    - "SelectItem label text is deliberately distinct between a form control's default-value display and any per-row status text that must coexist in the same render tree (e.g. 'Automatic (Let's Encrypt)' in the picker vs. 'Automatic' in the domain listing) — avoids two elements sharing an exact getByText-matchable string when both are legitimately on screen together"

key-files:
  created:
    - client/src/lib/certificates-api.ts
    - client/test/unit/lib/certificates-api.test.ts
    - client/src/routes/app/settings/components/certificates-card.tsx
    - client/test/unit/routes/settings/certificates-card.test.tsx
  modified:
    - client/src/lib/api.ts
    - client/src/lib/proxy-api.ts
    - client/src/hooks/use-proxy-status.ts
    - client/test/unit/lib/api.test.ts
    - client/src/routes/app/settings.tsx
    - client/src/components/domain/stack/cert-status-badge.tsx
    - client/test/unit/components/domain/stack/cert-status-badge.test.tsx
    - client/src/routes/app/stacks/components/proxy-tab.tsx
    - client/test/unit/routes/proxy-tab.test.tsx
    - .planning/todos/completed/2026-09-07-add-support-for-custom-tls-certificates.md (moved from pending/, Resolution appended)
    - .planning/WINDOWS.md (entry #12 added)

key-decisions:
  - "Task 3's assign-form certSource Select item for 'acme' is labeled 'Automatic (Let's Encrypt)' rather than bare 'Automatic' — the per-domain listing's Source column independently renders the exact string 'Automatic' for the same status, and both are on screen simultaneously in the D-11 per-domain-listing test; a shared exact label would make the two elements ambiguous to an exact-text query even though only one test scenario exercises both at once"
  - "form.reset() after a successful assign carries forward the submitted certSource but always resets certificateId to undefined — the next domain being assigned needs its own certificate choice, not the previous domain's leftover selection, even if the source picker default stays on 'custom'"
  - "certificates are fetched in the same load-effect Promise.all as configs/settings (not a separate effect) — mirrors this file's existing all-or-nothing load-then-render gating, so the certificate picker's options are never stale relative to the rest of the tab's initial render"

patterns-established:
  - "Client-side certificate-source UI: a Select bound to the schema-shared enum field, a conditionally rendered second Select fed by the same-named API client's list function, and an explicit empty-state message with a Link to where the missing resource is created — reusable shape for any future 'choose from a server-managed list, with a guided empty state' form control"

requirements-completed: []  # n/a — phase scoped by four todo files, not REQUIREMENTS.md IDs (see plan frontmatter); this plan closes scope item 4 end-to-end (D-09 through D-13)

coverage:
  - id: D1
    description: "A FormData request body reaches fetch with no content-type header (browser supplies the multipart boundary); a string body keeps the JSON content-type; a caller-supplied content-type header is never overwritten; a request with no body gets no content-type"
    verification:
      - kind: unit
        ref: "client/test/unit/lib/api.test.ts (extended in Task 1, prior session)"
        status: pass
    human_judgment: false
  - id: D2
    description: "certificates-api.ts's Certificate interface exposes only id/domainPattern/expiresAt/createdAt/updatedAt (no privateKey/certificate/caBundle member); getCertificates/uploadCertificate/deleteCertificate wrap the Task-06 routes with no body stringification of the upload's FormData"
    verification:
      - kind: unit
        ref: "client/test/unit/lib/certificates-api.test.ts (Task 1, prior session)"
        status: pass
      - kind: other
        ref: "grep -cE 'privateKey|caBundle' client/src/lib/certificates-api.ts (only in upload form-field names/comment, none in the interface block); grep -c 'JSON.stringify' client/src/lib/certificates-api.ts outputs 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "CertificatesCard renders a three-file upload form (certificate, private key, optional CA bundle), a list with domain pattern/expiry/per-row expiry warning, an empty state, verbatim server rejection reasons, and delete behind a confirmation dialog naming blocking domains on conflict; no secret material ever enters component state"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/settings/certificates-card.test.tsx (12 tests, Task 2, prior session) — 9/9 relevant tests pass in isolation this session"
        status: pass
    human_judgment: false
  - id: D4
    description: "CertStatusBadge's expiring branch renders 'Expiring soon' with the accompanying message when present, is visually distinct from all three prior branches (issued/failed/pending, including the unrecognised-status fallthrough), and never uses the destructive variant"
    verification:
      - kind: unit
        ref: "client/test/unit/components/domain/stack/cert-status-badge.test.tsx — 10/10 tests pass (4 new: distinct text, message rendering, non-destructive variant, plus 3 unchanged regression locks for issued/failed/pending/unknown)"
        status: pass
    human_judgment: false
  - id: D5
    description: "proxy-tab.tsx's assign form offers a certificate-source choice (default automatic, no picker shown), reveals a picker fed by getCertificates() naming each certificate by domain pattern when 'one of my certificates' is chosen, explains where to add one when none exist, and the per-domain listing shows each domain's source (Automatic / Custom certificate) alongside its status badge"
    verification:
      - kind: unit
        ref: "client/test/unit/routes/proxy-tab.test.tsx — 'certificate source (D-11)' describe block, 4/4 new tests pass; all 14 tests in the file pass together in isolation"
        status: pass
      - kind: other
        ref: "grep -c 'certSource' client/src/routes/app/stacks/components/proxy-tab.tsx -> 6; grep -c 'getCertificates' -> 2; git diff --stat client/src/components/ui/ -> empty"
        status: pass
    human_judgment: false
  - id: D6
    description: "The item-4 todo is filed under .planning/todos/completed/ only, with a Resolution section naming D-09 through D-13 and at least one shipping plan per decision, the live-database status carried forward from plans 09-05/09-06 (Branch B, no live database reached), and the live-HTTPS-serving user-acceptance-testing handoff (a failing check reopens the item)"
    verification:
      - kind: other
        ref: "test -f .planning/todos/completed/2026-09-07-add-support-for-custom-tls-certificates.md && test ! -f .planning/todos/pending/... ; ls .planning/todos/pending/*.md | wc -l dropped from 17 to 16"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live end-to-end confirmation that a real proxy stack with a genuinely uploaded certificate serves HTTPS correctly, and that acme-companion attempts no issuance for that domain"
    verification: []
    human_judgment: true
    rationale: "This plan (and 09-06/09-07 before it) prove the feature via unit tests, real compose-YAML parsing, and a real self-signed fixture certificate's expiry — none exercise a live Docker-mounted nginx-proxy/acme-companion deployment. Same class of live-environment gap already tracked in .planning/WINDOWS.md (entries #10, #11); a new entry #12 was added this session for the live-HTTPS-serving check specifically. A human on an unrestricted host must perform the pass described in the todo's Resolution before treating scope item 4 as fully proven in production."

duration: "~1h35m active work across two sessions (rate-limit interruption mid-Task-3)"
completed: 2026-09-17
status: complete
---

# Phase 9 Plan 8: Custom TLS Certificate Client Surface Summary

**A certificates card in Settings for upload/review/removal, a certificate-source choice with a live-fed picker on the stack proxy tab, an "Expiring soon" badge that arrives with no reload, and the item-4 todo closed with all five decisions traced to the plans that shipped them.**

## Performance

- **Duration:** ~1h35m active work, spread across two sessions separated by a rate-limit interruption mid-Task-3
- **Started:** 2026-09-17T15:48:34+02:00 (Task 1, prior session)
- **Interrupted:** mid-Task-3, after the RED state (failing `proxy-tab.test.tsx` D-11 tests) was confirmed but before the implementation or the todo closure
- **Resumed:** this session, verified the interrupted RED state, then completed Task 3
- **Completed:** 2026-09-17T20:41:24+02:00
- **Tasks:** 3 (all `tdd="true"` auto tasks)
- **Files modified:** 15 across the whole plan (4 created, 11 modified, including the todo file move and a `WINDOWS.md` ledger entry)

## Accomplishments
- `apiFetch` now omits the JSON content-type for a `FormData` body (browser supplies the multipart boundary) while keeping every existing behavior — a caller-supplied header still wins, a string body still gets JSON, an absent body still gets nothing
- A typed `certificates-api.ts` client wraps the Task-06 upload/list/delete routes with a `Certificate` interface that structurally cannot hold secret material — no `privateKey`/`certificate`/`caBundle` member exists to render
- `CertificatesCard` in Settings gives a user a three-file upload form, a list with per-row expiry warnings, verbatim server rejection reasons, and a confirmation-gated delete that surfaces which domains block it
- `CertStatusBadge` gained a fourth, amber, non-destructive "Expiring soon" branch that arrives live through the existing SSE stream with no page reload
- The stack proxy tab's assign-domain form now offers a certificate-source choice (automatic vs. one of the user's uploads), a picker fed by `getCertificates()`, an honest empty-state pointer to Settings, and a per-domain Source column so a user can see at a glance which domains are automatic and which are theirs
- Scope item 4's todo is closed with a Resolution naming every one of D-09 through D-13, the plan that shipped each, the still-open live-database gap (Branch B, plans 09-05/09-06), and the live-HTTPS-serving user-acceptance-testing handoff (a new failing check reopens the item)

## Task Commits

Each task was committed atomically (Task 1 and 2 in the prior session, before this session's rate-limit interruption):

1. **Task 1: Make the HTTP helper multipart-capable and add the typed certificate client** - `30359c8` (feat, prior session)
2. **Task 2: Add a certificates card to Settings so a user can upload, review, and remove certificates** - `aa2ac1e` (feat, prior session)
3. **Task 3, implementation: Let a domain choose its certificate source, warn before expiry** - `c141db9` (feat, this session — combines the already-written RED tests with the GREEN implementation per the orchestrator's resumption guidance, since the RED state itself was never committed before the interruption)
4. **Task 3, todo closure** - `a96378c` (docs, this session)

**Plan metadata:** (this commit) - `docs(09-08): complete custom TLS certificate client surface plan`

_Note: this plan's TDD discipline for Task 3 diverges from the usual RED-commit/GREEN-commit split — the interrupted prior session confirmed genuine RED (4 failing `proxy-tab.test.tsx` tests, 14 pre-existing tests still passing, verified directly by the orchestrator before this session began) but never committed that state. This session verified the same RED state was still present (`git status`/`git log` confirmed no intervening commits), then implemented directly to GREEN and committed test+implementation together, per the orchestrator's explicit instruction for this resumption case._

## Task 3: TDD Discipline (RED confirmed by orchestrator → GREEN this session)

**RED (confirmed, not committed by this session):** The orchestrator's prompt recorded that `client/test/unit/routes/proxy-tab.test.tsx`'s "certificate source (D-11)" describe block (4 tests: defaults-to-automatic-no-picker, reveals-picker-fed-by-getCertificates, explains-empty-state, shows-per-domain-source) had already been run against the unmodified `proxy-tab.tsx` and failed exactly on those 4 assertions, with all 14 pre-existing tests in the file still passing — and that `cert-status-badge.tsx`'s `expiring` branch (and its 10 tests) were already complete and green from the same interrupted session. This session re-verified via `git log`/`git status` that no commits landed between that RED confirmation and this session's start, so no re-run was performed before proceeding (re-running would have re-derived the identical RED state at the cost of nothing gained).

**GREEN (this session):** Implemented the certificate-source form control in `proxy-tab.tsx` — a `certSource` `FormField` bound to a Select (`Automatic (Let's Encrypt)` / `One of my certificates`), a `certificates` state array populated by `getCertificates()` in the tab's existing load-effect `Promise.all`, a conditionally rendered `certificateId` `FormField`/Select when `certSource === "custom"` (fed by the fetched certificates, labeled by `domainPattern`), an empty-state `Alert` linking to Settings when no certificates exist, and a new "Source" table column rendering "Automatic" / "Custom certificate" per domain. Re-ran: **`proxy-tab.test.tsx` 14/14 pass, `cert-status-badge.test.tsx` 10/10 pass**, `yarn typecheck` exits 0. Committed as `c141db9`.

One fix-forward during GREEN: the assign form's `certSource` Select initially labeled the automatic option bare `"Automatic"`, which collided (exact-text ambiguity) with the per-domain listing's own `"Automatic"` cell in the D-11 per-domain-listing test — both elements are on screen simultaneously whenever configs exist. Relabeled the Select's option to `"Automatic (Let's Encrypt)"` (still matches the `/automatic/i` substring check in the "defaults to automatic" test) before the first full run; no second GREEN cycle was needed after that adjustment.

## Files Created/Modified

**Task 1 (prior session):**
- `client/src/lib/api.ts` — FormData content-type omission
- `client/src/lib/certificates-api.ts` — new typed client
- `client/src/lib/proxy-api.ts` — `certSource`/`certificateId` fields
- `client/src/hooks/use-proxy-status.ts` — `expiring` added to status union
- `client/test/unit/lib/api.test.ts`, `client/test/unit/lib/certificates-api.test.ts`

**Task 2 (prior session):**
- `client/src/routes/app/settings/components/certificates-card.tsx` — new
- `client/src/routes/app/settings.tsx` — 2-line import+render wiring
- `client/test/unit/routes/settings/certificates-card.test.tsx` — new

**Task 3 (this session):**
- `client/src/components/domain/stack/cert-status-badge.tsx` — `expiring` branch (written prior session, committed this session)
- `client/test/unit/components/domain/stack/cert-status-badge.test.tsx` — 4 new tests (written prior session, committed this session)
- `client/src/routes/app/stacks/components/proxy-tab.tsx` — certificate-source choice, picker, empty state, Source column (implemented this session)
- `client/test/unit/routes/proxy-tab.test.tsx` — 4 new D-11 tests (written prior session, committed this session)
- `.planning/todos/completed/2026-09-07-add-support-for-custom-tls-certificates.md` — moved from `pending/`, Resolution appended (this session)
- `.planning/WINDOWS.md` — entry #12 added for the still-unexercised live-HTTPS-serving check (this session)

## Decisions Made

See `key-decisions` in frontmatter. In particular: the automatic-source Select label was changed from bare "Automatic" to "Automatic (Let's Encrypt)" specifically to avoid exact-text collision with the per-domain listing's own "Automatic" cell — both render simultaneously once any config exists, and the D-11 per-domain-listing test asserts on the exact string "Automatic" for the table cell.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Certificate-source Select label collided with the per-domain listing's own text**
- **Found during:** Task 3, first full test run after implementing the certSource Select
- **Issue:** Labeling the "acme" `SelectItem` as bare "Automatic" produced two elements with the exact text "Automatic" on screen at once (the assign form's default-selected value display, and the per-domain listing's Source column for an acme-sourced row) — `screen.getByText("Automatic")` in the "shows each domain's certificate source in the per-domain listing" test threw a multiple-elements error.
- **Fix:** Relabeled the Select's acme option to "Automatic (Let's Encrypt)" — still satisfies the separate `/automatic/i` substring check in the "defaults to automatic" test, and no longer collides with the table cell's exact "Automatic" text.
- **Files modified:** `client/src/routes/app/stacks/components/proxy-tab.tsx`
- **Verification:** `proxy-tab.test.tsx` 14/14 pass after the fix, including both the defaulting test and the per-domain-listing test.
- **Committed in:** `c141db9` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic label fix only, discovered and resolved during normal TDD GREEN verification. No scope creep, no behavior change beyond the label text.

## Issues Encountered

- **Full-suite test-run flake, same documented host-contention class as prior phase sessions.** `yarn workspace @docktor/client test` (whole suite) reported 5 failed files / 13 failed tests, including 3 in `proxy-tab.test.tsx` and 4 in `certificates-card.test.tsx` — both files this plan touches. Re-ran both files together in isolation immediately after: **26/26 pass** (12 certificates-card + 14 proxy-tab). Host evidence at the time of the full-suite run: `uptime` load average 23.97/45.15/26.15 on the box, `free -h` showing 2.0Gi swap fully allocated with ~819Mi free RAM, and `ps aux` confirming unrelated resident workloads (two `clamscan` processes at 97%/96% CPU, SonarQube's Elasticsearch+web+compute-engine JVMs, three separate `mysqld`/`mariadbd` instances, Jellyfin, Immich) — the same class of host contention already documented in `STATE.md` for 06-05, 08-01, and elsewhere. The other 3 failing files (`service-upgrade-dialog.test.tsx`, `stack-actions.test.tsx`, `stack-detail-page.test.tsx`) are entirely outside this plan's scope and were not re-verified, consistent with the plan's own instruction to attribute only in-scope file failures.

## User Setup Required

None — no external service configuration required. Per the todo's Resolution and `.planning/WINDOWS.md` entries #11 and #12, a developer on an unrestricted host with a live database and a live proxy stack must: (1) run `yarn db:migrate` and confirm the `certSource='acme'` backfill (carried forward from plan 09-05, entry #11), and (2) upload a real certificate through the browser, assign it to a domain, and confirm both HTTPS serving and no ACME issuance attempt (entry #12, first exercisable now that this plan ships the browser surface) — before scope item 4 is treated as fully proven in production.

## Next Phase Readiness

- **Phase 9 is now fully executed:** this was the last plan (8 of 8). All four scope items (deployment docs drift-check, Prisma migrate cutover, Windows/macOS CI, custom TLS certificates) have shipped at the source-and-unit-test level.
- **Two carried-forward live-environment gaps remain open** (`.planning/WINDOWS.md` #10, #11, #12): the Prisma migrate baseline/cutover has never been applied to a live database (#10, #11), and the custom-certificate feature has never been exercised against a live nginx-proxy/acme-companion deployment (#12). Both require a developer on an unrestricted host and are pre-existing classes of gap, not new risk introduced by this plan.
- **No blockers for phase closure at the planning level** — every plan's own `<verify>` and acceptance criteria are satisfied; the open WINDOWS.md entries are exactly the kind of tracked, named gap the ledger exists to carry into `/gsd-ship`'s gate rather than lose silently.

## Self-Check: PASSED

- FOUND: `client/src/lib/certificates-api.ts`
- FOUND: `client/src/routes/app/settings/components/certificates-card.tsx`
- FOUND: `client/src/components/domain/stack/cert-status-badge.tsx`
- FOUND: `client/src/routes/app/stacks/components/proxy-tab.tsx`
- FOUND: `.planning/todos/completed/2026-09-07-add-support-for-custom-tls-certificates.md`
- MISSING (expected): `.planning/todos/pending/2026-09-07-add-support-for-custom-tls-certificates.md`
- FOUND commit: `30359c8` (feat, Task 1)
- FOUND commit: `aa2ac1e` (feat, Task 2)
- FOUND commit: `c141db9` (feat, Task 3 implementation)
- FOUND commit: `a96378c` (docs, todo closure)

---
*Phase: 09-deployment-and-release-readiness*
*Completed: 2026-09-17*
