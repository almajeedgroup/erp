# PostgreSQL and Supabase

Running Postgres well for this system, and what a managed platform like Supabase
gives you and takes away.

## Why PostgreSQL

Chosen over the alternatives for reasons that are specific rather than
reflexive:

| Requirement | Why Postgres |
| --- | --- |
| Financial correctness | Real transactions, real constraints, `SELECT ... FOR UPDATE` for gapless numbering |
| Structured + flexible | Relational tables with `jsonb` where the shape genuinely varies (metadata, audit snapshots) |
| Arrays | `text[]` for tags, without a join table |
| Partial indexes | "One primary contact per client" is enforced by the database, not by a read-then-write |
| Enums | Bad statuses rejected at the storage layer, not just at the API |
| Extensibility | pgvector when retrieval outgrows the current approach; full-text search without another system |

Against MySQL: partial indexes, better `jsonb`, arrays, and a stricter default
posture. Against MongoDB: this data is deeply relational, and "flexible schema"
means "schema in the application, unenforced". Against SQLite: no concurrent
writers.

## Versions and features used

Postgres 17. The features this schema actually relies on:

- `jsonb` with GIN-indexable containment
- Array columns and the `@>` containment operator
- Partial unique indexes
- Enum types
- Row-value comparison — `(created_at, id) < ($1, $2)` — which is what makes
  keyset pagination one index range scan
- `SELECT ... FOR UPDATE`
- `generated` identity columns (unused; ids are application-generated)

## Configuration worth setting

```
# Safety
ssl = on
password_encryption = scram-sha-256      # not md5
statement_timeout = 30000
idle_in_transaction_session_timeout = 60000

# Observability
log_connections = on
log_disconnections = on
log_statement = 'ddl'                    # schema changes, not every query
log_min_duration_statement = 1000        # slow queries only
log_lock_waits = on

# Memory, for a 8 GB instance
shared_buffers = 2GB                     # ~25% of RAM
effective_cache_size = 6GB               # ~75%; a planner hint, not an allocation
work_mem = 32MB                          # per sort or hash, per connection
maintenance_work_mem = 512MB
```

`log_statement = 'all'` is tempting and wrong: it logs every parameter value,
which puts the data you are protecting into a log file with weaker access
control than the database.

`idle_in_transaction_session_timeout` matters more than it looks. An application
bug that leaves a transaction open holds locks and blocks vacuum indefinitely,
and the symptom — a slowly degrading database — is hard to diagnose.

## Connection pooling

Postgres forks a process per connection, so connections are expensive. The
application pools them:

```ts
max: 10,                       // per replica
connectionTimeoutMillis: 10_000,
idleTimeoutMillis: 30_000,
statement_timeout: 30_000,
application_name: 'almajeed-erp-api',
```

**Size it against the server, not against hope.** With `max_connections = 100`
and four API replicas at 10 each, that is 40 — leaving headroom for migrations,
monitoring and a human with psql. Over-provisioning produces "sorry, too many
clients already" at exactly the wrong moment, during a deploy when old and new
replicas overlap.

`application_name` shows up in `pg_stat_activity`, which is how you tell which
connection is doing what during an incident.

Beyond a few replicas, or with serverless compute, an external pooler (PgBouncer,
RDS Proxy, Supabase's built-in) becomes necessary. In transaction mode it
multiplexes many client connections onto few server ones — at the cost of
session-level features, which is why `SET LOCAL` is safe under it and `SET` is
not.

## Indexing

Covered in [the data model](../02-architecture/data-model.md). The operating
principle: an index exists because a query exists. Speculative indexes cost
write throughput and space for nothing.

Finding the missing one:

```sql
-- Slowest queries, if pg_stat_statements is enabled
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

-- Sequential scans on large tables
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables WHERE seq_scan > 0 ORDER BY seq_tup_read DESC;

-- Indexes nobody uses — they cost writes for nothing
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0;
```

`EXPLAIN (ANALYZE, BUFFERS)` on the actual query, with realistic data volumes.
An `EXPLAIN` against a hundred seeded rows tells you nothing about a hundred
thousand.

## Vacuum

Postgres MVCC means an `UPDATE` writes a new row version and leaves the old one
as a dead tuple. Autovacuum reclaims them.

It usually just works. When it does not, the symptom is table bloat and
degrading performance, and the cause is usually a long-running transaction
holding back the vacuum horizon — which is what
`idle_in_transaction_session_timeout` prevents.

The tables to watch here are `audit_logs` (append-only, so little vacuum
pressure but constant growth) and `refresh_tokens` (frequent updates, which is
exactly the pattern that produces dead tuples).

## Supabase

Supabase is managed Postgres plus a set of services around it: auto-generated
REST and GraphQL APIs, authentication, realtime subscriptions, object storage
and edge functions.

### What it gives you

- Managed Postgres with backups and point-in-time recovery
- A genuinely good dashboard and SQL editor
- Authentication with social providers, MFA and magic links — a real amount of
  work, done well
- Object storage with an access-policy model
- Realtime subscriptions over websockets
- Auto-generated APIs from the schema, which is remarkable for prototyping

### What it costs you

The auto-generated API is the interesting trade. It exposes tables directly to
the client, with **row-level security as the only authorization mechanism**.

For this system that is the wrong shape, and it is worth being precise about why:

| This system needs | RLS can express it? |
| --- | --- |
| Tenant isolation | Yes — RLS is genuinely excellent at this |
| Role-based permissions | Partly, and it gets unwieldy |
| "An issued invoice cannot be edited" | Awkwardly, as a trigger |
| "Totals are computed from lines" | No — this is application logic |
| "An expense cannot be approved by its filer" | Awkwardly |
| "Gapless invoice numbers under concurrency" | Needs a function |
| "One audit row per change, in the same transaction" | Triggers, which are hard to test |

The business rules in this product are not access rules. Pushing them into RLS
policies and triggers means writing them in PL/pgSQL, where they are harder to
test, harder to review, and invisible to the type system.

### Where Supabase would fit well

If the product were CRUD over data with straightforward ownership rules —
a notes app, a simple task tracker, an internal directory — Supabase would let
you build it in a fraction of the time, and the RLS model would be a genuine
strength rather than a constraint.

### Using Supabase as just the database

Entirely reasonable, and a good option. Supabase is Postgres; point
`DATABASE_URL` at it, run the migrations, ignore the generated API.

You get managed Postgres, backups, a good dashboard and connection pooling,
without adopting the architectural opinions. The things to check: use the
session-mode pooler or the direct connection for migrations (transaction mode
breaks advisory locks), and confirm the connection limit on your plan against
your pool size.

### Row-level security as a future hardening step

Supabase's RLS model is a good demonstration of what this system could adopt for
tenant isolation specifically — not for business rules. That is recorded in
[ADR-0002](../02-architecture/adr/0002-shared-schema-multi-tenancy.md), with the
concrete blocker: the tenant setting must be transaction-local, or a pooled
connection leaks one tenant's context into another's request.
