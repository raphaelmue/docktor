---
schema_version: 1
open_count: 5
waived_count: 0
fixed_count: 0
total_count: 5
last_updated: 2026-09-02T08:19:29.253Z
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
  }
]
````
