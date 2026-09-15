/**
 * Money.
 *
 * Rule of the codebase: **money is never a float**. Every amount is an integer
 * number of minor units (halalas for SAR, cents for USD, fils for KWD) plus an
 * ISO-4217 currency code. `0.1 + 0.2 !== 0.3` is not an acceptable failure mode
 * for an invoice total.
 *
 * The database stores the same shape: a `bigint` column for the amount and a
 * `char(3)` column for the currency. See docs/08-modules/finance.md.
 */

/** Minor-unit exponents for the currencies the product supports. */
export const CURRENCIES = {
  SAR: { exponent: 2, name: 'Saudi Riyal' },
  AED: { exponent: 2, name: 'UAE Dirham' },
  USD: { exponent: 2, name: 'US Dollar' },
  EUR: { exponent: 2, name: 'Euro' },
  GBP: { exponent: 2, name: 'Pound Sterling' },
  QAR: { exponent: 2, name: 'Qatari Riyal' },
  EGP: { exponent: 2, name: 'Egyptian Pound' },
  KWD: { exponent: 3, name: 'Kuwaiti Dinar' },
  BHD: { exponent: 3, name: 'Bahraini Dinar' },
  OMR: { exponent: 3, name: 'Omani Rial' },
  JPY: { exponent: 0, name: 'Japanese Yen' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export interface Money {
  /** Integer count of minor units. Always an integer; may be negative. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export type RoundingMode = 'half-even' | 'half-up' | 'down' | 'up';

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(`Cannot combine ${left} with ${right}; convert to a single currency first.`);
    this.name = 'CurrencyMismatchError';
  }
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

export function exponentOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].exponent;
}

/** Construct money from an integer number of minor units. */
export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`Money amount must be a safe integer of minor units, got: ${amount}`);
  }
  return Object.freeze({ amount, currency });
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/**
 * Parse a decimal amount ("1234.56", 1234.56) into minor units.
 * String input is parsed digit-by-digit so no float ever touches the value.
 */
export function fromDecimal(value: string | number, currency: CurrencyCode): Money {
  const exp = exponentOf(currency);
  const text = typeof value === 'number' ? value.toFixed(exp) : value.trim();

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new TypeError(`Not a decimal amount: ${String(value)}`);
  }
  const [, sign = '', whole = '', fraction = ''] = match;

  const padded = fraction.padEnd(exp + 1, '0');
  const kept = padded.slice(0, exp);
  const nextDigit = padded.charCodeAt(exp) - 48;

  let minor = Number(`${whole || '0'}${kept}` || '0');
  if (nextDigit >= 5) minor += 1; // half-up on parse; input beyond the exponent is user error
  return money(sign === '-' ? -minor : minor, currency);
}

/** Render as a plain decimal string with no grouping or symbol, e.g. "-1234.56". */
export function toDecimal(m: Money): string {
  const exp = exponentOf(m.currency);
  const sign = m.amount < 0 ? '-' : '';
  const digits = Math.abs(m.amount).toString().padStart(exp + 1, '0');
  if (exp === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}

export function abs(m: Money): Money {
  return money(Math.abs(m.amount), m.currency);
}

/** Sum a list. An empty list needs an explicit currency, so pass one. */
export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

/** Multiply by a factor (quantity, tax rate, FX rate) and round to minor units. */
export function multiply(m: Money, factor: number, mode: RoundingMode = 'half-even'): Money {
  if (!Number.isFinite(factor)) throw new TypeError(`Factor must be finite, got: ${factor}`);
  return money(round(m.amount * factor, mode), m.currency);
}

/** Divide by a divisor and round. Use `allocate` when splitting without losing units. */
export function divide(m: Money, divisor: number, mode: RoundingMode = 'half-even'): Money {
  if (divisor === 0) throw new RangeError('Division by zero');
  return money(round(m.amount / divisor, mode), m.currency);
}

/**
 * Split an amount across weights without losing or inventing a single minor
 * unit. Remainders go to the largest fractional parts first, ties to the
 * earliest index — the standard "largest remainder" method.
 *
 *   allocate(money(1000, 'SAR'), [1, 1, 1]) -> 334, 333, 333
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError('allocate requires at least one weight');
  if (weights.some((w) => w < 0)) throw new RangeError('allocate weights must be non-negative');

  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new RangeError('allocate weights must not sum to zero');

  const sign = m.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(m.amount);

  const exact = weights.map((w) => (magnitude * w) / total);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = magnitude - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder -= 1;
  }
  return result.map((v) => money(sign * v, m.currency));
}

/** Apply a percentage, e.g. `percentage(total, 15)` for 15% VAT. */
export function percentage(m: Money, percent: number, mode: RoundingMode = 'half-even'): Money {
  return multiply(m, percent / 100, mode);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export const isZero = (m: Money): boolean => m.amount === 0;
export const isPositive = (m: Money): boolean => m.amount > 0;
export const isNegative = (m: Money): boolean => m.amount < 0;

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** Locale-aware presentation. Presentation only — never parse this back. */
export function format(m: Money, locale = 'en-SA'): string {
  const exp = exponentOf(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(Number(toDecimal(m)));
}

/** Wire format used by the API and the database. */
export interface MoneyDTO {
  amount: string;
  currency: CurrencyCode;
}

/** Serialize as a string so a JSON round-trip cannot lose precision on large sums. */
export function toDTO(m: Money): MoneyDTO {
  return { amount: String(m.amount), currency: m.currency };
}

export function fromDTO(dto: MoneyDTO): Money {
  return money(Number(dto.amount), dto.currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

function round(value: number, mode: RoundingMode): number {
  if (Number.isInteger(value)) return value;
  switch (mode) {
    case 'down':
      return Math.trunc(value);
    case 'up':
      return value < 0 ? Math.floor(value) : Math.ceil(value);
    case 'half-up':
      return value < 0 ? -Math.round(-value) : Math.round(value);
    case 'half-even': {
      const sign = value < 0 ? -1 : 1;
      const v = Math.abs(value);
      const floor = Math.floor(v);
      const diff = v - floor;
      // Guard against binary representation noise (e.g. 2.675 * 100).
      if (Math.abs(diff - 0.5) < Number.EPSILON * 8) {
        return sign * (floor % 2 === 0 ? floor : floor + 1);
      }
      return sign * Math.round(v);
    }
  }
}
