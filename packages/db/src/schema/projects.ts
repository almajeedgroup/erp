import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  amountColumn,
  currencyColumn,
  idColumn,
  metadataColumn,
  softDelete,
  tagsColumn,
  timestamps,
} from './columns.js';
import { billingTypeEnum, healthStatusEnum, projectStatusEnum } from './enums.js';
import { clients } from './crm.js';
import { organizations, users } from './tenancy.js';

export const projects = pgTable(
  'projects',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    /** Short human reference, e.g. `TOWER-01`. Unique within the organization. */
    code: varchar('code', { length: 24 }),
    clientId: idColumn('client_id').references(() => clients.id, { onDelete: 'set null' }),
    status: projectStatusEnum('status').notNull().default('draft'),
    billingType: billingTypeEnum('billing_type').notNull().default('time_and_materials'),
    currency: char('currency', { length: 3 }).notNull().default('SAR'),
    budgetAmount: amountColumn('budget_amount'),
    budgetCurrency: currencyColumn('budget_currency'),
    hourlyRateAmount: amountColumn('hourly_rate_amount'),
    hourlyRateCurrency: currencyColumn('hourly_rate_currency'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    managerId: idColumn('manager_id').references(() => users.id, { onDelete: 'set null' }),
    health: healthStatusEnum('health').notNull().default('on_track'),
    description: text('description'),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('projects_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('projects_org_status_idx').on(table.organizationId, table.status),
    index('projects_client_idx').on(table.clientId),
    uniqueIndex('projects_org_code_key')
      .on(table.organizationId, table.code)
      .where(sql`code IS NOT NULL AND deleted_at IS NULL`),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: idColumn('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: idColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Descriptive only — org RBAC decides what this person may actually do. */
    role: varchar('role', { length: 60 }).notNull().default('contributor'),
    allocationPercent: integer('allocation_percent').notNull().default(100),
    hourlyRateAmount: amountColumn('hourly_rate_amount'),
    hourlyRateCurrency: currencyColumn('hourly_rate_currency'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('project_members_project_user_key').on(table.projectId, table.userId),
    index('project_members_user_idx').on(table.userId),
    index('project_members_org_idx').on(table.organizationId),
  ],
);

/**
 * Time entries.
 *
 * Duration is stored in whole minutes, not decimal hours: "7.5 hours" is a
 * presentation concern, and decimal hours re-introduce the rounding problems
 * that integer minor units solve for money. Billable amount is *not* stored —
 * it is derived from the rate in force, so a rate correction does not require
 * a backfill.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: idColumn('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: idColumn('task_id'),
    employeeId: idColumn('employee_id'),
    userId: idColumn('user_id').references(() => users.id, { onDelete: 'set null' }),
    date: date('date', { mode: 'string' }).notNull(),
    minutes: integer('minutes').notNull(),
    billable: boolean('billable').notNull().default(true),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedByUserId: idColumn('approved_by_user_id'),
    /** Set once the entry lands on an issued invoice; blocks edits after that. */
    invoicedInvoiceId: idColumn('invoiced_invoice_id'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('time_entries_org_date_idx').on(table.organizationId, table.date.desc()),
    index('time_entries_project_idx').on(table.projectId, table.date.desc()),
    index('time_entries_employee_idx').on(table.employeeId, table.date.desc()),
    index('time_entries_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  manager: one(users, { fields: [projects.managerId], references: [users.id] }),
  members: many(projectMembers),
  timeEntries: many(timeEntries),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  project: one(projects, { fields: [timeEntries.projectId], references: [projects.id] }),
}));
