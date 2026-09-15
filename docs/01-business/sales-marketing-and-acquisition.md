# Sales, marketing and customer acquisition

How a product like this reaches the businesses that need it — and what the
product captures so the answer can be measured rather than guessed.

## The funnel

```
Awareness      they learn the problem has a solution
   ↓  ~2%
Interest       they visit, read, think "that's us"
   ↓  ~15%
Evaluation     demo, trial, questions about security and export
   ↓  ~30%
Purchase       a decision, usually by someone who is not the daily user
   ↓  ~90%
Onboarding     data in, team trained, first invoice issued from it
   ↓
Retention      it becomes how they work
   ↓
Expansion      more seats, higher tier, referral
```

The conversion rates are illustrative. The shape is not: **onboarding is part of
acquisition, not part of support.** A customer who signs and never gets their
data in has not been acquired; they have been lent money that will be refunded
at renewal.

## Channels

| Channel | CAC | Cycle | Scales? | Fit here |
| --- | --- | --- | --- | --- |
| Referral | Lowest | Shortest | No — bounded by customer count | **Best.** Highest trust, highest retention |
| Outbound | High | Long | Yes, linearly with headcount | Works for a defined vertical |
| Content / inbound | Medium, falling | Medium | Yes, compounds | Slow to start, cheapest at scale |
| Partnerships | Medium | Long | Somewhat | Accountants and consultants advising this audience |
| Events | High | Medium | No | Trade-specific ones can be efficient |
| Paid search | High | Short | Yes, with money | Small intent volume for a niche category |

For a vertical B2B tool the realistic mix in year one is referral plus outbound,
with content started early because it takes eighteen months to compound and
starting late means it is late forever.

**Referral deserves the emphasis.** Contracting and consulting firms in a region
know each other. A recommendation from a peer collapses the evaluation stage:
the trust question is already answered. Which means the product's job in
acquisition is largely to make existing customers willing to recommend it, and
that is a retention activity.

## What the product captures

`clients.acquisition_channel` exists so CAC by channel is measurable rather than
anecdotal:

```
referral · outbound · inbound · partner · event · marketplace · other
```

Paired with `acquired_at` and the pipeline report, that gives:

- Customers won per channel per period
- With marketing spend tagged by channel in `expenses`, CAC per channel
- Conversion rate per channel, from the client status distribution

One column, captured at the moment the information is known, answering a
question that is otherwise unanswerable six months later. The same reasoning
applies generally: capture the dimension when it is free, not when you need the
report.

## Positioning

The sentence to get right:

> **For** operations managers at 30–300 person project businesses
> **who** cannot see whether their projects are actually profitable,
> **this** is an operations system
> **that** joins clients, projects, time, money and documents in one place,
> **unlike** point tools that each do one thing well and none of them together,
> **because** the answer lives in the join, not in any single module.

What makes it credible in that market:

- **The join.** Nothing else at this price answers cross-cutting questions.
- **Adoption in a week, not a quarter.** A large ERP is a project; this is a
  purchase.
- **An honest security posture.** A buyer trusting you with payroll will ask.
  Being able to hand them a threat model and a Top 10 mapping is a differentiator
  in a market where the usual answer is "we take security seriously".
- **Export without friction.** Nobody buys a system they cannot leave.

## The sales conversation

For a £10–25k annual contract the process is consultative but not enterprise:
two or three calls, a demo on their data shape, a trial, a decision.

**Discovery.** Before showing anything: how many projects, how do you price them,
how do you know if one is profitable, how long does invoicing take, who chases
late payment, what happens when someone leaves.

The last question is more revealing than it sounds. If the answer is "we lose
the spreadsheet", the pain is acute and the sale is short.

**Demo.** On their shapes, not the generic seed data. A fixed-price project and
a time-and-materials one, with their terminology. The moment that lands is
almost always the project profitability report.

**Objections, and honest answers.**

| Objection | The answer that works |
| --- | --- |
| "We already have Xero" | This does not replace it. It answers what Xero cannot: profitability per project |
| "Our spreadsheet works" | Until the person who owns it is on holiday, or leaves. What is the audit trail? |
| "Too expensive" | One unprofitable project caught early pays for a year. What did the last one cost? |
| "Our team won't use it" | Pricing is not per seat, so everyone gets access. Time entry takes ten seconds. Let's test that in the trial |
| "What about our data?" | Here is the security documentation. Export is one click. Here is the threat model |
| "We need feature X" | Either it exists, or it is on the roadmap with a date, or it is not being built and here is why. Never invent a date |

That last row is worth insisting on. A feature promised to close a deal becomes
a commitment that distorts the roadmap for a year, and the customer who was
promised it churns anyway when it slips.

## Onboarding

Where acquisition succeeds or quietly fails.

| Day | Milestone |
| --- | --- |
| 0 | Organization created, owner signed in |
| 1 | Clients and active projects imported |
| 3 | Team invited, roles assigned, first time entries logged |
| 7 | First invoice issued from the system |
| 14 | First month-end run through it |
| 30 | It is how they work |

The riskiest step is day 1. Manual entry of forty clients is a wall, and the
product's answer to it — a CSV import — is a gap worth closing before scaling
acquisition, because it is the difference between a trial that converts and one
that stalls.

## Marketing that fits this audience

**Content that is genuinely useful.** "How to calculate true project
profitability" — including the formula and the cost-rate-versus-billable-rate
trap — is read by exactly the person who should buy this, and it demonstrates
competence rather than asserting it.

**The security documentation as marketing.** Publishing a real threat model and
a real Top 10 mapping is unusual, and to a buyer who is about to trust you with
payroll it is a signal.

**Case studies with numbers.** "Reduced invoicing from three days to four hours"
beats "streamlined operations" by a distance.

**Not:** generic SaaS thought leadership, feature-comparison tables, or anything
that could be published by a competitor with the logo swapped.

## Metrics worth tracking

| Metric | Why |
| --- | --- |
| CAC by channel | Where to spend the next pound |
| Cycle length by channel | Cash flow planning |
| Trial-to-paid conversion | Product-market fit signal |
| Time to first invoice issued | The clearest leading indicator of retention |
| Net revenue retention | Whether the business grows without new customers |
| Referral rate | Whether customers are willing to stake their reputation on it |

The middle one deserves attention: **time to first invoice issued from the
system** predicts renewal better than any usage metric, because it is the point
at which the product has become load-bearing.
