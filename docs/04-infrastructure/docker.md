# Docker

Why the Dockerfiles in this repository look the way they do. Every decision in
them has a reason, and the reasons are more transferable than the files.

## The model

An **image** is a read-only filesystem plus metadata. A **container** is a
running instance of one. Images are built in **layers**, each layer a diff, and
layers are cached and shared.

That layer model is why instruction order matters so much.

## Layer caching, and why manifests are copied first

```dockerfile
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN npm ci --workspaces --include-workspace-root

COPY packages/ packages/
COPY apps/api/ apps/api/
RUN npm run build ...
```

A layer's cache is invalidated when its inputs change, and every layer after it
is rebuilt too. `npm ci` is the slowest step in the build. If the source were
copied before it, every one-character change would reinstall every dependency.

Copying only the manifests first means the install layer is cached until a
dependency actually changes. Source changes rebuild only the compile step.

This is the single highest-leverage Dockerfile technique, and it applies to
every language — copy the dependency manifest, install, then copy the source.

## Multi-stage builds

```dockerfile
FROM node:22-bookworm-slim AS deps        # install everything
FROM deps AS build                        # compile
FROM base AS prod-deps                    # install production deps only
FROM node:22-bookworm-slim AS runtime     # copy artefacts, nothing else
```

The build needs TypeScript, drizzle-kit and the whole dev dependency tree. The
runtime needs none of it.

Only the final stage becomes the image. Everything else is discarded, which
means the compiler, the test framework and the build tooling are not in
production — smaller image, faster pulls, and a materially smaller attack
surface.

## The base image

`node:22-bookworm-slim`.

| Option | Size | Trade |
| --- | --- | --- |
| `node:22` | ~1.1 GB | Full Debian. Every tool you might want, and every CVE they carry |
| `node:22-slim` | ~250 MB | Debian without the extras. **Chosen** |
| `node:22-alpine` | ~180 MB | musl libc. Smaller, but native modules can misbehave and debugging is harder |
| `distroless` | ~150 MB | No shell at all. Excellent security, painful to debug |

`slim` is the balance: small enough, glibc so native modules behave, and a shell
when you need to get inside a container at 2am.

In production, pin the digest rather than the tag. `node:22-bookworm-slim` moves;
`node:22-bookworm-slim@sha256:...` does not, and reproducible builds matter more
than automatic patching you did not test.

## Running as a non-root user

```dockerfile
RUN mkdir -p /var/lib/erp/storage && chown -R node:node /var/lib/erp
USER node
```

A container running as root turns any remote-code-execution bug into
root-in-container, which is one misconfiguration away from being much worse. A
Node process has no reason to have it.

The `chown` before the `USER` switch matters: after switching, the build can no
longer create directories it does not own.

## The entrypoint

```dockerfile
CMD ["node", "apps/api/dist/index.js"]
```

Exec form (a JSON array), not shell form. Exec form makes node PID 1, so it
receives SIGTERM directly and the graceful shutdown runs. Shell form wraps it in
`/bin/sh -c`, and the shell does not forward signals.

And `node` directly rather than `npm start`, for the same reason: npm does not
forward SIGTERM to its child, so every deploy would drop in-flight requests.

## Health checks

```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Using `node -e` rather than curl, because curl is not in a slim image and adding
it purely for a health check is a dependency you did not need.

It checks `/health`, not `/ready`. Liveness asks "is the process alive?";
readiness asks "should it receive traffic?" — and readiness checks the database.
A liveness probe that fails on a database blip restarts otherwise-healthy
containers and turns a brief outage into a longer one.

`start-period` covers the boot time before failures count.

## `.dockerignore`

```
node_modules
**/dist
.git
.env
.env.*
!.env.example
```

Two jobs. It keeps the build context small — sending a 500 MB `node_modules` to
the daemon on every build is slow and pointless when `npm ci` will recreate it.
And it keeps secrets out of layers: a `.env` copied into an image is in the
registry, in every pull, and in every developer's cache.

## The standalone output for Next.js

```dockerfile
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
```

Next traces exactly which files the server needs and emits a self-contained
bundle. Copying that instead of the whole `node_modules` typically saves a few
hundred megabytes.

## Compose, for development

`docker-compose.yml` defines Postgres, and — under the `full` profile — the API
and web containers.

The `profiles` mechanism is why `make up` starts only the database: for ordinary
development you want Postgres in a container and the applications running
natively, so you get fast reloads. The full profile is for checking that a
change behaves the same inside an image as it does on your machine.

`depends_on` with `condition: service_healthy` is what makes this work reliably.
Without the condition, `depends_on` only waits for the container to start, not
for Postgres to accept connections — so the API starts, fails to connect, and
exits.

## Common mistakes

| Mistake | Consequence |
| --- | --- |
| Copying source before installing dependencies | Every change reinstalls everything |
| `npm start` as the entrypoint | Signals are not forwarded; every deploy drops requests |
| Running as root | An RCE becomes root-in-container |
| Secrets in `ENV` or copied `.env` files | In the registry and in every pull |
| No `.dockerignore` | Slow builds, leaked files |
| `latest` tags | Non-reproducible builds |
| One giant stage | Compiler and dev dependencies in production |
| Writing to the container filesystem | Data lost on restart |
| Health check that checks the database | A database blip restarts healthy containers |

## Useful commands

```bash
docker compose up -d db                  # just Postgres
docker compose --profile full up --build # the whole stack, from images
docker compose logs -f api
docker compose exec api sh
docker compose down -v                   # also removes volumes — destructive

docker build -f infra/docker/api.Dockerfile -t erp-api:local .
docker history erp-api:local             # what each layer costs
docker image prune -a                    # reclaim space
```

`docker history` is the one people forget. It shows the size of every layer,
which is how you find the `RUN` that accidentally added 400 MB.
