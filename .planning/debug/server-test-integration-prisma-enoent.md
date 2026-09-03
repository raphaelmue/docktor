---
status: diagnosed
trigger: "G-05.1-1: yarn workspace @docktor/server test:integration fails locally (passes in CI) with prisma db push failing inside startContainer(). Caused by: Error: spawnSync C:\\Users\\D070307\\workspace\\docktor\\node_modules\\.bin\\prisma ENOENT"
created: 2026-09-03T00:00:00Z
updated: 2026-09-03T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — see Resolution
test: complete
expecting: n/a
next_action: n/a — diagnose-only mode, returning ROOT CAUSE FOUND to caller

## Symptoms

expected: Running `yarn workspace @docktor/server test:integration` exits 0 across all 4 integration test files (setup-concurrency, setup-wizard-flow, stacks, imports).
actual: All runs fail inside `startContainer()` (server/test/integration/setup.ts) with "prisma db push failed while applying the schema to the test database". CI (GitHub Actions, ubuntu-latest) passes the same suite successfully — this only fails locally, on a native Windows host (paths like `C:\Users\D070307\workspace\docktor\...`).
errors: |
  Run 1 (test:integration overall):
  Error: startContainer(): `prisma db push` failed while applying the schema to the test database.

  Run 2 (imports.test.ts specifically, fuller trace):
  Error: startContainer(): `prisma db push` failed while applying the schema to the test database.
  ❯ startContainer test/integration/setup.ts:46:15
  ❯ test/integration/imports.test.ts:20:9
  Caused by: Error: spawnSync C:\Users\D070307\workspace\docktor\node_modules\.bin\prisma ENOENT
reproduction: Run `yarn workspace @docktor/server test:integration` (or narrower: `server/test/integration/imports.test.ts`) on a native Windows host (not WSL) with a normal `yarn install` done, using `nodeLinker: node-modules` (the repo default).
started: Not a regression — present since setup.ts's execFileSync(prismaBin, ...) code was introduced (T-05.1-02 hardened it against shell-injection, but the extensionless bin-path assumption predates that and was never platform-branched).

## Eliminated

(none — root cause found directly from evidence chain, no false starts)

## Evidence

- timestamp: 2026-09-03T00:00:00Z
  checked: server/test/integration/setup.ts lines 1-51
  found: |
    Line 14: `const prismaBin = path.resolve(__dirname, "../../../node_modules/.bin/prisma");`
    Line 38: `execFileSync(prismaBin, ["db", "push", `--config=${prismaConfigPath}`], {env: {...}, stdio: "pipe"});`
    No `shell: true`, no platform branching (`process.platform`), no `.cmd`/`.exe` extension handling.
    Comment on line 12-13 explains WHY execFileSync argv-array form was chosen: "Prisma is a root devDependency — resolve it by path so it works without being on $PATH (e.g. in CI or when running vitest directly)". Comment on lines 35-36 explains a SEPARATE prior fix (T-05.1-02): "Uses the argv-array form (not a shell-interpolated string) so a path containing shell metacharacters can never be interpreted" — i.e. `shell: true` was deliberately avoided for security reasons on a previous pass.
  implication: The hardcoded path is asserted to be POSIX-shaped (extensionless `prisma`) with no Windows accommodation, and the code explicitly avoids `shell: true` — a constraint any fix must respect.

- timestamp: 2026-09-03T00:00:00Z
  checked: .yarnrc.yml
  found: "nodeLinker: node-modules"
  implication: Bin shims are generated under `node_modules/.bin/` following the classic npm/yarn "node-modules linker" convention (not PnP, not pnpm-style). This convention is platform-divergent: POSIX gets a symlink; Windows gets `.cmd`/`.ps1` shim files (see next findings).

- timestamp: 2026-09-03T00:00:00Z
  checked: "ls -la node_modules/.bin/prisma (local Linux dev machine, same nodeLinker config as the failing Windows host)"
  found: "prisma -> ../prisma/build/index.js (a symlink, no file extension)"
  implication: On POSIX, `.bin/prisma` is a symlink pointing directly at the package's JS entrypoint.

- timestamp: 2026-09-03T00:00:00Z
  checked: node_modules/prisma/package.json "bin" field, and the shebang of node_modules/prisma/build/index.js
  found: |
    package.json: `"bin": { "prisma": "build/index.js" }`
    build/index.js starts with `#!/usr/bin/env node` and has the executable bit set (file(1) reports "Node.js script executable").
  implication: The POSIX symlink at `.bin/prisma` works with `execFileSync` because the OS kernel's exec() interprets the shebang line transparently when a symlink/file with +x permission is executed directly — no shell needed. This is exactly why the direct-path + argv-array approach works on Linux/macOS with zero platform code.

- timestamp: 2026-09-03T00:00:00Z
  checked: .github/workflows/ci.yml lines 11 and 52
  found: "runs-on: ubuntu-latest ... run: yarn test:integration"
  implication: CI is Linux-only. This is exactly why CI passes unconditionally — CI never exercises the Windows code path, so the platform-specific bug in setup.ts has zero coverage.

