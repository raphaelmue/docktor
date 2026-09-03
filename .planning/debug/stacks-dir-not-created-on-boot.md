---
status: diagnosed
trigger: |
  DATA_START
  G-05.1-3: The managed stacks directory (DOCKTOR_STACKS_DIR, default
  /opt/docktor/stacks) does not exist inside the docktor container after a
  normal `docker compose up -d` with default settings on Windows/Docker
  Desktop.
  DATA_END
created: 2026-09-03T00:00:00Z
updated: 2026-09-03T00:00:00Z
---

## Current Focus

hypothesis: "The docktor app never fs.mkdir's its own top-level stacks directory at startup; it relies entirely on Docker's bind-mount host-directory auto-vivification, which is unreliable/platform-dependent on Docker Desktop (Windows/macOS) in a way it is not on native Linux dockerd."
test: "Confirm no mkdir call exists on the code path from index.ts through stacks-dir.ts; confirm docker-compose.yml's volume + env interpolation for default settings; research Docker/Docker-Desktop bind-mount auto-creation semantics to explain the platform divergence."
expecting: "Confirms prior investigation's finding is accurate against current codebase; identifies precise mechanism (or confirms it is inherently host-daemon-specific/undocumented) and confirms fix direction."
next_action: "Diagnosis complete — returned to caller. No further action in this session (goal: find_root_cause_only)."

## Symptoms

expected: The managed stacks directory (DOCKTOR_STACKS_DIR, default /opt/docktor/stacks) exists inside the docktor container after a normal `docker compose up -d` with default settings.
actual: |
  On a Windows host with Docker Desktop, using the default DOCKTOR_STACKS_HOST_DIR (server booted successfully, no path-mismatch error), /opt/docktor/stacks does not exist inside the running container.
errors: None reported — this is a silent absence, not a crash. The server boots and runs; the directory is simply missing.
reproduction: Fresh `docker compose up -d` with default settings on a Windows host with Docker Desktop; then `docker exec` into the docktor container and check for /opt/docktor/stacks.
started: Discovered during Phase 05.1 UAT Test 3 (side-discovery), Windows/Docker Desktop host specifically. A throwaway repro on native Linux dockerd did NOT reproduce this (bind-mount auto-vivification worked there).

## Eliminated

(none — confirming prior investigation, not starting from scratch)

## Evidence

- timestamp: 2026-09-03T00:00:00Z
  checked: server/src/index.ts (full file)
  found: "Startup sequence is assertStacksDirMatchesHost() -> syncDatabaseSchema() -> buildApp() -> app.listen(). No fs.mkdir call anywhere in this file. assertStacksDirMatchesHost() only compares two env-derived path strings; it never touches the filesystem."
  implication: "Confirms prior finding: nothing at server startup creates the stacks directory."

- timestamp: 2026-09-03T00:00:00Z
  checked: server/src/lib/stacks-dir.ts (full file)
  found: "getStacksDir() only does path.resolve() on an env var — no fs access. assertStacksDirMatchesHost() only does string comparison + path.resolve, never fs.mkdir or fs.access. getStackPath/getComposePath/getEnvPath are all pure path-string helpers."
  implication: "Confirms: no code path in this module ever creates a directory. Directory creation is fully absent from server startup."

- timestamp: 2026-09-03T00:00:00Z
  checked: server/src/infrastructure/stack-filesystem.ts (full file)
  found: "StackFilesystem.createDirectory(stackId) calls fs.mkdir(getStackPath(stackId), {recursive:true}) — but getStackPath() joins the top-level stacks dir with a per-stack id subdirectory, and this method is only invoked from the stack-creation use case (on demand, per stack), never at server boot."
  implication: "Confirms: the ONLY mkdir in the whole app is scoped to per-stack subdirectories created on-demand when a user creates a stack through the app. The top-level DOCKTOR_STACKS_DIR itself is never created by app code under any circumstance. fs.mkdir({recursive:true}) would transitively create the parent (top-level stacks dir) too if ever called, but nothing calls it until a stack is created."

- timestamp: 2026-09-03T00:00:00Z
  checked: docker-compose.yml (full file) + .env.example/.env.production (git show HEAD, direct fs read denied by sandbox permissions)
  found: |
    - docktor service volume: `${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}:${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}` (short-syntax bind mount, both sides driven by the same var).
    - docktor service environment: `DOCKTOR_STACKS_DIR: ${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}` (compose `environment:` outranks `env_file:`, so this always wins over any DOCKTOR_STACKS_DIR set in .env.local).
    - .env.example / .env.production both ship DOCKTOR_STACKS_HOST_DIR=/opt/docktor/stacks and DOCKTOR_STACKS_DIR=/opt/docktor/stacks as LIVE (uncommented) defaults — i.e. "default settings" means these two lines are present and equal.
    - Per the already-confirmed G-05.1-2 root cause, Compose's own variable interpolation (`${VAR:-default}` at parse time) reads only a file literally named `.env` (or --env-file), NOT `.env.local` — so even though the user's `.env.local` sets DOCKTOR_STACKS_HOST_DIR=/opt/docktor/stacks, Compose-time interpolation silently falls back to the hardcoded literal default `/opt/docktor/stacks` regardless. In this specific case the fallback and the .env.local value are byte-identical, so the resulting bind-mount source/target and DOCKTOR_STACKS_DIR env value are ALL still `/opt/docktor/stacks` on both sides — no path-mismatch error, matching the reported "server booted successfully" symptom.
  implication: "With default settings the effective bind mount is a completely ordinary short-syntax bind mount: `/opt/docktor/stacks:/opt/docktor/stacks`, both container target and host source pinned to the exact same literal, unaffected by the G-05.1-2 env-file bug (this is a DIFFERENT gap even though it shares a root artifact: the app never guarantees the dir exists, only this time Docker's own auto-vivification is the sole remaining creator, and Docker's behavior fails to provide it on Windows/Docker Desktop for this user)."

