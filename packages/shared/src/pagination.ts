/**
 * Cursor pagination.
 *
 * Offset pagination (`LIMIT 50 OFFSET 10000`) degrades linearly and silently
 * skips or repeats rows when the underlying set changes mid-scroll. Every list
 * endpoint here is keyset-paginated on `(created_at DESC, id DESC)`, which is
 * stable under concurrent writes and uses an index for every page.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  limit: number;
  cursor?: string | undefined;
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` to fetch the next page. `null` means the end. */
  nextCursor: string | null;
}

export interface CursorPosition {
  createdAt: string;
  id: string;
}

/** Encode a keyset position. Base64url so it survives query strings untouched. */
export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt}|${position.id}`, 'utf8').toString('base64url');
}

/** Decode a cursor; returns `null` for anything malformed rather than throwing. */
export function decodeCursor(cursor: string): CursorPosition | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator <= 0) return null;
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Turn `limit + 1` rows into a page. Fetching one extra row is how we know
 * whether a next page exists without a second `COUNT(*)` query.
 */
export function buildPage<T extends { id: string; createdAt: Date | string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdAt:
              last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt,
            id: last.id,
          })
        : null,
  };
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}
