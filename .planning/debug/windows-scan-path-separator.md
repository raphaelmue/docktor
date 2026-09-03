---
status: diagnosed
trigger: "windows-scan-path-separator: On native Windows, the import-scan API (POST /api/stacks/import/scan) returns a directory path using forward slashes instead of the OS-native backslash-separated path, causing a test assertion mismatch and a real client-facing inconsistency for Windows users of the import/scan feature."
created: 2026-09-03T00:00:00Z
updated: 2026-09-03T00:30:00Z
---

## Current Focus

hypothesis: CONFIRMED — fast-glob's `absolute: true` option unconditionally converts backslashes to forward slashes (utils.path.unixify in fast-glob's EntryTransformer), and brownfield-scanner.ts's scan() never renormalizes the resulting path/directory fields back to OS-native separators (path.win32.dirname does not restore them; it only slices the string).
test: Traced brownfield-scanner.ts -> fast-glob's EntryTransformer._transform -> utils.path.unixify source; verified path.win32.dirname()/normalize() behavior on a forward-slash Windows path with node -e.
expecting: n/a — root cause confirmed with direct source evidence, no further testing needed for diagnose-only mode.
next_action: none — diagnosis complete, goal is find_root_cause_only.

## Symptoms

expected: `body.stacks[0].directory` equals `scanDir` — the raw OS-native path passed into/derived by the scan (e.g. `C:\Users\D070307\AppData\Local\Temp\docktor-imports-test-6oKgpG` on Windows).
actual: The API returns the same path with forward slashes instead: `C:/Users/D070307/AppData/Local/Temp/docktor-imports-test-6oKgpG`.
errors: |
  AssertionError: expected 'C:/Users/D070307/AppData/Local/Temp/d…' to be 'C:\Users\D070307\AppData\Local\Temp\d…' // Object.is equality
  Expected: "C:\Users\D070307\AppData\Local\Temp\docktor-imports-test-6oKgpG"
  Received: "C:/Users/D070307/AppData/Local/Temp/docktor-imports-test-6oKgpG"
   ❯ test/integration/imports.test.ts:108:42
      106|         expect(body.skippedDirectories).toBe(0);
      107|         expect(body.stacks).toHaveLength(1);
      108|         expect(body.stacks[0].directory).toBe(scanDir);
         |                                          ^
      109|         expect(body.stacks[0].serviceCount).toBe(1);
      110|     });
  Test: "POST /api/stacks/import/scan → returns a ScanResult-shaped body for an authenticated request" in test/integration/imports.test.ts. Test Files: 1 failed | 3 passed (4). Tests: 1 failed | 18 passed (19).
reproduction: Test 7 in .planning/phases/05.1-stabilization-fix-blockers-and-majors-surfaced-during-testin/05.1-UAT.md — run `yarn workspace @docktor/server test:integration` on a native Windows host; `server/test/integration/imports.test.ts` fails at line 108.
started: Discovered 2026-09-03 during UAT test 7, native Windows host, right after confirming G-05.1-1 (Prisma CLI ENOENT) fix. Newly-surfaced, previously-untracked defect (G-05.1-4).

## Eliminated

## Evidence

