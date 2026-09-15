# Runbook

Procedures for running this system. Written to be followed when you are tired
and something is wrong, so each one states what it does, what it breaks, and how
to tell it worked.

**Conventions.** `$` commands run on an operator machine with the deployment
credentials. Anything destructive is marked. Anything that takes the system
down says so before the command, not after.

## Health endpoints

| Endpoint | Checks | Used by |
| --- | --- | --- |
| `GET /health` | The process is alive. **No database call.** | Liveness probe, container `HEALTHCHECK` |
| `GET /ready` | Database reachable, migrations applied | Readiness probe, load balancer |

The split matters. `/health` deliberately does not touch the database: a
liveness probe that fails during a brief database blip restarts otherwise
healthy containers and converts a thirty-second outage into a rolling one.
`/ready` does touch it, so a container that cannot serve is taken out of
rotation without being killed.

```bash
curl -fsS https://api.example.com/health   # {"status":"ok",...}
curl -fsS https://api.example.com/ready    # 200 when it can serve, 503 when not
```

## Deploy

**Preconditions:** CI green on the commit; migration reviewed; you know how to
roll back.

```bash
# 1. Confirm what is running now — you will want this for the rollback
$ docker inspect --format '{{index .Config.Image}}' erp-api

# 2. Migrations first, as a separate step, before any new container takes traffic
$ DATABASE_URL=... npm run db:migrate

# 3. Roll the API, one replica at a time, waiting for /ready between each
# 4. Roll the web containers
# 5. Verify
$ curl -fsS https://api.example.com/ready
$ curl -fsS https://app.example.com/login -o /dev/null -w '%{http_code}\n'
```

**Migrations run before containers, not on boot.** The image supports
`RUN_MIGRATIONS_ON_BOOT=true` for the single-container case, where Drizzle's
advisory lock serialises replicas, but at more than one replica it makes every
container's startup depend on a writable database. Run them as a release step.

**Order follows compatibility.** A migration must be compatible with the
*previous* release, because for the duration of the roll both versions are
running. That is the rule that makes a rollback possible at all.

### Verifying a deploy

Not "it returned 200". Check all four:

1. `/ready` is 200 on every replica.
2. Error rate in the logs is flat: `jq 'select(.level >= 50)'` over the last 5
   minutes, compared with the 5 minutes before the deploy.
3. p95 latency has not moved.
4. One real read and one real write through the UI — sign in, open an invoice.

## Roll back

**If no migration ran:** redeploy the previous image tag. That is the whole
procedure, and it is why the previous tag is recorded in step 1 of the deploy.

**If a migration ran:** stop and think, because this is the case that goes
wrong. There are no down migrations — deliberately; see
[disaster recovery](disaster-recovery.md).

- *Additive migration* (new table, new nullable column, new index): the previous
  release ignores it. Redeploy the old image; leave the schema alone.
- *Destructive migration* (dropped or renamed column, narrowed type): the
  previous release will not work against the new schema. The options are roll
  **forward** with a fix, or restore from backup and lose everything written
  since. This is why destructive changes are done in two releases — add and
  dual-write, then remove a release later — and why a single-release drop is
  worth blocking in review.

## Database

### Connect

```bash
$ psql "$DATABASE_URL"
# or, against the local compose stack
$ docker compose exec db psql -U erp -d erp
```

### Apply migrations

```bash
$ DATABASE_URL=... npm run db:migrate
```

Idempotent: Drizzle records applied migrations and takes an advisory lock, so
running it twice is a no-op and two replicas running it together serialise. CI
proves this by applying every migration twice on every build.

### Generate a migration

```bash
$ npm run db:generate          # diffs the Drizzle schema, writes SQL
$ $EDITOR packages/db/drizzle/ # READ IT. drizzle-kit will write DROP COLUMN.
```

Committing a schema change without its migration fails CI — the pipeline runs
`drizzle-kit generate` after applying and fails on any diff.

### Check the obvious things

```sql
-- Connections against the ceiling. The limit that bites first.
SELECT count(*) AS used, current_setting('max_connections')::int AS max
FROM pg_stat_activity;

-- Anything blocked?
SELECT pid, state, wait_event_type, wait_event, now() - query_start AS runtime,
       left(query, 80) AS query
FROM pg_stat_activity
WHERE state <> 'idle' ORDER BY query_start;

-- Slowest statements (needs pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 1) AS ms, left(query, 100)
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- Table sizes, largest first
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
```

### Kill a runaway query

```sql
SELECT pg_cancel_backend(<pid>);     -- polite: asks it to stop
SELECT pg_terminate_backend(<pid>);  -- DESTRUCTIVE: drops the connection
```

Try cancel first. Terminate rolls back the transaction, which for a long write
means the rollback itself may take a while.

