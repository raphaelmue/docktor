FROM node:22-slim AS client-build
WORKDIR /app
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn .yarn
COPY client/package.json client/
COPY shared/package.json shared/
COPY server/package.json server/
RUN yarn install --immutable
COPY shared/ shared/
COPY client/ client/
RUN yarn workspace @docktor/shared build && yarn workspace @docktor/client build

FROM node:22-slim AS server-build
WORKDIR /app
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn .yarn
COPY server/package.json server/
COPY shared/package.json shared/
COPY client/package.json client/
RUN yarn install --immutable
COPY shared/ shared/
COPY server/ server/
# prisma generate MUST run before the server's tsc build: server/src/generated/prisma
# is gitignored, so on a fresh build it does not exist yet, and tsc's type-check of
# any Prisma-derived import is only meaningful once the real generated types are
# present. Running generate after tsc "works" only by accident of Docker layer
# caching reusing a stale generated client from a previous build of an older schema.
RUN yarn prisma generate --config=server/prisma/prisma.config.ts && yarn workspace @docktor/shared build && yarn workspace @docktor/server build

# Downloads, checksum-verifies, and decompresses a pinned restic release. Kept as its
# own stage (rather than a RUN in the final image) purely so bzip2 — needed only to
# decompress the .bz2 release asset, and not present in node:22-slim by default — never
# ships in the final image; only the resulting /usr/local/bin/restic binary is copied
# out. Bump RESTIC_VERSION here to upgrade; nothing does this automatically, so it
# needs periodic manual review. Never use "latest" — pinning keeps builds reproducible.
FROM node:22-slim AS restic-install
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl bzip2 && \
    rm -rf /var/lib/apt/lists/*
# Single RUN: if checksum verification fails, the whole layer fails and there is no
# intermediate state where an unverified restic binary could be picked up by a later
# step — important because this binary will run with access to the host Docker socket.
RUN set -eu; \
    RESTIC_VERSION=0.19.1; \
    cd /tmp; \
    curl -fsSLO "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
    curl -fsSLO "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/SHA256SUMS"; \
    grep " restic_${RESTIC_VERSION}_linux_amd64.bz2\$" SHA256SUMS | sha256sum -c -; \
    bzip2 -d "restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
    mv "restic_${RESTIC_VERSION}_linux_amd64" /usr/local/bin/restic; \
    chmod +x /usr/local/bin/restic; \
    rm -f SHA256SUMS

FROM node:22-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=restic-install /usr/local/bin/restic /usr/local/bin/restic

# Install docker CLI and compose plugin
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | \
    tar xz --strip-components=1 -C /usr/local/bin docker/docker && \
    mkdir -p /usr/local/lib/docker/cli-plugins && \
    curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
      https://github.com/docker/compose/releases/download/v2.33.1/docker-compose-linux-x86_64 && \
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist/server
COPY --from=server-build /app/shared/package.json ./shared/package.json
COPY --from=server-build /app/shared/dist ./shared/dist
COPY --from=server-build /app/server/prisma ./server/prisma
COPY --from=client-build /app/client/dist ./client-dist

ENV NODE_ENV=production
ENV CLIENT_DIST_PATH=./client-dist
# Docktor runs Docker-outside-of-Docker: this value must equal the HOST-side
# path of the stacks directory volume mount (docker-compose.yml), because
# `docker compose` running inside this container resolves relative bind
# mounts in managed stacks against its own filesystem view, then hands the
# resulting absolute path to the host's Docker daemon over the socket. A
# mismatch here silently misplaces every relative-volume stack's data (see
# .planning/todos/pending/2026-08-28-dood-bind-mount-path-mismatch.md). This
# default is therefore expected to be overridden per deployment — compose
# drives it from DOCKTOR_STACKS_HOST_DIR so the two sides cannot drift apart.
ENV DOCKTOR_STACKS_DIR=/opt/docktor/stacks
# Default the stacks-directory watcher to polling mode. process.platform inside this
# image is always "linux", so the Windows auto-detect in file-watcher.ts can never
# trigger here — but the /stacks bind mount's host side may be a Docker Desktop
# (Windows/Mac) virtualized filesystem that doesn't propagate inotify into the
# container either. Polling costs a small, bounded amount of CPU (1s interval over
# the stacks directory) in exchange for correct instant-detection everywhere;
# operators who've confirmed a native Linux host can override with
# DOCKTOR_FS_POLLING=false to skip it.
ENV DOCKTOR_FS_POLLING=true
# Runs a guarded `prisma db push` on startup so a fresh `docker compose up`
# against an empty database doesn't crash on a missing table (todo B2). This
# is deliberately the interim schemaless sync step, not `prisma migrate` —
# see .planning/todos/pending/2026-09-01-adopt-prisma-migrate-post-mvp.md.
# Set to "false" to disable this step entirely.
ENV DOCKTOR_DB_AUTO_PUSH=true

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
