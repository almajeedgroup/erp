# Analytics

Six read-only reports over the modules beneath. The module contributes no data
of its own — its entire value is that **every number the product reports is
defined exactly once**.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/analytics/routes.ts` |
| Metrics | `apps/api/src/modules/analytics/metrics.ts` — the definitions |
| Tests | `analytics.test.ts` — 15 |
| UI | `/analytics`, and the `/dashboard` summary |

## Why one file

Two dashboards disagreeing about "revenue" is the classic ERP failure, and the
cure is not better dashboards. It is one definition, in one file, that
everything else calls — the API, the UI, and the AI agent's `revenue_summary`
tool all read the same function, so they cannot drift.

## The definitions

These are the ones to argue about. Once they are settled, the code is
mechanical.

| Term | Definition | The choice it encodes |
| --- | --- | --- |
| **Revenue** | Issued invoice totals (`issued`, `partially_paid`, `paid`) whose **issue date** falls in the period | **Accrual, not cash.** Money is earned when the invoice is issued, not when it is collected |
| **Expenses** | `approved` and `paid` expenses **incurred** in the period | A submitted claim is not yet a cost of doing business |
| **Profit** | Revenue − expenses | Gross, not net. No overhead allocation |
| **Accounts receivable** | Issued invoice totals − payments, **all time** | A balance, not a flow, so the period does not apply to it |
| **Overdue** | The receivable portion past its due date | Derived at read time |
| **Labour cost** | Logged minutes × each employee's **cost rate** | Cost, not billable rate. The gap between them is the margin |

**Draft and void invoices are excluded** from revenue everywhere. A draft is not
a claim on anyone, and a void invoice is a claim that was withdrawn.

**Accrual versus cash matters most at quarter boundaries.** An invoice issued on
31 March and paid on 5 April counts as March revenue and April cash. Both views
exist in the product — revenue is accrual, the cash-flow forecast is cash — and
[revenue, profit and cash flow](../01-business/revenue-profit-and-cash-flow.md)
explains why a profitable business still runs out of money.

## Single currency, by exclusion

Every report takes a currency and **excludes** amounts in other currencies
rather than converting them.

That is a deliberate refusal. Converting requires a rate source, a policy on
which date's rate applies, and somewhere to put the FX gain or loss — three
decisions that should not be made implicitly by a reporting function. A number
that quietly used yesterday's rate is worse than a number that says "SAR only",
because only one of them is honest about what it means.

The upgrade path is a rate table with dated rows and an explicit conversion
date. Until then, an organization billing in two currencies runs two reports.

## The reports

| Endpoint | What it answers |
| --- | --- |
| `GET /api/v1/analytics/overview` | Revenue, expenses, profit, AR, overdue — the dashboard row |
| `GET /api/v1/analytics/revenue` | Revenue over time, bucketed by day/week/month/quarter |
| `GET /api/v1/analytics/project-profitability` | Per project: revenue − labour − expenses |
| `GET /api/v1/analytics/receivables-aging` | `current / 1-30 / 31-60 / 61-90 / 90+` by days overdue |
| `GET /api/v1/analytics/cash-flow` | 13-week forecast from due dates and committed costs |
| `GET /api/v1/analytics/pipeline` | Client counts by status and by acquisition channel |

All require `analytics:read`.

### Project profitability

```
profit = revenue − labour cost − direct expenses
```

Revenue is invoices attributed to the project. Labour is logged minutes valued at
the **cost rate** — not the billable rate, which would make every project look
like it had no cost. Expenses are those tagged to the project.

This is the report that depends most on the rest of the system being disciplined:
if time is not logged, labour cost is zero and the project looks wildly
profitable. The number is only as good as the timesheets behind it, and that is
worth saying out loud to whoever reads it.

### Receivables aging

Buckets by days past due. `agingBucket()` in `modules/finance/totals.ts` is the
ladder — `<= 0` is `current`, then `<= 30`, `<= 60`, `<= 90`, then `90+`.

33 days overdue is `31-60`. The tests pin exactly 30 and exactly 31, because a
ladder like this is where an off-by-one hides, and because this exact boundary
has already produced one wrong bug report — see
[debugging](../06-engineering/debugging.md#a-worked-example).

### Cash-flow forecast

Thirteen weeks. Inflow from open invoices at their due dates; outflow from
approved expenses. A running balance accumulates across the weeks.

Two decisions inside it:

- **Buckets are materialised first**, then filled. An empty week shows as zero
  rather than vanishing, which is the difference between a chart showing a quiet
  fortnight and a chart silently omitting it.
- **Anything already overdue lands in the first bucket.** Overdue money is due
  *now*, not at a point in the past — and a forecast that places it in the past
  is a forecast with money that never arrives.

It is a forecast from due dates, not a prediction from payment behaviour. A
client who always pays 20 days late will make it optimistic every week.

## Who can do what

| Role | Read | Export |
| --- | --- | --- |
| owner | ✓ | ✓ |
| admin | ✓ | ✓ |
| finance | ✓ | ✓ |
| manager | ✓ | — |
| viewer | ✓ | — |
| member | — | — |

A manager sees the reports and cannot export them; `analytics:export` is
reserved for the roles that already see everything, because a CSV leaves the
system's access control behind the moment it is downloaded.

`member` has no analytics access at all — the aggregate view reveals
organization-wide financial position, which is not part of an individual
contributor's job.

## How it is computed

**Aggregation happens in Postgres**, not in JavaScript. `SUM`, `GROUP BY` and
date predicates run in the database; the service sums a handful of grouped rows
rather than fetching thousands and adding them up. Moving rows over the wire to
count them is the N+1 problem's quieter sibling.

**Every query is scoped**, like everywhere else. An organization's dashboard
aggregates its own rows and nothing else.

**No caching, no materialised views.** Reports are computed per request. Honest
at this scale, and the first thing to change under read pressure — with the
caveat that a materialised dashboard is a dashboard *as of* a timestamp, and
needs to say so on screen. See
[system design](../06-engineering/system-design.md#stage-3--read-pressure-on-postgres).

## Edges

- **← [Finance](finance.md)** — revenue, expenses, AR, aging
- **← [Projects](projects.md)** — logged time for labour cost
- **← [Employees](employees.md)** — cost rates
- **← [Clients](clients.md)** — pipeline by status and acquisition channel
- **→ [AI agent](ai-agent.md)** — `revenue_summary` calls the same functions, so
  the assistant cannot invent a different definition of revenue

## Not built

- **No multi-currency consolidation.** As above — needs a dated rate table.
- **No budgets or forecasts against plan.** Actuals only; there is nothing to
  compare them to.
- **No cohort or retention analysis.** No MRR, churn or expansion — the model
  is project-based rather than subscription-based, so those metrics would need
  definitions this product does not have.
- **No scheduled reports.** Nothing is emailed; everything is pulled.
- **No drill-down.** A revenue figure does not link to the invoices behind it,
  which is the single most-requested feature in any reporting UI.
- **No net profit.** Overhead is not allocated to projects, so "profit" here is
  always gross.
