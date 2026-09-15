import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Database enums.
 *
 * These mirror the `as const` tuples in `@almajeed/shared` exactly. Declaring
 * them in Postgres as well is deliberate belt-and-braces: application bugs and
 * ad-hoc SQL both get rejected at the storage layer rather than quietly
 * writing `'Activeeee'` into a status column that every report then filters on.
 *
 * Adding a value is a migration (`ALTER TYPE ... ADD VALUE`); removing one is
 * not, which is the right asymmetry for a system of record.
 */

export const roleEnum = pgEnum('role', [
  'owner',
  'admin',
  'finance',
  'manager',
  'member',
  'viewer',
]);

export const userStatusEnum = pgEnum('user_status', ['active', 'invited', 'suspended']);

export const membershipStatusEnum = pgEnum('membership_status', ['active', 'invited', 'revoked']);

export const clientStatusEnum = pgEnum('client_status', [
  'lead',
  'prospect',
  'active',
  'dormant',
  'churned',
]);

export const acquisitionChannelEnum = pgEnum('acquisition_channel', [
  'referral',
  'outbound',
  'inbound',
  'partner',
  'event',
  'marketplace',
  'other',
]);

export const projectStatusEnum = pgEnum('project_status', [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

export const billingTypeEnum = pgEnum('billing_type', [
  'fixed_price',
  'time_and_materials',
  'retainer',
  'internal',
]);

export const healthStatusEnum = pgEnum('health_status', ['on_track', 'at_risk', 'off_track']);

export const employmentTypeEnum = pgEnum('employment_type', [
  'full_time',
  'part_time',
  'contractor',
  'intern',
  'temporary',
]);

export const employeeStatusEnum = pgEnum('employee_status', [
  'active',
  'on_leave',
  'suspended',
  'terminated',
]);

export const payPeriodEnum = pgEnum('pay_period', ['monthly', 'biweekly', 'weekly', 'hourly']);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
  'cancelled',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'bank_transfer',
  'card',
  'cash',
  'cheque',
  'online_gateway',
  'other',
]);

export const expenseCategoryEnum = pgEnum('expense_category', [
  'payroll',
  'subcontractor',
  'software',
  'infrastructure',
  'travel',
  'marketing',
  'office',
  'professional_services',
  'taxes',
  'other',
]);

export const expenseStatusEnum = pgEnum('expense_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'paid',
]);

export const documentCategoryEnum = pgEnum('document_category', [
  'contract',
  'proposal',
  'invoice',
  'receipt',
  'report',
  'policy',
  'identification',
  'deliverable',
  'other',
]);

export const documentOwnerTypeEnum = pgEnum('document_owner_type', [
  'organization',
  'client',
  'project',
  'employee',
  'invoice',
  'expense',
  'task',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]);

export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
