import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  allocate,
  compare,
  divide,
  format,
  fromDTO,
  fromDecimal,
  money,
  multiply,
  percentage,
  subtract,
  sum,
  toDTO,
  toDecimal,
  zero,
} from './money.js';

describe('money', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(10.5, 'SAR')).toThrow(TypeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 'SAR')).toThrow(TypeError);
  });

  it('parses decimals without floating point drift', () => {
    expect(fromDecimal('1234.56', 'SAR').amount).toBe(123456);
    expect(fromDecimal('0.1', 'USD').amount).toBe(10);
    expect(fromDecimal('-99.99', 'USD').amount).toBe(-9999);
    expect(fromDecimal('7', 'USD').amount).toBe(700);
    expect(fromDecimal('.5', 'USD').amount).toBe(50);
  });

  it('honours currencies with a non-2 exponent', () => {
    expect(fromDecimal('1.234', 'KWD').amount).toBe(1234);
    expect(fromDecimal('500', 'JPY').amount).toBe(500);
    expect(toDecimal(money(1234, 'KWD'))).toBe('1.234');
    expect(toDecimal(money(500, 'JPY'))).toBe('500');
  });

  it('round-trips through the decimal representation', () => {
    for (const value of ['0.00', '0.01', '10.00', '1234567.89', '-0.05']) {
      expect(toDecimal(fromDecimal(value, 'SAR'))).toBe(value.replace(/^-0\.00$/, '0.00'));
    }
  });

  it('pads small amounts correctly', () => {
    expect(toDecimal(money(5, 'SAR'))).toBe('0.05');
    expect(toDecimal(money(0, 'SAR'))).toBe('0.00');
    expect(toDecimal(money(-5, 'SAR'))).toBe('-0.05');
  });

  it('adds and subtracts within a currency', () => {
    expect(add(money(100, 'SAR'), money(250, 'SAR')).amount).toBe(350);
    expect(subtract(money(100, 'SAR'), money(250, 'SAR')).amount).toBe(-150);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'SAR'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(1, 'SAR'), money(1, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero of the given currency', () => {
    expect(sum([], 'USD')).toEqual(zero('USD'));
    expect(sum([money(1, 'USD'), money(2, 'USD')], 'USD').amount).toBe(3);
  });

  it('avoids the classic 0.1 + 0.2 problem', () => {
    const total = add(fromDecimal('0.1', 'USD'), fromDecimal('0.2', 'USD'));
    expect(toDecimal(total)).toBe('0.30');
  });

  it('rounds multiplication half-to-even by default', () => {
    expect(multiply(money(5, 'SAR'), 0.5).amount).toBe(2); // 2.5 -> 2
    expect(multiply(money(7, 'SAR'), 0.5).amount).toBe(4); // 3.5 -> 4
    expect(multiply(money(5, 'SAR'), 0.5, 'half-up').amount).toBe(3);
    expect(multiply(money(5, 'SAR'), 0.5, 'down').amount).toBe(2);
    expect(multiply(money(5, 'SAR'), 0.5, 'up').amount).toBe(3);
  });

  it('computes VAT the way an invoice line does', () => {
    const line = fromDecimal('1000.00', 'SAR');
    expect(toDecimal(percentage(line, 15))).toBe('150.00');
  });

  it('divides and rejects division by zero', () => {
    expect(divide(money(1000, 'SAR'), 4).amount).toBe(250);
    expect(() => divide(money(1000, 'SAR'), 0)).toThrow(RangeError);
  });

  describe('allocate', () => {
    it('never loses or invents a minor unit', () => {
      const parts = allocate(money(1000, 'SAR'), [1, 1, 1]);
      expect(parts.map((p) => p.amount)).toEqual([334, 333, 333]);
      expect(sum(parts, 'SAR').amount).toBe(1000);
    });

    it('splits by weight', () => {
      const parts = allocate(money(10_000, 'SAR'), [70, 20, 10]);
      expect(parts.map((p) => p.amount)).toEqual([7000, 2000, 1000]);
    });

    it('handles negative totals symmetrically', () => {
      const parts = allocate(money(-1000, 'SAR'), [1, 1, 1]);
      expect(parts.map((p) => p.amount)).toEqual([-334, -333, -333]);
      expect(sum(parts, 'SAR').amount).toBe(-1000);
    });

    it('rejects degenerate weights', () => {
      expect(() => allocate(money(100, 'SAR'), [])).toThrow(RangeError);
      expect(() => allocate(money(100, 'SAR'), [0, 0])).toThrow(RangeError);
      expect(() => allocate(money(100, 'SAR'), [-1, 2])).toThrow(RangeError);
    });

    it('is exhaustive over a range of totals', () => {
      for (let total = 0; total < 200; total += 1) {
        const parts = allocate(money(total, 'SAR'), [3, 5, 7]);
        expect(sum(parts, 'SAR').amount).toBe(total);
      }
    });
  });

  it('survives a JSON round trip as a string', () => {
    const original = money(9_007_199_254_740_990, 'SAR');
    const restored = fromDTO(JSON.parse(JSON.stringify(toDTO(original))));
    expect(restored).toEqual(original);
  });

  it('formats for presentation', () => {
    expect(format(fromDecimal('1234.50', 'SAR'), 'en-US')).toContain('1,234.50');
  });
});
