# ADR-0003 · Money as integer minor units

**Status:** Accepted · **Date:** 2026-01

## Context

This system issues invoices. The total on an invoice is the amount a client is
legally asked to pay, and it must be exactly reproducible — by the API, by the
web app, by a report, and by an auditor a year later.

`0.1 + 0.2 === 0.30000000000000004` is not an acceptable property for that.

## Decision

Every monetary amount is an **integer count of minor units** paired with an
ISO-4217 currency code. `1,500.00 SAR` is `{ amount: 150000, currency: 'SAR' }`.
No float, no decimal type, anywhere.

The representation is consistent through every layer:

| Layer | Representation |
| --- | --- |
| Database | `bigint` amount + `char(3)` currency, two columns |
| Domain | `Money { amount: number; currency: CurrencyCode }`, frozen |
| Wire | `{ "amount": "150000", "currency": "SAR" }` — a **string** |
| Display | Formatted at the last moment, by `Intl.NumberFormat` |

The same reasoning extends to everything that participates in a money
calculation: quantities in thousandths (`7.5` → `7500`), tax and discount rates
in basis points (`15%` → `1500`), durations in whole minutes.

Arithmetic lives in
[`packages/shared/src/money.ts`](../../../packages/shared/src/money.ts) and
refuses to add across currencies. `allocate` splits an amount by weights using
the largest-remainder method, so a three-way split of 10.00 is 3.34 + 3.33 +
3.33 and never loses or invents a halala.

## Consequences

**Good.** Exact. The total on screen is the total in the database is the total
the client received. Integer arithmetic is exact in Postgres *and* in
JavaScript, up to 2^53 — ninety trillion halalas, far past any invoice this
product will see.

**Good.** Currency errors are caught at the point of the mistake.
`add(sar, usd)` throws a `CurrencyMismatchError` rather than producing a
meaningless number that reaches a report.

**Bad.** Every amount needs unpacking for display, and every developer has to
know the convention. Mitigated by keeping the unpacking in one place —
`format.money()` on the web side, `toDecimal()` in the domain — and by the two
columns being named `*_amount` and `*_currency` so the convention is visible in
the schema.

**Bad.** The wire format is a string, which surprises people expecting a number.
Deliberate: JSON numbers are IEEE-754 doubles in most clients, and a large total
would lose precision silently. A string cannot.

**Bad.** No automatic currency conversion. Analytics excludes amounts outside
the reporting currency rather than converting them. Documented as a limitation;
the fix needs a rate table with dated rows and a policy on which rate applies to
which figure, and guessing is worse than excluding.

## Alternatives considered

**`numeric` in Postgres, string in the application.** Exact in the database, and
the usual recommendation. Rejected because the exactness ends the moment one
code path does `Number(row.amount)` — and in a JavaScript codebase, one
eventually does. An integer is exact on both sides of that boundary.

**A decimal library (decimal.js, big.js).** Correct, and the right answer if
amounts could exceed 2^53 minor units or needed arbitrary precision. Rejected as
unnecessary weight: a bounded integer already gives exactness within a range
that is two orders of magnitude beyond the domain, and a plain `number` is
faster, simpler and needs no serialisation strategy.

**Floats with careful rounding.** Rejected. Every system that has tried this has
eventually shipped a rounding bug to a customer.

**A single `money` column with the currency in a separate config.** Rejected:
it assumes an organization has exactly one currency, which is false the moment a
client is billed in USD.
