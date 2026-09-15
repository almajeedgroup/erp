# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Web image.
#
# Next.js `output: standalone` traces exactly the files the server needs, so the
# runtime stage copies a self-contained bundle rather than the whole
# node_modules tree — typically a few hundred megabytes smaller.
# ---------------------------------------------------------------------------

FROM node:26-bookworm-slim AS base
ENV CI=true
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
# The web app imports schemas and types from the shared package, so that is
# built first. `next build` also type-checks the app, which is why there is no
# separate tsc step here.
RUN npm run build -w @almajeed/shared \
 && npm run build -w @almajeed/web

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
