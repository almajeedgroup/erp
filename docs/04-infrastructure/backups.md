# Backups

A backup you have not restored is a hypothesis, not a backup.

## What needs backing up

| Data | Where | Criticality |
| --- | --- | --- |
| Database | Postgres | **Total.** Everything except document bytes |
| Document bytes | Object storage | High. The rows referencing them are in the database |
| Secrets | Secret manager | High. Recoverable by regeneration, but that means a forced password reset |
| Application code | Git | Low. Distributed by nature |
| Container images | Registry | Low. Rebuildable from a tag |

## RPO and RTO

The two numbers that define a backup strategy.

**RPO — recovery point objective.** How much data you can afford to lose,
measured in time. An RPO of one hour means accepting that an hour of work can
vanish.

**RTO — recovery time objective.** How long you can afford to be down.

| Scenario | Target RPO | Target RTO |
| --- | --- | --- |
| Database corruption | 5 minutes | 1 hour |
| Accidental deletion | 5 minutes | 2 hours |
| Region failure | 1 hour | 4 hours |
| Complete loss | 24 hours | 24 hours |

These drive everything else. A five-minute RPO requires continuous archiving,
not a nightly dump.

## Database

### Managed backups

Every managed Postgres offers automated backups with point-in-time recovery.
Configure:

| Setting | Value |
| --- | --- |
| Automated backups | On |
| Retention | 30 days minimum |
| Backup window | Off-peak |
| Point-in-time recovery | On |
| Cross-region copy | Yes for production |

Point-in-time recovery is the feature that matters. It continuously archives the
write-ahead log, so you can restore to any moment within the retention window —
not just to whenever the last snapshot ran.

**That is what makes a five-minute RPO achievable**, and it is also what makes
"restore to the moment before the bad migration" possible.

### Logical dumps as well

PITR restores to a new instance of the same engine version. A logical dump is
portable — to a different version, a different provider, or a laptop.

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > erp-$(date +%F).dump
```

Weekly, retained for a year, encrypted, in a separate account. It is the answer
to "we need to move providers" and to "we need to inspect last quarter's data
without touching production".

### What a backup contains

Everything. Every tenant's data, every password hash, every national id — with
none of the application's access control in front of it.

A backup is a complete copy of your most sensitive asset in a place with
different security properties from the database. Treat it accordingly:

- Encrypted at rest and in transit, always
- A separate IAM role from the application; ideally a separate account
- Every restore and download logged
- Bounded retention — an unbounded backup archive is an unbounded liability
  under data-protection law

## Object storage

Object storage is durable but **not backed up by default**. It protects against
hardware failure, not against someone deleting an object.

| Control | What it protects against |
| --- | --- |
| Versioning | Accidental overwrite or delete |
| Object lock / retention | Deliberate deletion, including by a compromised credential |
| Cross-region replication | Regional failure |
| Lifecycle rules | Cost, by moving old objects to cheaper storage |

Versioning plus a lifecycle rule that expires non-current versions after 90 days
is the sensible default.

## The restore procedure

Written out because "restore the backup" is not a procedure.

### Database, to a point in time

1. **Stop writes.** Scale the API to zero, or put it in maintenance mode.
   Restoring while writes continue produces a split brain.
2. **Identify the target time.** From the incident timeline — usually the moment
   before the bad deploy or the destructive query. The audit log is the primary
   source for this.
3. **Restore to a new instance.** Never over the top of the existing one; the
   existing one is evidence, and you may need it.
4. **Verify.** Connect and check: row counts per table, the most recent audit
   row, a known invoice's total, the migration journal.
5. **Switch.** Update `DATABASE_URL`, restart the API.
6. **Reconcile.** Work between the restore point and now is gone. Identify it
   from the audit log and application logs, and communicate it specifically —
   "invoices issued between 14:05 and 14:50 need re-entering" is actionable;
   "some data may be missing" is not.

### Documents

If a document row exists but its bytes do not, restore from a version or from
the replica. The audit log records every upload and delete, which is what makes
reconciliation possible.

### Secrets

Secret managers version secrets; restore the previous version. If a secret is
genuinely lost:

- `JWT_SECRET` — generate a new one. Everyone is logged out, and recovers by
  signing in
- `PASSWORD_PEPPER` — **there is no recovery.** Every password hash becomes
  unverifiable and every user must reset. This is why it belongs in a managed
  secret store with versioning, not in a file on a server

## Testing restores

The part everyone skips, and the only part that turns a hypothesis into a
backup.

| Cadence | Test |
| --- | --- |
| Monthly | Restore to a scratch instance, run the verification queries |
| Quarterly | Full drill: restore, point a staging API at it, exercise the application |
| Annually | Cross-region restore, timed against the RTO |

Record the time each takes. An RTO you have never measured is a guess, and the
first time you measure it should not be during an incident.

## What is not backed up, deliberately

- **Application logs.** Retained per the logging policy, not backed up. They are
  diagnostic, not a system of record
- **Container images.** Rebuildable from a git tag
- **Local development databases.** Recreated with `npm run db:seed`

## Monitoring

Backups fail silently, which is the worst property a backup can have:

- Alert on any failed backup job
- Alert if the most recent successful backup is older than expected
- Alert if backup size changes by more than 50% — a sudden drop can mean a
  partial dump; a sudden rise can mean a runaway table
- Monthly report of restore-test results

## Related

[Disaster recovery](../07-operations/disaster-recovery.md) covers the scenarios
these backups exist to answer.
