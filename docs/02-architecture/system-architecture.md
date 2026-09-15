# System architecture

## The shape of it

```
                       Browser
                          │  httpOnly cookie (no token in JS)
                          ▼
              ┌───────────────────────┐
              │  apps/web (Next.js)   │  server components, server actions,
              │  backend-for-frontend │  route handlers
              └───────────┬───────────┘
                          │  Authorization: Bearer <access token>
                          ▼
              ┌───────────────────────┐
              │  apps/api (Fastify)   │  validate → authenticate → authorize
              │                       │  → service → audit
              └───────────┬───────────┘
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   PostgreSQL 17    Object storage      Model provider
   (all state)      (document bytes)    (Anthropic, or the mock)
```

Three processes, one database. Nothing exotic: at this size the interesting
problems are correctness and isolation, not distribution, and every additional
moving part is a new way to be down.

## Why the browser never holds a token

The web app is a backend-for-frontend. Tokens live in `httpOnly`,
`sameSite=lax`, `secure` cookies; the browser cannot read them, and every API
call is made by a server component, a server action or a route handler that
attaches the bearer header itself.

A token in `localStorage` is readable by any script that manages to run on the
page. One XSS and the attacker has a working session they can replay from
anywhere, for as long as the token lives. An `httpOnly` cookie is not readable,
so the same XSS gets the attacker actions-while-you-are-there rather than a
portable credential. That is a large difference for a small amount of work.

It also keeps the API's CORS policy narrow: the only browser origin that ever
talks to it is the one we control.

Implemented in [`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)
and [`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts). Verified in a
real browser: `document.cookie` returns an empty string while the session works.

## The request lifecycle

Every authenticated API request passes through the same stages, in this order.

| # | Stage | Where | What it does |
| --- | --- | --- | --- |
| 1 | Correlation | `server.ts` `genReqId` | Accept an inbound `x-request-id` or mint one. Echoed on the response, in every log line, in every audit row |
| 2 | Transport hardening | `plugins/security.ts` | helmet, allow-list CORS, rate limit keyed on principal or IP |
| 3 | Authentication | `plugins/auth.ts` `onRequest` | Verify the JWT with the algorithm pinned, then **re-read the membership** |
| 4 | Validation | Zod, via the type provider | Parse body, query and params. Strict objects: unknown keys are a 422 |
| 5 | Authorization | `app.requirePermission(...)` | Set lookup against the role's permissions. Denials are logged |
| 6 | Service | `modules/<name>/service.ts` | Business rules, against a `RequestContext` |
| 7 | Tenant scope | `packages/db/src/tenancy.ts` | `organization_id = $1 AND deleted_at IS NULL`, written in exactly one place |
| 8 | Audit | `lib/audit.ts` | One row per state change, in the same transaction as the change |
| 9 | Serialization | Zod response schema | The response is validated against its declared shape |
| 10 | Errors | `plugins/errors.ts` | Typed failures answer with a code; everything else is a bare 500 plus the request id |

### Step 3 deserves its own paragraph

Verifying the signature is not enough. Authentication also re-reads the
membership row on every request — one indexed query — and takes the **role from
the database, not from the token**.

That buys revocation. Removing someone from an organization, suspending their
user, or demoting them takes effect on their next request, rather than whenever
their access token happens to expire. For a system holding payroll and invoices,
paying one indexed lookup per request for that is obviously worth it.

The cost is real and named: a database round trip on every authenticated
request. If that ever becomes the bottleneck, the fix is a short-TTL cache
keyed on the membership id with explicit invalidation on role change — not
removing the check.

### Step 9 deserves one too

Responses are validated against their own schemas. A handler returning the wrong
shape is a 500 with a loud log line, not a subtly wrong payload that a client
discovers in production. It also means the OpenAPI document cannot drift from
the implementation: both are generated from the same Zod schema.

## Layers, and what may import what

```
apps/web ──────► @almajeed/shared          (schemas, types, money)
   │
   └── HTTP ──► apps/api
                   │
                   ├──► @almajeed/shared   (same schemas — one definition)
                   └──► @almajeed/db ──► @almajeed/shared
```

The rules:

- `@almajeed/shared` imports nothing from the workspace. No framework, no
  driver, no network client. It is the layer that is cheapest to test and the
  one both sides agree on.
- `@almajeed/db` knows about Drizzle and Postgres. It does not know about HTTP.
- `apps/api` knows about HTTP. It does not import a database driver directly —
  only the `Database` type from `@almajeed/db`, which is driver-agnostic. That
  is precisely what lets the test suite run the identical service code against
  in-process Postgres.
- `apps/web` imports schemas and types from `shared` and reaches the API over
  HTTP. It never touches the database.

## Testability as an architectural property

`buildServer` takes its dependencies — database, storage, model provider, clock
— rather than constructing them. That one decision is why 294 tests run in
thirty seconds with no container, no port and no network:

```ts
const app = await buildServer({
  config,
  db: pgliteDatabase,      // real Postgres, in-process
  storage: memoryStorage,  // a Map
  ai: mockProvider,        // deterministic, free
  clock: () => FIXED_NOW,  // date-dependent reports are reproducible
});
```

The clock is not a detail. Every "is this overdue?" and every reporting window
depends on the current time, and a test that passes in June and fails in August
is worse than no test.

## What this architecture is not ready for

Stated plainly, because an architecture document that only lists strengths is
marketing.

**A single database is a single point of failure.** Mitigated by managed
Postgres with automated failover and point-in-time recovery, not by the
application. See [disaster recovery](../07-operations/disaster-recovery.md).

**Document uploads buffer in memory.** Bounded by `STORAGE_MAX_UPLOAD_BYTES`
(25 MiB by default), but many concurrent large uploads are a memory pressure
problem. Streaming straight to object storage is the fix when it matters.

**Retrieval scores every chunk in the tenant's corpus.** Fine at thousands of
chunks, not at millions. The threshold and the migration to pgvector are in
[ADR-0005](adr/0005-embeddings-as-jsonb.md).

**No background job runner.** Everything happens in the request. Emailing an
invoice, generating a PDF or re-indexing a large document all want a queue, and
none of them exist yet — which is part of why those features do not.

**No caching layer.** Every read hits Postgres. Correct, and fast enough at this
size; the first thing to cache when it is not is the membership lookup above.
