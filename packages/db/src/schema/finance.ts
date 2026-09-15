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
import {
  expenseCategoryEnum,
  expenseStatusEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
} from './enums.js';
import { clients } from './crm.js';
import { employees } from './hr.js';
import { projects } from './projects.js';
import { organizations, users } from './tenancy.js';

/**
 * Invoices.
 *
 * The header stores *computed* totals (subtotal, tax, total) even though they
 * are derivable from the lines. That is intentional denormalisation: an issued
 * invoice is a legal document, and it must keep reporting the number the client
 * received even if a tax rate or a line is later corrected on a credit note.
 * Totals are recomputed only while the invoice is still a draft.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: idColumn('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    projectId: idColumn('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Gapless per-organization reference, allocated when the invoice is issued. */
    number: varchar('number', { length: 40 }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    currency: char('currency', { length: 3 }).notNull().default('SAR'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    purchaseOrder: varchar('purchase_order', { length: 60 }),

    subtotalAmount: amountColumn('subtotal_amount').notNull().default(0),
    discountAmount: amountColumn('discount_amount').notNull().default(0),
    taxAmount: amountColumn('tax_amount').notNull().default(0),
    totalAmount: amountColumn('total_amount').notNull().default(0),
    /** Running total of recorded payments; `total - paid` is the balance due. */
    paidAmount: amountColumn('paid_amount').notNull().default(0),

    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    voidedAt: timestamp('voided_at', { withTimezone: true, mode: 'date' }),
    voidReason: text('void_reason'),
    notes: text('notes'),
    terms: text('terms'),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('invoices_org_number_key').on(table.organizationId, table.number),
    index('invoices_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('invoices_org_status_idx').on(table.organizationId, table.status),
    index('invoices_client_idx').on(table.clientId, table.issueDate.desc()),
    index('invoices_project_idx').on(table.projectId),
    // Powers the receivables-aging report without scanning paid invoices.
    index('invoices_due_idx')
      .on(table.organizationId, table.dueDate)
      .where(sql`status IN ('issued', 'partially_paid')`),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceId: idColumn('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    projectId: idColumn('project_id').references(() => projects.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    description: varchar('description', { length: 500 }).notNull(),
    /** Stored x1000 so 7.5 hours is 7500 — an integer, like everything else. */
    quantityMilli: integer('quantity_milli').notNull(),
    unitPriceAmount: amountColumn('unit_price_amount').notNull(),
    /** Basis points (1500 = 15.00%), so a tax rate is never a float either. */
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    discountRateBp: integer('discount_rate_bp').notNull().default(0),
    lineSubtotalAmount: amountColumn('line_subtotal_amount').notNull().default(0),
    lineDiscountAmount: amountColumn('line_discount_amount').notNull().default(0),
    lineTaxAmount: amountColumn('line_tax_amount').notNull().default(0),
    lineTotalAmount: amountColumn('line_total_amount').notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('invoice_lines_invoice_idx').on(table.invoiceId, table.position),
    index('invoice_lines_org_idx').on(table.organizationId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceId: idColumn('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: idColumn('client_id').references(() => clients.id, { onDelete: 'set null' }),
    amountAmount: amountColumn('amount_amount').notNull(),
    amountCurrency: currencyColumn('amount_currency').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    method: paymentMethodEnum('method').notNull().default('bank_transfer'),
    reference: varchar('reference', { length: 120 }),
    recordedByUserId: idColumn('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    index('payments_invoice_idx').on(table.invoiceId, table.paidAt.desc()),
    index('payments_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('payments_org_paid_idx').on(table.organizationId, table.paidAt.desc()),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 200 }).notNull(),
    category: expenseCategoryEnum('category').notNull().default('other'),
    status: expenseStatusEnum('status').notNull().default('draft'),
    amountAmount: amountColumn('amount_amount').notNull(),
    amountCurrency: currencyColumn('amount_currency').notNull(),
    taxAmountAmount: amountColumn('tax_amount_amount'),
    incurredAt: date('incurred_at', { mode: 'string' }).notNull(),
    projectId: idColumn('project_id').references(() => projects.id, { onDelete: 'set null' }),
    employeeId: idColumn('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    vendor: varchar('vendor', { length: 200 }),
    documentId: idColumn('document_id'),
    /** Rebillable to the client; picked up when drafting an invoice. */
    billable: boolean('billable').notNull().default(false),
    submittedByUserId: idColumn('submitted_by_user_id'),
    approvedByUserId: idColumn('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    rejectionReason: text('rejection_reason'),
    notes: text('notes'),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('expenses_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('expenses_org_incurred_idx').on(table.organizationId, table.incurredAt.desc()),
    index('expenses_org_status_idx').on(table.organizationId, table.status),
    index('expenses_project_idx').on(table.projectId),
    index('expenses_employee_idx').on(table.employeeId),
  ],
);

/**
 * Per-organization invoice numbering.
 *
 * A dedicated counter row that the issue path locks with `SELECT ... FOR
 * UPDATE`. `MAX(number) + 1` is a race under concurrency and a Postgres
 * sequence leaks gaps on rollback; tax authorities generally want gapless
 * series, so the counter is transactional.
 */
export const invoiceCounters = pgTable('invoice_counters', {
  organizationId: idColumn('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  prefix: varchar('prefix', { length: 12 }).notNull().default('INV'),
  nextNumber: integer('next_number').notNull().default(1),
  updatedAt: timestamps.updatedAt,
});

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
  lines: many(invoiceLines),
  payments: many(payments),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  project: one(projects, { fields: [expenses.projectId], references: [projects.id] }),
  employee: one(employees, { fields: [expenses.employeeId], references: [employees.id] }),
}));
