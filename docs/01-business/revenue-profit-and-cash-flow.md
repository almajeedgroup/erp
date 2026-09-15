# Revenue, profit and cash flow

Three numbers that people use interchangeably and that mean entirely different
things. Businesses fail with all three positive except the last.

## The distinction

| | Question | Timing | Can it kill you? |
| --- | --- | --- | --- |
| **Revenue** | What did we earn? | When earned (accrual) | Only by being absent |
| **Profit** | What did we keep? | Same period as the revenue | Slowly |
| **Cash flow** | What actually moved? | When money moves | **Immediately** |

The classic failure: a profitable business with a full order book that cannot
make payroll, because its customers pay in 60 days and its staff are paid in 30.
Profit is an opinion about a period. Cash is a fact about a bank account.

## Revenue

### Accrual, not cash

This product recognises revenue when an invoice is **issued**, not when it is
paid. An invoice issued on 28 March for £50,000 is March revenue even if the
money arrives in May.

That is the accrual basis, and it is right because it matches revenue to the
period in which the work was done. Cash-basis revenue would show a company that
did nothing in March and had a spectacular May, which tells you nothing about how
the business is performing.

The cost is that revenue and cash diverge, which is exactly why the cash-flow
forecast exists as a separate report.

### The definition in code

```
revenue = Σ total_amount
  WHERE status IN ('issued', 'partially_paid', 'paid')
    AND issue_date BETWEEN :from AND :to
    AND currency = :reporting_currency
    AND deleted_at IS NULL
```

Defined once, in
[`apps/api/src/modules/analytics/metrics.ts`](../../apps/api/src/modules/analytics/metrics.ts).
Every revenue figure in the product — dashboard tile, chart, project margin —
comes from that definition. Two dashboards disagreeing about revenue is the
classic ERP failure, and the cure is one definition rather than better
dashboards.

Drafts are excluded: a draft is not a claim on anyone. Voided invoices are
excluded: they were withdrawn.

### For the vendor: MRR and ARR

The metrics a subscription business runs on, which this product does not compute
for itself but which its own business needs:

| Metric | Meaning |
| --- | --- |
| MRR | Monthly recurring revenue — normalised monthly subscription value |
| ARR | MRR × 12 |
| New MRR | From customers won this month |
| Expansion MRR | From existing customers upgrading |
| Contraction MRR | From downgrades |
| Churned MRR | From cancellations |
| Net new MRR | New + expansion − contraction − churned |

**Net revenue retention** — `(starting MRR + expansion − contraction − churn) ÷
starting MRR` — is the single most informative number for a B2B SaaS. Above
100% means the business grows without winning a single new customer, which is
what investors are really buying.

## Profit

### The layers

```
Revenue
  − Cost of goods sold (hosting, support, third-party per customer)
= Gross profit                         ← the money available for everything else
  − Sales and marketing
  − Research and development
  − General and administrative
= Operating profit (EBIT)
  − Interest, tax, depreciation, amortisation
= Net profit
```

**Gross margin is the number that decides whether a software business is a
software business.** Above 75% and growth is fundable; below 60% and you are a
services company with a login page, which is a fine business but a different one
with different economics.

### What this product computes

Gross profit, in the customer's own terms:

```
gross_profit = revenue − approved_expenses
gross_margin = gross_profit ÷ revenue        (null when revenue is zero)
```

The `null` is deliberate. A margin on no revenue is undefined, and reporting 0%
puts a misleading number on a dashboard.

Approved expenses only. A submitted-but-unapproved claim is not yet a cost of
doing business, and counting it would let anyone move the company's reported
profit by filing an expense.

### Project profitability

The report the whole product exists for:

```
margin = billed_revenue − labour_cost − direct_expenses
labour_cost = Σ (minutes ÷ 60 × employee.cost_rate)
```

Labour is valued at **cost rate**, not billable rate. The question is what the
work cost the company, not what it was sold for. Confusing the two makes every
project look profitable — the most common and most expensive error in a services
business.

Time logged by someone with no cost rate on file contributes zero cost, and
therefore shows as suspiciously high margin. That is the honest outcome: a
visible gap is better than an invented rate.

## Cash flow

### Why it is separate

Revenue is a promise. Cash is a fact. The gap between them is your receivables,
and it is where services businesses die.

A firm issuing £200,000 of invoices a month on net-45 terms is carrying roughly
£300,000 of working capital at any moment. If a large client goes to 90 days,
that becomes £450,000 — money that must come from somewhere while payroll runs
monthly.

### The three kinds

| Kind | What it covers |
| --- | --- |
| Operating | The business itself — collections in, payroll and suppliers out |
| Investing | Buying or selling assets |
| Financing | Raising or repaying capital, dividends |

For a services business, operating cash flow is nearly everything.

### What this product computes

A thirteen-week direct-method forecast: open receivables placed in the week they
fall due, less approved-but-unpaid expenses in the week they were incurred.

Deliberately simple, and documented as such. No payment-behaviour weighting, no
recurring commitments, no payroll projection. A more sophisticated model —
"this client historically pays 12 days late" — is genuinely better and needs
payment history the product does not yet have enough of.

Anything already overdue lands in week one, because overdue money is due now,
not at a point in the past.

### Receivables aging

The operational companion:

| Bucket | Meaning |
| --- | --- |
| Current | Not yet due |
| 1–30 | Late, chase politely |
| 31–60 | Late, chase firmly |
| 61–90 | A problem; escalate |
| 90+ | Assume you may not get it |

Two firms with identical revenue and radically different health look identical
until you see this chart.

### The levers

In order of how quickly they work:

1. **Invoice immediately.** The single biggest one. An invoice sent on the 1st
   rather than the 15th is paid two weeks earlier, forever. This is why drafting
   an invoice needs to be fast.
2. **Shorter terms.** Net 30 rather than net 60 halves the working capital
   requirement. Negotiable more often than people assume.
3. **Deposits and milestones.** 30% up front on a fixed-price project funds the
   work.
4. **Chase early.** A polite reminder at day 3 past due is far more effective
   than a firm one at day 45. The overdue report exists for this.
5. **Annual billing.** For the vendor: twelve months of cash on day one, and a
   renewal decision once a year rather than twelve times.

## The three together

A worked example, because the interaction is the point:

```
March:  issued £180,000, costs £120,000
        Revenue £180,000 · Profit £60,000 · Cash −£120,000

April:  issued £200,000, costs £130,000, collected £180,000 (March, net 30)
        Revenue £200,000 · Profit £70,000 · Cash +£50,000

May:    issued £150,000, costs £140,000, collected £90,000 (one client slipped)
        Revenue £150,000 · Profit £10,000 · Cash −£50,000
```

Three profitable months. Cash negative in two of them, and a £120,000 swing in
the first. A business with less than that in the bank on 1 March does not reach
1 April, regardless of its order book.

This is why the dashboard shows revenue, receivable and overdue receivable
side by side rather than revenue alone.
