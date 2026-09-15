/**
 * Date helpers.
 *
 * Everything here works in **UTC** and on calendar dates (`YYYY-MM-DD`).
 * Reporting periods that silently shift with the server's timezone are a
 * recurring source of "the numbers changed overnight" bugs, so there is no
 * local-time path in this module at all. Presentation-layer localisation is the
 * web app's job.
 */

export type IsoDate = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

export function toIsoDate(value: Date | string): IsoDate {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: IsoDate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`Invalid ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid ISO date: ${value}`);
  return date;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * DAY_MS));
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(value);
  const target = new Date(date);
  target.setUTCMonth(target.getUTCMonth() + months);
  // Clamp: 2026-01-31 + 1 month is 2026-02-28, not 2026-03-03.
  if (target.getUTCDate() !== date.getUTCDate()) target.setUTCDate(0);
  return toIsoDate(target);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}

/** ISO-8601 week: Monday is day 1. */
export function startOfWeek(value: IsoDate): IsoDate {
  const date = parseIsoDate(value);
  const day = (date.getUTCDay() + 6) % 7;
  return addDays(value, -day);
}

export function startOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: IsoDate): IsoDate {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

export function startOfQuarter(value: IsoDate): IsoDate {
  const month = Number(value.slice(5, 7));
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${value.slice(0, 4)}-${String(firstMonth).padStart(2, '0')}-01`;
}

export type Granularity = 'day' | 'week' | 'month' | 'quarter';

/** The bucket label a date falls into, e.g. `2026-Q1`, `2026-03`, `2026-W12`. */
export function periodKey(value: IsoDate, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return value;
    case 'week':
      return startOfWeek(value);
    case 'month':
      return value.slice(0, 7);
    case 'quarter': {
      const month = Number(value.slice(5, 7));
      return `${value.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
    }
  }
}

/** Every bucket between two dates, inclusive — so a chart has no silent gaps. */
export function periodRange(from: IsoDate, to: IsoDate, granularity: Granularity): string[] {
  if (from > to) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 10_000) {
    const key = periodKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor =
      granularity === 'day' ? addDays(cursor, 1) : addDays(cursor, granularity === 'week' ? 7 : 1);
    guard += 1;
  }
  return keys;
}

export function today(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** Default reporting window: the last 12 complete months plus the current one. */
export function defaultReportingRange(now: Date = new Date()): { from: IsoDate; to: IsoDate } {
  const to = toIsoDate(now);
  return { from: startOfMonth(addMonths(to, -11)), to };
}
