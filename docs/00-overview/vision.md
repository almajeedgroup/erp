# Vision

## What this is

A system of record for a mid-sized contracting and consulting business. It
holds the clients, the work, the people, the money, the documents and the tasks
in one place, and it can answer questions about all of them.

The problem it solves is not "we need software". It is the specific, expensive
mess that every business of thirty to three hundred people arrives at: clients
in a CRM, projects in a spreadsheet, timesheets in a second spreadsheet,
invoices in accounting software, contracts in a shared drive, and nobody able
to answer "is the Metro project actually profitable?" without a day of
reconciliation.

The value is in the joins. Any of these modules exists as a better standalone
product. What none of them can do alone is tell you that a project is 90% of
the way through its budget with 40% of the scope delivered, because that fact
lives across three systems.

## Who it is for

The primary user is a **delivery manager or owner** in a business that sells
people's time and expertise. Concretely:

- 30–300 employees
- Project-based revenue, often a mix of fixed-price and time-and-materials
- Invoices in the thousands to hundreds of thousands, not millions of small
  transactions
- Operating in one or a few currencies, usually with VAT
- Already has accounting software they are not going to replace

The secondary users are the people whose work feeds it: engineers logging time,
finance issuing invoices, an auditor reading the trail.

## What it deliberately is not

Saying no is most of what makes a system coherent.

**Not accounting software.** There is no general ledger, no chart of accounts,
no double-entry bookkeeping, no tax filing. It tracks receivables and spend
because those are operational facts a manager needs daily. The books stay in
the accounting package, and the integration is an export.

**Not payroll.** It holds compensation because project margin is meaningless
without labour cost. It does not run payroll, calculate statutory deductions or
file anything.

**Not a CRM.** Clients have a status and an acquisition channel because those
are the denominators for the pipeline and CAC reports. There is no deal stage
machinery, no email sequencing, no lead scoring.

**Not a document management system.** Files are attached to records and can be
found and cited. There is no versioning, no check-out, no approval workflow, no
e-signature.

**Not real-time collaboration.** Two people editing the same invoice is handled
by refusing the second write, not by merging. That is the right trade for
financial records.

**Not multi-region.** One database, one region. The systems that need to be
closer to the user are read-heavy consumer products, which this is not.

## The three rules

Everything else follows from these.

### 1. It is a system of record, so nothing is quietly lost

Financial and HR rows are soft-deleted, never removed. An issued invoice is
immutable — corrections happen through a void and a re-issue, so both documents
survive. Every state change writes an audit row, in the same transaction as the
change, including the attempts that were denied.

The cost is a schema full of `deleted_at` and a table that only grows. The
benefit is that "what happened to invoice 0042?" always has an answer.

### 2. Money is never approximate

Every amount is an integer count of minor units plus a currency code. There is
no float and no `numeric` in the schema. Quantities are stored in thousandths
and tax rates in basis points, so a line total is integer arithmetic end to end.
Amounts in different currencies are never added; in reports they are excluded
rather than converted at a rate nobody chose.

The cost is that every amount needs unpacking for display. The benefit is that
the total on screen is the total in the database is the total the client was
sent.

### 3. One tenant can never see another

Every business table carries `organization_id`, every query is scoped by it, and
the scoping is written in exactly one file
([`packages/db/src/tenancy.ts`](../../packages/db/src/tenancy.ts)). Lookups by
id match id *and* organization in the same predicate, so a leaked id from
another tenant returns nothing, and the API reports 404 rather than 403 — it
never confirms that another organization's record exists.

This is the property with the least tolerance for error. A slow page is an
annoyance; a cross-tenant read is the end of the business.

## Success, concretely

The product is working if:

- A manager can answer "is this project profitable?" in under a minute, without
  opening a spreadsheet.
- Finance can tell, at a glance, what is owed and how late it is.
- An auditor can reconstruct any figure from the audit log.
- Someone can ask the assistant a question in plain language and get an answer
  that cites the record it came from.
- A new engineer can go from clone to a running system with the seeded demo
  data in one command.

That last one is not a vanity metric. A system nobody can run locally is a
system nobody improves.

## Where this goes next

In rough order of value, with the reason each is not built yet:

1. **Invoice PDF generation and email.** Needs a template system and a mail
   transport, both of which are real dependencies with real failure modes.
2. **Draft an invoice from approved time entries.** The data model supports it
   (`time_entries.invoiced_invoice_id` exists and is enforced); the workflow does
   not exist yet.
3. **Multi-currency consolidation.** Needs a rate table with dated rows and a
   policy on which rate applies to which figure. Guessing is worse than
   excluding, which is what happens today.
4. **Receipt OCR into expenses.** See
   [vision and speech](../05-ai/vision-and-speech.md) for what it would cost.
5. **Email invitations with single-use tokens.** Today an administrator sets an
   initial password directly; this needs a mail transport.
6. **Object storage driver.** The interface exists and the local driver is
   complete; S3 fails at boot with a clear message rather than pretending.
