import { relations } from 'drizzle-orm';
import { date, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import {
  amountColumn,
  currencyColumn,
  idColumn,
  metadataColumn,
  softDelete,
  tagsColumn,
  timestamps,
} from './columns.js';
import { employeeStatusEnum, employmentTypeEnum, payPeriodEnum } from './enums.js';
import { organizations, users } from './tenancy.js';

/**
 * Employees.
 *
 * Deliberately separate from `users`: a person on the payroll may have no
 * login (site staff, a contractor billed monthly), and a login may belong to
 * nobody on the payroll (an external accountant with the `finance` role). The
 * optional `user_id` link is what joins the two when both exist.
 *
 * The three columns marked SENSITIVE below are gated on
 * `employee:read_sensitive` and are stripped from responses — and from AI
 * retrieval — for everyone else.
 */
export const employees = pgTable(
  'employees',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: idColumn('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Payroll reference, unique per organization. */
    employeeNumber: varchar('employee_number', { length: 32 }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 24 }),
    jobTitle: varchar('job_title', { length: 200 }),
    department: varchar('department', { length: 120 }),
    managerId: idColumn('manager_id'),
    employmentType: employmentTypeEnum('employment_type').notNull().default('full_time'),
    status: employeeStatusEnum('status').notNull().default('active'),
    hiredAt: date('hired_at', { mode: 'string' }),
    terminatedAt: date('terminated_at', { mode: 'string' }),

    // SENSITIVE — requires `employee:read_sensitive`.
    compensationAmount: amountColumn('compensation_amount'),
    compensationCurrency: currencyColumn('compensation_currency'),
    payPeriod: payPeriodEnum('pay_period').notNull().default('monthly'),
    nationalId: varchar('national_id', { length: 40 }),
    bankAccount: varchar('bank_account', { length: 64 }),

    /** Fully-loaded internal cost per hour. Drives project margin. */
    costRateAmount: amountColumn('cost_rate_amount'),
    costRateCurrency: currencyColumn('cost_rate_currency'),
    /** Default external rate for this person's billable time. */
    billableRateAmount: amountColumn('billable_rate_amount'),
    billableRateCurrency: currencyColumn('billable_rate_currency'),
    weeklyHours: integer('weekly_hours').notNull().default(40),
    notes: text('notes'),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('employees_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('employees_org_status_idx').on(table.organizationId, table.status),
    index('employees_org_department_idx').on(table.organizationId, table.department),
    index('employees_manager_idx').on(table.managerId),
    uniqueIndex('employees_org_number_key').on(table.organizationId, table.employeeNumber),
  ],
);

export const employeesRelations = relations(employees, ({ one }) => ({
  organization: one(organizations, {
    fields: [employees.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  manager: one(employees, {
    fields: [employees.managerId],
    references: [employees.id],
    relationName: 'employee_manager',
  }),
}));
