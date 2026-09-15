import {
  type CurrencyCode,
  type Money,
  type RoundingMode,
  add,
  money,
  multiply,
  subtract,
  sum,
  zero,
} from '@almajeed/shared';

/**
 * Invoice arithmetic.
 *
 * Pure functions over `Money`, with no database and no request in sight, so
 * the rules can be tested exhaustively — which matters because these are the
 * numbers a client is invoiced and a tax authority audits.
 *
 * Three decisions worth stating outright:
 *
 *  1. **Quantities are integers too.** A quantity is stored as thousandths
 *     (`7.5 hours` -> `7500`), so no float participates in a line total.
 *  2. **Tax and discount rates are basis points.** `15%` is `1500`, not `0.15`.
 *  3. **Per-line rounding, then sum.** Tax is rounded on each line and the
 *     lines are added, rather than taxing the invoice subtotal. This is what
 *     tax authorities and every accounting package expect, and the two
 *     approaches differ by a halala often enough to matter.
 */

export const QUANTITY_SCALE = 1_000;
export const BASIS_POINTS = 10_000;

export interface LineInput {
  /** Quantity in thousandths: 7.5 -> 7500. */
  quantityMilli: number;
  unitPrice: Money;
  taxRateBp: number;
  discountRateBp: number;
}

export interface LineTotals {
  /** quantity x unit price, before discount and tax. */
  subtotal: Money;
  discount: Money;
  tax: Money;
  /** subtotal - discount + tax. */
  total: Money;
}

export interface InvoiceTotals {
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
}

/** Percentage (`15`) to basis points (`1500`), rounded to the nearest point. */
export function toBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

/** Decimal quantity (`7.5`) to thousandths (`7500`). */
export function toQuantityMilli(quantity: number): number {
  return Math.round(quantity * QUANTITY_SCALE);
}

export function fromQuantityMilli(quantityMilli: number): number {
  return quantityMilli / QUANTITY_SCALE;
}

export function computeLine(line: LineInput, mode: RoundingMode = 'half-even'): LineTotals {
  const subtotal = multiply(line.unitPrice, line.quantityMilli / QUANTITY_SCALE, mode);
  const discount = multiply(subtotal, line.discountRateBp / BASIS_POINTS, mode);
  const taxable = subtract(subtotal, discount);
  const tax = multiply(taxable, line.taxRateBp / BASIS_POINTS, mode);
  return { subtotal, discount, tax, total: add(taxable, tax) };
}

export function computeInvoice(
  lines: readonly LineInput[],
  currency: CurrencyCode,
  mode: RoundingMode = 'half-even',
): { lines: LineTotals[]; totals: InvoiceTotals } {
  const computed = lines.map((line) => computeLine(line, mode));

  return {
    lines: computed,
    totals: {
      subtotal: sum(
        computed.map((line) => line.subtotal),
        currency,
      ),
      discount: sum(
        computed.map((line) => line.discount),
        currency,
      ),
      tax: sum(
        computed.map((line) => line.tax),
        currency,
      ),
      total: sum(
        computed.map((line) => line.total),
        currency,
      ),
    },
  };
}

/** Outstanding balance on an invoice: what is still owed. Never negative. */
export function balanceDue(total: Money, paid: Money): Money {
  const remaining = subtract(total, paid);
  return remaining.amount < 0 ? zero(total.currency) : remaining;
}

export type SettlementStatus = 'unpaid' | 'partially_paid' | 'paid';

/**
 * Where an invoice stands after a payment.
 *
 * Overpayment counts as paid rather than erroring: a client who rounds up a
 * transfer should not wedge the invoice. The excess shows up as a credit in
 * the receivables report.
 */
export function settlementStatus(total: Money, paid: Money): SettlementStatus {
  if (paid.amount <= 0) return 'unpaid';
  if (paid.amount >= total.amount) return 'paid';
  return 'partially_paid';
}

/** Net terms applied to an issue date, as a calendar date. */
export function dueDateFor(issueDate: string, paymentTermsDays: number): string {
  const issued = new Date(`${issueDate}T00:00:00.000Z`);
  issued.setUTCDate(issued.getUTCDate() + paymentTermsDays);
  return issued.toISOString().slice(0, 10);
}

/**
 * How overdue an invoice is, in days, relative to `today`.
 * Zero or negative means it is not yet due.
 */
export function daysOverdue(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const now = Date.parse(`${today}T00:00:00.000Z`);
  return Math.floor((now - due) / 86_400_000);
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const overdue = daysOverdue(dueDate, today);
  if (overdue <= 0) return 'current';
  if (overdue <= 30) return '1-30';
  if (overdue <= 60) return '31-60';
  if (overdue <= 90) return '61-90';
  return '90+';
}

/**
 * Format an invoice number from a counter.
 * `INV`, 2026, 7 -> `INV-2026-0007`.
 */
export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Value of a block of time at a rate, for drafting an invoice from timesheets. */
export function valueOfMinutes(
  minutes: number,
  hourlyRate: Money,
  mode: RoundingMode = 'half-even',
): Money {
  return multiply(hourlyRate, minutes / 60, mode);
}

/** Convenience for building a zero total in a known currency. */
export function emptyTotals(currency: CurrencyCode): InvoiceTotals {
  return {
    subtotal: money(0, currency),
    discount: money(0, currency),
    tax: money(0, currency),
    total: money(0, currency),
  };
}
