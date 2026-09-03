# Docktor

Docktor is a self-hosting management platform that provides a UI-driven
experience for deploying, updating, and managing Docker Compose applications.
It targets anyone running a single VPS or local server who wants to self-host
apps (Nextcloud, Vaultwarden, Gitea, and so on) through a browser, without
needing SSH or Docker CLI access for day-to-day operation.

## Workspaces

This is a Yarn v4 monorepo with three workspaces:

| Workspace | Path | Role |
|---|---|---|
| `@docktor/shared` | `shared/` | Shared Zod validation schemas and types |
| `@docktor/server` | `server/` | Fastify 5 + Prisma + PostgreSQL backend |
| `@docktor/client` | `client/` | React 19 + Vite + TailwindCSS frontend |

The whole system runs as a single Fastify server in production — API,
background jobs, SSE streams, and the built React SPA all served from one
process, deployed as a Docker Compose stack.

## Quickstart (deploying Docktor)

```bash
cp .env.example .env   # fill in the CHANGE_ME values
docker compose up -d
```

Then open the URL you set in `BETTER_AUTH_URL` — a fresh instance redirects
you straight to the setup wizard. See **[docs/deployment.md](docs/deployment.md)**
for the full walkthrough, the complete environment-variable reference, the
stacks-directory path requirement (read this before your first deploy), and a
troubleshooting guide.

## Development

Local development runs the server and client directly on the host (not in
Docker) against a bare Postgres container:

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres only
yarn install
yarn dev                                          # server + client, hot reload
```

`yarn dev` reads its configuration from `.env.development`. See
[CLAUDE.md](CLAUDE.md) for the full architecture, coding conventions, and
testing guidelines.
