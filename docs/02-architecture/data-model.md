# Data model

23 tables, one database, one schema. Defined in
[`packages/db/src/schema/`](../../packages/db/src/schema/) and migrated by
committed SQL in [`packages/db/drizzle/`](../../packages/db/drizzle/).

## The tables

| Group | Tables |
| --- | --- |
| Tenancy | `organizations`, `users`, `memberships`, `refresh_tokens`, `api_keys`, `audit_logs` |
| Clients | `clients`, `contacts` |
| Projects | `projects`, `project_members`, `time_entries` |
| People | `employees` |
| Finance | `invoices`, `invoice_lines`, `payments`, `expenses`, `invoice_counters` |
| Documents | `documents`, `document_chunks` |
| Tasks | `tasks`, `task_comments` |
| AI | `ai_conversations`, `ai_messages` |

## Money

Two columns, never one:

```sql
budget_amount    bigint,      -- integer count of minor units
budget_currency  char(3)      -- ISO 4217
```

`1500.00 SAR` is stored as `150000` and `'SAR'`. There is no `numeric` and no
`double precision` anywhere in this schema.

**Why not `numeric`?** It is exact, so it would work. But it round-trips through
JavaScript as a string that then has to be parsed by something, and the moment
one code path does `Number(row.amount)` the exactness is gone. An integer is
exact in Postgres *and* in JavaScript, up to 2^53 — which is 90 trillion halalas,
comfortably past any invoice this product will see. The
[money test](../../packages/shared/src/money.test.ts) asserts a round trip at
`Number.MAX_SAFE_INTEGER - 1`.

**Why is the currency next to every amount?** Because an amount without its
currency is not a quantity. Carrying them together makes
`add(sar, usd)` a `CurrencyMismatchError` at the point of the mistake rather
than a wrong number in a report three screens later.

The same reasoning extends:

| Value | Stored as | Example |
| --- | --- | --- |
| Quantity | thousandths (`integer`) | `7.5 hours` → `7500` |
| Tax rate | basis points (`integer`) | `15%` → `1500` |
| Discount rate | basis points (`integer`) | `7.25%` → `725` |
| Duration | whole minutes (`integer`) | `1h 30m` → `90` |

A line total is therefore integer arithmetic from end to end. The rules live in
[`apps/api/src/modules/finance/totals.ts`](../../apps/api/src/modules/finance/totals.ts)
as pure functions over `Money`, with no database in sight, and are tested
exhaustively.

## Time

Every timestamp is `timestamp with time zone`, stored in UTC. Calendar dates —
an invoice issue date, a time entry's date — are `date`, because they are
genuinely dates and not instants: an invoice issued on the 3rd was issued on the
3rd regardless of who is reading it.

The date helpers in
[`packages/shared/src/datetime.ts`](../../packages/shared/src/datetime.ts) are
UTC-only. There is no local-time path, because "the numbers changed overnight"
is a recurring class of reporting bug and the cure is to not have the option.

## Identifiers

Prefixed strings: `inv_3f1a...`, `cli_8b2c...`. A prefix plus a UUIDv4 with the
dashes removed, in a `varchar(64)`.

| Alternative | Why not |
| --- | --- |
| `bigserial` | Leaks row counts and growth rate. An id in a URL tells a competitor how many clients you have |
| Bare UUID | No worse, but a leaked id in a log or a support ticket says nothing about what it points at |
| Prefixed UUID | Self-describing in logs; type-safe in the application via branded types; non-sequential |

The branding is not cosmetic. `Id<'client'>` is not assignable to
`Id<'project'>`, so passing the wrong id to a function is a compile error, and
the route schemas reject an id of the wrong kind with a 422 before a handler
runs — which is why a `prj_...` in a client route never becomes a database
query at all.

## Tenancy

Every business table carries `organization_id`, with a foreign key and
`ON DELETE CASCADE`. Every query filters on it through `scope()`.

Lookups by id use `scopeById`, which matches id **and** organization in one
predicate. A guessed id from another tenant returns zero rows, which the service
layer reports as 404 — the API never distinguishes "does not exist" from
"exists, but not yours". See [multi-tenancy](multi-tenancy.md).

## Indexing

Every listable table carries the same pagination index:

```sql
CREATE INDEX clients_org_created_idx
  ON clients (organization_id, created_at DESC, id DESC);
```

