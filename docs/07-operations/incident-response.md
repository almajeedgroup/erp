# Incident response

An incident is any unplanned event that degrades the service for users, or any
suspected compromise of data or credentials. The goal of this page is to make
the first ten minutes boring.

## The first ten minutes

1. **Declare.** Say "I am declaring an incident" somewhere other people will
   see. The most expensive failure mode in a small team is one person quietly
   trying things for forty minutes while everyone else assumes it is fine.
2. **Take the Incident Lead role**, or hand it to someone. One person
   coordinates; everyone else reports to them.
3. **Assess severity** (table below). When in doubt, pick the higher one — it is
   cheap to downgrade and expensive to have under-called.
4. **Start a timeline.** One document, append-only, timestamped, including the
   things that turned out to be wrong. This is the artefact the review is built
   from, and nobody reconstructs it accurately afterwards.
5. **Stop the bleeding before you diagnose.** Roll back, disable the feature,
   shed the load. Understanding *why* is the review's job, not the incident's.
6. **Tell customers** if it is Sev 1 or Sev 2. Before they tell you.

## Severity

| Sev | Meaning | Examples | Response |
| --- | --- | --- | --- |
| **1** | Service down, or data exposed/lost | API returning 5xx for everyone; a cross-tenant leak; the database is gone | Immediate, all hands, customers told within the hour |
| **2** | Major function broken for many users | Invoices cannot be issued; sign-in failing for one organization; uploads failing | Immediate during working hours, customers told same day |
| **3** | Degraded, with a workaround | The assistant is down; analytics stale; one report wrong | Next working day |
| **4** | Minor, cosmetic | A label is wrong; a chart axis is off | Normal backlog |

**Any suspected data breach is Sev 1**, whatever its apparent size. A
cross-tenant leak affecting one record is still a breach, still notifiable, and
still needs the clock started.

## Roles

In a small team one person often holds several. Say out loud which ones.

- **Incident Lead** — decides, delegates, keeps the timeline. Does *not* debug;
  the moment the lead is head-down in `psql`, coordination stops.
- **Operations** — makes the changes: rollback, restart, failover. The only
  person touching production, so two people cannot undo each other.
- **Communications** — status page, customer email, internal updates. Writes in
  plain language, commits to a next-update time and keeps it.
- **Scribe** — appends to the timeline, including the dead ends.

## Diagnosis order

Work from the outside in; it is faster than guessing, and it is the same
sequence every time so it can be followed under pressure.

```bash
# 1. Is the API alive at all?
curl -fsS https://api.example.com/health

# 2. Can it serve? (this one checks the database)
curl -fsS https://api.example.com/ready

# 3. What is erroring, and since when?
docker compose logs --since 30m api | jq -c 'select(.level >= 50) | {t:.time, msg, err:.err.message, req:.requestId}' | tail -50

# 4. Is it everyone, or one organization?
#    Group the errors by organizationId. A single-tenant blast radius points at
#    data, not infrastructure.

# 5. Database
```
```sql
SELECT count(*) AS used, current_setting('max_connections')::int AS max FROM pg_stat_activity;
SELECT pid, state, wait_event_type, wait_event, now() - query_start AS runtime, left(query, 80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;
```

**Then the question that resolves most incidents:** *what changed?* A deploy, a
migration, a config change, a certificate expiry, a dependency upgrade, a
provider incident, a tenant importing ten thousand rows. Check the deploy log
before theorising.

## Common incidents

### The API is returning 5xx for everyone

- **Database unreachable.** `/ready` fails, `/health` passes. Check the database
  is up, check connection count against `max_connections`, check credentials did
  not rotate underneath you.
- **Connection pool exhausted.** Requests queue and time out. `pg_stat_activity`
  shows connections at the ceiling. Restarting the API frees them and buys time;
  the real fix is a leaked connection or a long transaction.
