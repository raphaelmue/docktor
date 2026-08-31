---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-08-31T13:32:33.722Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | server/test/integration/setup-concurrency.test.ts |  | Integration test cannot be executed in this sandboxed worktree: testcontainers postgres:17 TCP connect succeeds but protocol-level data never flows (confirmed with raw pg.Client and prisma db push both hanging/failing identically on the pre-existing, unmodified stacks.test.ts) — a Docker-outside-of-Docker networking limitation, not a code defect. tsc and all static acceptance criteria (getPrisma export, setting.deleteMany, no createTestUser, Promise.all present) pass. | open |  | 2026-08-31T13:32:33.722Z |  |

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
  }
]
````
