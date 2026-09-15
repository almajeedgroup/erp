import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn, metadataColumn, softDelete, tagsColumn, timestamps } from './columns.js';
import { acquisitionChannelEnum, clientStatusEnum } from './enums.js';
import { organizations, users } from './tenancy.js';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export const clients = pgTable(
  'clients',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    status: clientStatusEnum('status').notNull().default('lead'),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 24 }),
    website: varchar('website', { length: 2048 }),
    taxNumber: varchar('tax_number', { length: 50 }),
    billingCurrency: char('billing_currency', { length: 3 }).notNull().default('SAR'),
    /** Net terms in days. `dueDate = issueDate + paymentTermsDays`. */
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    acquisitionChannel: acquisitionChannelEnum('acquisition_channel').notNull().default('other'),
    acquiredAt: date('acquired_at', { mode: 'string' }),
    address: jsonb('address').$type<Address | null>(),
    notes: text('notes'),
    /** Relationship owner. Not an access-control field — RBAC is org-wide. */
    ownerId: idColumn('owner_id').references(() => users.id, { onDelete: 'set null' }),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // The keyset-pagination index: every list query walks this.
    index('clients_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('clients_org_status_idx').on(table.organizationId, table.status),
    index('clients_org_name_idx').on(table.organizationId, table.name),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: idColumn('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    title: varchar('title', { length: 200 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 24 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('contacts_client_idx').on(table.clientId, table.createdAt.desc()),
    index('contacts_org_idx').on(table.organizationId, table.createdAt.desc()),
    // At most one live primary contact per client, enforced by the database
    // rather than by a read-modify-write that two requests can interleave.
    uniqueIndex('contacts_one_primary_per_client')
      .on(table.clientId)
      .where(sql`is_primary = true AND deleted_at IS NULL`),
  ],
);

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, { fields: [clients.ownerId], references: [users.id] }),
  contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  client: one(clients, { fields: [contacts.clientId], references: [clients.id] }),
}));
