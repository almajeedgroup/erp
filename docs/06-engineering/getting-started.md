# Getting started

Clone to a working system. Two paths: one that needs nothing but Node, and one
that runs against a real Postgres.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 22 | Native `fetch`, stable ESM, `--enable-source-maps`. Enforced by `engines` in `package.json` |
| npm | ≥ 10 | Workspaces with `--workspaces --include-workspace-root` |
| Docker | any recent | Only for the real-Postgres path and for building images |

Nothing else. No global CLI to install, no language runtime besides Node — the
Python in `docs/05-ai/` is conceptual background, not a dependency.

## The one-command path

```bash
git clone https://github.com/almajeedgroup/erp.git
cd erp
npm install
npm run demo
```

`npm run demo` starts the API with `DATABASE_URL=memory://demo`, which boots
[PGlite](https://pglite.dev) — real PostgreSQL compiled to WebAssembly, running
inside the Node process — applies the committed migrations, seeds a full
organization, and starts the web app against it.

Open <http://localhost:3000> and sign in:

| Email | Role |
| --- | --- |
| `owner@almajeed.test` | owner |
| `finance@almajeed.test` | finance |
| `manager@almajeed.test` | manager |
| `engineer@almajeed.test` | member |
| `auditor@almajeed.test` | viewer |

All five share the password `correct horse battery staple`, which the API also
prints on startup (`DEMO_PASSWORD` in `apps/api/src/seed/demo-data.ts`).

Sign in as each in turn — the navigation, the columns and the API responses
differ, because permissions are enforced at the route and rendered from the
same grant matrix. That is the fastest way to understand the authorization
model, and it is why the demo ships five users rather than one.

The database is in memory. Everything is gone when you stop the process, which
is the point: the demo is disposable and can never be mistaken for real data.
See `apps/api/src/index.ts` for the guard — the PGlite import is dynamic, so a
production bundle never loads it.

## The real-Postgres path

```bash
cp .env.example .env     # then edit the two secrets it refuses to boot without
make up                  # docker compose up -d db, then wait for pg_isready
make migrate             # apply packages/db/drizzle/*.sql
make seed                # same demo data, this time persisted
make dev                 # API on :4000, web on :3000, both watching
```

`make help` lists every target.

Use this path whenever you touch the schema, a query plan, or anything
concurrency-shaped (`SELECT ... FOR UPDATE`, isolation levels, index usage).
PGlite is genuinely Postgres, but it is a single-connection WASM build — it will
not show you lock contention.

### Generating a secret

The config layer refuses to start in production if `JWT_SECRET` or
`PASSWORD_PEPPER` still hold their `.env.example` placeholder, and refuses any
value under 32 characters everywhere:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Rotating `PASSWORD_PEPPER` invalidates every stored password hash. It is not a
routine rotation — see [secrets management](../03-security/secrets-management.md).

## The shape of the repository

```
packages/shared   Domain types, money, RBAC, Zod schemas. No I/O, no framework.
packages/db       Drizzle schema, migrations, the tenancy helper, the test database.
apps/api          Fastify server. Modules own routes + services.
apps/web          Next.js App Router. Server components; a BFF for cookies.
docs              This.
infra             Dockerfiles.
```

Dependencies point one way: `web → api (HTTP)`, `api → db → shared`. `shared`
imports nothing from the workspace, which is what lets both the API and the web
app use the same money arithmetic and the same permission matrix without either
depending on the other. [ADR-0001](../02-architecture/adr/0001-typescript-monorepo.md)
has the reasoning.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Build packages, then API and web in watch mode |
| `npm run demo` | The same, against the in-memory database with seed data |
| `npm test` | The whole suite, against PGlite |
| `npm run test:watch` | Re-run on change |
| `npm run typecheck` | `tsc -b` (also emits packages) then the test-inclusive project |
| `npm run lint` | ESLint 10 flat config |
| `npm run format` | Prettier, writing |
| `npm run verify` | format:check → lint → typecheck → test. **What CI runs** |
| `npm run db:generate` | Diff the Drizzle schema, write a migration |
| `npm run db:migrate` | Apply migrations |

Run `npm run verify` before you push. It is the same four commands, in the same
order, that `.github/workflows/ci.yml` runs — if it passes locally it passes
there, and a green pipeline stays meaningful.

## First change, end to end

Suppose clients need a `website` field.

1. **Schema** — add the column in `packages/db/src/schema/crm.ts`.
2. **Migration** — `npm run db:generate`, then read the generated SQL. Do not
   skip reading it: `drizzle-kit` will happily generate a `DROP COLUMN`.
3. **Domain** — extend the Zod schemas in `packages/shared/src/domain/clients.ts`.
   The API's request validation *and* its OpenAPI document both come from
   these, so this one edit updates the contract.
4. **Service** — map it in `toClient()` in `apps/api/src/modules/clients/service.ts`.
5. **Test** — assert it round-trips in `clients.test.ts`.
6. **UI** — render it in `apps/web/src/app/(app)/clients/page.tsx`.
7. `npm run verify`.

Steps 1–3 are the contract; 4–6 are the implementation. If you find yourself
editing 4 without 3, you are probably adding a field the API does not actually
promise.

## Where things will trip you up

**Relative imports need a `.js` extension.** The whole repository is NodeNext
ESM. `import { scope } from './tenancy.js'` — even though the file is
`tenancy.ts`. That is the ESM specifier, resolved at runtime; TypeScript is
doing what Node will do.

**`@almajeed/db/testing` resolves differently in tests.** `vitest.config.ts`
aliases the workspace packages to their *source*, most-specific alias first, so
tests run against the TypeScript rather than the last build you happened to
make. Builds use the package `exports` field.

**Two tsconfigs, on purpose.** `tsconfig.json` builds (project references,
emits, excludes tests). `tsconfig.typecheck.json` checks everything including
tests with `paths` pointing at source. `npm run typecheck` runs both.

**The web app is not in the root project references.** `next build` type-checks
it with its own plugin; adding it twice produced conflicting module resolution.

**Docker is only needed for the real-Postgres path.** The test suite never
touches it — see [ADR-0004](../02-architecture/adr/0004-pglite-for-tests.md).

## Next

- [Coding standards](coding-standards.md) — the conventions and why they exist
- [Testing](testing.md) — the harness, and what is deliberately untested
- [Module map](../00-overview/module-map.md) — what each module owns