That is exactly the ordering key of the keyset cursor
([`apps/api/src/lib/query.ts`](../../apps/api/src/lib/query.ts)), so every page —
the first and the ten-thousandth — is one index range scan.

Beyond that, indexes exist where a filter is actually used, not speculatively.
Each one costs write throughput and space, so the bar is a query that exists.

Three partial indexes earn their place by enforcing a rule rather than speeding
up a read:

```sql
-- At most one live primary contact per client. The database enforces it, so
-- two concurrent requests cannot both "check then set".
CREATE UNIQUE INDEX contacts_one_primary_per_client ON contacts (client_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Project codes unique within an organization, ignoring deleted rows.
CREATE UNIQUE INDEX projects_org_code_key ON projects (organization_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;

-- Receivables aging touches only open invoices.
CREATE INDEX invoices_due_idx ON invoices (organization_id, due_date)
  WHERE status IN ('issued', 'partially_paid');
```

## Enums

20 Postgres enums mirror the `as const` tuples in `@almajeed/shared`. Declaring
them in both places is deliberate belt-and-braces: Zod stops a bad value at the
API boundary, and the enum stops one that arrives through a migration, a
backfill script or an ad-hoc `psql` session.

Adding a value is a migration (`ALTER TYPE ... ADD VALUE`); removing one is not
supported without a rewrite. That asymmetry is the right one for a system of
record — statuses accumulate, they do not disappear.

## Deletion

Business rows carry `deleted_at` and reads filter it out. Nothing financial or
HR-related is ever hard-deleted.

Three reasons: an invoice that vanishes takes its audit trail with it; "where
did that client go?" needs an answer; and an accidental delete should be
recoverable by an operator rather than by a backup restore.

The cost is that every query must remember the filter — which is why no query
writes it by hand. `scope()` adds it automatically.

Actual erasure, when a data-subject request requires it, is a deliberate,
audited operation. See [data privacy](../03-security/data-privacy.md).

## Denormalisation, where it is deliberate

Two places store a value that could be derived. Both are on purpose.

**Invoice header totals.** `subtotal_amount`, `tax_amount` and `total_amount`
duplicate what the lines say. An issued invoice is a legal document and must go
on reporting the number the client received, even if a tax rate changes later.
Totals are recomputed only while the invoice is still a draft.

**`invoices.paid_amount`.** A running total of payments, so the receivables
query does not need a correlated subquery per invoice. Updated in the same
transaction as the payment insert, so it cannot drift.

Everything else is derived at read time — `overdue`, `days_overdue`,
`balance_due`, a task's `overdue` flag, every analytics figure. A stored
`overdue` flag is wrong the next morning, and nothing keeps it honest.

## Invoice numbering

A dedicated counter row per organization, locked with `SELECT ... FOR UPDATE`
when an invoice is issued.

| Alternative | Why not |
| --- | --- |
| `MAX(number) + 1` | Races. Two concurrent issues produce the same number |
| Postgres sequence | Leaks gaps on rollback. Tax authorities generally want an unbroken series |
| Counter row + row lock | Gapless, and a rollback returns the number rather than burning it |

The cost is that concurrent issues within one organization serialise. Issuing an
invoice is a human action at human frequency, so that is free in practice.

Drafts carry a provisional `DRAFT-xxxxxxxx` reference and take a real number
only at issue, so an abandoned draft does not burn one.

## Entity relationships

```
organizations ─┬─ memberships ─── users
               ├─ clients ─── contacts
               ├─ projects ─┬─ project_members
               │            └─ time_entries ──► tasks (optional)
               ├─ employees ─── employees (manager, self-referencing)
               ├─ invoices ─┬─ invoice_lines
               │            └─ payments
               ├─ expenses
               ├─ documents ─── document_chunks
               ├─ tasks ─┬─ task_comments
               │         └─ tasks (parent, self-referencing)
               ├─ ai_conversations ─── ai_messages
               └─ audit_logs
```

Foreign key `ON DELETE` behaviour is chosen per relationship, not by default:

- `CASCADE` from `organizations`, so removing a tenant genuinely removes it.
- `RESTRICT` from `invoices.client_id`, so a client with invoices cannot be
  hard-deleted underneath them.
- `SET NULL` for soft references like `clients.owner_id`, where losing the
  person should not lose the client.
