# ADR-0002 · Shared schema multi-tenancy

**Status:** Accepted · **Date:** 2026-01

## Context

The product serves many organizations from one deployment. Each one's data must
be completely invisible to the others — this is the property with the least
tolerance for error in the system, because a cross-tenant read ends the business
in a way that no amount of uptime makes up for.

The expected shape is tens to low hundreds of tenants, each with thousands to
tens of thousands of rows. Not a handful of enormous enterprise customers, and
not a million tiny ones.

## Decision

One database, one schema. Every business table carries `organization_id`. Every
query is scoped through a single module,
[`packages/db/src/tenancy.ts`](../../../packages/db/src/tenancy.ts), and
nothing else in the codebase writes that comparison by hand.

Lookups by primary key match id **and** organization in one predicate, so a
leaked id from another tenant returns zero rows and the API answers 404 — never
confirming that another organization's record exists.

## Consequences

**Good.** One migration, one connection pool, one backup, one set of dashboards.
Adding a tenant is an `INSERT`. Cross-tenant operational queries — "how many
organizations have issued an invoice this month?" — are trivial.

**Good.** The isolation logic is concentrated in about forty lines, which can
therefore be reviewed carefully and tested adversarially, rather than being
spread across every query in the system.

**Bad, and the core trade.** Isolation is an application invariant, not a
database boundary. A query that skips `scope()` leaks. Mitigated by putting
`scope()` *inside* the pagination and lookup helpers so a module cannot forget
it, by `CODEOWNERS` on the file, and by isolation tests in every module.

**Bad.** A compromised application credential can read everything. Mitigated by
least-privilege grants, rotating secrets, and an audit log that makes bulk reads
visible — but not eliminated. This is inherent to the model.

**Bad.** No per-tenant restore. Recovering one organization's data from a
backup means restoring a copy and extracting rows, rather than restoring their
database. Documented in
[disaster recovery](../../07-operations/disaster-recovery.md).

**Bad.** Noisy-neighbour effects are possible. One enormous tenant can affect
query plans and cache hit rates for everyone.

## Alternatives considered

**Database per tenant.** The strongest isolation and the cleanest per-tenant
restore. Rejected on operational cost: migrations, connection pools, backups and
monitoring all multiply by tenant count, and partial migration failure across
120 databases is a genuinely bad afternoon. It is the right answer for a
handful of large regulated customers, and the migration path — move a tenant out
to its own database, route by organization — stays open.

**Schema per tenant.** 23 tables × N schemas. Rejected as the worst of both:
migrations get slow and can fail halfway, connection setup needs a `search_path`
dance, and the isolation is still enforced by the application choosing the right
schema. Same failure mode, more operational weight.

**Row-level security in Postgres.** Move the guarantee below the application: a
policy on every table, `SET LOCAL app.organization_id` per transaction, and a
query that forgot the filter returns nothing. Genuinely better isolation, and
the intended hardening step.

Not done yet for two reasons. It requires the setting to be transaction-local
rather than session-local, or a pooled connection leaks one tenant's context
into another's request — a subtle bug that would be worse than what it replaces.
And it changes the behaviour of the migration and seed paths, which legitimately
operate across tenants. The trigger to revisit: the first raw query written
outside the analytics module, or the first customer who requires isolation below
the application layer.
