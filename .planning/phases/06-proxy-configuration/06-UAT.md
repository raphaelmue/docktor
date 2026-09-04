---
status: testing
phase: 06-proxy-configuration
source: [06-VERIFICATION.md]
started: 2026-09-04T18:05:00Z
updated: 2026-09-04T18:05:00Z
---

## Current Test

number: 1
name: Live database schema verification
expected: |
  Run `yarn dotenv -e .env.development -- prisma db push --accept-data-loss --config=server/prisma/prisma.config.ts` on a host where the dev Postgres (`docktor-db-dev`) is reachable, then query `information_schema.columns` for `Stack.isProtected` and `ProxyConfig.certStatus`/`certMessage`/`certCheckedAt` (and confirm `npmProxyHostId`/`isPublic` are absent). The live database schema matches server/prisma/schema/proxy.prisma and stack.prisma.
awaiting: user response

## Tests

### 1. Live database schema verification
expected: The live database schema matches server/prisma/schema/proxy.prisma and stack.prisma (Stack.isProtected; ProxyConfig.certStatus/certMessage/certCheckedAt present; npmProxyHostId/isPublic absent). Both this verification session and every one of the six plan-execution sessions hit the identical `P1001: Can't reach database server` error against the published Postgres port — a documented, host-level sandbox restriction, not something a grep/file check can resolve.
result: [pending]

### 2. Integration test execution
expected: Run `yarn workspace @docktor/server test:integration test/integration/proxy.test.ts` and `test/integration/setup-wizard-flow.test.ts` on an unrestricted host with a reachable Postgres. All HTTP-round-trip assertions pass: 201 assign + real compose-file write, GET list, 409 duplicate domain, 400 invalid hostname, 400 proxy-stack-not-deployed, 204/404 remove, 409 port-conflict deploy, 400 compose-failure deploy, 401 on every route without a cookie, and the wizard step6 flow. The underlying mechanisms these integration tests exercise (compose-file byte-preservation, D-08 aggregation, idempotent re-assign, removeServiceProxyEnv) are independently unit-tested against real temp-directory files and did run green — only the HTTP-boundary round trip is unconfirmed.
result: [pending]

### 3. Live proxy-stack deploy, certificate issuance, and wizard walkthrough
expected: On a dedicated/verified-clear Docker host with free host ports 80/443: POST /api/settings/proxy/deploy (or the wizard's Proxy step), then `docker ps` for docktor-proxy-nginx/docktor-proxy-acme, `docker network ls` for a bare `docktor_proxy` network, assign a domain with TLS to a real service, and confirm a DNS-pointed domain reaches "Secured" while a non-pointed one shows "Cert failed" with a real acme-companion log line. Also confirm the dashboard hides docktor-proxy while proxy.showInDashboard is off, and that stop/restart/delete on it return 400. The managed proxy stack deploys, routes traffic, issues real certificates, and is protected — end to end, on real infrastructure. No live Docker host with free ports 80/443 was available in any of the six plan-execution sessions or in this verification session (the shared execution host carries real unrelated production workloads, and a prior live docker-compose run on this exact host stopped real containers before the collision was noticed — recorded in STATE.md).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
