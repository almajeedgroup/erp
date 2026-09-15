import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn, metadataColumn, softDelete, timestamps } from './columns.js';
import { membershipStatusEnum, roleEnum, userStatusEnum } from './enums.js';

/**
 * Tenancy.
 *
 * Every business table carries `organization_id` and every query filters on it.
 * The isolation model is "shared database, shared schema, mandatory scope" —
 * chosen over schema-per-tenant because 50 modules x N schemas is an
 * operational tax nobody pays back. The trade is that isolation is an
 * application invariant, so it is enforced in exactly one place
 * (`src/tenancy.ts`) and covered by dedicated tests rather than trusted to
 * every call site. ADR-0002 records the decision.
 */

export const organizations = pgTable(
  'organizations',
  {
    id: idColumn().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    /** Reporting currency. Individual records may differ; analytics converts. */
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('SAR'),
    country: char('country', { length: 2 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Riyadh'),
    vatNumber: varchar('vat_number', { length: 50 }),
    /** Default VAT rate applied to new invoice lines, as a percentage. */
    defaultTaxRate: integer('default_tax_rate').notNull().default(15),
    settings: metadataColumn('settings'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex('organizations_slug_key').on(table.slug)],
);

/**
 * Users are global identities, not tenant rows: one person, one password, one
 * email, possibly several organizations. Which organization a request acts in
 * comes from the access token, never from the URL.
 */
export const users = pgTable(
  'users',
  {
    id: idColumn().primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Argon2id encoded hash. Never selected by the generic user queries. */
    passwordHash: text('password_hash').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    /** Reset on success; drives the lockout below. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** Set when throttling kicks in; authentication refuses until it passes. */
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: idColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('member'),
    status: membershipStatusEnum('status').notNull().default('active'),
    invitedByUserId: idColumn('invited_by_user_id'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('memberships_org_user_key').on(table.organizationId, table.userId),
    index('memberships_user_idx').on(table.userId),
    index('memberships_org_idx').on(table.organizationId, table.createdAt),
  ],
);

/**
 * Refresh tokens.
 *
 * Stored as a SHA-256 hash, never in the clear, so a database read does not
 * hand an attacker live sessions. Rotation is enforced: using a token marks it
 * replaced, and presenting an already-replaced token revokes the whole
 * `family_id` — the standard detection for a stolen-and-replayed refresh
 * token. See docs/03-security/authn.md.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: idColumn().primaryKey(),
    userId: idColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    /** All tokens descended from one login share a family. */
    familyId: idColumn('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    replacedByTokenId: idColumn('replaced_by_token_id'),
    userAgent: varchar('user_agent', { length: 400 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_key').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_expires_idx').on(table.expiresAt),
  ],
);

/**
 * The audit log.
 *
 * Append-only by convention and by permission: the application role may
 * `INSERT` and `SELECT` here and nothing else (see the grants in
 * docs/03-security/database-security.md). Every state-changing request writes
 * exactly one row, with the actor, the request id that correlates it to the
 * structured logs, and a redacted before/after pair.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: idColumn('actor_user_id'),
    /** Verb in `resource.action` form, e.g. `invoice.issued`. */
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 60 }).notNull(),
    resourceId: varchar('resource_id', { length: 64 }),
    /** Redacted snapshots — secrets and sensitive HR fields are stripped first. */
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    requestId: varchar('request_id', { length: 64 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    /** `false` when the action was attempted and denied — the interesting rows. */
    succeeded: boolean('succeeded').notNull().default(true),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('audit_logs_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('audit_logs_resource_idx').on(table.organizationId, table.resourceType, table.resourceId),
    index('audit_logs_actor_idx').on(table.organizationId, table.actorUserId),
  ],
);

/** Machine credentials for integrations. Hashed, scoped and expiring like any other secret. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    /** SHA-256 of the secret. The plaintext is shown exactly once, at creation. */
    keyHash: char('key_hash', { length: 64 }).notNull(),
    /** Non-secret display fragment, e.g. `amk_live_7f3a…`. */
    prefix: varchar('prefix', { length: 24 }).notNull(),
    role: roleEnum('role').notNull().default('viewer'),
    createdByUserId: idColumn('created_by_user_id'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('api_keys_hash_key').on(table.keyHash),
    index('api_keys_org_idx').on(table.organizationId, table.createdAt),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  apiKeys: many(apiKeys),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  refreshTokens: many(refreshTokens),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));
