# System design

How this system scales, in the order the bottlenecks actually arrive. Not in the
order they are interesting — the fashionable problems (sharding, event sourcing,
CQRS) are last because they are last.

The honest starting position: **nothing here has been load tested.** There is no
performance baseline. What follows is reasoning from the shape of the code and
the properties of Postgres, with the measurement you would take before acting
stated alongside each step. Treat a number below as a hypothesis with a test
attached, not as a result.

## The current shape

```
Browser ──HTTPS──▶ Next.js (BFF)  ──HTTP──▶ Fastify API ──▶ PostgreSQL
                   server comps              stateless           │
                   httpOnly cookies          RBAC + tenancy      │
                                                    │            │
                                             Object storage   (embeddings
                                             (documents)       as JSONB)
                                                    │
                                             Model provider (Anthropic)
```

Two stateless services and one database. Everything that must be durable is in
Postgres or object storage; the API holds no session state, no cache and no
in-memory queue. That single property is what makes every step below possible,
and it is worth defending against anything that would quietly break it.

## Where the state lives

| State | Home | Consequence |
| --- | --- | --- |
| Business data | Postgres | One place to back up, one place to secure |
| Sessions | Postgres (`refresh_tokens`), hashed | Revocable; survives a restart |
| Documents | Object storage, key in Postgres | The database stays small |
| Embeddings | Postgres JSONB | Scanned in application memory (ADR-0005) |
| Access tokens | Nowhere — signed, 15 min | Stateless verification, no lookup |

Access tokens being stateless is the deliberate trade: verification is a local
signature check with no database round trip, and the cost is that revocation is
not instant. A revoked session is dead within 15 minutes, and its refresh token
is dead immediately. [ADR-0007](../02-architecture/adr/0007-bff-session-cookies.md).

## Stage 1 — one of each (today)

One API container, one web container, one Postgres. Comfortably enough for tens
of organizations and low-hundreds of concurrent users.

What is already right for this stage and will keep being right:

- Every list endpoint is **keyset paginated**, so page depth does not degrade.
- Every query is scoped by `organization_id`, and every index leads with it, so
  a large tenant does not slow a small one.
- N+1 queries are avoided by design: services fetch related rows in one query
  (`inArray`) rather than per row.
- Money arithmetic is integer, so it is CPU-trivial.

**The first thing that will hurt** is not throughput; it is a missing index on a
query nobody thought about. `pg_stat_statements` plus `EXPLAIN (ANALYZE,
BUFFERS)` finds it in minutes. Add the index, add a migration, move on.

## Stage 2 — more API containers

**Signal:** API CPU sustained above ~70%, or p95 latency rising while database
time stays flat.

The API is stateless, so this is a replica count change and a load balancer. No
sticky sessions (tokens are signed, not stored in memory), no shared cache to
invalidate, no leader election.

Two things need attention the moment there is more than one container:

1. **Rate limiting becomes per-container.** `@fastify/rate-limit` counts in
   process memory, so three containers means three times the configured limit.
   Move the store to Redis, or accept the multiple and set the limit
   accordingly — but decide, rather than discovering it.
2. **Migrations must stop running on boot.** Right now
   `RUN_MIGRATIONS_ON_BOOT=true` relies on Drizzle's advisory lock to serialise
   replicas. That works, but it makes every container's startup depend on the
   database being writable. Move migrations to a release job that runs before
   any new container takes traffic. This is written down in
   `apps/api/src/index.ts` next to the code it concerns.

## Stage 3 — read pressure on Postgres

**Signal:** database CPU high, and `pg_stat_statements` shows the load is reads
— typically analytics, which aggregate across a whole organization.

In order of cost to implement:

1. **Index the specific slow query.** Usually enough. Genuinely.
2. **Connection pooling.** Each API container holds a pool (`poolMax`);
   containers × poolMax must stay under Postgres's `max_connections`. PgBouncer
   in transaction mode multiplexes, and the trade to understand is that it
   breaks session-level features — including `SET` and, in some configurations,
   prepared statements.
3. **A read replica for analytics.** Analytics endpoints tolerate seconds of
   staleness; nothing else in the product does. Route only those queries there,
   and be explicit that a number on the dashboard may lag a payment recorded
   ten seconds ago.
4. **Materialised views** for the expensive aggregates, refreshed on a schedule.
   This is the first point where the product's *semantics* change — a
   materialised dashboard is a dashboard as of a timestamp — so it needs a
   visible "as of" in the UI, not just a `REFRESH` in cron.

