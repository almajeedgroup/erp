import { z } from 'zod';
import { CURRENCY_CODES } from '../money.js';
import { ID_PREFIXES, type IdPrefixName } from '../ids.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination.js';

/**
 * Validation primitives.
 *
 * Every byte that enters the API is parsed by one of these before a handler
 * sees it, and objects are **strict**: an unexpected key is a 422, not a
 * silently ignored field. That is what stops mass-assignment — a client cannot
 * smuggle `{"role":"owner"}` into a profile update and have it reach the
 * database, because the schema for that route has no `role` key at all.
 */

/** An id schema bound to one entity kind, e.g. `id('client')`. */
export function id<K extends IdPrefixName>(kind: K) {
  const prefix = ID_PREFIXES[kind];
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`), `must be a valid ${kind} id`)
    .describe(`${kind} identifier`);
}

/** Trimmed and lower-cased *before* validating, so case is never a duplicate-account bug. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('must be a valid email address').max(254));

/** E.164-ish. Deliberately permissive on separators, strict on length. */
export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^\+?[0-9][0-9\s().-]{4,}$/, 'must be a valid phone number');

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric with single hyphens');

export const shortText = z.string().trim().min(1).max(200);
export const mediumText = z.string().trim().min(1).max(1_000);
export const longText = z.string().trim().max(20_000);

export const urlSchema = z.url().max(2048);

export const isoDate = z.iso.date().describe('calendar date, YYYY-MM-DD');
export const isoDateTime = z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp');

export const currencySchema = z.enum(CURRENCY_CODES as [string, ...string[]]);

/**
 * Money on the wire: an integer string of minor units plus a currency.
 * A string, not a number, so a large total cannot lose precision in JSON.
 */
export const moneySchema = z.strictObject({
  amount: z
    .string()
    .regex(/^-?\d{1,18}$/, 'must be an integer number of minor units')
    .describe('integer minor units, e.g. "150000" = 1,500.00 SAR'),
  currency: currencySchema,
});

/** Free-form tags. Bounded so a single row cannot become a denial-of-service. */
export const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(25).default([]);

/** Caller-supplied metadata. Bounded depth and size; stored as jsonb. */
export const metadataSchema = z
  .record(z.string().max(64), z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]))
  .refine((v) => Object.keys(v).length <= 50, { message: 'at most 50 metadata keys' })
  .default({});

export const paginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
});

export const searchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
});

/** Standard page envelope for every list endpoint. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const okSchema = z.object({ ok: z.literal(true) });

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});

export type MoneyInput = z.infer<typeof moneySchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
