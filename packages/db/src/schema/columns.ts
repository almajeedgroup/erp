import { sql } from 'drizzle-orm';
import { bigint, char, jsonb, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Column builders shared by every table.
 *
 * Defining them once means the audit columns, the money representation and the
 * id format cannot drift apart between modules — which is exactly how an ERP
 * ends up with three different ideas of what a timestamp means.
 */

/** Prefixed string ids (see `@almajeed/shared` -> ids.ts). 64 chars is ample. */
export const idColumn = (name = 'id') => varchar(name, { length: 64 });

/** `created_at` / `updated_at`, always stored with a timezone, always UTC. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
};

/**
 * Soft delete.
 *
 * Financial and HR records are never hard-deleted: an invoice that vanishes
 * takes its audit trail with it. Reads filter on `deleted_at IS NULL`; the
 * retention job in docs/07-operations/ is what eventually purges.
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
};

/**
 * Money.
 *
 * Two columns, never one: a `bigint` count of minor units and an ISO-4217 code.
 * There is no `numeric` and no `float` anywhere in this schema — see
 * docs/02-architecture/data-model.md for why. The pair is always declared
 * explicitly (`budgetAmount` + `budgetCurrency`) rather than spread from a
 * helper, so the column names stay greppable and Drizzle keeps full inference.
 */
export const amountColumn = (name: string) => bigint(name, { mode: 'number' });
export const currencyColumn = (name: string) => char(name, { length: 3 });

export const tagsColumn = (name = 'tags') =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export const metadataColumn = (name = 'metadata') =>
  jsonb(name)
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`);
