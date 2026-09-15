# Multi-tenancy

One database, one schema, `organization_id` on every business table, and a
mandatory scope on every query.

This is the property with the least tolerance for error in the whole system. A
slow page is an annoyance. A cross-tenant read is the end of the business.

## The options, and why this one

| Model | Isolation | Operational cost | Verdict |
| --- | --- | --- | --- |
| Database per tenant | Strongest | Migrations, connections and backups multiply by tenant count | Right for a handful of large enterprise tenants; wrong here |
| Schema per tenant | Strong | 23 tables × N schemas; migrations get slow and partial failure is messy | The worst of both at this scale |
| Shared schema, scoped rows | Application-enforced | One migration, one connection pool, one backup | **Chosen** |

The trade is explicit: isolation becomes an application invariant rather than a
database boundary. That is only acceptable if the invariant is enforced in one
place and tested hard — which is the rest of this page.

Recorded as [ADR-0002](adr/0002-shared-schema-multi-tenancy.md).

## Where it is enforced

[`packages/db/src/tenancy.ts`](../../packages/db/src/tenancy.ts). Three
functions, and nothing else in the codebase writes an `organization_id`
comparison by hand.

```ts
// organization_id = $1 AND deleted_at IS NULL AND <your conditions>
scope(table, organizationId, ...conditions)

// The same, plus id = $2 — the shape that defeats IDOR.
scopeById(table, organizationId, id)

// Includes soft-deleted rows. Restore and audit paths only.
scopeIncludingDeleted(table, organizationId, ...conditions)
```

The repository helpers in
[`apps/api/src/lib/repository.ts`](../../apps/api/src/lib/repository.ts) put
`scope()` *inside* `paginate` and `findByIdOrThrow`, so a module physically
cannot forget it — the boilerplate that would otherwise be copy-pasted nine
times **is** the tenant isolation, and the way to keep it correct is to have one
copy.

## Where the organization id comes from

The verified access token, and nowhere else.

Not a path parameter, not a query string, not a header, not a body field. An API
where the client supplies its own tenant id is an API where the client can
supply someone else's.

```ts
request.auth.organizationId   // set by plugins/auth.ts, from the JWT
```

The claim is cross-checked on every request against a live membership row, so a
token whose organization no longer matches an active membership is rejected
rather than trusted.

## The 404-not-403 rule

Looking a row up by id *and* organization in one predicate means a guessed or
leaked id from another tenant returns zero rows, which surfaces as 404.

That is deliberate. A 403 would confirm the record exists — enough to enumerate
another tenant's invoice ids and learn how many they have. The API never
distinguishes "does not exist" from "exists, but not yours", and every module's
tests assert it:

```ts
it('404s — not 403 — when reading another tenant’s client by its exact id', ...)
```

## Foreign keys are not tenancy

A foreign key says the referenced row exists. It says nothing about who owns it.

Without a further check, a caller could attach their invoice to another tenant's
project: the FK would be satisfied, because the project genuinely exists.

So every foreign key that arrives in a request body is checked:

```ts
await assertBelongsToOrganization(ctx, projects, input.projectId, 'Project');
```

`users` is a special case, because it is a *global* table — one person, one
login, potentially several organizations. A plain FK would accept a stranger's
user id. `assertActiveMember` checks for an active membership in the caller's
organization instead, and every `userId` in a body goes through it.

## What is not tenant-scoped

- **`users`** — global identity. Scoping happens through `memberships`.
- **`refresh_tokens`** — carries both `user_id` and `organization_id`, because a
  session is a session *in* an organization.
- **`ai_conversations`** — tenant-scoped *and* private to their creator. A
  colleague's chat history is not organizational data the way an invoice is, so
  reads filter on `user_id` as well.

## Testing it

Isolation is tested at two levels, because one is not enough.

**Unit, at the data layer**
([`packages/db/src/tenancy.test.ts`](../../packages/db/src/tenancy.test.ts)):
two organizations, rows in each, then adversarial questions — can A read B's row
given its exact id, does a soft-deleted row come back, does the tenant filter
survive an extra condition, does a cascade from `organizations` take the right
rows.

**Integration, through the API** (every module's test file): cross-tenant read,
update and delete by exact id, all expecting 404; list endpoints asserted to
contain only the caller's rows; retrieval asserted not to surface another
tenant's documents.

## Residual risks

Named, because pretending otherwise is how they persist.

**A raw query that skips `scope()`.** The mitigation is that there are very few
raw queries, they are concentrated in the analytics module, and they are
reviewed as security-sensitive via `CODEOWNERS`. Postgres row-level security
would make this structurally impossible and is the obvious hardening step — see
below.

**A compromised application credential reads everything.** True by construction
in a shared-schema model. Mitigated by least-privilege database grants
([database security](../03-security/database-security.md)), secrets that rotate,
and the audit log making bulk reads visible.

**A migration that forgets `organization_id` on a new table.** Mitigated by the
review checklist in [the module map](../00-overview/module-map.md#adding-a-module)
and by the fact that `scope()` will not compile against a table without the
column — `TenantTable` requires it structurally.

## The hardening step, when it is worth it

Postgres row-level security with a per-request `SET LOCAL app.organization_id`
would move the guarantee from the application into the database: even a query
that forgot `scope()` would return nothing.

It is not enabled today because it needs careful handling of the connection pool
(the setting must be transaction-local, never session-local, or a pooled
connection leaks one tenant's context into another's request), and because it
would silently change the behaviour of the migration and seed paths, which
legitimately cross tenants.

The trigger to do it: the first time a raw query is written outside the
analytics module, or the first regulated customer who asks for isolation to be
enforced below the application.