## Users and access

### Someone cannot sign in

Work down this list; it is ordered by how often each is the answer.

1. **Account locked?** Repeated failures lock the account for a cooling-off
   period. `SELECT locked_until, failed_login_count FROM users WHERE email = $1;`
2. **Wrong organization?** An email exists once per organization.
3. **Membership inactive?** `SELECT status, role FROM memberships WHERE user_id = $1;`
   Authorization re-reads membership on *every* request, so a deactivated member
   loses access immediately.
4. **`PASSWORD_PEPPER` changed?** Then *no* password verifies, for anyone. This
   is a rotation incident, not a user problem — see
   [secrets management](../03-security/secrets-management.md).

### Force-revoke a user's sessions

Access tokens are stateless and live 15 minutes, so revocation means killing the
refresh tokens and waiting out the access token.

```sql
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
```

For an immediate cut-off, also set the membership inactive — that is checked on
every request:

```sql
UPDATE memberships SET status = 'inactive'
WHERE user_id = $1 AND organization_id = $2;
```

### Promote or demote a member

Through the API (`PATCH /api/v1/organization/members/:userId/role`), so the
change is audited and the escalation guard applies — nobody can grant a role
above their own, and `owner` can only be granted by an `owner`.

Direct SQL bypasses `canAssignRole` and writes no audit row. Use it only when
the API is unavailable, and write down that you did.

### The last owner left

The API refuses to remove or demote the last owner (`assertNotLastOwner`), so
this should not happen. If it has — through direct SQL — promote someone:

```sql
UPDATE memberships SET role = 'owner'
WHERE organization_id = $1 AND user_id = $2;
```

## Secrets

### Rotate `JWT_SECRET`

**Effect:** every access and refresh token becomes invalid. Every user is signed
out. No data is lost.

Deploy the new value and roll the API. Users sign in again. Do it during a quiet
window unless you are rotating *because* of a compromise, in which case do it
now.

### Rotate `PASSWORD_PEPPER`

**DESTRUCTIVE.** The pepper is an input to every stored password hash. Changing
it means no existing password can verify — every user must reset.

This is not routine maintenance. It is a break-glass response to a confirmed
pepper compromise, and it requires a password-reset flow for every user before
you start.

## Storage

```bash
# Local driver
$ du -sh /var/lib/erp/storage

# Orphan check: keys on disk with no documents row.
# Compare, then delete by hand. Never write a script that deletes from storage
# based on a query you have not eyeballed.
```

Document deletion is soft (`deleted_at`) and leaves the object in place, so a
mistaken delete is recoverable. Hard deletion for data-subject requests is a
separate, deliberate procedure — [data privacy](../03-security/data-privacy.md).

## The AI assistant

### Disable it

Set `AI_PROVIDER=mock` and roll the API. The assistant keeps answering with the
deterministic stub instead of calling a provider; nothing else in the product is
affected, because the agent's tools are ordinary API callers.

Use this when provider costs spike, the provider is down, or you need the
outbound dependency gone during an incident.

### Check what it has been doing

```sql
SELECT date_trunc('hour', created_at) AS hour,
       count(*) AS messages,
       sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
FROM ai_messages
WHERE organization_id = $1 AND created_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1;
```

Every agent action also lands in `audit_logs` with the acting user, because the
agent acts *as* the user and inherits their permissions — it cannot read
anything they could not.

## Logs

```bash
# Errors, readable
$ docker compose logs api | jq -c 'select(.level >= 50) | {t:.time, msg, err:.err.message, req:.requestId}'

# One request, end to end
$ docker compose logs api | grep "$REQUEST_ID"

# Slow requests
$ docker compose logs api | jq -c 'select(.responseTime > 500) | {url:.req.url, ms:.responseTime}'
```

Secrets are redacted before serialization (`apps/api/src/lib/logger.ts`).
If you find yourself wanting to remove a redaction to debug something, get the
value from the client side instead — the removal will get committed.

## Scheduled work

| Task | Frequency | Why |
| --- | --- | --- |
| Verify a backup **by restoring it** | Monthly | A backup you have not restored is a hypothesis |
| `npm audit --audit-level=high` | Every build, and weekly on `main` | Advisories land on unchanged code |
| Review `audit_logs` for denied actions | Weekly | `succeeded = false` rows are the interesting ones |
| Prune expired refresh tokens | Monthly | Table growth only; no correctness impact |
| Review error budget | Monthly | [Service levels](service-levels.md) |
| Rotate `JWT_SECRET` | Annually, or on suspicion | Limits the value of an old leak |

## Escalation

If you are following this page during an outage and it does not cover what you
are seeing, stop and switch to [incident response](incident-response.md). The
first step there is to declare, because the most expensive failure mode is one
person quietly trying things for forty minutes.
