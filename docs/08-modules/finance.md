# Finance

Invoices, payments and expenses. The module that must be right, because its
numbers are what a client is billed and what a tax authority audits. Every rule
here exists because getting it wrong is expensive in a way no other module's
bugs are.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/finance/routes.ts` |
| Service | `apps/api/src/modules/finance/service.ts` |
| Arithmetic | `apps/api/src/modules/finance/totals.ts` — pure, no database |
| Tables | `invoices`, `invoice_lines`, `invoice_counters`, `payments`, `expenses` |
| Tests | `finance.test.ts` — 30, `totals.test.ts` — 17 |
| UI | `/invoices`, `/invoices/[invoiceId]`, `/expenses` |

## Money

Every amount in this system is an **integer count of minor units** with a
currency: 5,750.00 SAR is `{ amount: 575000, currency: 'SAR' }`. No floating
point touches money at any point, because `0.1 + 0.2 !== 0.3` and an ERP that
loses a halala per line loses a client's trust at the end of the month.

On the wire the amount is a **string** (`"575000"`), because a JSON number is a
float and a large enough total would lose precision in transit.

Inputs are exact too: quantities are stored as thousandths (`quantity_milli`,
7.5 hours → `7500`) and rates as basis points (`tax_rate_bp`, 15% → `1500`).
The API surface stays human — you send `quantity: 7.5` and `taxRate: 15` — and
converts once at the boundary.

[ADR-0003](../02-architecture/adr/0003-integer-minor-units-for-money.md) has the
full argument.

## Invoice arithmetic

`totals.ts` is pure functions over `Money`, with no database and no request in
sight, so the rules are exhaustively testable. Per line:

```
subtotal = quantity × unitPrice
discount = subtotal × discountRate          ← applied first
tax      = (subtotal − discount) × taxRate  ← then tax
total    = subtotal − discount + tax
```

**Discount before tax, and rounding per line, then sum.** Both are deliberate.
Tax authorities and every accounting package expect tax computed on the
discounted amount, and expect each line rounded before addition — taxing the
invoice subtotal instead gives an answer that differs by a halala often enough
to matter, and "our total disagrees with yours by 0.01" is a conversation nobody
wants to have monthly.

Splitting an amount across lines uses `allocate()`, which distributes remainder
units by largest remainder so the parts always sum to the whole.

**The client cannot supply totals.** The create schema has no such field, and
bodies are `z.strictObject`, so an attempt is a **422** rather than a silently
ignored key. Totals are computed server-side, always.

## Invoice lifecycle

```
draft ──▶ issued ──▶ partially_paid ──▶ paid
  │          │              │
  │          └──▶ void ◀────┘
  └──▶ cancelled
```

`INVOICE_TRANSITIONS` in `packages/shared/src/domain/finance.ts` is the whole
table, and `paid`, `void` and `cancelled` are terminal. An invalid transition is
a **412** naming the current status.

| Stage | What is true |
| --- | --- |
| `draft` | Freely editable. No number yet. Not a legal document |
| `issued` | Numbered, dated, sent. **Immutable** |
| `partially_paid` | At least one payment, balance outstanding |
| `paid` | Settled. Terminal |
| `void` | Cancelled after issue, leaving the number consumed and the record intact |
| `cancelled` | Abandoned before issue |

**Issued invoices are immutable.** Not a convention — a rule enforced in the
service. A document you have sent to a client and reported to a tax authority
cannot change afterwards; that is what void-and-reissue is for, and it is why
`void` keeps the row rather than deleting it.

**Issuing requires at least one line.** A zero-line invoice would consume a
number and mean nothing.

**The due date comes from the client's payment terms** at issue time, unless one
was set explicitly.

## Gapless numbering

Invoice numbers must have **no gaps** — several jurisdictions require it, and
auditors check.

```sql
SELECT prefix, next_number FROM invoice_counters
WHERE organization_id = $1 FOR UPDATE
```

The row lock is the mechanism. A second transaction issuing concurrently blocks
until the first commits or rolls back, and **a rollback returns the number
rather than burning it** — which a sequence would not do, because
`nextval()` is non-transactional by design.

The cost is that invoice issuance serialises within an organization. That is
accepted deliberately: organizations issue tens of invoices a day, not
thousands. See [system design](../06-engineering/system-design.md#stage-4--write-pressure)
for what to do if that ever stops being true.

Format: `INV-2026-0007`.

## Payments

A payment is recorded against an issued invoice, and the invoice's status
follows the balance automatically — `partially_paid` or `paid`.

Three refusals, all 412:

- **Wrong status** — "Cannot record a payment against a draft invoice"
- **Wrong currency** — "Payment must be in SAR; received USD"
- **Non-positive amount** — a negative payment is a credit note, which is a
  different document

**Currency is checked before any arithmetic.** This one was a real bug: the check
used to happen after `computeInvoice`, so a mixed-currency invoice threw
`CurrencyMismatchError` out of the money layer — not an `AppError`, therefore a
**500 instead of a 412**. `assertLinesMatchCurrency` now runs first, on both the
create and update paths, and the test asserts the status code rather than merely
"not 201".

## Expenses

Costs, categorised (`payroll`, `subcontractor`, `software`, `infrastructure`,
`travel`, `marketing`, `office`, `professional_services`, `taxes`, `other`),
optionally attached to a project so they land in profitability.

```
draft ──▶ submitted ──▶ approved ──▶ paid
                   └──▶ rejected
