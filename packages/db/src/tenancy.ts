import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * Tenant scoping.
 *
 * This is the single most important file in the package. Every read and every
 * write against a business table goes through `scope()`, which produces the
 * `organization_id = $1 AND deleted_at IS NULL` predicate. Nothing else in the
 * codebase is allowed to hand-write that condition, for one reason: a scoping
 * bug is not a bug, it is a cross-tenant data breach, and the way to keep it
 * out is to have exactly one place where it can happen and to test that place
 * hard.
 *
 * The organization id passed in always originates from a verified access
 * token. It is never read from a path parameter, a query string or a body —
 * see docs/03-security/authz-rbac.md.
 */

/** A table that participates in tenancy. Structural, so it needs no base class. */
export interface TenantTable extends PgTable {
  organizationId: PgColumn;
}

export interface SoftDeletableTable extends TenantTable {
  deletedAt: PgColumn;
}

function hasSoftDelete(table: TenantTable): table is SoftDeletableTable {
  return 'deletedAt' in table && table.deletedAt !== undefined;
}

/**
 * The tenant predicate for `table`, optionally AND-ed with extra conditions.
 * Soft-deleted rows are excluded automatically.
 */
export function scope(
  table: TenantTable,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  const parts: (SQL | undefined)[] = [eq(table.organizationId, organizationId)];
  if (hasSoftDelete(table)) parts.push(isNull(table.deletedAt));
  parts.push(...conditions);
  // `and` returns undefined only when every part is undefined, which cannot
  // happen here — the tenant equality is always present.
  return and(...parts) as SQL;
}

/** Same as `scope`, but includes soft-deleted rows. For restore and audit paths only. */
export function scopeIncludingDeleted(
  table: TenantTable,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(table.organizationId, organizationId), ...conditions) as SQL;
}

/**
 * Scope by primary key within a tenant — the shape that defeats IDOR.
 *
 * Looking a row up by id *and* organization in one predicate means a guessed
 * or leaked id from another tenant returns zero rows, which the service layer
 * reports as 404. The API therefore never distinguishes "does not exist" from
 * "exists, but not yours".
 */
export function scopeById(
  table: TenantTable & { id: PgColumn },
  organizationId: string,
  id: string,
): SQL {
  return scope(table, organizationId, eq(table.id, id));
}
