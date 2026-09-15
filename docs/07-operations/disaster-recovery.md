# Disaster recovery

Backups are a hypothesis. A restore is the experiment. This page is about the
experiment.

Related: [backups](../04-infrastructure/backups.md) covers how backups are
taken and stored; this page covers what to do when you need them.

## Objectives

| Term | Target | What it means here |
| --- | --- | --- |
| **RPO** — how much data may be lost | **5 minutes** | Continuous WAL archiving; point-in-time recovery to any moment |
| **RTO** — how long until service returns | **4 hours** | Provision, restore, verify, cut over |

These are targets, not measurements. **The RTO has not been demonstrated by a
timed drill.** Until it has, treat 4 hours as an estimate — and treat running
the drill as the highest-value item on this page.

Different scenarios have very different real recovery times, and the table below
says which.

## What must survive

| Asset | Where | Lose it and… |
| --- | --- | --- |
| PostgreSQL | Managed backups + WAL archive | The business stops. Everything is here |
| Documents | Object storage, versioned | Contracts and receipts gone; rows point at nothing |
| Secrets (`JWT_SECRET`, `PASSWORD_PEPPER`, database URL) | Secret manager, backed up separately | **Without the pepper, no password can ever verify again** |
| Code and migrations | Git, multiple remotes | Rebuildable, but the schema must match the data |
| Container images | Registry | Rebuildable from a tagged commit |

**The pepper is the one people miss.** A perfect database restore with a lost
`PASSWORD_PEPPER` means every user must reset their password, and you will
discover it at the worst moment. It belongs in the secret manager *and* in
offline escrow, and its recovery is the first step of every scenario below.
See [secrets management](../03-security/secrets-management.md).

## Scenarios

### 1. Bad data write — a wrong UPDATE or DELETE

*Most likely. Smallest blast radius. Usually the least dramatic fix.*

Most deletes in this system are **soft**: `deleted_at` is set and `scope()`
filters the row out. Recovery is an `UPDATE` setting it back to `NULL`, and no
restore is involved:

```sql
UPDATE clients SET deleted_at = NULL
WHERE organization_id = $1 AND id = $2;
```

For a genuine bad write, `audit_logs` holds `before` and `after` snapshots of
changed fields, so the previous values are recoverable without touching a
backup:

```sql
SELECT created_at, actor_user_id, action, before, after
FROM audit_logs
WHERE organization_id = $1 AND resource_type = 'invoice' AND resource_id = $2
ORDER BY created_at DESC;
```

If the damage is wide, restore to a scratch instance at a point in time *just
before* the write, extract the affected rows, and copy them across. Do not
restore over production to fix a handful of rows — the collateral loss is
everything written since.

**RTO: minutes.**

### 2. Database corruption or loss

Point-in-time recovery, to just before the event.

```bash
# Managed Postgres (RDS / Cloud SQL / Supabase): restore to a new instance
#   at a chosen timestamp. Never restore in place — you want the old instance
#   intact until the new one is verified.

# Self-managed, from base backup + WAL:
$ pg_basebackup -D /var/lib/postgresql/restore -h backup-host -U replicator
# recovery.signal + restore_command, then:
#   recovery_target_time = '2026-09-15 13:45:00+00'
#   recovery_target_action = 'promote'
```

Then, before any traffic:

```sql
-- Does the schema match the code you are about to deploy?
-- Drizzle records applied files in __drizzle_migrations; \dt *.__drizzle_migrations
-- will tell you which schema it landed in on this instance.
SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;

-- Do the row counts look like a working system?
SELECT 'organizations' t, count(*) FROM organizations
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'documents', count(*) FROM documents;

-- Spot-check the most recent write you expect to exist
SELECT id, number, status, created_at FROM invoices ORDER BY created_at DESC LIMIT 5;
```

Point the API at the new instance, roll, verify `/ready`, then verify a real
read and a real write through the UI.

