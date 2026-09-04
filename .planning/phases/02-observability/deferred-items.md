# Deferred Items — Phase 02 Observability

Out-of-scope discoveries surfaced while executing plan 02-08. Not fixed here per the
executor's scope boundary rule (only issues directly caused by the current task's
changes are auto-fixed).

## ~~Pre-existing RED-phase test stubs~~ — RESOLVED in `ebbb566`

Was: 22 pre-existing failures across `server/test/unit/infrastructure/brownfield-scanner.test.ts`
(7 tests, WIZ-06/BF-01) and `compose-analyzer.test.ts` (15 tests, BF-02) — TDD RED-phase
stubs with `expect(true).toBe(false)` placeholders and the real assertions commented out,
originally left for a follow-up plan since they were unrelated to 02-08's `files_modified`.

Fixed directly at the user's request (`ebbb566`): both `BrownfieldScanner` and
`ComposeAnalyzer` were already fully implemented, but the commented-out test bodies no
longer matched the real API and couldn't just be uncommented. Rewrote both suites against
the actual implementations, mocking `fast-glob`/`node:fs/promises` for the scanner per
project convention. Two real implementation gaps surfaced and were fixed rather than
tested around: `extractBindMounts` didn't support Compose's long-form volume syntax at
all, and `extractInlineEnvVars` treated `HOST: ${HOST}`-style object-form variable
references as literal inline values instead of excluding them like the array form does.
Full server unit suite: 285/285 passing.

## No schema sync step on container startup (discovered during 02-08 Task 3 Docker verification)

Fresh `docker compose up` fails at runtime with `The table 'public.Backup' does not
exist in the current database` — nothing in the Docker image or compose startup runs
`prisma db push` (the project uses schemaless `db push`, not `prisma migrate`; no
`server/prisma/migrations/` directory exists) against the database before the server
starts serving requests.

Not fixed here: this is a deployment/infra gap unrelated to plan 02-08's
`files_modified` and unrelated to Phase 02's observability scope. User confirmed a
local workaround exists and asked that a real fix wait until the project adopts a
formal migration schema (`prisma migrate`) rather than `db push`, since a `db push`
step baked into container startup that also needs conditional guards (don't ever
run against prod without confirmation, don't race multiple replicas) is a bigger design
decision than a quick patch.

## No redirect to /setup wizard on first run (discovered during 02-08 Task 3 Docker verification)

User reported that a fresh instance does not get routed to `/setup` (the onboarding
wizard at `client/src/routes/setup.tsx`, gated by `checkSetupStatus()` in
`client/src/lib/setup-api.ts`) — not yet investigated further; user asked to defer
and continue the planned checkpoint verification instead. Not fixed here: unrelated
to plan 02-08's `files_modified` and out of Phase 02's observability scope. Needs a
follow-up look at whatever route guard is (or isn't) calling `checkSetupStatus()` on
app load.