- timestamp: 2026-09-03T00:10:00Z
  checked: server/src/infrastructure/brownfield-scanner.ts (full file)
  found: |
    scan() calls `fg(this.COMPOSE_FILE_PATTERNS, {cwd: dir, absolute: true, ...})`
    (fast-glob, imported as `fg`). foundFiles (fast-glob's absolute-path output)
    is pushed directly into uniqueFiles, then for each filePath:
      stacks.push({ path: filePath, directory: path.dirname(filePath), ... })
    No renormalization of filePath's separator style happens anywhere in this
    file before it is placed on the returned DiscoveredStack.
  implication: The separator style of `path`/`directory` in the ScanResult is
    entirely determined by what fast-glob's `absolute: true` output looks like
    on the host OS, and by path.dirname()'s behavior on that string.

- timestamp: 2026-09-03T00:15:00Z
  checked: node_modules/fast-glob/out/providers/transformers/entry.js (EntryTransformer._transform)
  found: |
    ```
    _transform(entry) {
        let filepath = entry.path;
        if (this._settings.absolute) {
            filepath = utils.path.makeAbsolute(this._settings.cwd, filepath);
            filepath = utils.path.unixify(filepath);
        }
        ...
    ```
    utils.path.unixify (node_modules/fast-glob/out/utils/path.js:29-31):
      `function unixify(filepath) { return filepath.replace(/\\/g, '/'); }`
    This runs unconditionally, on every platform (no os.platform() check) —
    fast-glob's `absolute: true` output ALWAYS uses forward slashes, even on
    Windows, even for absolute paths. Confirmed as documented, intentional
    upstream behavior (fast-glob README "How to write patterns on Windows?"
    section: "Always use forward-slashes..."; glob results are POSIX-style by
    design since micromatch/glob patterns are `/`-delimited).
  implication: foundFiles in brownfield-scanner.ts (and therefore each
    filePath) is forward-slash-separated on Windows even though `dir` (the
    scan root passed in) was a native Windows backslash path. This is the
    origin point of the slash conversion — not a bug in fast-glob itself, but
    an un-renormalized consumption of it in our code.

- timestamp: 2026-09-03T00:20:00Z
  checked: "node -e path.win32.dirname() behavior on a forward-slash Windows path (path.d module ships win32 impl on any platform)"
  found: |
    path.win32.dirname('C:/Users/D070307/AppData/Local/Temp/docktor-imports-test-6oKgpG/docker-compose.yml')
      => 'C:/Users/D070307/AppData/Local/Temp/docktor-imports-test-6oKgpG'   (forward slashes preserved)
    path.win32.normalize(that same dirname result)
      => 'C:\Users\D070307\AppData\Local\Temp\docktor-imports-test-6oKgpG'  (backslashes restored)
  implication: On Windows, `path` (native node:path === path.win32) 's
    `dirname()` does NOT renormalize the separator style of its input — it
    only slices the string at the last separator occurrence, preserving
    whatever character was already there. So brownfield-scanner.ts's
    `path.dirname(filePath)` at line 104 passes the forward-slash-ness of
    fast-glob's output straight through into `directory`. Only an explicit
    `path.normalize(...)` call (or avoiding fast-glob's forced unixify) would
    restore native backslashes. This is exactly what the failing test
    observes: `body.stacks[0].directory` = 'C:/Users/.../docktor-imports-test-6oKgpG'
    instead of scanDir's native 'C:\Users\...\docktor-imports-test-6oKgpG'.

- timestamp: 2026-09-03T00:25:00Z
  checked: server/src/routes/imports.ts (POST /api/stacks/import/scan handler, full plugin file)
  found: |
    `const result = await brownfieldScanner.scan(directories); return result;`
    — the route returns the ScanResult object verbatim (Fastify JSON-serializes
    it), with zero path post-processing. No layer between BrownfieldScanner.scan()
    and the HTTP JSON body renormalizes separators.
  implication: The conversion happens exactly once, inside
    BrownfieldScanner.scan() (via fast-glob's forced unixify + un-renormalizing
    path.dirname), and is never corrected afterward. Confirms this is the sole
    origin point — not a route-layer or serialization-layer issue.

## Resolution

root_cause: |
  server/src/infrastructure/brownfield-scanner.ts's scan() method passes
  fast-glob's `absolute: true` output straight through into the returned
  DiscoveredStack.path / DiscoveredStack.directory fields without ever
  renormalizing the path separator to the OS-native style.

  fast-glob's EntryTransformer (node_modules/fast-glob/out/providers/transformers/entry.js,
  via utils.path.unixify in node_modules/fast-glob/out/utils/path.js) *always*
  converts backslashes to forward slashes for absolute-path results,
  unconditionally on every platform including Windows — this is fast-glob's
  documented, intentional design (glob patterns/results are POSIX-style
  `/`-delimited by convention). So on a native Windows host, `fg(...)` inside
  brownfield-scanner.ts's scan() (line 70-76) returns entries like
  'C:/Users/.../docker-compose.yml' even though the scanned directory `dir`
  was passed in as a native Windows backslash path.

  brownfield-scanner.ts then does `directory: path.dirname(filePath)`
  (line 104) using Node's platform-native `path` module (== path.win32 on
  Windows). Critically, `path.win32.dirname()` does NOT renormalize separator
  style — it only slices the string at the last separator character found
  (accepting both `/` and `\` as valid separators when parsing), so it
  faithfully preserves the forward-slash style already present in fast-glob's
  output. The same is true of the sibling `path: filePath` field (line 103) —
  it is fast-glob's raw unixified output, never touched again.

  No later layer (server/src/routes/imports.ts's scan handler returns the
  ScanResult verbatim; confirmed by reading the full route file) ever calls
  path.normalize() or otherwise restores native separators before the object
  is JSON-serialized in the HTTP response. Net effect: on Windows, both
  `path` and `directory` on every DiscoveredStack in a ScanResult are
  forward-slash-separated, while the directories/paths the client (or the
  integration test, via scanDir from fs.mkdtemp+path.join) uses natively are
  backslash-separated — producing the observed mismatch. This is a genuine,
  previously-untracked cross-platform defect (does not affect Linux/macOS/CI
  since POSIX paths are already forward-slash-separated, only surfaces on
  Windows), and is unrelated to the G-05.1-1 Prisma-CLI-path fix (different
  file, different mechanism — confirmed no shared code path).
fix:
verification:
files_changed: []
