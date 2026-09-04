---
created: 2026-08-28T11:04:58.168Z
title: Fix integration/e2e tests
area: testing
severity: blocker
files:
  - server/package.json (test:integration script)
  - client/package.json (test:integration / Playwright script)
---

## Problem

Integration and end-to-end tests are currently broken/failing across the
monorepo. Server integration tests run via `yarn workspace @docktor/server
test:integration` (Vitest, `test/integration` project — hits a real
Postgres DB, no mocked DB per project convention). Client e2e tests run via
`yarn workspace @docktor/client test:integration` (Playwright).

Recent commits on this branch touched job/watcher logic
(`fix(jobs): fix inverted ignored-filter logic silently blocking
FileWatcher traversal`, `fix(jobs): make FileWatcher polling mode
overridable, default on in Docker`) and added RED-phase test stubs
(`test: complete RED-phase stubs for BrownfieldScanner and
ComposeAnalyzer`) — these are plausible recent causes or related areas to
check first.

No specific failure output was captured at capture time; next session
should run both suites to get current failure details before diagnosing.

## Solution

TBD — run `yarn workspace @docktor/server test:integration` and
`yarn workspace @docktor/client test:integration` to capture current
failures, then apply `superpowers:systematic-debugging` to root-cause
before fixing. Keep server integration tests against the real DB (no
mocking) per project testing rules.