**RTO: 1–4 hours**, dominated by restore time, which scales with database size.
Know roughly how long yours takes *before* you need the number.

### 3. Object storage loss

Document rows survive in Postgres; the bytes do not. Versioned object storage
with soft delete means an accidental delete is recoverable from a prior version.

The failure worth naming is **partial** loss: rows pointing at keys that no
longer exist. Find them by listing keys and comparing against `storage_key` in
`documents`. A download for a missing object fails cleanly — the service raises
a dependency error rather than serving a zero-byte file — but users see broken
documents until it is reconciled.

**RTO: hours**, depending on volume.

### 4. Region or provider loss

The severe case, and the one this system is least prepared for.

- Database: restore from backups into another region. If backups are
  cross-region replicated, this is scenario 2 with a longer copy. **If they are
  not, this is unrecoverable** — check today, not during the incident.
- Object storage: cross-region replication, or accept the loss.
- Containers: images are in a registry; rebuild from the tagged commit.
- DNS: point records at the new region. **Lower the TTL first** — a 3600-second
  TTL means an hour of stale resolution you cannot shorten once the incident
  has started. Keeping the record at 300 seconds costs nothing in normal
  operation.

**RTO: 4–24 hours.** Being honest about that is more useful than claiming four.

### 5. Ransomware or a malicious insider

The scenario backups are usually *not* designed for, because the attacker
targets the backups too.

Requirements: backups **immutable** for their retention period (object lock /
write-once), stored under credentials the production role cannot use, and at
least one copy offline or in a separate account.

Recovery: restore to a *clean* environment from a backup predating the
compromise, rotate every secret, and rebuild containers from source rather than
reusing images. Assume anything writable from the compromised credential is
compromised — including the migration history.

**RTO: days**, most of it spent establishing what the last clean point was.

## The restore drill

**Monthly. Non-negotiable.** A backup nobody has restored is a hypothesis with a
cron job attached.

```
1. Provision a scratch database.
2. Restore the most recent backup into it.
3. Time it. Write the number down — this is your real RTO.
4. Verify:
   - migration table matches the current release
   - row counts are plausible
   - the newest row is within RPO of the backup timestamp
   - point the API at it locally and sign in as a seeded user
5. Destroy the scratch instance.
6. Record the date, the duration, and anything that went wrong.
```

Step 3 is the one that matters. Everything else confirms the backup is valid;
step 3 tells you whether the RTO on this page is real.

### Drill log

| Date | Scenario | Restore time | Result | Notes |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | **No drill has been run. The RTO above is an estimate.** |

The row is left empty on purpose. A recovery document that implies drills have
happened when they have not is worse than one that admits the gap, because it
produces confidence that is not backed by anything.

## Why there are no down migrations

A deliberate decision, and it changes what rollback means.

Down migrations look like insurance and are rarely usable. A migration that
drops a column cannot restore its data going down; one that transforms values is
rarely exactly reversible; and the down path is almost never tested, so it is
run for the first time during an incident, against production, under pressure.

Instead:

- **Additive changes roll back trivially** — the previous release ignores a new
  column or table.
- **Destructive changes are split across two releases.** Add the new column and
  write to both; remove the old one a release later, after the intermediate
  release has been running long enough to be confident. Each release is
  individually rollback-safe.
- **When something genuinely must be undone**, it is a forward migration written
  with knowledge of what actually happened — or a point-in-time restore.

This shifts the cost to review time, where there is more of it. A single-release
destructive migration is the thing to block in review.

## Order of recovery

When several things are broken, restore in dependency order:

1. **Secrets** — without `PASSWORD_PEPPER` the restore is much less useful.
2. **Database** — everything else is meaningless without it.
3. **Object storage** — the product works without it; documents do not.
4. **API**, then **web**.
5. **DNS**, last, so traffic arrives at something verified.

Verify at each step before starting the next. Cutting DNS over to a stack you
have not checked turns a recovery into a second incident.
