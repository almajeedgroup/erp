/**
 * Output mapping.
 *
 * Rows come back from Drizzle with `Date` objects and `bigint`-backed numbers;
 * responses are declared as JSON. These helpers do the conversion in the
 * service layer — once, at the boundary — so response schemas stay plain JSON
 * and every module serializes a timestamp the same way.
 */

export function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/** Integer minor units to the string the wire format uses. */
export function amount(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function amountOr(value: number | null | undefined, fallback = 0): string {
  return String(value ?? fallback);
}
