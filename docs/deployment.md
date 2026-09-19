# Deployment

This is the documented, copy-pasteable path to a running Docktor instance using
Docker Compose. It describes exactly what ships in this repository — the
`docker-compose.yml` and `.env.example` at the repository root — not an intended
future state.

## Prerequisites

- A Linux host (or a Linux VM) with Docker Engine and the Docker Compose plugin
  installed (`docker compose version` should print a v2.x version).
- Access to `/var/run/docker.sock` on that host — Docktor manages containers by
  driving the host's own Docker daemon from inside its own container
  (Docker-outside-of-Docker, "DooD"). This grants the Docktor container
  host-root-equivalent reach: anyone who can exec into it can control every
  container on the host, including ones Docktor doesn't manage. Understand this
  before deploying Docktor on a host you don't fully trust.
- A directory on the host where you want managed stacks to live (this guide uses
  `/opt/docktor/stacks`; any path works as long as you follow the
  [Stacks directory path](#stacks-directory-path-read-this-before-your-first-deploy)
  section below exactly).
- Nothing else. Postgres is bundled in `docker-compose.yml` — you do not need to
  install or configure a database separately.

## Quickstart

Every command below was actually run against this repository's own
`docker-compose.yml` and `.env.example` while writing this guide.

1. **Get the compose file and env template.** Either clone this repository, or
   just fetch the two files you need:

   ```bash
   git clone https://github.com/raphaelmue/docktor.git
   cd docktor
   ```

2. **Copy the env template and fill in the values that must change:**

   ```bash
   cp .env.example .env
   ```

   **This filename is load-bearing, not a convention.** Docker Compose
   auto-discovers a project-root file named exactly `.env` for its own
   top-level `${VAR}` interpolation — the mechanism that computes
   `DOCKTOR_STACKS_DIR` and both sides of the stacks volume mapping below. A
   differently-named file is still loaded into the container's environment
   via `env_file:`, but is invisible to interpolation, so the stacks mount
   would silently revert to its default path while the app sees your custom
   value — exactly the mismatch the server refuses to boot on (see
   [Stacks directory path](#stacks-directory-path-read-this-before-your-first-deploy)
   below). Do not rename this file.

   Open `.env` and change every value the template marks `CHANGE_ME`:

   - `DATABASE_URL` — replace `CHANGE_ME_DB_PASSWORD` with a real password.
   - `POSTGRES_PASSWORD` — add this line to `.env` (it isn't in the
     template) set to the *same* password you just put in `DATABASE_URL`.
     `docker-compose.yml`'s `db` service reads it from `.env` directly
     rather than shipping a hardcoded default; if you skip this, the
     `docktor-db` container refuses to start instead of silently running with
     a guessable password.
   - `BETTER_AUTH_SECRET` — generate with:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `ENCRYPTION_KEY` — generate the same way (a *different* value than the
     secret above). Must be exactly 64 hex characters or the server throws on
     first use of encrypted storage (SMTP/SFTP/S3/restic credentials).
   - `BETTER_AUTH_URL` — the URL you'll actually reach this instance at (e.g.
     `http://<server-ip>:3000`, or `https://docktor.example.com` behind a
     reverse proxy). Getting this wrong doesn't crash the server — it produces
     a confusing "invalid origin" login failure instead. See
     [Troubleshooting](#troubleshooting) #4.

   Read the [Stacks directory path](#stacks-directory-path-read-this-before-your-first-deploy)
   section below **before** touching `DOCKTOR_STACKS_DIR` /
   `DOCKTOR_STACKS_HOST_DIR` — getting this pair wrong doesn't error either, it
   silently loses data.

3. **Bring it up:**

   ```bash
   docker compose up -d
   ```

   The first run builds the image (a few minutes) and starts two containers:
   `docktor-db` (Postgres) and `docktor` (the app). The `docktor` container
   waits for `docktor-db`'s healthcheck before starting, then applies the
   database schema automatically on its own first boot (see
   [Database schema](#database-schema) below) — you do not need to run any
   separate migration command.

   Watch it come up:

   ```bash
   docker compose logs -f docktor
   ```

   A healthy first boot logs a `[schema-sync] applied: ...` line (or
   `[schema-sync] already-current: ...` on a restart with nothing pending),
   then the Fastify server starts listening. An install upgrading from the
   older schemaless `db push` mechanism additionally reports
   `baselined 0_init` inside that same line's detail before the outcome —
   see [Database schema](#database-schema) below for what that means and
   what to do if it's followed by a divergence warning.

4. **Open the setup wizard.** Visit `http://<server-ip>:3000` (or whatever
   `BETTER_AUTH_URL` you set) in a browser. A fresh instance with no users yet
   redirects you straight to `/setup` automatically — create your admin
   account there and follow the remaining wizard steps (instance settings,
   optional backup configuration, optional notification configuration, optional
   brownfield scan of existing compose stacks on the host).

That's it — no separate database setup, no manual schema step, no missing
environment variable values the server doesn't tell you about.

## Environment variables

Every variable the server reads (`server/src`), matching `.env.example` exactly.

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | Required | — | Must be exactly `production` for this deployment. Turns on serving the built React SPA (`server/src/app.ts`). Any other value looks like a backend-only install with no frontend, with no error explaining why — see Troubleshooting #2. |
| `PORT` | Optional | `3000` | Port the Fastify server listens on inside the container. |
| `HOST` | Optional | `0.0.0.0` | Interface the server binds to inside the container. |
| `CLIENT_DIST_PATH` | Optional | resolved by the image | Path to the built SPA; used only when `NODE_ENV=production`. You should not need to set this. |
| `DATABASE_URL` | Required | — | Postgres connection string. Use the compose service name `db` as the host, not `localhost`. |
| `POSTGRES_PASSWORD` | **Required** | — (no shipped default) | Not read by the server itself — consumed by `docker-compose.yml`'s `db` service via `env_file: .env`. Must match the password embedded in `DATABASE_URL`. Not in `.env.example`; add it yourself. If unset, Postgres refuses to start rather than falling back to a guessable default. |
| `DOCKTOR_DB_AUTO_MIGRATE` | Optional | `true` | Applies pending Prisma migrations automatically at container startup, and auto-baselines an upgrading install's pre-migration schema into migration history. See [Database schema](#database-schema). |
| `DOCKTOR_DB_AUTO_PUSH` | Optional | `true` | Deprecated alias for `DOCKTOR_DB_AUTO_MIGRATE` above, honoured only when the new variable is unset. Kept so an existing install's opt-out survives the upgrade — set `DOCKTOR_DB_AUTO_MIGRATE` for new deployments. |
| `BETTER_AUTH_SECRET` | **Required** | — | Session-signing secret. The server crashes at boot with an unhelpful `BetterAuthError` if this is missing — see Troubleshooting #1. |
| `BETTER_AUTH_URL` | **Required** for real use | dev-only fallback (`http://localhost:5173`) | The externally-reachable URL of this instance. Feeds both `baseURL` and `trustedOrigins`. Wrong value → "invalid origin" login failure, not a crash — see Troubleshooting #4. |
| `ENCRYPTION_KEY` | **Required** | — | Encrypts SMTP passwords, SFTP keys, S3 secrets, and the restic repository password at rest. Must be exactly 64 hex characters (32 bytes) or every encrypt/decrypt call throws. |
| `DOCKTOR_STACKS_DIR` | Required (has a working default) | `/opt/docktor/stacks` (image default) | Container-side path where managed stacks live. See [Stacks directory path](#stacks-directory-path-read-this-before-your-first-deploy) — **must exactly match `DOCKTOR_STACKS_HOST_DIR`.** |
| `DOCKTOR_STACKS_HOST_DIR` | Required (has a working default) | `/opt/docktor/stacks` (compose default) | Host-side path of the same directory. Drives both sides of the `docker-compose.yml` stacks volume. |
| `DOCKTOR_STACKS_MOUNT_CHECK` | Optional | enabled | The server verifies at boot that the stacks directory is backed by a real mount rather than the container's own writable layer. Setting this to `false` downgrades that refusal to a warning, for deployments deliberately running on ephemeral storage. See [Stacks directory persistence](#stacks-directory-persistence). |
| `DOCKTOR_FS_POLLING` | Optional | `true` (forced on by the image; not auto-detected) | Forces the stacks-directory file watcher into polling mode instead of native inotify. The shipped `Dockerfile` bakes this to `true` unconditionally, since the stacks volume's host side may be a Docker Desktop (Windows/Mac) virtualized filesystem that doesn't propagate inotify events into the Linux container — set to `false` only if you've confirmed a native Linux host and want inotify instead. |
| `DOCKER_DATA_PATH` | Optional | `/var/lib/docker` (wrong for this deployment — see below) | Filesystem path the disk-space checker monitors. **Set to `/host/var/lib/docker`** for this deployment — `docker-compose.yml` mounts the host's root filesystem read-only at `/host` specifically so this check can see real host disk usage; the plain default measures this container's own tiny filesystem instead. |
| `RESTIC_BINARY` | Optional | `restic` (resolved via PATH) | Path to the restic binary. The image installs a pinned, checksum-verified release at `/usr/local/bin/restic`, already on PATH. |

## Stacks directory path (read this before your first deploy)

Docktor runs Docker-outside-of-Docker: it drives the **host's** Docker daemon
over the mounted socket, not its own. When a managed stack's compose file
declares a relative bind mount (e.g. `./volumes/data:/var/opt/app`), the
`docker compose` CLI running *inside* the Docktor container resolves that
relative path against `DOCKTOR_STACKS_DIR` — its own filesystem view — and
then sends the resulting **absolute path** to the host daemon over the socket.

If `DOCKTOR_STACKS_HOST_DIR` (the real path on the host's disk) does not equal
`DOCKTOR_STACKS_DIR` (the path inside the Docktor container), the host daemon
receives an absolute path that doesn't exist on the host. It does not error —
it silently creates a new, empty directory tree at that stray path and writes
the managed stack's data there instead of into the real stack directory. The
data is not just misplaced; it is lost the next time the container is
recreated, because the stray path was never on any volume.

**This pair of variables must be byte-identical.** `docker-compose.yml` and
`.env.example` are already wired so that setting `DOCKTOR_STACKS_HOST_DIR`
alone keeps both sides in sync — you should not need to edit
`docker-compose.yml` itself, only relocate the value in your `.env`.

If you do get this wrong, you don't get a silent failure: `server/src/lib/stacks-dir.ts`'s
`assertStacksDirMatchesHost()` runs before the server starts and **refuses to
boot**, naming both paths, whenever `DOCKTOR_STACKS_HOST_DIR` is set but
doesn't match `DOCKTOR_STACKS_DIR`. It only stays silent (with a warning) when
`DOCKTOR_STACKS_HOST_DIR` is left unset entirely — which is why `.env.example`
sets it by default rather than leaving it commented out.

## Stacks directory persistence

A matching `DOCKTOR_STACKS_DIR`/`DOCKTOR_STACKS_HOST_DIR` pair (above) proves
the two paths agree — it does not prove the stacks volume actually mounted.
`server/src/lib/stacks-dir.ts`'s `ensureStacksDir()` creates the container-side
directory with `mkdir` if it's missing, and `mkdir` succeeding looks identical
whether the bind mount attached or not: Docker's short-syntax bind-mount
auto-creation is legacy and best-effort, and Docker Desktop's virtualized
backends (e.g. WSL2) can diverge from native Linux dockerd for a path with no
real host-mappable location. If the mount never attached, `mkdir` quietly
creates an ordinary directory inside the container's own writable layer.
Everything Docktor writes there — every managed stack's `docker-compose.yml`,
`.env`, and relative bind-mount data — is then silently discarded the next
time the container is recreated by an image update, a `docker compose up`, or
a host reboot, with no error at any prior boot.

To catch this, `assertStacksDirIsMounted()` runs immediately after
`ensureStacksDir()` and reads `/proc/self/mountinfo` to find the nearest mount
covering the resolved stacks path. The server **refuses to boot** only on
positive evidence of ephemeral storage:

- The covering mount's filesystem type is `overlay`, `overlayfs`, `tmpfs`, or
  `ramfs`.
- The covering mount is the container's own root (`/`) while
  `DOCKTOR_STACKS_HOST_DIR` is set **and** the process can positively confirm
  it is actually running inside a container (it checks for `/.dockerenv`,
  the file Docker creates in every container) — a deployment that sets that
  variable has declared itself the containerized Docker-outside-of-Docker
  deployment, where the stacks volume must appear as a mount of its own; this
  catches a never-attached volume even on a non-overlay container storage
  driver (btrfs/zfs/xfs) that would otherwise pass the filesystem-type check
  above. The `/.dockerenv` guard exists because "root mount +
  `DOCKTOR_STACKS_HOST_DIR` set" alone cannot be distinguished from an
  entirely ordinary bare-metal/VM deployment with a single-partition Linux
  layout and no separate mount for the stacks path — without it, that
  combination is not evidence of ephemerality and would incorrectly refuse to
  boot a working, persistent deployment.

It **warns and starts normally** whenever it cannot tell — there is no
readable `/proc/self/mountinfo` (e.g. a non-Linux dev host, or a hardened
runtime restricting `/proc` access), or no mount entry covers the resolved
path at all. Inability to verify never blocks a boot.

Set `DOCKTOR_STACKS_MOUNT_CHECK=false` to skip this check deliberately, for
example when intentionally running on ephemeral storage. The skip is never
silent — it always logs a warning naming the variable.

## Database schema

The container applies the project's formal Prisma migrations
(`server/prisma/migrations/`) on startup, before the HTTP server starts
listening, orchestrated by `server/src/lib/schema-sync.ts` and wired into
`server/src/index.ts`. This step replaced the earlier schemaless `db push`
mechanism this guide previously described.

The step keeps the same four guards the earlier mechanism already had:

- Skips entirely if `DOCKTOR_DB_AUTO_MIGRATE=false` is set (or, as a
  deprecated alias, `DOCKTOR_DB_AUTO_PUSH=false` — see
  [Environment variables](#environment-variables)).
- Retries reachability against the database for roughly a minute before
  giving up, so it tolerates Postgres still starting.
- Takes a Postgres advisory lock first, so two Docktor replicas starting at
  the same time can't both apply migrations at once.
- Never passes a data-loss-acceptance or database-reset flag — `prisma
  migrate deploy` applies only recorded, already-reviewed migrations by
  design and does not accept either flag in the first place.
- Never blocks the server from starting even if it fails — a failed schema
  sync is logged, not fatal, so you can still reach the instance to
  investigate (though most routes will then fail with a missing-table or
  missing-column error until you resolve it and restart).

**Upgrading an existing install.** If your database already has Docktor's
tables but no `_prisma_migrations` history table — because it was created by
an earlier version's schemaless `db push` step — the startup step detects
this automatically and records the baseline migration `0_init` as already
applied (`prisma migrate resolve --applied 0_init`), then proceeds to apply
any migrations added since. **No operator action is required** for this
baseline; it happens on first boot after upgrade with no confirmation
prompt.

Immediately after any such baseline, the step also probes the live schema
for residual divergence against the shipped schema (`prisma migrate diff
--exit-code`) and reports any divergence loudly in the `[schema-sync]` logs.
That divergence means your database's schema was already behind the shipped
schema at upgrade time — the automatic baseline recorded more as "applied"
than your database actually has. **There is no automatic repair for this by
design.** If you see it:

1. Read the reported diff to see exactly which tables/columns are missing.
2. Apply the missing changes deliberately (by hand, or by re-running
   `prisma migrate deploy` after fixing the underlying cause), or
3. Set `DOCKTOR_DB_AUTO_MIGRATE=false` and manage the schema yourself from
   that point on.

A fresh, empty database records no baseline at all — the migration is simply
applied cold, the same as any new install.

> **Live-verification note.** The automatic upgrade baseline above is fully
> unit-tested (fresh database, previously-`db push`-synced database,
> already-migrated database, and the post-baseline drift probe), but it has
> **not yet been exercised against a real, previously-`db push`-synced live
> database** in this project's own environment — the session that
> implemented it could not reach the dev database from its sandboxed
> execution host (TCP connected, but the Postgres wire-protocol handshake
> never completed). A developer on an unrestricted host should run the
> command sequence recorded in `09-03-SUMMARY.md` (baseline the dev
> database, apply, re-apply to confirm the no-op is stable, then diff)
> before treating this upgrade path as live-proven. Tracked as
> `.planning/WINDOWS.md` entry #10.

**Authoring a schema change.** Now that migrations are the source of truth,
edit the relevant file under `server/prisma/schema/`, then run:

```bash
yarn db:migrate
```

This runs Prisma's dev migration command (`prisma migrate dev`) against your
local database, generates a new migration file under
`server/prisma/migrations/`, and regenerates the Prisma client. The earlier
schemaless `db:push` convenience script was removed, so every schema change
now produces a reviewable migration file — commit it alongside your schema
change.

**To disable this step** (e.g. once you manage migrations entirely outside
the container), set `DOCKTOR_DB_AUTO_MIGRATE=false` in your `.env`.
`DOCKTOR_DB_AUTO_PUSH=false` is still honoured as a deprecated alias if you
set it on an earlier version and haven't updated it yet.

## Backups

The restic repository location is a setting you configure **in the app itself**
(Settings → Backups), stored encrypted in the database — not a volume mount.
There is deliberately no `/backups` volume in `docker-compose.yml`: earlier
versions of this compose file mounted `/data` and `/backups` directories that
nothing in the server actually read, which looked like persistence that wasn't
really there. If you point a local-type restic repository at a host path from
within the app, that path must itself be reachable from inside the Docktor
container — bind-mount it yourself in `docker-compose.yml` if you go this
route, the same way the stacks directory is mounted.

## Troubleshooting

Each row below is a real defect someone hit while deploying an earlier version
of this project — fixed as noted, or still requiring the workaround described.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | Container crashes immediately at boot with a `BetterAuthError` and no clear explanation | `BETTER_AUTH_SECRET` was missing from the environment | Set `BETTER_AUTH_SECRET` in `.env` — see the [Environment variables](#environment-variables) table for the generation command. Fixed in `.env.example`/`.env.production` (now REQUIRED and documented) as of this guide; if you still hit this, check your `.env` actually has the line uncommented. |
| 2 | The app looks like a backend-only install — API responds, but visiting the root URL shows nothing resembling a frontend | `NODE_ENV` was not exactly `production` (e.g. unset, or `development`) | Set `NODE_ENV=production` in `.env`. `server/src/app.ts` only registers the SPA static-file handler when `NODE_ENV === "production"`. |
| 3 | Fresh `docker compose up` against an empty database crashes with `The table 'public.Backup' does not exist` (or `Setting`, or any other table) | Nothing applied the Prisma migrations before the app tried to query it | Fixed by the startup schema-sync step — see [Database schema](#database-schema). Make sure `DOCKTOR_DB_AUTO_MIGRATE` isn't set to `false` (nor the deprecated `DOCKTOR_DB_AUTO_PUSH` alias) unless you're applying migrations yourself. |
| 4 | Login fails with an "invalid origin" error, even though the app itself loads fine | `BETTER_AUTH_URL` was unset or pointed at the wrong URL — it feeds both `baseURL` and `trustedOrigins` in `server/src/lib/auth.ts`, and an unset value falls back to a dev-only `http://localhost:5173` origin that doesn't match a real deployment | Set `BETTER_AUTH_URL` to the exact URL you access this instance at (protocol + host + port), in `.env`. |
| 5 | A stack you created never shows up in the host directory you expected, or the data disappears after recreating the Docktor container | `DOCKTOR_STACKS_DIR` (container-side) and `DOCKTOR_STACKS_HOST_DIR` (host-side) didn't match | Read [Stacks directory path](#stacks-directory-path-read-this-before-your-first-deploy) above. As of this guide, `.env.example` sets both to the same default value, and the server refuses to boot on a mismatch (rather than silently misplacing data) whenever `DOCKTOR_STACKS_HOST_DIR` is set. |
| 6 | A managed stack's relative bind-mount volume (e.g. `./volumes/data:/var/opt/app`) writes its data somewhere unexpected on the host, even though `DOCKTOR_STACKS_DIR`/`DOCKTOR_STACKS_HOST_DIR` match | Docker-outside-of-Docker: `docker compose` inside the Docktor container resolves the relative path, then hands the resulting *absolute* path to the *host* daemon. If the stacks directory pair (see row 5) doesn't match, the resolved absolute path doesn't exist on the host | Same fix as row 5 — this is the exact mechanism the stacks-directory-path pairing exists to prevent. |
| 7 | The `/data` and `/backups` volumes referenced in an older version of `docker-compose.yml` don't seem to do anything | Nothing in `server/src` ever read `DOCKTOR_DATA_DIR` or `DOCKTOR_BACKUP_DIR` — those mounts were decorative | Both mounts (and the two dead env vars) were removed from `docker-compose.yml`/`.env.example` as of this guide. Backups are configured entirely in-app; see [Backups](#backups) above. |
| 8 | An operator upgrading an existing (pre-05.1) Docktor installation sees the server refuse to boot after upgrading, naming a stacks-directory path mismatch | The canonical stacks path changed to `/opt/docktor/stacks` and there is deliberately no automatic migration of existing data to the new path | Relocate your existing stacks directory to the new canonical path (or set `DOCKTOR_STACKS_HOST_DIR`/`DOCKTOR_STACKS_DIR` to your existing host path instead of changing the data) before restarting. This is intentional — automatically moving a self-hoster's data during an upgrade is riskier than failing loudly and letting them do it deliberately. |
| 9 | After upgrading, `docker compose up -d` fails because the env file named in `docker-compose.yml` (`.env`) is not found, or a previously-working custom stacks directory starts failing the path-mismatch check even though nothing about your setup changed | The deployment env file was renamed from `.env.local` to `.env` so Docker Compose's own top-level `${VAR}` interpolation can read it (see the callout in [Quickstart](#quickstart) step 2) | Rename your existing file in place: `mv .env.local .env`. The contents are unchanged — no values need editing, and no secrets need regenerating. |
| 10 | The server refuses to boot with an error saying the stacks directory is not on a persistent filesystem | The stacks volume never attached, so the directory `ensureStacksDir()` created lives in the container's writable layer instead of on a real mount | Check that `docker-compose.yml`'s stacks volume is present and that `DOCKTOR_STACKS_HOST_DIR` equals `DOCKTOR_STACKS_DIR`. Confirm with `docker exec <container> cat /proc/self/mountinfo`. Only use `DOCKTOR_STACKS_MOUNT_CHECK=false` when running on ephemeral storage is intentional. |
