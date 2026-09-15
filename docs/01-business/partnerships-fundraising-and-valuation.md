# Partnerships, fundraising and company valuation

Three topics that share a theme: they are all about what the business is worth
to someone else.

## Partnerships

### The kinds that actually work

| Type | Shape | Value |
| --- | --- | --- |
| **Integration** | Technical connection to a product the customer already uses | Removes a purchase objection. Highest value, lowest drama |
| **Referral** | An advisor recommends you, for a fee or goodwill | Warm introductions at low CAC |
| **Reseller** | A partner sells and supports; you build | Reach into a market you cannot cover |
| **Co-marketing** | Joint content, events, webinars | Cheap awareness, modest conversion |

For a product like this, integration and referral are the ones worth pursuing.
Reselling adds a layer between you and the customer at exactly the stage when
you most need to hear from them directly.

### Integration partners, in priority order

1. **Accounting software** (Xero, QuickBooks, Zoho, local equivalents). The most
   requested integration, because every prospect already has one and none of
   them will replace it. Invoices and approved expenses push out; payment status
   pulls back. This removes the single largest objection in the sale.
2. **Payment providers.** A pay-now link on an invoice measurably shortens
   collection, which is the metric the customer cares most about.
3. **Calendar and communication.** Time entry from calendar events removes the
   most-resented daily task.
4. **Document storage** (Google Drive, SharePoint). Meet the documents where
   they already live rather than asking for a migration.

### Referral partners

Accountants and management consultants advise exactly this audience, are trusted
by them, and are asked "how should we track this?" regularly.

What makes it work: they must understand the product well enough to know who it
fits, and — more importantly — who it does not. A referral partner who sends
bad-fit prospects burns their own credibility and yours.

### What to be careful about

**Exclusivity.** Almost never worth it. It caps your upside in exchange for a
promise of effort.

**Integrations that only one customer wants.** An integration is a permanent
maintenance commitment against someone else's API. Build it when several
customers want it, not when one asks loudly.

**Partnerships as a substitute for sales.** A partnership is a channel, not a
strategy. If direct sales does not work, a partner selling the same product will
not work either.

## Fundraising

### Whether to raise at all

The question people skip. Venture capital is not free money — it is money in
exchange for a commitment to grow at a rate that makes a venture return
possible, which is roughly 3× a year in the early years.

| Path | Fits when | Cost |
| --- | --- | --- |
| Bootstrap | Capital-efficient, reachable market | Slower. You keep control and all the upside |
| Revenue-based finance | Predictable recurring revenue | Expensive debt, but no dilution |
| Angel | Need £100–500k and industry expertise | Dilution, and a board seat you may regret |
| Seed VC | Need £1–3m and a credible large market | Dilution, plus an obligation to grow at venture pace |
| Series A+ | Proven repeatable sales, need to scale | More of the same |

A vertical B2B tool serving contracting firms in one region can be an excellent
£2–5m ARR business and a poor venture investment, because the market is not
large enough to return a fund. That is not a criticism of the business — it is a
reason to be honest about which path you are on, because taking venture money
for a business that cannot grow at venture pace ends badly for everyone.

### What investors actually examine

At seed stage, in order:

1. **The team.** Can these people build and sell this?
2. **The market.** Is it big enough, and is it growing?
3. **Traction.** Is anyone paying, and are they staying?
4. **Unit economics.** LTV:CAC, payback, gross margin. See
   [pricing and unit economics](pricing-and-unit-economics.md).
5. **The product.** Last, honestly. It is the most changeable thing on the list.

The metrics that get asked for:

| Metric | Seed expectation | Series A expectation |
| --- | --- | --- |
| ARR | £100k–500k | £1m–3m |
| Growth | 15–20% month on month | 100%+ year on year |
| Gross margin | > 70% | > 75% |
| Net revenue retention | > 90% | > 110% |
| Logo churn | < 3%/month | < 1.5%/month |
| CAC payback | < 18 months | < 12 months |

### The data room

What a diligence process asks for, and what this repository already provides:

| Requested | Where it comes from |
| --- | --- |
| Financial statements, cohort analysis | Accounting system |
| Customer contracts | Legal |
| Security posture | [The security documentation](../03-security/) |
| Architecture and technical risk | [Architecture and ADRs](../02-architecture/) |
| Code quality, test coverage | The repository itself |
| Key-person risk | Documentation quality — genuinely assessed |

The last row is worth stating: technical diligence assesses whether the system
can survive the departure of the person who built it. Documentation of the kind
in this repository is a direct answer to that, and its absence is a discount on
the valuation.

## Company valuation

### How software companies are valued

Not on profit, at least not early. On **revenue multiples**, adjusted for
growth, retention and margin.

```
Valuation ≈ ARR × multiple
```

The multiple depends on:

| Factor | Pushes the multiple up | Pushes it down |
| --- | --- | --- |
| Growth | 100%+ year on year | Under 30% |
| Net revenue retention | Above 120% | Below 90% |
| Gross margin | Above 80% | Below 60% |
| Churn | Under 1%/month | Over 3%/month |
| Market size | Large, growing | Niche, static |
| Concentration | No customer over 5% | One customer at 30% |
| Capital efficiency | Low burn per pound of ARR | High |

Typical ranges, which move with the market and should be treated as orientation
rather than fact:

| Profile | Multiple |
| --- | --- |
| High growth, high retention, large market | 10–20× ARR |
| Moderate growth, good retention | 5–10× ARR |
| Slow growth, or a small market | 2–5× ARR |
| Declining | 1–2× ARR, or an asset sale |

### The rule of 40

`growth rate % + profit margin % ≥ 40`.

A company growing 60% while losing 20% of revenue scores 40. So does one growing
10% with a 30% profit margin. Both are considered healthy; they are simply at
different stages.

Below 40 suggests you are neither growing fast enough to justify the burn nor
profitable enough to be self-sustaining — the uncomfortable middle.

### Other methods, and when they apply

**Discounted cash flow.** Project future cash flows, discount to present value.
Rigorous, and nearly useless for an early-stage company because the projections
are fiction. Appropriate for a mature, predictable business.

**Comparable transactions.** What similar companies sold for. Useful reality
check; the difficulty is that "similar" does a lot of work.

**Strategic value.** What an acquirer pays because it fills a hole in their
product, or removes a competitor. Often far above any financial model, and
entirely dependent on finding the right acquirer at the right time.

### What actually moves the number

For a business like this, in order of leverage:

1. **Reduce churn.** It compounds into every other metric. Halving churn doubles
   LTV, lifts net revenue retention, and lifts the multiple.
2. **Increase net revenue retention.** Above 100% means growth without new
   customers, which is the property investors pay most for.
3. **Grow faster, without destroying the economics.** Growth bought at a CAC
   payback of 36 months is not growth.
4. **Diversify customers.** One customer at 30% of revenue is a discount applied
   to the whole business.
5. **Reduce key-person risk.** Documentation, tests, and a team that can operate
   the system. This is the one engineering can act on directly, and it is why
   the repository looks the way it does.
