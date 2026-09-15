# ADR-0004 · Test against in-process Postgres

**Status:** Accepted · **Date:** 2026-01

## Context

The correctness this product cares about mostly lives in SQL and its
constraints: tenant scoping, enum enforcement, foreign keys, partial unique
indexes, transaction semantics, `SELECT ... FOR UPDATE`. A test suite that mocks
the database tests none of it.

But a suite that needs a database container is slow to start, awkward on a
laptop, and a source of flaky CI — port races, health-check timing, state
leaking between parallel jobs.

## Decision

Tests run against [PGlite](https://pglite.dev): PostgreSQL compiled to
WebAssembly, running in the same process.

Each test file creates its own instance, applies the **same committed
migrations** production applies, and truncates between tests. There is no
container, no port, no shared state, and no network.

[`packages/db/src/testing.ts`](../../../packages/db/src/testing.ts) is the
harness; [`apps/api/src/test/harness.ts`](../../../apps/api/src/test/harness.ts)
builds a complete API on top of it and drives it with `app.inject()`.

## Consequences

**Good.** The constraints are genuinely exercised. A bad enum value, a
cross-tenant foreign key, a partial unique index violation and a transaction
rollback all behave exactly as they will in production, and all are asserted by
tests.

**Good.** 294 tests in about thirty seconds, with `npm test` and nothing else.
No `docker compose up` in the contributing guide, no service block in CI.

**Good.** A migration that does not apply cleanly fails the test suite rather
than the deploy, because the suite applies the real migration files.

**Good.** Perfect isolation between test files, so they parallelise without
coordination.

**Bad.** PGlite is a specific Postgres build, not the exact server production
runs. Extensions differ — notably, this build has no pgvector, which is part of
why [ADR-0005](0005-embeddings-as-jsonb.md) went the way it did. Performance
characteristics differ entirely, so nothing here says anything about query
plans.

**Bad.** It would not catch a behaviour that differs between the WASM build and
the real server. Closed by a CI job that applies the migrations to a real
Postgres 17 through the real node-postgres driver, twice (to prove idempotence),
then seeds, then checks for schema drift.

**Bad.** Startup cost per test file is a second or two. Acceptable at this suite
size; if it stops being, the fix is a template dump restored per file rather
than re-running migrations.

## Alternatives considered

**Mock the database.** Fastest, and tests almost nothing that matters here.
Every interesting bug in this system is an interaction with SQL, and a mock
asserts that the code called the mock.

**Testcontainers.** Real Postgres, matching production exactly. Rejected as the
default because it requires a working Docker daemon on every contributor's
machine and in CI, adds tens of seconds of startup, and introduces the port and
health-check flakiness this decision was trying to avoid. It is the right tool
for the one job that genuinely needs it — which is why that job exists in CI.

**A shared test database.** One Postgres, one schema per test run. Rejected:
parallel test files then contend, cleanup between runs becomes a source of
mysterious failures, and a developer's laptop needs Postgres installed.

**SQLite.** Fast and embedded, but a different SQL dialect: no `jsonb`, no
arrays, no partial indexes the same way, different transaction semantics,
different type coercion. Testing against a different database than you run is
how "works on my machine" becomes institutional.
