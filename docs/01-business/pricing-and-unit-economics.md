# Pricing and unit economics

How the product would be priced, and the arithmetic that says whether the
business works.

## What you are actually pricing

Not the software. The value it creates, which for this product is:

- Hours not spent reconciling spreadsheets
- Invoices sent on time rather than three weeks late
- Unprofitable projects caught in month two rather than month eight
- An answer to "where is our money?" that does not take a day

For a 50-person firm, one unprofitable project caught early is worth more than a
year of licence fees. That is the number to anchor on — not the cost of hosting.

## Pricing models

| Model | Mechanics | Fits when | Problem |
| --- | --- | --- | --- |
| Per seat | £X per user per month | Value scales with headcount | Customers ration seats, which starves the data and breaks the reports |
| Per active seat | Billed on who logged in | Same, fairer | Unpredictable for the buyer; they hate surprises |
| Flat tier | £X per month for a band | Simple, predictable | A 30-person and a 90-person firm pay the same |
| Usage-based | Per invoice, per project | Aligns with value | Punishes growth; the customer's success costs them money |
| Hybrid | Platform fee + seats | Captures both | More to explain |

**The per-seat trap is the one to think hardest about.** If finance is charged
for every user, they will buy ten seats for a fifty-person firm, and then forty
people will not log time. The data goes stale, the reports go wrong, the product
stops being useful, and they churn — blaming the product, correctly.

For a system whose value depends on everyone entering data, seat-based pricing
is structurally hostile to the product working.

## The recommended shape

**A platform fee by band, with unlimited users.**

| Tier | Band | Monthly | Includes |
| --- | --- | --- | --- |
| Starter | Up to 25 people | £300 | All modules, unlimited users, email support |
| Growth | 26–100 | £800 | Plus the AI assistant, API access, priority support |
| Scale | 101–300 | £2,000 | Plus SSO, custom roles, a named contact |
| Enterprise | 300+ | Quoted | Plus on-premise option, audit support, contractual SLAs |

Why this shape:

- **Unlimited users** means everybody enters data, which means the product works,
  which means they renew. This is the single most important pricing decision.
- **Bands by headcount** track value: a bigger firm gets more out of it and can
  pay more.
- **Annual billing at a 15–20% discount** improves cash flow materially and
  reduces churn, because a cancellation decision happens once a year rather than
  twelve times.
- **The AI assistant above Starter** because it has real marginal cost and is a
  genuine upgrade reason.

## Unit economics

The arithmetic that decides whether this is a business.

### Definitions

| Term | Formula | Meaning |
| --- | --- | --- |
| ARPA | Total revenue ÷ accounts | Average revenue per account |
| COGS | Hosting + support + third-party per customer | What serving them costs |
| Gross margin | (ARPA − COGS) ÷ ARPA | The money available for everything else |
| CAC | Sales + marketing spend ÷ customers won | What winning one costs |
| Churn | Customers lost ÷ customers at start | Monthly or annual |
| Lifetime | 1 ÷ churn rate | How long they stay |
| LTV | ARPA × gross margin × lifetime | What one is worth |
| Payback | CAC ÷ (ARPA × gross margin) | Months to recover acquisition |

### A worked example

Assume the Growth tier at £800/month and reasonable numbers for a B2B SaaS at
this stage:

```
ARPA                          £800/month
COGS                          £60/month   (hosting £25, support £30, AI £5)
Gross margin                  92.5%
Gross profit per account      £740/month

CAC                           £4,000      (sales time, marketing, onboarding)
Monthly churn                 1.5%
Average lifetime              67 months   (1 ÷ 0.015)

LTV                           £49,580     (740 × 67)
LTV : CAC                     12.4 : 1
Payback period                5.4 months  (4,000 ÷ 740)
```

### The benchmarks

| Metric | Healthy | Concerning | This example |
| --- | --- | --- | --- |
| Gross margin | > 75% | < 60% | 92.5% ✓ |
| LTV : CAC | > 3 : 1 | < 1 : 1 | 12.4 : 1 ✓ |
| Payback | < 12 months | > 24 months | 5.4 ✓ |
| Monthly churn | < 2% | > 5% | 1.5% ✓ |
| Net revenue retention | > 100% | < 90% | depends on expansion |

**LTV:CAC above 5:1 usually means you are under-investing in sales**, not that
you are brilliant. If every pound of acquisition returns twelve, spend more
pounds. The number to optimise is absolute gross profit, not the ratio.

### Sensitivity — where it actually breaks

The same model with pessimistic assumptions:

```
Churn at 4%/month instead of 1.5%:
  Lifetime 25 months → LTV £18,500 → LTV:CAC 4.6:1   still viable
CAC at £12,000 instead of £4,000 (enterprise-style selling):
  LTV:CAC 4.1:1, payback 16 months                    tight but survivable
Both:
  LTV:CAC 1.5:1, payback 16 months                    not a business
```

The lesson is the usual one and it is worth internalising: **churn compounds
against you far more than CAC does.** Halving churn doubles LTV. Halving CAC
improves the ratio once.

## What drives COGS in this system

| Component | Cost | Notes |
| --- | --- | --- |
| Database | £15–40/month/customer at low scale | Falls sharply with shared-schema tenancy |
| Compute | £5–15 | Two small containers serve many tenants |
| Object storage | £1–5 | Documents are small and infrequently read |
| AI | £0–20 | The variable one. See below |
| Support | £20–50 | Dominant at low scale, falls with product maturity |

**Shared-schema multi-tenancy is a gross-margin decision as much as a technical
one.** A database per tenant would multiply the largest line item by customer
count. That trade is recorded in
[ADR-0002](../02-architecture/adr/0002-shared-schema-multi-tenancy.md), and the
isolation cost it accepts is why so much of the security documentation exists.

**AI cost needs watching.** It is the only component that scales with usage
rather than with customer count. The controls already in the code — a tight rate
limit, a hard agent step ceiling, per-message token accounting in the audit log —
exist so that a heavy user is visible before they are expensive.

## Pricing mistakes to avoid

**Pricing off cost.** Cost sets a floor, not a price. If it costs £60 to serve
and saves them £5,000, £300 is not generous.

**Launching too cheap.** Raising prices on existing customers is painful and
grandfathering is expensive. Starting high and discounting is easy; the reverse
is not.

**Too many tiers.** Three or four. Seven produces analysis paralysis and a sales
conversation about feature matrices rather than value.

**Charging for the audit log, SSO or export.** These are trust features. Charging
for the audit log says "pay extra to know what happened in your own system",
which is a bad thing to say to someone evaluating whether to trust you with
payroll. SSO in the top tier is defensible because it genuinely serves larger
organizations; the others are not.

**Never raising prices.** A 5–7% annual increase, announced with the year's
improvements, is normal and expected. Never raising prices means the product
gets relatively cheaper every year while costs rise.
