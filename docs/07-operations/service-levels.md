# Service levels

What "working" means, stated numerically, so that a decision about whether to
ship a risky change or spend a week on reliability has something to reference.

**Status: proposed, not measured.** The targets below are the ones this system
should be held to. No instrumentation is currently collecting them, so no error
budget has been spent or earned. Wiring up the SLIs is the prerequisite for
every number here meaning anything, and it is called out at the end.

## The vocabulary

- **SLI** — a service *level indicator*: a number you measure. "Fraction of API
  requests returning a non-5xx status."
- **SLO** — a service level *objective*: the target for that number. "99.9%
  over 30 days."
- **Error budget** — `100% − SLO`. At 99.9% over 30 days, that is **43 minutes**
  of allowed failure. It is a budget in the real sense: something to be spent
  deliberately, on releases and risky changes, not merely avoided.
- **SLA** — a contractual commitment with money attached. There is no SLA here.
  Do not sign one for numbers you have not been measuring for months.

The distinction that matters: an SLO is an internal engineering target and can
be missed. An SLA is a promise to a customer. Setting the SLO tighter than the
SLA is what gives you warning before the promise breaks.

## Proposed objectives

| # | SLI | SLO | Window | Budget |
| --- | --- | --- | --- | --- |
| 1 | Availability — non-5xx share of API requests | 99.9% | 30 days | 43 min |
| 2 | Latency — p95 of read endpoints | < 300 ms | 30 days | — |
| 3 | Latency — p95 of write endpoints | < 800 ms | 30 days | — |
| 4 | Sign-in success — non-5xx share of `POST /auth/login` | 99.95% | 30 days | 22 min |
| 5 | Durability — data loss events | 0 | always | 0 |
| 6 | Assistant availability | 99% | 30 days | 7.2 h |

Notes on each, because the number alone is not the decision:

**1 — Availability.** Measured at the API, counting 5xx only. A 4xx is the
system working: a 403 means authorization functioned, a 422 means validation
functioned. Counting them would mean a client sending bad requests could burn
the budget.

**2 and 3 — Latency.** Separated because they are different systems. Reads are a
keyset-paginated index scan; writes take locks and, for invoice numbering,
serialise within an organization. Holding both to one number would either make
the read target too loose or the write target impossible.

p95, not average. An average hides the tail, and the tail is what users notice
and remember.

**4 — Sign-in.** Broken out because it is the endpoint where failure means
*total* loss of service for that user. Everything else can be retried from a
working session; this one cannot. It gets the tightest objective.

**5 — Durability.** Zero, and not negotiable — this is an ERP. An availability
incident is a bad day; a durability incident is an existential one, because the
data is the product. See [disaster recovery](disaster-recovery.md).

**6 — The assistant.** Deliberately loose. It depends on an external model
provider, it is an assistive feature rather than a load-bearing one, and
`AI_PROVIDER=mock` degrades it without touching anything else. Holding it to
99.9% would mean either an availability budget consumed by someone else's
outage, or over-engineering a feature nobody's invoicing depends on.

## What is deliberately excluded

- **Scheduled maintenance**, announced 48 hours ahead. It should be rare; the
  architecture supports rolling deploys with no downtime, so a maintenance
  window is a signal something needs fixing.
- **Client-side network failures.** Not observable, not actionable.
- **Model provider outages**, for SLIs 1–4. They are covered by SLI 6.

## Using the budget

The budget exists to be spent. That is the whole idea — a team with a large
unspent error budget is shipping too slowly, and a team that has exhausted it is
shipping too recklessly.

| Budget remaining | What it means |
| --- | --- |
| > 50% | Healthy. Ship. Take on risky changes deliberately |
| 10–50% | Normal. Ship, with care around migrations and auth |
| < 10% | Reliability work only. No non-critical deploys until the window rolls |
| 0% | Freeze. Only fixes that improve reliability |

Two failure modes this is designed to prevent: the team that never ships because
any risk feels unacceptable, and the team that ships through a month of
degradation because nobody was counting.

## Measuring it

None of this is instrumented yet. What is needed:

**SLIs 1–4** come from request logs, which already exist. Every log line carries
`responseTime`, the status code and the route, so the aggregation is a query
away once logs reach somewhere queryable. Roughly:

```
availability = count(status < 500) / count(*)
latency_p95  = percentile(responseTime, 0.95) grouped by route, split read/write
```

**SLI 4** is the same aggregation filtered to `POST /api/v1/auth/login`.

**SLI 5** is not a measurement; it is a claim verified by the monthly restore
drill in [disaster recovery](disaster-recovery.md) — which has not yet been run.

**SLI 6** needs per-call outcome recording on the model provider path. The
`ai_messages` table records tokens but not failures; failures would need their
own counter.

[Monitoring](../04-infrastructure/monitoring.md) covers the instrumentation.

## Alerting

Alert on **symptoms users feel**, not on causes.

| Alert | Condition | Why |
| --- | --- | --- |
| API down | `/ready` failing for 2 minutes | Users see nothing working |
| Error rate | 5xx > 5% for 5 minutes | Burning budget fast |
| Latency | p95 > 2× objective for 10 minutes | Degraded, before it is down |
| Sign-in failing | `/auth/login` 5xx > 1% for 5 minutes | Total loss for new sessions |
| Budget burn | On track to exhaust the month in < 3 days | Time to intervene |
| Database connections | > 80% of `max_connections` | The ceiling that bites first |
| Backup failed | Any failed backup job | Silent until you need it |
| Certificate expiry | < 14 days | Wholly avoidable, still common |

**Do not alert on CPU.** High CPU with good latency is a machine doing its job.
The alert that pages someone for a healthy server is the alert that teaches them
to ignore pages — and a team that ignores pages has no alerting at all.

Every alert must be **actionable**. If the response is "look at it and see", it
is a dashboard, not an alert.

## Reporting

Monthly, one page: the six numbers, budget consumed, incidents with their
durations, and what changed. Keep the history — the trend answers questions the
snapshot cannot, such as whether reliability work actually worked.
