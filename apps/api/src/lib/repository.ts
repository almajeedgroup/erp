import { type Page, notFound } from '@almajeed/shared';
import { memberships, scope, scopeById, type TenantTable } from '@almajeed/db';
import { type SQL, and, eq } from 'drizzle-orm';
import type { PgColumn, PgSelect } from 'drizzle-orm/pg-core';
import type { RequestContext, TxContext } from '../context.js';
import { keysetAfter, keysetOrder, pageFrom } from './query.js';

/**
 * The read patterns every module shares.
 *
 * Two helpers, and between them they remove the boilerplate that would
 * otherwise be copy-pasted nine times — which matters because the boilerplate
 * in question *is* the tenant isolation. A module that forgets to call `scope`
 * leaks another organization's data; a module that calls `listScoped` cannot
 * forget, because the scope is applied inside.
 */

type ListableTable = TenantTable & { id: PgColumn; createdAt: PgColumn };

export interface ListOptions {
  limit: number;
  cursor?: string | undefined;
  /** Extra predicates, AND-ed with the tenant scope. */
  filters?: (SQL | undefined)[];
}

/**
 * Apply tenant scope, the caller's filters, the keyset cursor and the matching
 * `ORDER BY` to a select builder, then page the result.
 *
 * The query is built by the caller so projections and joins stay explicit;
 * only the parts that must never vary are supplied here.
 */
export async function paginate<T extends { id: string; createdAt: Date }>(
  query: PgSelect,
  table: ListableTable,
  ctx: RequestContext | TxContext,
  options: ListOptions,
): Promise<Page<T>> {
  const conditions = [
    scope(table, ctx.auth.organizationId, ...(options.filters ?? [])),
    keysetAfter(table, options.cursor),
  ].filter((condition): condition is SQL => condition !== undefined);

  const rows = (await query
    .where(and(...conditions))
    .orderBy(...keysetOrder(table))
    // One extra row tells us whether a next page exists, with no COUNT(*).
    .limit(options.limit + 1)) as unknown as T[];

  return pageFrom(rows, options.limit);
}

/**
 * Fetch one row by id within the caller's organization, or throw 404.
 *
 * The id and the organization are matched in the same predicate, so a valid id
 * belonging to another tenant produces "not found" rather than "forbidden".
 * The API therefore never confirms that another organization's record exists —
 * the fix for the IDOR half of OWASP A01.
 */
export async function findByIdOrThrow<T>(
  query: PgSelect,
  table: TenantTable & { id: PgColumn },
  ctx: RequestContext | TxContext,
  id: string,
  resourceName: string,
): Promise<T> {
  const rows = (await query
    .where(scopeById(table, ctx.auth.organizationId, id))
    .limit(1)) as unknown as T[];

  const row = rows[0];
  if (!row) throw notFound(resourceName, id);
  return row;
}

/** Same lookup, but `null` instead of a throw — for optional references. */
export async function findById<T>(
  query: PgSelect,
  table: TenantTable & { id: PgColumn },
  ctx: RequestContext | TxContext,
  id: string,
): Promise<T | null> {
  const rows = (await query
    .where(scopeById(table, ctx.auth.organizationId, id))
    .limit(1)) as unknown as T[];
  return rows[0] ?? null;
}

/**
 * Assert that a referenced row exists inside the caller's organization.
 *
 * Every foreign key supplied in a request body goes through this. Without it,
 * a caller could attach their invoice to another tenant's project — the
 * database's foreign key would happily accept it, because it knows nothing
 * about tenancy.
 */
export async function assertBelongsToOrganization(
  ctx: RequestContext | TxContext,
  table: TenantTable & { id: PgColumn },
  id: string | null | undefined,
  resourceName: string,
): Promise<void> {
  if (!id) return;
  const rows = await ctx.db
    .select({ id: table.id })
    .from(table)
    .where(scopeById(table, ctx.auth.organizationId, id))
    .limit(1);
  if (rows.length === 0) throw notFound(resourceName, id);
}

/**
 * Assert that a user id supplied in a request body is an active member of the
 * caller's organization.
 *
 * `users` is a global table, so a plain foreign key would happily accept
 * someone from another tenant — assigning a client to a stranger, or leaking
 * that a given user id exists. Every `userId` that arrives in a body goes
 * through here.
 */
export async function assertActiveMember(
  ctx: RequestContext | TxContext,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const rows = await ctx.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, ctx.auth.organizationId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(1);
  if (rows.length === 0) throw notFound('User', userId);
}
