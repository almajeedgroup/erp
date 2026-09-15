import { type Page, buildPage, decodeCursor } from '@almajeed/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Keyset pagination against Drizzle.
 *
 * The ordering key is `(created_at DESC, id DESC)`, which is covered by an
 * index on every listable table. The cursor predicate is written as a Postgres
 * **row-value comparison**:
 *
 *   (created_at, id) < ($1, $2)
 *
 * rather than the hand-rolled `created_at < $1 OR (created_at = $1 AND id < $2)`.
 * The row-value form is what the planner turns into a single index range scan,
 * and it is far harder to get subtly wrong at a tie.
 */

export interface KeysetTable {
  createdAt: PgColumn;
  id: PgColumn;
}

/** The cursor predicate, or `undefined` for the first page. */
export function keysetAfter(table: KeysetTable, cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const position = decodeCursor(cursor);
  // A malformed cursor is treated as "start from the beginning" rather than a
  // 400: cursors are opaque to clients and a stale one should not be an error
  // the user has to understand.
  if (!position) return undefined;
  return sql`(${table.createdAt}, ${table.id}) < (${new Date(position.createdAt)}, ${position.id})`;
}

/** The `ORDER BY` that matches `keysetAfter`. They must always be used together. */
export function keysetOrder(table: KeysetTable): SQL[] {
  return [sql`${table.createdAt} desc`, sql`${table.id} desc`];
}

/**
 * Fetch `limit + 1` rows so the presence of a next page is known without a
 * second `COUNT(*)`, then trim and build the cursor.
 */
export function pageFrom<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): Page<T> {
  return buildPage(rows, limit);
}

/** Map a page's items while preserving the cursor. */
export function mapPage<T, U>(page: Page<T>, fn: (item: T) => U): Page<U> {
  return { items: page.items.map(fn), nextCursor: page.nextCursor };
}

/**
 * Escape a user-supplied string for use inside a `LIKE`/`ILIKE` pattern.
 *
 * Values are already parameterised, so this is not about SQL injection — it is
 * about a search for "100%" not silently matching every row.
 */
export function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
