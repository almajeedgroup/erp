import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPage,
  clampLimit,
  decodeCursor,
  encodeCursor,
} from './pagination.js';

const row = (id: string, createdAt: string) => ({ id, createdAt, name: id });

describe('pagination', () => {
  it('round-trips a cursor', () => {
    const position = { createdAt: '2026-03-01T10:00:00.000Z', id: 'cli_abc' };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('returns null for junk rather than throwing', () => {
    expect(decodeCursor('not-a-cursor')).toBe(null);
    expect(decodeCursor('')).toBe(null);
    expect(decodeCursor(Buffer.from('no-separator').toString('base64url'))).toBe(null);
    expect(decodeCursor(Buffer.from('nonsense|id').toString('base64url'))).toBe(null);
  });

  it('is URL-safe', () => {
    const cursor = encodeCursor({ createdAt: '2026-03-01T10:00:00.000Z', id: 'cli_zz~/+' });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)?.id).toBe('cli_zz~/+');
  });

  it('builds a page and signals more results from the extra row', () => {
    const rows = [
      row('a', '2026-03-03T00:00:00.000Z'),
      row('b', '2026-03-02T00:00:00.000Z'),
      row('c', '2026-03-01T00:00:00.000Z'),
    ];
    const page = buildPage(rows, 2);
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(decodeCursor(page.nextCursor!)).toEqual({
      createdAt: '2026-03-02T00:00:00.000Z',
      id: 'b',
    });
  });

  it('ends the sequence when no extra row came back', () => {
    const page = buildPage([row('a', '2026-03-03T00:00:00.000Z')], 2);
    expect(page.nextCursor).toBe(null);
    expect(buildPage([], 10).nextCursor).toBe(null);
  });

  it('accepts Date as well as string timestamps', () => {
    const rows = [
      { id: 'a', createdAt: new Date('2026-03-03T00:00:00.000Z') },
      { id: 'b', createdAt: new Date('2026-03-02T00:00:00.000Z') },
    ];
    const page = buildPage(rows, 1);
    expect(decodeCursor(page.nextCursor!)?.createdAt).toBe('2026-03-03T00:00:00.000Z');
  });

  it('clamps limits into the permitted band', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(10.9)).toBe(10);
  });
});
