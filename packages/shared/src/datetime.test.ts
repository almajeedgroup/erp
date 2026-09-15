import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  defaultReportingRange,
  endOfMonth,
  parseIsoDate,
  periodKey,
  periodRange,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  toIsoDate,
} from './datetime.js';

describe('datetime', () => {
  it('parses and formats ISO dates in UTC', () => {
    expect(toIsoDate('2026-03-15T22:30:00.000Z')).toBe('2026-03-15');
    expect(parseIsoDate('2026-03-15').toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(() => parseIsoDate('15-03-2026')).toThrow(TypeError);
    expect(() => toIsoDate('not a date')).toThrow(TypeError);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps month arithmetic instead of overflowing', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-03-31', '2026-03-01')).toBe(-30);
  });

  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-03-15')).toBe('2026-03-09'); // a Sunday
    expect(startOfWeek('2026-03-16')).toBe('2026-03-16'); // a Monday
    expect(startOfWeek('2026-03-22')).toBe('2026-03-16');
  });

  it('computes month and quarter boundaries', () => {
    expect(startOfMonth('2026-03-15')).toBe('2026-03-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(startOfQuarter('2026-05-20')).toBe('2026-04-01');
    expect(startOfQuarter('2026-12-31')).toBe('2026-10-01');
  });

  it('labels periods by granularity', () => {
    expect(periodKey('2026-03-15', 'day')).toBe('2026-03-15');
    expect(periodKey('2026-03-15', 'week')).toBe('2026-03-09');
    expect(periodKey('2026-03-15', 'month')).toBe('2026-03');
    expect(periodKey('2026-03-15', 'quarter')).toBe('2026-Q1');
    expect(periodKey('2026-11-02', 'quarter')).toBe('2026-Q4');
  });

  it('enumerates continuous period buckets with no gaps', () => {
    expect(periodRange('2026-01-01', '2026-03-31', 'month')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(periodRange('2026-01-01', '2026-01-05', 'day')).toHaveLength(5);
    expect(periodRange('2026-03-31', '2026-01-01', 'month')).toEqual([]);
  });

  it('defaults reporting to a rolling 12 months', () => {
    const range = defaultReportingRange(new Date('2026-09-15T00:00:00.000Z'));
    expect(range).toEqual({ from: '2025-10-01', to: '2026-09-15' });
  });
});
