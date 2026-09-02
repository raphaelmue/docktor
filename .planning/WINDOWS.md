---
schema_version: 1
open_count: 8
waived_count: 0
fixed_count: 0
total_count: 8
last_updated: 2026-09-02T09:31:39.036Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | server/test/integration/setup-concurrency.test.ts |  | Integration test cannot be executed in this sandboxed worktree: testcontainers postgres:17 TCP connect succeeds but protocol-level data never flows (confirmed with raw pg.Client and prisma db push both hanging/failing identically on the pre-existing, unmodified stacks.test.ts) — a Docker-outside-of-Docker networking limitation, not a code defect. tsc and all static acceptance criteria (getPrisma export, setting.deleteMany, no createTestUser, Promise.all present) pass. | open |  | 2026-08-31T13:32:33.722Z |  |
| 2 | 05.1 | unrun-verify | server/test/integration/setup.ts |  | yarn workspace @docktor/server test:integration could not be verified to exit 0 in this session — confirmed host-level TCP-to-Docker-published-port block (not a repo defect); see 05.1-01-SUMMARY.md Known Limitation | open |  | 2026-09-01T14:19:41.957Z |  |
| 3 | 05.1 | unrun-verify | .planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-02-SUMMARY.md |  | Manual two-browser-tab verification (plan 05.1-02 verification item 4: Deploy shows Deploying badge live in every open tab; compose/env save shows config-changed banner live without reload) could not be executed — no running Docktor instance/browser available in this session. All underlying unit-level behavior is proven (D1-D5). | open |  | 2026-09-02T07:47:09.421Z |  |
| 4 | 05.1 | unrun-verify | docker-compose.yml |  | D1 (relative bind mount lands at correct host path via DooD fix) was verified live once, but the live test itself caused a real-service incident (see 05.1-03-SUMMARY.md); needs re-verification in a properly isolated Docker host before being treated as a routine repeatable check | open |  | 2026-09-02T08:19:28.160Z |  |
| 5 | 05.1 | unrun-verify | server/src/application/backup-service.ts |  | D2 (restic archives the same physical path the containers write into) confirmed by code inspection only — not exercised via an actual restic backup+restore cycle against a real stack | open |  | 2026-09-02T08:19:29.253Z |  |
| 6 | 05.1 | unrun-verify | server/src/jobs/file-watcher.ts |  | Task 2 manual check (editing a running stack's .env file directly on disk shows the config-changed badge in the UI within the watcher's detection window) could not be executed — no running Docktor instance in this session. Unit-level behavior fully proven (42/42 file-watcher tests pass). | open |  | 2026-09-02T09:31:36.765Z |  |
| 7 | 05.1 | unrun-verify | client/src/routes/app/stacks/[id].tsx |  | Task 3 end-to-end check (introducing a YAML syntax error into a running stack's compose file makes a red indicator appear on both the stack list and detail page with no manual reload, and fixing the file clears it) could not be executed — no running Docktor instance/browser in this session. Unit-level behavior fully proven (20/20 hook tests pass). | open |  | 2026-09-02T09:31:37.929Z |  |
| 8 | 05.1 | unrun-verify | server/prisma/schema/stack.prisma |  | yarn db:push could not apply the two new fields (configError, lastEnvHash) to the live dev database — same documented host-level TCP-to-Docker-published-port block as 05.1-01/05.1-05 (raw TCP connects to docktor-db-dev:5432 but the Postgres protocol handshake never completes). yarn db:generate succeeded (schema is syntactically valid), and both workspaces type-check clean against the regenerated Prisma client. | open |  | 2026-09-02T09:31:39.036Z |  |

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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-01T14:19:41.957Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": ".planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-02-SUMMARY.md",
    "line": null,
    "description": "Manual two-browser-tab verification (plan 05.1-02 verification item 4: Deploy shows Deploying badge live in every open tab; compose/env save shows config-changed banner live without reload) could not be executed — no running Docktor instance/browser available in this session. All underlying unit-level behavior is proven (D1-D5).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T07:47:09.421Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "docker-compose.yml",
    "line": null,
    "description": "D1 (relative bind mount lands at correct host path via DooD fix) was verified live once, but the live test itself caused a real-service incident (see 05.1-03-SUMMARY.md); needs re-verification in a properly isolated Docker host before being treated as a routine repeatable check",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T08:19:28.160Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/src/application/backup-service.ts",
    "line": null,
    "description": "D2 (restic archives the same physical path the containers write into) confirmed by code inspection only — not exercised via an actual restic backup+restore cycle against a real stack",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T08:19:29.253Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "server/src/jobs/file-watcher.ts",
    "line": null,
    "description": "Task 2 manual check (editing a running stack's .env file directly on disk shows the config-changed badge in the UI within the watcher's detection window) could not be executed — no running Docktor instance in this session. Unit-level behavior fully proven (42/42 file-watcher tests pass).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T09:31:36.765Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "05.1",
    "file": "client/src/routes/app/stacks/[id].tsx",
    "line": null,
    "description": "Task 3 end-to-end check (introducing a YAML syntax error into a running stack's compose file makes a red indicator appear on both the stack list and detail page with no manual reload, and fixing the file clears it) could not be executed — no running Docktor instance/browser in this session. Unit-level behavior fully proven (20/20 hook tests pass).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-02T09:31:37.929Z",
    "resolved_at": null
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
  }
]
````