- **A bad deploy.** Errors start at a deploy timestamp. Roll back — the previous
  image tag is in the deploy record, which is why
  [the runbook](runbook.md#deploy) makes recording it step 1.

### Everyone is signed out

`JWT_SECRET` changed. Every token is invalid by design. Confirm the intended
value is deployed, then let users sign in again. Nothing is lost.

### Nobody can sign in, but sessions still work

`PASSWORD_PEPPER` changed. No stored hash can verify. Restore the previous
pepper immediately — this is not a situation to "roll forward" through, because
the alternative is resetting every password.

### Suspected cross-tenant data exposure

**Sev 1. Treat as a breach until proven otherwise.**

1. Capture evidence first: the request id, the response, the account, the
   timestamp. Do not let a restart destroy the logs.
2. Find the query. Every business read goes through `scope()`
   (`packages/db/src/tenancy.ts`); a leak means either a query that bypassed it
   or an id taken from the request rather than the token.
3. Determine the blast radius from `audit_logs` — which rows, for which
   organizations, read by whom, over what period.
4. Contain: disable the endpoint, or take the service down. A Sev 1 leak
   outranks availability.
5. Fix, with a test that fails against the vulnerable code.
6. Notify. [Data privacy](../03-security/data-privacy.md) covers obligations and
   timelines.

### Credential compromise

1. Rotate the credential. Everything else waits.
2. Revoke sessions: `UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;`
   Access tokens expire within 15 minutes.
3. Read `audit_logs` for what the credential did while compromised. `succeeded =
   false` rows show what was attempted and refused, which is often the clearest
   picture of intent.
4. Work out how it leaked. A rotated secret that leaks the same way again is not
   a fix.

### The AI assistant is failing or expensive

Sev 3 — it is not load-bearing. Set `AI_PROVIDER=mock` and roll the API. The
assistant degrades to the deterministic stub; the rest of the product is
untouched, because the agent's tools are ordinary API callers with no privileged
path.

### Slow, but up

Usually one query without an index, or one tenant doing something unusual.
`pg_stat_statements` ordered by `mean_exec_time` names it. `EXPLAIN (ANALYZE,
BUFFERS)` says why. A `Seq Scan` or a `Sort` where you expected `Index Scan` is
the answer.

## Communicating

Three updates, minimum: when you declare, when you know something, when it is
over. Between them, update on a schedule you commit to — "next update in 30
minutes" — and keep it even when the update is "no change".

**Say what users can observe**, not what you are doing internally:

> **Investigating** — Some users are unable to issue invoices. Sign-in and all
> other functions are working normally. Next update by 14:30 UTC.

Not "a migration deadlocked on invoice_counters". Nobody outside the team knows
what that means, and it invites speculation.

Never speculate about cause while the incident is open. "We believe this was
caused by X" during an incident is wrong often enough to cost more trust than
the outage.

## Closing

Declare it over only when the service is verified healthy — not when the error
rate drops. Say so on the same channels, and say whether a follow-up is coming.

## The review

Within a week, for every Sev 1 and Sev 2. Blameless, and mean it: people who
expect blame hide information, and the information is the entire point.

Cover:

- **Timeline.** What happened, when, including the wrong turns.
- **Impact.** Who was affected, for how long, what they could not do.
- **Cause.** Not "human error" — a person making a mistake is a given; the
  question is what let the mistake reach production.
- **What went well.** Detection, rollback, communication. Worth knowing which
  parts to keep.
- **Actions.** Each with an owner and a date. An action item with neither is a
  wish.

The best action items make the failure *impossible* rather than *less likely*:
a constraint, a type, a test, a check in CI. The `drizzle-kit generate` drift
check in the pipeline is one of these — it exists because schema-migration drift
is a class of deploy failure that is now unshippable rather than merely
discouraged.

## Contacts

| Role | Who | How |
| --- | --- | --- |
| Incident Lead (default) | Engineering lead | _fill in_ |
| Database | _fill in_ | _fill in_ |
| Cloud/hosting support | _fill in_ | _fill in_ |
| Data protection | _fill in_ | _fill in_ |
| Legal (breach notification) | _fill in_ | _fill in_ |

**Fill this table in before you need it.** An incident is the worst possible
time to discover nobody knows who the hosting account owner is. The blanks are
left visible here on purpose, rather than filled with plausible placeholders
that would read as complete.