- timestamp: 2026-09-03T00:00:00Z
  checked: Web search — yarn Berry node-modules linker Windows .bin shim behavior (github.com/yarnpkg/berry issues #5886, #988, #2416; "How bin linking works in node.js npm and yarn and monorepos")
  found: |
    Yarn's node-modules linker (npm-compatible bin-linking convention) on Windows does not create a bare extensionless executable at `.bin/<name>` — Windows cannot execute a POSIX shebang script directly via native process creation, and Windows generally can't create true symlinks without elevated privileges/Developer Mode. Instead the linker writes `.bin/<name>.cmd` (a cmd.exe batch shim wrapping `node <resolved-js-path> %*`) and `.bin/<name>.ps1`, plus (for git-bash compatibility) a bare `.bin/<name>` POSIX shell script — which is NOT natively executable by Windows' CreateProcess without a shell interpreter.
  implication: On the Windows host, the literal path `...\node_modules\.bin\prisma` (no extension) either does not exist as a Windows-executable file, or exists only as a POSIX shell-script variant that CreateProcess cannot launch directly. Node's `child_process.execFileSync`/`spawnSync`, when called with `shell` unset (falsy) and a full path that has no `.cmd`/`.bat` extension, invokes Windows `CreateProcess` directly with no PATHEXT probing and no cmd.exe wrapping — this is exactly the documented Node.js Windows caveat for `.bin` scripts invoked by literal/resolved path rather than through a shell or `npm`/`yarn` run wrapper.
  citations:
    - https://github.com/yarnpkg/berry/issues/5886
    - https://github.com/yarnpkg/berry/issues/988
    - https://github.com/yarnpkg/berry/issues/2416
    - https://www.jonathancreamer.com/how-bin-linking-works-in-node-js-npm-and-yarn-and-monorepos/

- timestamp: 2026-09-03T00:00:00Z
  checked: "Cross-referenced observed error text against the mechanism above"
  found: "Caused by: Error: spawnSync C:\\Users\\D070307\\workspace\\docktor\\node_modules\\.bin\\prisma ENOENT — exact literal path with no extension, exact error code (ENOENT, not EINVAL/EACCES) matching 'no such executable file found at this literal path'."
  implication: Matches the predicted failure mode precisely — not a permissions error, not a corrupted install, not a missing `yarn install` step. It is a literal file-not-found for the exact extensionless path the code constructs, which is structurally absent/non-executable on Windows.

## Resolution

root_cause: |
  `server/test/integration/setup.ts` line 14 hardcodes the Prisma CLI binary path as
  `path.resolve(__dirname, "../../../node_modules/.bin/prisma")` — an extensionless POSIX-shaped
  path — and invokes it directly via `execFileSync(prismaBin, [...], {stdio: "pipe"})` (line 38)
  with no `shell` option and no platform branching. This works on POSIX (Linux/macOS, including CI's
  ubuntu-latest runner) because Yarn's `node-modules` linker (per `.yarnrc.yml`: `nodeLinker: node-modules`)
  creates `.bin/prisma` there as a symlink to `prisma/build/index.js`, a script starting with
  `#!/usr/bin/env node` that the OS kernel can exec() directly via shebang interpretation — no shell
  required. On native Windows, the same linker convention instead produces `.cmd`/`.ps1` shim files
  (e.g. `.bin/prisma.cmd`) rather than a directly Windows-executable file at the bare extensionless
  `.bin/prisma` path; Windows' native process creation (which Node's `execFileSync`/`spawnSync` invoke
  directly when `shell` is not set) cannot resolve or launch that literal extensionless path, producing
  `ENOENT` — exactly matching the observed error. This is a genuine cross-platform code defect (an
  unstated POSIX assumption baked into the hardcoded bin path), not a local/environment misconfiguration
  on the reporting user's machine: it will reproduce on ANY native-Windows contributor machine after a
  normal `yarn install`, and CI never catches it because CI only runs on `ubuntu-latest`.
fix: |
  Not applied (goal: find_root_cause_only). Suggested direction for the fix-implementation pass:
  resolve the Prisma CLI's JS entrypoint via Node module resolution instead of a hardcoded OS-shaped
  `.bin` path, and invoke it with `process.execPath` (the node binary itself, always a real executable
  on every platform) so no shell and no `.bin` shim of any kind is ever needed — e.g.
  `execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", ...])`.
  This preserves the existing argv-array (non-shell-interpolated) form that T-05.1-02 deliberately
  chose to avoid shell-metacharacter injection, while removing the Windows-vs-POSIX `.bin` shim
  divergence entirely. (A platform-branch on `process.platform === "win32"` appending `.cmd` and using
  `shell: true` would also fix it but is a weaker option: `.cmd`/`.bat` invocation on Windows requires
  `shell: true` per Node's own child_process Windows caveats, which reopens the shell-metacharacter
  risk T-05.1-02 was written to close — the `process.execPath` + `require.resolve` approach avoids that
  trade-off entirely.)
verification: n/a — diagnose-only mode; root cause confirmed via direct evidence (yarn linker docs/issues,
  local `.bin/prisma` symlink inspection, prisma package.json bin field + shebang inspection, CI runner OS,
  and exact error-message match) without needing to reproduce on a live Windows host.
files_changed: []
