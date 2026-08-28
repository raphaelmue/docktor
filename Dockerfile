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
RUN yarn workspace @docktor/shared build && yarn workspace @docktor/server build && yarn prisma generate --config=server/prisma/prisma.config.ts

FROM node:22-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      restic && \
    rm -rf /var/lib/apt/lists/*

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
# Fixed container-side mount points (see docker-compose.yml volumes) — not meant to
# vary per deployment, so they live in the image rather than compose environment.
ENV DOCKTOR_STACKS_DIR=/stacks
# Default the stacks-directory watcher to polling mode. process.platform inside this
# image is always "linux", so the Windows auto-detect in file-watcher.ts can never
# trigger here — but the /stacks bind mount's host side may be a Docker Desktop
# (Windows/Mac) virtualized filesystem that doesn't propagate inotify into the
# container either. Polling costs a small, bounded amount of CPU (1s interval over
# the stacks directory) in exchange for correct instant-detection everywhere;
# operators who've confirmed a native Linux host can override with
# DOCKTOR_FS_POLLING=false to skip it.
ENV DOCKTOR_FS_POLLING=true

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
