import {
  type CurrencyCode,
  type Money,
  type MoneyDTO,
  isCurrencyCode,
  money,
  toDTO,
} from '@almajeed/shared';

/**
 * The bridge between the `Money` value object and the two database columns
 * that store it (`*_amount` bigint, `*_currency` char(3)).
 *
 * Keeping the mapping in one place stops the "amount without its currency"
 * bug — the one where a SAR figure is added to a USD figure because only the
 * number made it through a layer.
 */

/** Read a money pair back out of a row. Returns `null` when the amount is null. */
export function readMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fallbackCurrency?: CurrencyCode,
): Money | null {
  if (amount === null || amount === undefined) return null;
  const code = (currency ?? fallbackCurrency ?? '').trim();
  if (!isCurrencyCode(code)) return null;
  return money(Number(amount), code);
}

/** Read a money pair that is known to be present, defaulting the currency. */
export function readMoneyOr(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fallbackCurrency: CurrencyCode,
): Money {
  return readMoney(amount, currency, fallbackCurrency) ?? money(0, fallbackCurrency);
}

/** Convert the wire representation (`{amount: "150000", currency: "SAR"}`) to `Money`. */
export function fromMoneyInput(input: { amount: string; currency: string }): Money {
  if (!isCurrencyCode(input.currency)) {
    throw new TypeError(`Unsupported currency: ${input.currency}`);
  }
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`Money amount out of safe integer range: ${input.amount}`);
  }
  return money(amount, input.currency);
}

export function fromMoneyInputOrNull(
  input: { amount: string; currency: string } | null | undefined,
): Money | null {
  return input ? fromMoneyInput(input) : null;
}

/** Serialize for a response body. */
export function toMoneyOutput(value: Money): MoneyDTO {
  return toDTO(value);
}

export function toMoneyOutputOrNull(value: Money | null): MoneyDTO | null {
  return value ? toDTO(value) : null;
}

/** Spread a `Money` into the two columns of a row being written. */
export function writeMoney<P extends string>(
  prefix: P,
  value: Money | null,
): Record<string, number | string | null> {
  return {
    [`${prefix}Amount`]: value ? value.amount : null,
    [`${prefix}Currency`]: value ? value.currency : null,
  };
}
