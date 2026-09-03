---
status: resolved
trigger: "G-05.1-2: Following docs/deployment.md's quickstart exactly (cp .env.example .env.local; set DOCKTOR_STACKS_HOST_DIR in .env.local; docker compose up -d) makes the server refuse to boot with a \"Stacks directory path mismatch\" error."
created: 2026-09-03T07:29:19Z
updated: 2026-09-03T10:45:00Z
---

## Current Focus

hypothesis: CONFIRMED — see Resolution
test: done
expecting: n/a
next_action: n/a — diagnose-only mode, returning root cause to caller

## Symptoms

expected: Following docs/deployment.md exactly (cp .env.example .env.local; set DOCKTOR_STACKS_HOST_DIR in .env.local; docker compose up -d) boots the server successfully with the custom stacks directory.
actual: |
  The server refuses to boot. Reproduced multiple times (once with a Windows path, once with the corrected /mnt/c/... POSIX path, once more this session) — same failure every time, regardless of the exact path value.
errors: |
  docktor | Error: Stacks directory path mismatch: DOCKTOR_STACKS_HOST_DIR ("/mnt/c/Users/D070307/workspace/docktor/dev-data/docktor/stacks") does not match the container-side DOCKTOR_STACKS_DIR ("/opt/docktor/stacks").
      at assertStacksDirMatchesHost (file:///app/dist/server/lib/stacks-dir.js:52:15)
      at file:///app/dist/server/index.js:7:5
reproduction: cp .env.example .env.local; set DOCKTOR_STACKS_HOST_DIR to any non-default value in .env.local; docker compose up -d (no --env-file flag, matching docs/deployment.md's documented quickstart exactly).
started: Present since 05.1-03's fix (which added the `environment: DOCKTOR_STACKS_DIR: ${DOCKTOR_STACKS_HOST_DIR:-...}` interpolation block to docker-compose.yml). Discovered during Phase 05.1 UAT Test 3.

## Eliminated

(none — root cause confirmed on first hypothesis, matching the prior investigation recorded in the UAT gap)

## Evidence

- timestamp: 2026-09-03T07:30:00Z
  checked: docker-compose.yml (current HEAD), .env.example (current HEAD, via `git show HEAD:.env.example` — direct Read is blocked by session file-permission settings on `.env*`)
  found: |
    docker-compose.yml's `docktor` service has:
      env_file: [.env.local]
      environment: { DOCKTOR_STACKS_DIR: ${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks} }
      volumes: [ "${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}:${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}", ... ]
    .env.example sets DOCKTOR_STACKS_DIR=/opt/docktor/stacks and DOCKTOR_STACKS_HOST_DIR=/opt/docktor/stacks (same default), instructing users to change only DOCKTOR_STACKS_HOST_DIR to relocate.
    docs/deployment.md's Quickstart step 2/3 says `cp .env.example .env.local`, edit values in `.env.local`, then plain `docker compose up -d` — no `--env-file` flag anywhere in the quickstart or troubleshooting table.
  implication: The `${DOCKTOR_STACKS_HOST_DIR:-...}` tokens appear in two different YAML constructs with two different resolution mechanisms — top-level Compose variable interpolation (used to compute the `environment:` value and to build the `volumes:` bind-mount source/target) vs. `env_file:` (used to inject variables into the running container's process environment). These are documented by Docker Compose to be resolved differently: interpolation reads only the real process/shell environment or a file literally named `.env` (or `--env-file`); `env_file:` entries never feed interpolation, they only populate the container's runtime env after the container spec has already been built.

- timestamp: 2026-09-03T07:31:30Z
  checked: server/src/lib/stacks-dir.ts (assertStacksDirMatchesHost, getStacksDir)
  found: |
    getStacksDir() = path.resolve(process.env.DOCKTOR_STACKS_DIR ?? "./stacks") — reads the container's actual runtime env var DOCKTOR_STACKS_DIR.
    assertStacksDirMatchesHost() compares path.resolve(process.env.DOCKTOR_STACKS_HOST_DIR) (runtime env, also read directly by the app process — NOT via Compose interpolation) against getStacksDir(), and throws if they differ. It is called from server/src/index.ts before the HTTP server starts listening.
  implication: The app's DOCKTOR_STACKS_HOST_DIR view comes straight from process.env (populated correctly by `env_file: .env.local` at container-runtime), but its DOCKTOR_STACKS_DIR view comes from whatever the `environment:` block computed at Compose-parse time — which depends on interpolation, not env_file. This is the structural split that produces the mismatch.

- timestamp: 2026-09-03T07:33:00Z
  checked: |
    Live reproduction with `docker compose config` (Docker Compose v5.5.0) against a copy of the actual docker-compose.yml, with a `.env.local` containing `DOCKTOR_STACKS_HOST_DIR=/custom/path/from/env-local` — the exact documented quickstart (no --env-file flag).
  found: |
    Rendered config (no --env-file):
      environment: { DOCKTOR_STACKS_DIR: /opt/docktor/stacks, DOCKTOR_STACKS_HOST_DIR: /custom/path/from/env-local, ... }
      volumes: [ { source: /opt/docktor/stacks, target: /opt/docktor/stacks, type: bind }, ... ]
    Rendered config (WITH `--env-file .env.local` added):
      environment: { DOCKTOR_STACKS_DIR: /custom/path/from/env-local, DOCKTOR_STACKS_HOST_DIR: /custom/path/from/env-local, ... }
      volumes: [ { source: /custom/path/from/env-local, target: /custom/path/from/env-local, ... } ]
  implication: |
    Directly reproduces and confirms the mechanism byte-for-byte: under the documented quickstart (no --env-file), DOCKTOR_STACKS_DIR AND the volume bind-mount (both host and container side) silently resolve to the /opt/docktor/stacks default — completely ignoring the custom value the user set in .env.local — while DOCKTOR_STACKS_HOST_DIR alone shows the custom value in the rendered `environment:` block (because that one entry is populated by env_file at runtime, not by interpolation). This is not just a false-positive check: even if assertStacksDirMatchesHost() were removed, the actual bind mount would still silently mount the wrong (default) host directory, so the user's custom DOCKTOR_STACKS_HOST_DIR would never actually take effect under the documented workflow — the crash is the app correctly catching a real, would-be-silent misconfiguration.

- timestamp: 2026-09-03T07:34:00Z
  checked: .planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-03-SUMMARY.md and 05.1-REVIEW-FIX.md (prior phase work that introduced/touched this exact code)
  found: |
    05.1-03-SUMMARY.md: the `environment: DOCKTOR_STACKS_DIR: ${...}` block was added specifically to make `environment:` (which outranks `env_file:` in Compose's *runtime-env precedence*) prevent a stray DOCKTOR_STACKS_DIR in .env.local from desyncing the pair — verified via `docker compose config` at the time, but only for the env_file-vs-environment precedence question, not for whether `${DOCKTOR_STACKS_HOST_DIR}` interpolation itself can see .env.local at all.
    05.1-REVIEW-FIX.md (a sibling fix, WR-04, same phase): explicitly discovered and documented the identical Compose behavior for POSTGRES_PASSWORD — "docker compose's top-level ${VAR} substitution only reads a literal .env file (or the real process environment), never .env.local; only the service-level env_file: directive reads .env.local" — and worked around it there by avoiding top-level interpolation entirely (dropping the hardcoded default, sourcing POSTGRES_PASSWORD purely via env_file:).
  implication: |
    The same Compose interpolation-vs-env_file distinction was already found and fixed once in this phase (WR-04, POSTGRES_PASSWORD) but the fix there worked because POSTGRES_PASSWORD needed no top-level interpolation. The stacks-directory case cannot use the same workaround as-is because the `volumes:` bind-mount source/target genuinely requires Compose-time interpolation (env_file: cannot populate a `volumes:` entry — that's part of the container spec Compose builds before the container process runs, not part of the runtime env). This is a structural gap that the 05.1-03 fix did not close, re-surfacing the same defect class one plan later in the same phase.

## Resolution

root_cause: |
  docker-compose.yml uses top-level `${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}` Compose-variable-interpolation syntax in two places that Compose resolves at compose-file-parse time — the `environment: DOCKTOR_STACKS_DIR:` entry and both sides of the stacks `volumes:` bind mount. Docker Compose's top-level `${VAR}` interpolation only reads the real process/shell environment or a file literally named `.env` (or one passed via `--env-file`); it never reads `env_file:` service directives, and `.env.local` is not `.env`. docs/deployment.md's Quickstart instructs `cp .env.example .env.local`, editing DOCKTOR_STACKS_HOST_DIR there, then running plain `docker compose up -d` with no `--env-file` flag. Under that exact documented sequence, Compose's interpolation engine never sees the custom DOCKTOR_STACKS_HOST_DIR value and silently falls back to the `/opt/docktor/stacks` default for BOTH the `DOCKTOR_STACKS_DIR` environment entry and the stacks volume's host+container bind-mount paths. Meanwhile `env_file: .env.local` correctly injects the real custom `DOCKTOR_STACKS_HOST_DIR` into the container's runtime process environment (a separate, independent mechanism from interpolation). The result: the running app process sees a real custom `DOCKTOR_STACKS_HOST_DIR` alongside a `DOCKTOR_STACKS_DIR` that silently defaulted to `/opt/docktor/stacks` — a genuine mismatch, not a false positive. `assertStacksDirMatchesHost()` (server/src/lib/stacks-dir.ts:50) correctly detects this and fails fast at startup, exactly as it was designed to (per its own docstring: prevents Docker-outside-of-Docker relative-bind-mount data loss). The actual defect is entirely in docker-compose.yml + docs/deployment.md's documented file-naming/invocation combination, not in the assertion or the app code. This is the same Compose interpolation-vs-env_file distinction independently discovered and fixed once already in this phase for `POSTGRES_PASSWORD` (WR-04 / 05.1-REVIEW-FIX.md), but that workaround (drop the top-level interpolation, rely solely on env_file) does not transfer to the stacks-directory case because the `volumes:` bind-mount source/target *must* be resolved by Compose's own interpolation — `env_file:` cannot populate a `volumes:` entry, only the container's runtime env.
  files_changed: []
fix: |
  Not applied (goal: find_root_cause_only). Suggested fix direction, in order of preference:

  1. (Preferred, minimal blast radius) Rename the documented/loaded env file from `.env.local` to `.env` throughout: docker-compose.yml's two `env_file:` entries (`docktor` and `db` services), docs/deployment.md's Quickstart (`cp .env.example .env`) and every prose/table reference to `.env.local`, README.md's quickstart line, and `.env.example`'s header comment. Docker Compose auto-discovers a project-root file literally named `.env` for its own top-level `${VAR}` interpolation — this makes the `environment: DOCKTOR_STACKS_DIR: ${DOCKTOR_STACKS_HOST_DIR:-...}` entry and both sides of the stacks `volumes:` bind mount correctly pick up a user's custom value with zero extra flags on any `docker compose` invocation (up, down, logs, pull, ...). `env_file: .env` continues to inject the same values into the container's runtime environment exactly as `env_file: .env.local` does today — no other docker-compose.yml structural change needed. `.env` is already gitignored (confirmed: .gitignore line 25), same as `.env.local` today, so no secret-exposure regression.
  2. (Alternative, higher operator burden / more fragile) Keep the `.env.local` filename convention, but change every documented `docker compose` invocation to pass `--env-file .env.local` explicitly (docs/deployment.md Quickstart step 3, `docker compose logs -f`, and any future command). Riskier long-term: any operator (or future doc/script) that runs a bare `docker compose ...` command without the flag silently reintroduces this exact failure mode, and the two-file split (`.env.local` for runtime, implicit `.env`/shell for interpolation) remains a standing trap.
  3. (Not recommended as sole fix) Leave the file-naming/invocation as-is and instead have docker-compose.yml source the volume's host-side path without top-level interpolation. Not achievable for the `volumes:` bind-mount, which Compose resolves before the container process exists — `env_file:`/runtime env cannot reach it. This option does not actually close the gap for the volume line, only for the `environment:` block, and would leave the mount itself silently pointed at the default path.

  Whichever naming direction is chosen, note `.env.example` already ships `DOCKTOR_STACKS_DIR` and `DOCKTOR_STACKS_HOST_DIR` as two separate lines set to the same default — the docs currently tell users to change only `DOCKTOR_STACKS_HOST_DIR` (relying on the `environment:` block to derive `DOCKTOR_STACKS_DIR` via interpolation). That derivation is sound; it is only the file Compose reads it from that is wrong.
verification: |
  Root cause independently reproduced live (not just re-derived from the prior UAT-recorded investigation) via `docker compose config` (Docker Compose v5.5.0) against a copy of the actual repository docker-compose.yml:
    - Without --env-file (matching docs/deployment.md's quickstart exactly): DOCKTOR_STACKS_DIR renders as /opt/docktor/stacks (default) and the stacks volume renders with source=target=/opt/docktor/stacks (default) even though .env.local set DOCKTOR_STACKS_HOST_DIR=/custom/path/from/env-local. DOCKTOR_STACKS_HOST_DIR itself renders correctly in the environment block only because that specific line is populated by env_file at runtime, not by interpolation.
    - With --env-file .env.local added: DOCKTOR_STACKS_DIR and the volume source/target all correctly render as /custom/path/from/env-local.
  This exact contrast (present without the flag, absent with it) is the mechanism that produces the reported "Stacks directory path mismatch" error under the documented quickstart, for any non-default DOCKTOR_STACKS_HOST_DIR value — confirmed independent of the specific path string (Windows path vs. POSIX /mnt/c/... path vs. this session's /custom/path/from/env-local all trigger identically).