**Not a cache, not yet.** A cache in front of Postgres trades a performance
problem you can see for an invalidation problem you cannot, and in a
multi-tenant system a cache-key bug is a cross-tenant leak. Index first; cache
when you have measured that indexing is not enough.

## Stage 4 — write pressure

**Signal:** lock waits in `pg_stat_activity`, or write latency rising under
concurrency.

The known contention point is deliberate. Gapless invoice numbering takes
`SELECT ... FOR UPDATE` on a per-organization counter row
(`allocateInvoiceNumber` in `modules/finance/service.ts`), which serialises
invoice creation **within one organization**. That is the price of numbers with
no gaps, which is a legal requirement in several jurisdictions, and it is a
price worth paying: organizations issue tens of invoices a day, not thousands.

If it ever does become the bottleneck, the options in order are: shorten the
transaction so the lock is held for less time; allocate numbers in blocks per
container; or drop the gapless guarantee, which is a business decision and not
an engineering one.

Everything else that writes is row-independent and scales with Postgres.

## Stage 5 — the AI path

This is the part most likely to surprise, because its cost profile is unlike the
rest of the system: seconds of latency, per-request money, and an external
dependency that can be slow or down.

**Retrieval** is an application-memory cosine scan over an organization's chunks
— O(chunks × dimensions). Fine at a thousand chunks; not fine at fifty thousand.
Triggers for moving to `pgvector` with an HNSW index: 20,000 chunks in one
organization, p95 retrieval above 500 ms, or memory pressure from loading
embeddings. [ADR-0005](../02-architecture/adr/0005-embeddings-as-jsonb.md).

**Generation** is an outbound call taking seconds. It must never share a
connection pool or a queue with interactive traffic, and it needs a timeout, a
circuit breaker and a per-organization spend cap. A model provider having a bad
afternoon should degrade the assistant, not the invoice list.

**Embedding on upload** happens inline today. At volume it belongs in a queue
with a `pending → indexed` state on the document, so an upload does not wait for
a model provider.

See [inference infrastructure](../05-ai/inference-infrastructure.md).

## Stage 6 — the things you probably will not need

Stated so that reaching for them is a decision:

**Sharding by organization.** Shared-schema multi-tenancy
([ADR-0002](../02-architecture/adr/0002-shared-schema-multi-tenancy.md)) means
every row already carries `organization_id`, so the shard key exists. Splitting
by tenant is therefore mechanical rather than a rewrite — but it costs
cross-tenant reporting and multiplies operational surface, so it comes after a
single Postgres with a read replica has genuinely been outgrown.

**Microservices.** The modules are already separated by directory and by
service function, with no shared mutable state between them. Extracting one is
possible. It is also a trade of in-process function calls for network calls,
transactions for distributed sagas, and one deployment for several. The usual
honest reason to split is organizational — teams that cannot ship without each
other — and that reason has nothing to do with load.

**Event sourcing / CQRS.** The audit log already gives the "what happened" that
most people want event sourcing for, at a fraction of the complexity.

## Failure and degradation

Designing for scale without designing for failure produces a system that is fast
until it is unavailable.

| Dependency | Failure | Current behaviour | Should be |
| --- | --- | --- | --- |
| Postgres | Down | All requests 500; `/ready` fails | Correct — the product is its data |
| Object storage | Down | Upload and download fail | Correct; the rest of the app keeps working |
| Model provider | Down or slow | Assistant fails | Correct, but needs an explicit timeout and breaker |
| Web → API | Down | Pages error | A cached shell would be better |

The liveness probe (`/health`) deliberately does **not** check the database,
while the readiness probe (`/ready`) does. A liveness probe that fails on a
database blip restarts healthy containers and turns a thirty-second outage into
a rolling one — the single most common self-inflicted incident in this shape of
system.

## What to measure first

Before any of the above, these four:

1. **p95 latency per route.** Which endpoint, not "the API".
2. **Database time per request.** Separates a slow query from slow code.
3. **Postgres connections in use** vs `max_connections`. The limit that bites
   first and looks like something else.
4. **Model spend and latency per organization.** The only cost here that scales
   with usage rather than with data.

[Monitoring](../04-infrastructure/monitoring.md) covers instrumentation;
[service levels](../07-operations/service-levels.md) covers turning these into
objectives with an error budget.

## The rule underneath all of it

Every stage above is reached by **measuring**, not by anticipating. The
architecture's job is not to be scaled already; it is to keep the cheap options
open — which is why the API is stateless, why the tenant key is on every row,
why pagination is keyset, and why the model provider sits behind an interface.
Each of those was a one-line-cheaper decision at the start that removes a
rewrite later.
