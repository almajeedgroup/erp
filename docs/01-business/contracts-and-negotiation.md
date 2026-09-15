# Contracts and negotiation

The commercial terms that matter, which of them become fields in this system,
and how to negotiate the ones that do not.

## Two kinds of contract

This product sits on both sides of a contractual relationship:

1. **The customer's contracts with their clients** — the projects, rates and
   payment terms the system tracks.
2. **The vendor's contract with the customer** — the SaaS agreement under which
   this software is sold.

Both matter, and they have different shapes.

## Terms that become fields

Some contractual terms are operational facts the system needs:

| Term | Field | Why it matters daily |
| --- | --- | --- |
| Payment terms | `clients.payment_terms_days` | Sets every due date, drives the cash forecast |
| Billing currency | `clients.billing_currency` | Amounts are never mixed across currencies |
| Tax registration | `clients.tax_number` | Legally required on the invoice |
| Contract value | `projects.budget` | The number a fixed-price project is measured against |
| Rate | `projects.hourly_rate` | What time is worth |
| Billing model | `projects.billing_type` | Decides how revenue is recognised and how an invoice is drafted |
| Dates | `projects.start_date`, `end_date` | Delivery commitments |
| Purchase order | `invoices.purchase_order` | Many corporate clients will not pay without it |

Capturing these as structured fields rather than leaving them in a PDF is what
makes the system useful. The PDF goes in Documents; the terms that drive
behaviour become columns.

## Terms that do not become fields

Equally important and deliberately not modelled, because modelling them would
imply the system enforces them:

- Scope and deliverables
- Intellectual property ownership
- Liability caps and indemnities
- Termination rights and notice periods
- Confidentiality
- Dispute resolution and governing law

These live in the contract document. The system stores the document and links it
to the client or project.

## Terms worth negotiating hard — customer side

### Payment terms

The single most valuable term in a services contract, and the most negotiable.

Net 30 rather than net 60 halves the working capital requirement. On £200,000 a
month of billing that is £200,000 of cash that stays in the business.

What works:
- **Ask.** Many clients have a default they will move off if asked.
- **Trade it.** A 2% discount for net 14 is often cheaper than financing the gap.
- **Milestones.** 30% on signature, 40% at midpoint, 30% on completion turns one
  large late payment into three smaller earlier ones.
- **Late-payment interest.** Often statutory, rarely enforced — but including it
  changes the conversation at day 60.

### Scope and change control

The mechanism that decides whether a fixed-price project is profitable.

Without a written change process, "small additions" accumulate until the margin
is gone and nobody can point to when it happened. With one, each change is
priced and either paid for or declined.

This is why `projects.billing_type` matters operationally: a fixed-price project
with creeping scope is the most common way a services business loses money, and
the profitability report is what makes it visible in month two rather than month
eight.

### Liability caps

Standard is a cap at fees paid, or 12 months of fees. Uncapped liability on a
£50,000 project is an existential risk for a small firm, and it is usually
negotiable because the client's own lawyer knows the cap is conventional.

## Terms worth negotiating hard — vendor side

Selling software to businesses, these come up:

### Data ownership and export

The customer owns their data. Say so plainly and early. Commit to export in a
machine-readable format on request and on termination.

Counter-intuitively, making it easy to leave makes people more willing to
arrive.

### Uptime commitments

A customer will ask for an SLA. What to offer:

| Commitment | Reality |
| --- | --- |
| 99.9% | 43 minutes of downtime a month. Achievable with a managed database and two replicas |
| 99.95% | 22 minutes. Needs genuine redundancy and practised failover |
| 99.99% | 4 minutes. Multi-region, and a different cost structure entirely |

Do not commit to a number you have not measured. Offer 99.9% with service
credits as the remedy, and instrument it — see
[service levels](../07-operations/service-levels.md).

### Security commitments

A buyer trusting you with payroll will ask about encryption, access control,
breach notification, and sub-processors. Having the answers written down
([the security documentation](../03-security/)) turns a two-week security review
into a one-hour call.

Commit to what is true. "We encrypt data at rest and in transit, enforce
role-based access, maintain an audit log, and will notify you within 24 hours of
becoming aware of a breach affecting your data" is specific and honest. "We take
security seriously" is neither.

### Auto-renewal and price increases

Annual with auto-renewal, 30 days' notice to cancel, and price increases capped
at a stated percentage with 60 days' notice. Predictable for them, predictable
for you, and it avoids the renewal conversation becoming a renegotiation.

## Negotiation principles

**Know your walk-away before you start.** A contract you regret is worse than
one you did not sign. For a vendor, the walk-away is usually a term that makes a
customer unprofitable to serve — unlimited liability, a bespoke deployment, a
committed feature date.

**Trade, do not concede.** "We can do net 30 if we move to annual billing." A
concession given for nothing teaches the other side that asking works.

**Price is rarely the real objection.** "Too expensive" usually means "I am not
convinced of the value" or "I do not have budget authority". Ask which.

**Get it in writing.** Verbal agreements in a good-faith relationship become
disputes when the person who made them leaves.

**The relationship outlasts the negotiation.** In a market where customers refer
each other, winning a negotiation and losing the relationship is a bad trade.

## Red flags

| Flag | Why |
| --- | --- |
| Payment terms beyond 60 days | They are financing themselves with your money |
| No cap on liability | One dispute ends the business |
| Unlimited revisions or support | Unbounded cost against fixed revenue |
| "We'll sort the paperwork later" | The paperwork never gets sorted; disputes do |
| Payment contingent on their client paying | You are financing their receivables |
| A committed feature date to close a deal | Distorts the roadmap for a year; they churn when it slips |
