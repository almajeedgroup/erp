# Business model

What kind of business this software is, and what follows from that.

## SaaS, and what the letters actually mean

Software as a Service: the customer pays for access, not for a copy. You run it,
you maintain it, you upgrade it, and they pay periodically for as long as it is
useful to them.

The structural consequences are more interesting than the definition:

| Property | Consequence |
| --- | --- |
| Revenue is recurring | You can forecast. A good month does not have to be repeated from zero next month |
| Cost of serving is ongoing | Gross margin matters. Every customer costs you something every month, forever |
| The customer can leave | Churn is a permanent tax on growth. Retention is a growth lever, not an afterthought |
| You control the deployment | You can ship weekly. You also carry the pager |
| One codebase, many customers | A fix helps everyone. A bug hurts everyone |

That last row is the whole economic argument for SaaS, and the whole operational
argument against being careless.

### The alternatives, and why not them

**Perpetual licence.** The customer buys a version and owns it. Revenue is
lumpy, every customer runs a different version, and supporting five versions
means fixing every bug five times. Still right for software that must run in an
air-gapped environment.

**On-premise with a support contract.** The middle ground. You get recurring
revenue and the customer gets control of their data. The cost is that you cannot
debug their instance, you cannot deploy a fix, and your support load scales with
customer count rather than with product complexity. Worth offering only when a
large regulated customer will not accept anything else — and then priced to
cover what it genuinely costs.

**Open source with paid hosting.** Real distribution advantages and a genuine
community. Wrong for a vertical business tool: the addressable audience is
operations managers at contracting firms, not developers, and they will not
self-host.

## B2B, specifically

This is sold to businesses, not consumers. Almost every meaningful decision
differs.

| | B2C | B2B (this) |
| --- | --- | --- |
| Buyer | The user | Often not the user — an owner buys, a manager uses |
| Deal size | £10s/month | £100s–£1,000s/month |
| Sales cycle | Minutes | Weeks to months |
| Acquisition | Marketing at scale | Sales, referral, partnership |
| Churn | 3–5%/month is normal | 1%/month is bad |
| Support | Self-serve, forums | Named contact, response times |
| Requirements | Broad, shallow | Narrow, deep, occasionally non-negotiable |

The most important row is the first. **The person who pays is often not the
person who uses it.** An owner buys because they cannot see project
profitability; a project manager uses it every day and cares about whether
logging time takes ten seconds or two minutes.

Both have to be satisfied. A product the buyer loves and the users resent gets
cancelled at renewal, because the users stop entering data and the reports stop
being true. A product the users love and the buyer cannot justify never gets
bought.

### What B2B changes in the product

- **Roles and permissions are table stakes**, not a premium feature. A business
  has a finance person and a delivery lead and they need different access. This
  is why the RBAC matrix exists on day one.
- **An audit trail is a purchase requirement.** "Who changed this?" gets asked
  in the evaluation, not after the incident.
- **Data export is a purchase requirement.** Nobody buys a system they cannot
  leave. Making export easy is counter-intuitively pro-retention: it removes the
  fear that makes people not buy.
- **Multi-tenancy must be genuinely airtight**, because your customers are
  sometimes each other's competitors.
- **Integration matters more than features.** They already have accounting
  software. Replacing it is not on the table; talking to it is.

## Where this sits in the market

The honest competitive picture:

| Approach | What they do well | Where the gap is |
| --- | --- | --- |
| Spreadsheets | Free, infinitely flexible, everyone knows them | No audit trail, no access control, breaks at scale, one person owns the file |
| Point solutions (Harvest, Asana, Xero) | Excellent at one thing | The join is manual. Nobody can answer a cross-cutting question |
| Large ERPs (SAP, NetSuite, Odoo) | Complete, configurable, proven | Six-figure implementations, months of consulting, far more than a 50-person firm needs |
| **This** | The join between modules, at a size a 50-person firm can adopt in a week | Narrower than a large ERP, by design |

The wedge is the join. A business does not buy "a project tool"; it buys the
ability to answer "is this profitable?" without a day of reconciliation.

The risk is obvious and worth naming: the gap between "point solutions plus
spreadsheets" and "real ERP" is exactly where products go to be
underwhelming-at-everything. The defence is depth in the join — profitability,
utilisation, receivables aging — rather than breadth in each module.

## Who it is for, and who it is not

**Good fit:** 30–300 people, project-based revenue, a mix of fixed-price and
time-and-materials, invoices in the thousands to hundreds of thousands, one or a
few currencies, and an existing accounting package they will not replace.

**Bad fit:** under 10 people (a spreadsheet genuinely is fine, and honesty here
buys credibility); product companies without projects; anyone needing statutory
payroll; anyone needing inventory or manufacturing; anyone needing a general
ledger.

Saying no to a bad-fit prospect is the highest-leverage sales activity there is.
They churn, they consume support, and they ask for features that make the
product worse for everyone else.

## The moat, such as it is

Software features are not a moat; they are a roadmap for competitors. What
actually compounds:

1. **Data gravity.** After a year, the system holds the history. Leaving means
   losing it or migrating it, and migration is what nobody has time for.
2. **Workflow embedding.** When time entry, expense approval and invoicing all
   run through it, replacing it means retraining everyone.
3. **The integration surface.** Each accounting or payment integration built is
   one a competitor must also build.
4. **Trust.** In a system holding payroll, reliability and a clean security
   record compound. This is slow and cannot be bought.

None of these exist at launch. They are the reason retention matters more than
acquisition in year two.

## How the product supports the business model

Concretely, what is in the code because of the model:

- **Multi-tenancy from the first commit**, because retrofitting isolation is a
  rewrite.
- **The audit log**, because B2B buyers ask for it during evaluation.
- **RBAC with six roles**, because a business has distinct jobs.
- **`clients.acquisition_channel`**, because you cannot measure CAC by channel
  without the denominator, and it costs one column to capture.
- **Analytics that the vendor also needs** — the aging report a customer uses on
  their receivables is the one this business uses on its own.
