import { z } from 'zod';
import {
  currencySchema,
  id,
  isoDate,
  longText,
  mediumText,
  metadataSchema,
  moneySchema,
  paginationQuerySchema,
  shortText,
  tagsSchema,
} from './common.js';

/**
 * Invoice lifecycle.
 *
 *   draft -> issued -> (partially_paid) -> paid
 *   draft -> cancelled
 *   issued -> void            (a void leaves an audit trail; a delete would not)
 *
 * `overdue` is derived at read time from `dueDate` and the outstanding
 * balance, never stored, so it cannot go stale. The allowed transitions are
 * enforced in the service layer and asserted in tests.
 */
export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
  'cancelled',
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['partially_paid', 'paid', 'void'],
  partially_paid: ['paid', 'void'],
  paid: [],
  void: [],
  cancelled: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export const invoiceLineSchema = z.strictObject({
  description: shortText,
  quantity: z.number().min(0.001).max(1_000_000).describe('supports fractional hours, e.g. 7.5'),
  unitPrice: moneySchema,
  /** Percentage, e.g. 15 for 15% VAT. Applied per line, not per invoice. */
  taxRate: z.number().min(0).max(100).default(0),
  /** Percentage discount applied to this line before tax. */
  discountRate: z.number().min(0).max(100).default(0),
  projectId: id('project').optional(),
});

export const createInvoiceSchema = z
  .strictObject({
    clientId: id('client'),
    projectId: id('project').optional(),
    currency: currencySchema.default('SAR'),
    issueDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    /** Human-facing reference; generated per organization when omitted. */
    number: z.string().trim().max(40).optional(),
    purchaseOrder: z.string().trim().max(60).optional(),
    notes: longText.optional(),
    terms: longText.optional(),
    lines: z.array(invoiceLineSchema).min(1, 'an invoice needs at least one line').max(200),
    tags: tagsSchema,
    metadata: metadataSchema,
  })
  .refine((v) => !v.issueDate || !v.dueDate || v.issueDate <= v.dueDate, {
    message: 'dueDate must not be before issueDate',
    path: ['dueDate'],
  });

export const updateInvoiceSchema = z.strictObject({
  clientId: id('client').optional(),
  projectId: id('project').nullable().optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  purchaseOrder: z.string().trim().max(60).optional(),
  notes: longText.optional(),
  terms: longText.optional(),
  lines: z.array(invoiceLineSchema).min(1).max(200).optional(),
  tags: tagsSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  status: invoiceStatusSchema.optional(),
  clientId: id('client').optional(),
  projectId: id('project').optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  overdueOnly: z.stringbool().optional(),
});

export const PAYMENT_METHODS = [
  'bank_transfer',
  'card',
  'cash',
  'cheque',
  'online_gateway',
  'other',
] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const recordPaymentSchema = z.strictObject({
  amount: moneySchema,
  paidAt: isoDate.optional(),
  method: paymentMethodSchema.default('bank_transfer'),
  reference: z.string().trim().max(120).optional(),
  notes: longText.optional(),
});

export const EXPENSE_CATEGORIES = [
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
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

export const EXPENSE_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);

export const createExpenseSchema = z.strictObject({
  description: shortText,
  category: expenseCategorySchema.default('other'),
  amount: moneySchema,
  /** Tax paid on this expense; recoverable VAT is reported separately. */
  taxAmount: moneySchema.optional(),
  incurredAt: isoDate,
  projectId: id('project').optional(),
  employeeId: id('employee').optional(),
  vendor: shortText.optional(),
  /** Uploaded receipt in the Documents module. */
  documentId: id('document').optional(),
  billable: z.boolean().default(false),
  notes: longText.optional(),
  tags: tagsSchema,
  metadata: metadataSchema,
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  status: expenseStatusSchema.optional(),
  category: expenseCategorySchema.optional(),
  projectId: id('project').optional(),
  employeeId: id('employee').optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const approveExpenseSchema = z.strictObject({
  approved: z.boolean(),
  reason: longText.optional(),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/* ---------------------------------------------------------------- output -- */

export const invoiceLineOutSchema = z.object({
  id: id('invoiceLine'),
  position: z.number().int(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: moneySchema,
  taxRate: z.number(),
  discountRate: z.number(),
  projectId: z.string().nullable(),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
});

export const paymentSchema = z.object({
  id: id('payment'),
  invoiceId: id('invoice'),
  amount: moneySchema,
  paidAt: z.string(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const invoiceSchema = z.object({
  id: id('invoice'),
  number: z.string(),
  status: invoiceStatusSchema,
  /** Derived at read time from `dueDate` and the balance — never stored. */
  overdue: z.boolean(),
  daysOverdue: z.number().int(),
  clientId: id('client'),
  clientName: z.string().nullable(),
  projectId: z.string().nullable(),
  currency: currencySchema,
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  paid: moneySchema,
  balanceDue: moneySchema,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** The full document: header plus its lines and payments. */
export const invoiceDetailSchema = invoiceSchema.extend({
  lines: z.array(invoiceLineOutSchema),
  payments: z.array(paymentSchema),
});

export const expenseSchema = z.object({
  id: id('expense'),
  description: z.string(),
  category: expenseCategorySchema,
  status: expenseStatusSchema,
  amount: moneySchema,
  taxAmount: moneySchema.nullable(),
  incurredAt: z.string(),
  projectId: z.string().nullable(),
  employeeId: z.string().nullable(),
  vendor: z.string().nullable(),
  documentId: z.string().nullable(),
  billable: z.boolean(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const voidInvoiceSchema = z.strictObject({
  reason: mediumText,
});

export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type InvoiceLineOut = z.infer<typeof invoiceLineOutSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type Expense = z.infer<typeof expenseSchema>;