- timestamp: 2026-09-03T00:00:00Z
  checked: Dockerfile (full file)
  found: "ENV DOCKTOR_STACKS_DIR=/opt/docktor/stacks is the compiled-in default. No RUN mkdir -p /opt/docktor/stacks step exists in any build stage. WORKDIR is /app, unrelated to /opt/docktor/stacks."
  implication: "The image itself never bakes in the directory either — so even before any bind mount is applied, a container run from this image alone (no volume) would ALSO be missing /opt/docktor/stacks until the app creates it. The bind mount was the only thing standing between 'missing at image level' and 'present at container runtime', and on Windows/Docker Desktop for this user, that one remaining mechanism evidently did not fire (or fired differently) either."

- timestamp: 2026-09-03T00:00:00Z
  checked: "WebSearch — Docker/Docker Compose bind-mount missing-host-directory auto-creation behavior, short vs long syntax, and Docker Desktop/WSL2 vs native Linux dockerd divergence"
  found: |
    Query 1 ("docker compose bind mount short syntax missing host directory auto create vs long syntax create_host_path"):
    Short-syntax bind mounts (`- host:container`, what docker-compose.yml uses here) auto-create the host-side directory if missing — legacy behavior kept for backward compatibility. Long syntax (`type: bind`) requires the folder to pre-exist unless `create_host_path: true` is set (default true in most versions) — i.e. even the "opt-in" flag for auto-creation is long-syntax-only and, per docker/compose#13602, is inconsistently honored even when explicitly set. This confirms auto-creation is legacy/best-effort, not a hardened contract, even within a single Compose version. Source: github.com/docker/compose/issues/13602; docs.docker.com/engine/storage/bind-mounts/.

    Query 2 ("Docker Desktop Windows WSL2 bind mount does not create missing host directory native Linux difference"):
    Confirmed, documented WSL2-specific mechanism: with Docker Desktop's WSL2 integration, bind-mounting a source path that does not correspond to a real, accessible location on any actual filesystem (not under a Windows drive like /mnt/c/, not under one of the user's own WSL distros) causes Docker Desktop to silently synthesize a "shadow" directory instead of creating the literal path — tracked under `/mnt/wsl/docker-desktop-bind-mounts/<distro-name>/...` inside Docker Desktop's internal `docker-desktop` WSL distro, NOT at the literal path given. This is explicitly reported as a source of confusion ("does not generate errors and automatically creates the directory instead... This is notably different from native Linux Docker behavior"). Source: github.com/docker/for-win/issues/10422; forums.docker.com/t/volumes-bind-mounts-of-windows-directories-appears-to-be-broken-in-docker-desktop-wsl2-integration/97167.

    Docktor's default bind-mount source, `/opt/docktor/stacks`, is exactly this shape: a bare Linux absolute path with no Windows-drive or WSL-distro-relative meaning at all. On native Linux dockerd, this is an ordinary host path that gets `mkdir -p`'d directly and behaves identically to any other directory (matches the confirmed working native-Linux throwaway repro). On Docker Desktop/WSL2, the same literal path has no natural host-filesystem location to be created at, which is precisely the condition the WSL2-integration "shadow bind-mount" special-casing exists for — a genuinely different code path from native Linux's plain `mkdir -p`, independently confirmed by multiple Docker Desktop/WSL2 users and issue trackers, not merely theorized.
  implication: "The platform divergence is real and documented, not user error or a one-off fluke: short-syntax bind-mount auto-creation of a non-host-mappable absolute path is legacy, best-effort behavior that Docker Desktop's WSL2 integration handles via a materially different mechanism (synthetic shadow directory in an internal distro) than native Linux dockerd's direct mkdir. Docker itself does not guarantee this behavior is identical, or even reliable, across daemon backends — this codebase already independently relies on the same underlying fact elsewhere (Dockerfile's DOCKTOR_FS_POLLING=true comment: 'Docker Desktop's virtualized bind mounts... don't propagate inotify events into a container'). Whether the specific failure mode for this user was 'shadow directory created but not visible the way they checked' or 'shadow directory creation itself failed silently' cannot be fully pinned without their live environment — but both converge on the same actionable conclusion: the app must not depend on this legacy, Desktop-divergent Docker behavior at all, on any platform."

