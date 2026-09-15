import {
  exponentOf,
  format as formatMoney,
  fromDTO,
  isCurrencyCode,
  type CurrencyCode,
} from '@almajeed/shared';

/**
 * Presentation helpers.
 *
 * All of them are pure and take the wire shapes the API returns, so a page can
 * render a number without ever unpacking minor units by hand — which is how a
 * "1500" ends up on screen where "15.00" belongs.
 */

/**
 * Money as it arrives over the wire.
 *
 * `currency` is typed as a plain string because that is what JSON delivers.
 * Narrowing happens here, once, with an explicit guard: an unrecognised code
 * renders as an em dash rather than throwing and taking a whole page down over
 * one cell.
 */
export interface MoneyLike {
  amount: string;
  currency: string;
}

function narrow(
  value: MoneyLike | null | undefined,
): { amount: number; currency: CurrencyCode } | null {
  if (!value || !isCurrencyCode(value.currency)) return null;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: value.currency };
}

export function money(value: MoneyLike | null | undefined, locale = 'en-SA'): string {
  const narrowed = narrow(value);
  if (!narrowed) return '—';
  return formatMoney(
    fromDTO({ amount: String(narrowed.amount), currency: narrowed.currency }),
    locale,
  );
}

/** Compact form for dashboard tiles: 1.2M rather than 1,234,567.00. */
export function moneyCompact(value: MoneyLike | null | undefined, locale = 'en-SA'): string {
  const narrowed = narrow(value);
  if (!narrowed) return '—';

  const major = narrowed.amount / 10 ** exponentOf(narrowed.currency);
  const compact = Math.abs(major) >= 10_000;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: narrowed.currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(major);
}

export function date(value: string | null | undefined, locale = 'en-GB'): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export function dateTime(value: string | null | undefined, locale = 'en-GB'): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(parsed);
}

export function percent(value: number | null | undefined): string {
  // `null` means undefined, not zero — a margin on no revenue has no value,
  // and showing "0%" would be a lie on a dashboard.
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })} h`;
}

export function minutesAsHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  return hours(Math.round((minutes / 60) * 10) / 10);
}

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-GB');
}

/** `in_progress` -> `In progress`. */
export function label(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
