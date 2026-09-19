---
schema_version: 1
open_count: 5
waived_count: 0
fixed_count: 7
total_count: 12
last_updated: 2026-09-17T18:41:50.828Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | server/test/integration/setup-concurrency.test.ts |  | Integration test cannot be executed in this sandboxed worktree: testcontainers postgres:17 TCP connect succeeds but protocol-level data never flows (confirmed with raw pg.Client and prisma db push both hanging/failing identically on the pre-existing, unmodified stacks.test.ts) — a Docker-outside-of-Docker networking limitation, not a code defect. tsc and all static acceptance criteria (getPrisma export, setting.deleteMany, no createTestUser, Promise.all present) pass. | open |  | 2026-08-31T13:32:33.722Z |  |
| 2 | 05.1 | unrun-verify | server/test/integration/setup.ts |  | yarn workspace @docktor/server test:integration could not be verified to exit 0 in this session — confirmed host-level TCP-to-Docker-published-port block (not a repo defect); see 05.1-01-SUMMARY.md Known Limitation | fixed |  | 2026-09-01T14:19:41.957Z | 2026-09-11T21:28:33.756Z |
| 3 | 05.1 | unrun-verify | .planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-02-SUMMARY.md |  | Manual two-browser-tab verification (plan 05.1-02 verification item 4: Deploy shows Deploying badge live in every open tab; compose/env save shows config-changed banner live without reload) could not be executed — no running Docktor instance/browser available in this session. All underlying unit-level behavior is proven (D1-D5). | fixed |  | 2026-09-02T07:47:09.421Z | 2026-09-11T21:28:52.125Z |
| 4 | 05.1 | unrun-verify | docker-compose.yml |  | D1 (relative bind mount lands at correct host path via DooD fix) was verified live once, but the live test itself caused a real-service incident (see 05.1-03-SUMMARY.md); needs re-verification in a properly isolated Docker host before being treated as a routine repeatable check | fixed |  | 2026-09-02T08:19:28.160Z | 2026-09-11T21:28:52.522Z |
| 5 | 05.1 | unrun-verify | server/src/application/backup-service.ts |  | D2 (restic archives the same physical path the containers write into) confirmed by code inspection only — not exercised via an actual restic backup+restore cycle against a real stack | fixed |  | 2026-09-02T08:19:29.253Z | 2026-09-11T21:28:52.920Z |
| 6 | 05.1 | unrun-verify | server/src/jobs/file-watcher.ts |  | Task 2 manual check (editing a running stack's .env file directly on disk shows the config-changed badge in the UI within the watcher's detection window) could not be executed — no running Docktor instance in this session. Unit-level behavior fully proven (42/42 file-watcher tests pass). | fixed |  | 2026-09-02T09:31:36.765Z | 2026-09-11T21:28:53.385Z |
| 7 | 05.1 | unrun-verify | client/src/routes/app/stacks/[id].tsx |  | Task 3 end-to-end check (introducing a YAML syntax error into a running stack's compose file makes a red indicator appear on both the stack list and detail page with no manual reload, and fixing the file clears it) could not be executed — no running Docktor instance/browser in this session. Unit-level behavior fully proven (20/20 hook tests pass). | fixed |  | 2026-09-02T09:31:37.929Z | 2026-09-11T21:28:53.844Z |
| 8 | 05.1 | unrun-verify | server/prisma/schema/stack.prisma |  | yarn db:push could not apply the two new fields (configError, lastEnvHash) to the live dev database — same documented host-level TCP-to-Docker-published-port block as 05.1-01/05.1-05 (raw TCP connects to docktor-db-dev:5432 but the Postgres protocol handshake never completes). yarn db:generate succeeded (schema is syntactically valid), and both workspaces type-check clean against the regenerated Prisma client. | open |  | 2026-09-02T09:31:39.036Z |  |
| 9 | 05.1 | unrun-verify | server/test/integration/imports.test.ts |  | New imports.test.ts (401 rejection x4, scan+adopt round-trip, T-05-09 410 regression guard) could not execute in this sandbox — same confirmed environmental P1001 TCP-to-Docker-published-Postgres-port block documented in 05.1-01/05.1-05 SUMMARYs. Code reviewed against passing sibling test files (stacks.test.ts, setup-wizard-flow.test.ts) but never run to green. | fixed |  | 2026-09-02T10:06:02.732Z | 2026-09-11T21:28:54.285Z |
| 10 | 09 | unrun-verify | server/src/lib/schema-sync.ts |  | Task 3 of 09-03-PLAN.md: live baselining (migrate resolve --applied 0_init, migrate deploy x2, migrate diff drift probe) against the dev DB could not run — TCP connect to localhost:5432 succeeds but the Postgres protocol handshake never completes (same class as 05.1-01/05.1-05/05.1-06/06-01/06-07/08-01/WINDOWS #1/#8, confirmed independently via raw pg.Client and prisma migrate status, both P1001/timeout). migrate deploy's real no-op stdout text is therefore still unverified against the classification regex in schema-sync.ts. A developer on an unrestricted host must run the 4-command sequence recorded in 09-03-SUMMARY.md. | open |  | 2026-09-16T08:06:44.168Z |  |
| 11 | 09 | unrun-verify | server/prisma/migrations/20260917083545_add_certificate/migration.sql |  | Plan 09-05 Task 3 Branch B: migration generated without a database (from-schema-copy diff technique, matches 09-03's entry #10 precedent) — TCP connect to localhost:5432 succeeds but the Postgres wire-protocol handshake never completes (confirmed via prisma migrate status P1001 and a raw pg.Client 8s timeout, same class as 05.1-01/05.1-05/05.1-06/06-01/06-07/08-01/09-03). No live database has this migration applied; the certSource backfill onto pre-existing ProxyConfig rows is therefore unverified. A developer on an unrestricted host must run: yarn db:migrate (will detect this migration as already written and pending) then verify every existing ProxyConfig row has certSource='acme' and migration history shows 0_init followed by this migration. | open |  | 2026-09-17T08:36:50.295Z |  |
| 12 | 09 | unrun-verify | client/src/routes/app/stacks/components/proxy-tab.tsx |  | Live end-to-end confirmation that a real proxy stack with a genuinely uploaded certificate serves HTTPS correctly (and acme-companion attempts no issuance for that domain) has not been exercised in any session across plans 09-06/09-07/09-08 — proven only via source-level logic, real compose-YAML parsing, and a real self-signed fixture certificate's expiry, never a live nginx-proxy/acme-companion deployment. A developer on an unrestricted host must upload a real cert through the browser, assign it to a domain, and confirm both HTTPS serving and no ACME issuance attempt. | open |  | 2026-09-17T18:41:50.828Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "server/test/integration/setup-concurrency.test.ts",
    "line": null,
    "description": "Integration test cannot be executed in this sandboxed worktree: testcontainers postgres:17 TCP connect succeeds but protocol-level data never flows (confirmed with raw pg.Client and prisma db push both hanging/failing identically on the pre-existing, unmodified stacks.test.ts) — a Docker-outside-of-Docker networking limitation, not a code defect. tsc and all static acceptance criteria (getPrisma export, setting.deleteMany, no createTestUser, Promise.all present) pass.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-31T13:32:33.722Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/test/integration/setup.ts",
    "line": null,
    "description": "yarn workspace @docktor/server test:integration could not be verified to exit 0 in this session — confirmed host-level TCP-to-Docker-published-port block (not a repo defect); see 05.1-01-SUMMARY.md Known Limitation",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-01T14:19:41.957Z",
    "resolved_at": "2026-09-11T21:28:33.756Z"
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": ".planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-02-SUMMARY.md",
    "line": null,
    "description": "Manual two-browser-tab verification (plan 05.1-02 verification item 4: Deploy shows Deploying badge live in every open tab; compose/env save shows config-changed banner live without reload) could not be executed — no running Docktor instance/browser available in this session. All underlying unit-level behavior is proven (D1-D5).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T07:47:09.421Z",
    "resolved_at": "2026-09-11T21:28:52.125Z"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "docker-compose.yml",
    "line": null,
    "description": "D1 (relative bind mount lands at correct host path via DooD fix) was verified live once, but the live test itself caused a real-service incident (see 05.1-03-SUMMARY.md); needs re-verification in a properly isolated Docker host before being treated as a routine repeatable check",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T08:19:28.160Z",
    "resolved_at": "2026-09-11T21:28:52.522Z"
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/src/application/backup-service.ts",
    "line": null,
    "description": "D2 (restic archives the same physical path the containers write into) confirmed by code inspection only — not exercised via an actual restic backup+restore cycle against a real stack",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T08:19:29.253Z",
    "resolved_at": "2026-09-11T21:28:52.920Z"
  },
  {
    "id": 6,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/src/jobs/file-watcher.ts",
    "line": null,
    "description": "Task 2 manual check (editing a running stack's .env file directly on disk shows the config-changed badge in the UI within the watcher's detection window) could not be executed — no running Docktor instance in this session. Unit-level behavior fully proven (42/42 file-watcher tests pass).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T09:31:36.765Z",
    "resolved_at": "2026-09-11T21:28:53.385Z"
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "client/src/routes/app/stacks/[id].tsx",
    "line": null,
    "description": "Task 3 end-to-end check (introducing a YAML syntax error into a running stack's compose file makes a red indicator appear on both the stack list and detail page with no manual reload, and fixing the file clears it) could not be executed — no running Docktor instance/browser in this session. Unit-level behavior fully proven (20/20 hook tests pass).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T09:31:37.929Z",
    "resolved_at": "2026-09-11T21:28:53.844Z"
  },
  {
    "id": 8,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/prisma/schema/stack.prisma",
    "line": null,
    "description": "yarn db:push could not apply the two new fields (configError, lastEnvHash) to the live dev database — same documented host-level TCP-to-Docker-published-port block as 05.1-01/05.1-05 (raw TCP connects to docktor-db-dev:5432 but the Postgres protocol handshake never completes). yarn db:generate succeeded (schema is syntactically valid), and both workspaces type-check clean against the regenerated Prisma client.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T09:31:39.036Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/test/integration/imports.test.ts",
    "line": null,
    "description": "New imports.test.ts (401 rejection x4, scan+adopt round-trip, T-05-09 410 regression guard) could not execute in this sandbox — same confirmed environmental P1001 TCP-to-Docker-published-Postgres-port block documented in 05.1-01/05.1-05 SUMMARYs. Code reviewed against passing sibling test files (stacks.test.ts, setup-wizard-flow.test.ts) but never run to green.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T10:06:02.732Z",
    "resolved_at": "2026-09-11T21:28:54.285Z"
  },
  {
    "id": 10,
    "kind": "unrun-verify",
    "phase": "09",
    "file": "server/src/lib/schema-sync.ts",
    "line": null,
    "description": "Task 3 of 09-03-PLAN.md: live baselining (migrate resolve --applied 0_init, migrate deploy x2, migrate diff drift probe) against the dev DB could not run — TCP connect to localhost:5432 succeeds but the Postgres protocol handshake never completes (same class as 05.1-01/05.1-05/05.1-06/06-01/06-07/08-01/WINDOWS #1/#8, confirmed independently via raw pg.Client and prisma migrate status, both P1001/timeout). migrate deploy's real no-op stdout text is therefore still unverified against the classification regex in schema-sync.ts. A developer on an unrestricted host must run the 4-command sequence recorded in 09-03-SUMMARY.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-16T08:06:44.168Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "unrun-verify",
    "phase": "09",
    "file": "server/prisma/migrations/20260917083545_add_certificate/migration.sql",
    "line": null,
    "description": "Plan 09-05 Task 3 Branch B: migration generated without a database (from-schema-copy diff technique, matches 09-03's entry #10 precedent) — TCP connect to localhost:5432 succeeds but the Postgres wire-protocol handshake never completes (confirmed via prisma migrate status P1001 and a raw pg.Client 8s timeout, same class as 05.1-01/05.1-05/05.1-06/06-01/06-07/08-01/09-03). No live database has this migration applied; the certSource backfill onto pre-existing ProxyConfig rows is therefore unverified. A developer on an unrestricted host must run: yarn db:migrate (will detect this migration as already written and pending) then verify every existing ProxyConfig row has certSource='acme' and migration history shows 0_init followed by this migration.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-17T08:36:50.295Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "unrun-verify",
    "phase": "09",
    "file": "client/src/routes/app/stacks/components/proxy-tab.tsx",
    "line": null,
    "description": "Live end-to-end confirmation that a real proxy stack with a genuinely uploaded certificate serves HTTPS correctly (and acme-companion attempts no issuance for that domain) has not been exercised in any session across plans 09-06/09-07/09-08 — proven only via source-level logic, real compose-YAML parsing, and a real self-signed fixture certificate's expiry, never a live nginx-proxy/acme-companion deployment. A developer on an unrestricted host must upload a real cert through the browser, assign it to a domain, and confirm both HTTPS serving and no ACME issuance attempt.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-17T18:41:50.828Z",
    "resolved_at": null
  }
]
````