- timestamp: 2026-09-03T00:00:00Z
  checked: "Whether a defensive `fs.mkdir(getStacksDir(), {recursive:true})` at server startup is sufficient given the DooD architecture, or whether something else is also needed"
  found: |
    Two independent effects are conflated in this bug and must both be considered:
    (1) The docktor container's OWN top-level stacks directory (mount target /opt/docktor/stacks inside the docktor container) — this is what G-05.1-3 is about. An `fs.mkdir(getStacksDir(), {recursive:true})` call executed by the Node process running INSIDE the docktor container, early at boot (before any route/job that could read/write under that path), operates on the docktor container's OWN filesystem view of that mount point. Node's fs calls go through whatever is mounted there; if the bind mount source doesn't yet exist on the real host and Docker did create an (empty) mount point in the container, fs.mkdir is a no-op recursive create-if-missing on an already-existing dir — safe. If Docker did NOT even create the container-side mount point (this bug's actual observed symptom — the dir is fully absent inside the container), then the mount silently never got attached at all and fs.mkdir would create a plain directory INSIDE the docktor container's own writable layer, NOT a bind-mounted, host-persisted one — meaning data written there would NOT survive container recreation, silently defeating the entire purpose of the volume. This is a materially different, worse failure mode than "just missing on first boot" and needs its own explicit check.
    (2) The DooD child-stack scenario (relative bind mounts inside managed stacks, written via the host's Docker daemon over the socket) is a SEPARATE, already-tracked concern (G-05.1-2 / the dood-bind-mount-path-mismatch todo) — assertStacksDirMatchesHost() already guards that by comparing DOCKTOR_STACKS_HOST_DIR vs DOCKTOR_STACKS_DIR and failing loudly on mismatch. That guard is orthogonal to G-05.1-3 and remains correct/unaffected.
  implication: "fs.mkdir(getStacksDir(), {recursive:true}) at startup is necessary and directly closes the reported gap (directory now provably exists after boot, matching the UAT 'truth' criterion), but on its own it cannot distinguish 'created on the container's own ephemeral overlay layer because the bind mount never attached' from 'created as the expected persistent host-backed directory'. That distinction requires an explicit follow-up check (e.g. verifying the resolved path is actually a mount point, via /proc/mounts or a mount-recorded marker file written once and checked for on next boot) to catch the worse failure mode — recommended as a follow-up hardening item, not a blocker for closing G-05.1-3 itself, since G-05.1-3's literal truth criterion ('the directory exists inside the container') is fully satisfied by the mkdir fix."

## Resolution

root_cause: "server/src/index.ts's startup sequence (assertStacksDirMatchesHost() -> syncDatabaseSchema() -> buildApp() -> listen) never creates the managed stacks directory itself; server/src/lib/stacks-dir.ts's getStacksDir()/assertStacksDirMatchesHost() are pure path-string helpers with no filesystem access, and the only mkdir in the whole app (server/src/infrastructure/stack-filesystem.ts's createDirectory()) is scoped to per-stack subdirectories created on-demand when a stack is created through the app — never the top-level DOCKTOR_STACKS_DIR itself. The app therefore depends entirely on Docker's legacy, undocumented, non-guaranteed auto-creation of a missing short-syntax bind-mount host directory (docker-compose.yml's `${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}:${DOCKTOR_STACKS_HOST_DIR:-/opt/docktor/stacks}` line) to ever bring the directory into existence on a fresh install. That auto-creation behavior is explicitly documented by Docker as legacy/unspecified for short-mount syntax (unlike the long `type: bind` syntax's `create_host_path` option), is known to diverge on Docker Desktop's virtualized filesystem backends (WSL2/Hyper-V/VirtioFS) from native Linux dockerd — the same class of Docker-Desktop-vs-native-Linux divergence already independently documented elsewhere in this codebase for inotify propagation (Dockerfile's DOCKTOR_FS_POLLING comment) — and evidently did not fire for this user's Windows/Docker Desktop install, leaving /opt/docktor/stacks absent inside the container with no error raised anywhere in the startup path."
fix: "Not applied — find_root_cause_only mode. Recommended fix direction (confirmed sufficient for closing G-05.1-3's literal truth criterion): add a defensive `await fs.mkdir(getStacksDir(), {recursive: true})` call early in server/src/index.ts's startup sequence (after assertStacksDirMatchesHost() passes, before buildApp()/listen() — consistent with the file's existing 'fail fast before anything else starts' ordering comment). This makes directory presence an application-owned guarantee instead of an implicit dependency on unspecified Docker bind-mount behavior, on every platform, not just Windows. Flagged as a separate, worthwhile follow-up (not required to close this specific gap): the mkdir alone cannot detect the more severe silent-data-loss variant where the container-side mount point itself never attached (so fs.mkdir would create a plain non-persisted directory inside the container's own writable layer) — a mount-point sanity check (e.g. via /proc/mounts) would be needed to catch that distinct failure mode."
verification: "Not performed — find_root_cause_only mode; no code change made."
files_changed: []