```

**You cannot approve your own expense.**

```
409 "An expense cannot be approved by the person who filed it"
```

This is segregation of duties, and it is the most-tested line in the module,
because it is the control that makes expense approval mean anything. Re-reviewing
an already-approved or paid expense is also a 409.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/invoices` | `invoice:read` |
| POST | `/api/v1/invoices` | `invoice:create` |
| GET | `/api/v1/invoices/:invoiceId` | `invoice:read` |
| PATCH | `/api/v1/invoices/:invoiceId` | `invoice:update` |
| POST | `/api/v1/invoices/:invoiceId/issue` | `invoice:issue` |
| POST | `/api/v1/invoices/:invoiceId/void` | `invoice:void` |
| POST | `/api/v1/invoices/:invoiceId/payments` | `payment:record` |
| GET | `/api/v1/expenses` | `expense:read` |
| POST | `/api/v1/expenses` | `expense:create` |
| GET | `/api/v1/expenses/:expenseId` | `expense:read` |
| POST | `/api/v1/expenses/:expenseId/review` | `expense:approve` |

State changes are **verbs on sub-resources**, not a `status` field in a PATCH.
`POST /issue` can allocate a number, set dates and write an audit entry as one
operation; `PATCH {status: 'issued'}` would make the same call look like an
ordinary field update and invite a client to try `{status: 'paid'}`. See
[API design](../02-architecture/api-design.md).

## Who can do what

Invoices and payments:

| Role | Read | Create | Update | Issue | Void | Read payment | Record payment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| finance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | — | — | — | — | — | — |
| viewer | ✓ | — | — | — | — | ✓ | — |
| member | — | — | — | — | — | — | — |

Expenses:

| Role | Read | Create | Approve |
| --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ |
| finance | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | — |
| member | ✓ | ✓ | — |
| viewer | ✓ | — | — |

The two tables differ because the two objects are different. **Everyone files
expenses** — a contributor who buys a domain name needs to claim it — so
`expense:create` goes all the way down to `member`. **Almost nobody issues
invoices**, so `invoice:issue` stops at `finance`.

A manager sees invoices (they need to know whether their client has paid) and
cannot issue or void one. A `member` sees no invoices at all, but files and reads
expenses. A `viewer` — an auditor or advisor — reads everything and writes
nothing.

## Edges

- **← [Clients](clients.md)** — currency, payment terms, tax number
- **← [Projects](projects.md)** — billable time becomes lines; invoicing freezes
  those time entries permanently
- **→ [Analytics](analytics.md)** — revenue, receivables aging, cash flow and
  profitability all read from here
- **→ [Documents](documents.md)** — receipts attach to expenses, PDFs to invoices

## Not built

- **No credit notes.** Void-and-reissue is the only correction. A partial
  correction after issue currently has no representation, and this is the first
  gap a real finance team will hit.
- **No multi-currency conversion.** An invoice is in one currency. Reports
  filter by currency rather than converting, because converting requires a rate
  source, a rate date policy and an FX gain/loss account — three decisions that
  should not be made implicitly. Analytics **excludes** rather than guesses.
- **No recurring invoices** for retainer projects.
- **No tax engine.** Tax rates are per line, entered by whoever drafts the
  invoice. There is no rule table, no reverse charge, no per-jurisdiction logic.
- **No accounting ledger.** This is not double-entry bookkeeping; it is invoicing
  and expense tracking. There is no trial balance and no chart of accounts.
- **No payment gateway.** Payments are recorded, not taken.
- **No PDF rendering.** The invoice detail page is HTML.
- **No dunning.** Overdue invoices appear in the aging report; nothing chases
  them.
