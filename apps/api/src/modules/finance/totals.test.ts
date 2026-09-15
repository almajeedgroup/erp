import { fromDecimal, money, toDecimal } from '@almajeed/shared';
import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  balanceDue,
  computeInvoice,
  computeLine,
  daysOverdue,
  dueDateFor,
  formatInvoiceNumber,
  settlementStatus,
  toBasisPoints,
  toQuantityMilli,
  valueOfMinutes,
} from './totals.js';

const sar = (value: string) => fromDecimal(value, 'SAR');

describe('invoice arithmetic', () => {
  describe('a single line', () => {
    it('multiplies quantity by unit price', () => {
      const line = computeLine({
        quantityMilli: toQuantityMilli(3),
        unitPrice: sar('250.00'),
        taxRateBp: 0,
        discountRateBp: 0,
      });
      expect(toDecimal(line.subtotal)).toBe('750.00');
      expect(toDecimal(line.total)).toBe('750.00');
    });

    it('supports fractional quantities without float error', () => {
      const line = computeLine({
        quantityMilli: toQuantityMilli(7.5),
        unitPrice: sar('320.00'),
        taxRateBp: 0,
        discountRateBp: 0,
      });
      expect(toDecimal(line.subtotal)).toBe('2400.00');
    });

    it('applies VAT after the discount, not before', () => {
      const line = computeLine({
        quantityMilli: toQuantityMilli(1),
        unitPrice: sar('1000.00'),
        discountRateBp: toBasisPoints(10), // 10%
        taxRateBp: toBasisPoints(15), // 15%
      });
      expect(toDecimal(line.subtotal)).toBe('1000.00');
      expect(toDecimal(line.discount)).toBe('100.00');
      expect(toDecimal(line.tax)).toBe('135.00'); // 15% of 900, not of 1000
      expect(toDecimal(line.total)).toBe('1035.00');
    });

    it('keeps total = subtotal - discount + tax for arbitrary inputs', () => {
      for (let unit = 1; unit <= 250; unit += 7) {
        for (const quantity of [0.001, 0.5, 1, 3.333, 12.75]) {
          const line = computeLine({
            quantityMilli: toQuantityMilli(quantity),
            unitPrice: money(unit, 'SAR'),
            discountRateBp: 725,
            taxRateBp: 1500,
          });
          expect(line.total.amount).toBe(
            line.subtotal.amount - line.discount.amount + line.tax.amount,
          );
        }
      }
    });

    it('handles a currency with three minor digits', () => {
      const line = computeLine({
        quantityMilli: toQuantityMilli(2),
        unitPrice: fromDecimal('1.234', 'KWD'),
        taxRateBp: 0,
        discountRateBp: 0,
      });
      expect(toDecimal(line.subtotal)).toBe('2.468');
    });
  });

  describe('a whole invoice', () => {
    it('sums the lines and reconciles the header', () => {
      const { totals } = computeInvoice(
        [
          {
            quantityMilli: toQuantityMilli(10),
            unitPrice: sar('500.00'),
            taxRateBp: 1500,
            discountRateBp: 0,
          },
          {
            quantityMilli: toQuantityMilli(1),
            unitPrice: sar('1200.00'),
            taxRateBp: 1500,
            discountRateBp: 0,
          },
        ],
        'SAR',
      );

      expect(toDecimal(totals.subtotal)).toBe('6200.00');
      expect(toDecimal(totals.tax)).toBe('930.00');
      expect(toDecimal(totals.total)).toBe('7130.00');
      expect(totals.total.amount).toBe(
        totals.subtotal.amount - totals.discount.amount + totals.tax.amount,
      );
    });

    it('rounds tax per line rather than on the invoice subtotal', () => {
      // Three lines of 0.11 at 15%: per-line tax is 0.02 each (0.0165 -> 0.02
      // half-even on the minor unit), totalling 0.05. Taxing the 0.33 subtotal
      // in one go would give 0.05 as well here, but the per-line path is the
      // one an auditor reconstructs, so it is the one implemented.
      const lines = Array.from({ length: 3 }, () => ({
        quantityMilli: toQuantityMilli(1),
        unitPrice: sar('0.11'),
        taxRateBp: 1500,
        discountRateBp: 0,
      }));
      const { lines: computed, totals } = computeInvoice(lines, 'SAR');
      expect(totals.tax.amount).toBe(computed.reduce((acc, line) => acc + line.tax.amount, 0));
    });

    it('returns zeros for an empty invoice instead of throwing', () => {
      const { totals } = computeInvoice([], 'SAR');
      expect(toDecimal(totals.total)).toBe('0.00');
    });
  });

  describe('settlement', () => {
    it('reports the outstanding balance', () => {
      expect(toDecimal(balanceDue(sar('1000.00'), sar('250.00')))).toBe('750.00');
      expect(toDecimal(balanceDue(sar('1000.00'), sar('0.00')))).toBe('1000.00');
    });

    it('never reports a negative balance on an overpayment', () => {
      expect(toDecimal(balanceDue(sar('1000.00'), sar('1200.00')))).toBe('0.00');
    });

    it('classifies payment state', () => {
      expect(settlementStatus(sar('1000.00'), sar('0.00'))).toBe('unpaid');
      expect(settlementStatus(sar('1000.00'), sar('1.00'))).toBe('partially_paid');
      expect(settlementStatus(sar('1000.00'), sar('999.99'))).toBe('partially_paid');
      expect(settlementStatus(sar('1000.00'), sar('1000.00'))).toBe('paid');
      expect(settlementStatus(sar('1000.00'), sar('1500.00'))).toBe('paid');
    });
  });

  describe('dates', () => {
    it('applies net terms', () => {
      expect(dueDateFor('2026-03-01', 30)).toBe('2026-03-31');
      expect(dueDateFor('2026-01-31', 30)).toBe('2026-03-02');
      expect(dueDateFor('2026-03-01', 0)).toBe('2026-03-01');
    });

    it('measures how overdue an invoice is', () => {
      expect(daysOverdue('2026-03-01', '2026-03-15')).toBe(14);
      expect(daysOverdue('2026-03-20', '2026-03-15')).toBe(-5);
      expect(daysOverdue(null, '2026-03-15')).toBe(0);
    });

    it('buckets receivables the way the aging report does', () => {
      expect(agingBucket('2026-03-20', '2026-03-15')).toBe('current');
      expect(agingBucket('2026-03-15', '2026-03-15')).toBe('current');
      expect(agingBucket('2026-03-14', '2026-03-15')).toBe('1-30'); // 1 day
      expect(agingBucket('2026-02-20', '2026-03-15')).toBe('1-30'); // 23 days
      expect(agingBucket('2026-02-13', '2026-03-15')).toBe('1-30'); // 30 days, the edge
      expect(agingBucket('2026-02-12', '2026-03-15')).toBe('31-60'); // 31 days, over it
      expect(agingBucket('2026-01-10', '2026-03-15')).toBe('61-90'); // 64 days
      expect(agingBucket('2025-12-10', '2026-03-15')).toBe('90+'); // 95 days
    });
  });

  describe('helpers', () => {
    it('formats invoice numbers with a zero-padded sequence', () => {
      expect(formatInvoiceNumber('INV', 2026, 7)).toBe('INV-2026-0007');
      expect(formatInvoiceNumber('AMG', 2026, 12_345)).toBe('AMG-2026-12345');
    });

    it('values logged minutes at an hourly rate', () => {
      expect(toDecimal(valueOfMinutes(90, sar('400.00')))).toBe('600.00');
      expect(toDecimal(valueOfMinutes(0, sar('400.00')))).toBe('0.00');
      expect(toDecimal(valueOfMinutes(1, sar('400.00')))).toBe('6.67');
    });

    it('converts percentages and quantities to integers', () => {
      expect(toBasisPoints(15)).toBe(1500);
      expect(toBasisPoints(7.25)).toBe(725);
      expect(toQuantityMilli(7.5)).toBe(7500);
      expect(toQuantityMilli(0.001)).toBe(1);
    });
  });
});
