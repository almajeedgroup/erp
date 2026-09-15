# Database security

Postgres holds everything that matters. Losing control of it is losing control
of the product.

## Least privilege

The application connects as a role that can read and write business tables and
nothing else. Specifically, it cannot create or drop tables, cannot alter types,
and cannot update or delete from `audit_logs`.

```sql
-- The migration role. Used by the release job, never by the running service.
CREATE ROLE erp_migrate LOGIN PASSWORD :'migrate_password';
GRANT ALL ON SCHEMA public TO erp_migrate;

-- The application role. What the API actually connects as.
CREATE ROLE erp_app LOGIN PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;

-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_logs FROM erp_app;

-- A read-only role for analysts and ad-hoc investigation.
CREATE ROLE erp_readonly LOGIN PASSWORD :'readonly_password';
GRANT USAGE ON SCHEMA public TO erp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO erp_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO erp_readonly;
```

Separating the migration role from the application role is the important part.
An application that can `DROP TABLE` turns any SQL-injection bug — or any
mistake — into data loss. The migration role is used by the release job and by
nothing that serves traffic.

The `REVOKE` on `audit_logs` is what makes "append-only" true rather than
aspirational.

## SQL injection

Drizzle parameterises everything. No query in this codebase is built by string
concatenation, and the `sql` template tag interpolates values as parameters, not
as text:

```ts
sql`(${table.createdAt}, ${table.id}) < (${new Date(position.createdAt)}, ${position.id})`
// → (created_at, id) < ($1, $2)
```

Two adjacent issues that are *not* injection but are worth the same care:

**`LIKE` pattern escaping.** User input going into `ILIKE` has `%`, `_` and `\`
escaped, so a search for `100%` does not match every row. A correctness fix, not
a security one.

**Identifiers.** Table and column names are never user-supplied. A "sort by any
column" feature would need an allow-list, because identifiers cannot be
parameterised.

## Connection security

| Setting | Value | Why |
| --- | --- | --- |
| TLS | Required outside local development | Traffic inside a VPC is still plaintext to anyone who reaches the network |
| `rejectUnauthorized` | `true` | Otherwise TLS is theatre — any certificate is accepted |
| Pool max | 10 per replica | Sized against `max_connections` divided by replica count; over-provisioning produces "sorry, too many clients" during a deploy |
| Connection timeout | 10 s | Fail fast rather than queueing forever behind an exhausted pool |
| Statement timeout | 30 s | One pathological query cannot pin a connection indefinitely |
| `application_name` | `almajeed-erp-api` | So `pg_stat_activity` says who is doing what |

The config refuses to start in production with `DATABASE_SSL=false`.

## Tenant isolation at the data layer

Covered in [multi-tenancy](../02-architecture/multi-tenancy.md). The short
version: enforced by the application, in exactly one module, and the hardening
step is row-level security.

## The audit log as evidence

`audit_logs` is append-only by permission, not merely by convention. Rows carry
the actor, the action, the resource, a redacted before/after pair, the request
id, the IP and the user agent — and denied attempts are recorded with
`succeeded: false`.

Snapshots are redacted **before** storage. An audit log that faithfully records
a password hash or a national id has turned itself into a second, less protected
copy of the sensitive data.

For a genuinely tamper-evident trail, the next step is shipping rows to
write-once storage — a separate account's object store with object lock, or a
log service with retention lock. An append-only grant stops the application; it
does not stop someone with `superuser`.

## Backups are an attack surface

A backup is a complete copy of the database with none of the application's
access control in front of it.

| Control | Requirement |
| --- | --- |
| Encryption | At rest and in transit, always |
| Access | A separate IAM role from the application; ideally a separate account |
| Audit | Every restore and every download logged |
| Retention | Bounded — an unbounded backup archive is an unbounded liability under data-protection law |
| Testing | Restores are exercised; see [disaster recovery](../07-operations/disaster-recovery.md) |

## Monitoring

Worth alerting on:

- Authentication failures against the database role (someone probing)
- Connection count approaching the pool or server maximum
- Queries exceeding the statement timeout
- Replication lag, if a replica exists
- Unusual read volume from the application role — the signature of bulk
  exfiltration
- Any connection from an unexpected source address

## Development and production data

Production data is never copied to a development environment. The seed script
generates a complete, believable dataset
([`apps/api/src/seed/demo-data.ts`](../../apps/api/src/seed/demo-data.ts)), so
there is no reason to.

If a production-shaped dataset is ever genuinely needed for performance work,
the requirement is anonymisation at export time: names replaced, emails
rewritten to a sink domain, national ids and bank details dropped entirely,
amounts perturbed. "We'll be careful with the dump" is not a control.

## PostgreSQL configuration

Beyond the defaults, worth setting:

```
ssl = on
password_encryption = scram-sha-256     # not md5
log_connections = on
log_disconnections = on
log_statement = 'ddl'                   # every schema change, not every query
log_min_duration_statement = 1000       # slow queries only
idle_in_transaction_session_timeout = 60000
statement_timeout = 30000
```

`log_statement = 'all'` is tempting and wrong: it logs every parameter value,
which puts the data you are protecting into a log file with weaker access
control than the database.

`idle_in_transaction_session_timeout` matters more than it looks — an
application bug that leaves a transaction open holds locks and blocks vacuum
indefinitely.
