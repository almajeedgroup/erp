# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# API image.
#
# Multi-stage, because the build needs TypeScript, drizzle-kit and the whole dev
# dependency tree, and the runtime needs none of it. The final image carries
# production dependencies and compiled JavaScript only.
#
# It runs as a non-root user. A container running as root turns any RCE into
# root-in-container, and there is no reason for a Node process to have it.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV CI=true
WORKDIR /app

# --- dependencies ----------------------------------------------------------
FROM base AS deps
# Manifests first, so a source-only change does not invalidate the dependency
# layer — the slowest step in the build.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root

# --- build -----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN npm run build -w @almajeed/shared \
 && npm run build -w @almajeed/db \
 && npm run build -w @almajeed/api

# --- production dependencies ------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspaces --include-workspace-root \
 && npm cache clean --force

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

# `node` (uid 1000) ships with the base image.
RUN mkdir -p /var/lib/erp/storage && chown -R node:node /var/lib/erp

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/
COPY --from=build --chown=node:node /app/packages/db/dist packages/db/dist
# The migrations travel with the image, so the version that runs them is always
# the version that was tested against them.
COPY --from=build --chown=node:node /app/packages/db/drizzle packages/db/drizzle
COPY --from=build --chown=node:node /app/packages/db/package.json packages/db/
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/

USER node
EXPOSE 4000

# Liveness only. The readiness probe (/ready) checks the database and belongs to
# the orchestrator; a liveness probe that fails on a database blip restarts
# otherwise-healthy containers and turns a brief outage into a longer one.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No `npm start`: exec'ing node directly makes this process PID 1, so it
# receives SIGTERM and can drain connections. Under an npm wrapper the signal
# goes to the wrapper and in-flight requests are dropped on every deploy.
CMD ["node", "apps/api/dist/index.js"]
