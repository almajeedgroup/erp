import {
  type CreateExpenseInput,
  type CreateInvoiceInput,
  type Expense,
  type Invoice,
  type InvoiceDetail,
  type InvoiceLineOut,
  type Page,
  type Payment,
  type RecordPaymentInput,
  type UpdateInvoiceInput,
  canTransitionInvoice,
  conflict,
  money,
  newId,
  notFound,
  preconditionFailed,
  toIsoDate,
} from '@almajeed/shared';
import {
  clients,
  expenses,
  invoiceCounters,
  invoiceLines,
  invoices,
  payments,
  projects,
  scope,
  scopeById,
} from '@almajeed/db';
import { type SQL, and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { CurrencyCode } from '@almajeed/shared';
import type { Executor } from '@almajeed/db';
import type { RequestContext } from '../../context.js';
import { diffSnapshot, writeAudit } from '../../lib/audit.js';
import {
  fromMoneyInput,
  readMoney,
  readMoneyOr,
  toMoneyOutput,
  toMoneyOutputOrNull,
} from '../../lib/money.js';
import { mapPage } from '../../lib/query.js';
import { assertBelongsToOrganization, findByIdOrThrow, paginate } from '../../lib/repository.js';
import { iso, isoOrNull } from '../../lib/serialize.js';
import {
  BASIS_POINTS,
  QUANTITY_SCALE,
  agingBucket,
  balanceDue,
  computeInvoice,
  daysOverdue,
  dueDateFor,
  formatInvoiceNumber,
  settlementStatus,
  toBasisPoints,
  toQuantityMilli,
} from './totals.js';

/**
 * Finance.
 *
 * The module where "it is only an ERP" stops being true — these rows are the
 * company's books. Three invariants run through everything below:
 *
 *  1. **A draft is editable; an issued invoice is not.** Once a document has
 *     been sent to a client it is immutable. Mistakes are corrected by voiding
 *     and re-issuing, which leaves both documents in the record.
 *  2. **Invoice numbers are gapless and allocated transactionally.** A counter
 *     row is locked with `SELECT ... FOR UPDATE`; `MAX(number)+1` races and a
 *     Postgres sequence leaks gaps on rollback, and tax authorities generally
 *     want an unbroken series.
 *  3. **Stored totals are frozen at issue.** The header keeps the numbers the
 *     client actually received even if a rate changes later.
 */

/* ---------------------------------------------------------------- reads -- */

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  clientId: string;
  clientName: string | null;
  projectId: string | null;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  purchaseOrder: string | null;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  notes: string | null;
  terms: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSelection = {
  id: invoices.id,
  number: invoices.number,
  status: invoices.status,
  clientId: invoices.clientId,
  clientName: clients.name,
  projectId: invoices.projectId,
  currency: invoices.currency,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  purchaseOrder: invoices.purchaseOrder,
  subtotalAmount: invoices.subtotalAmount,
  discountAmount: invoices.discountAmount,
  taxAmount: invoices.taxAmount,
  totalAmount: invoices.totalAmount,
  paidAmount: invoices.paidAmount,
  notes: invoices.notes,
  terms: invoices.terms,
  tags: invoices.tags,
  metadata: invoices.metadata,
  createdAt: invoices.createdAt,
  updatedAt: invoices.updatedAt,
};

const invoiceQuery = (ctx: RequestContext) =>
  ctx.db
    .select(invoiceSelection)
    .from(invoices)
    .leftJoin(clients, eq(clients.id, invoices.clientId))
    .$dynamic();

function toInvoice(row: InvoiceRow, today: string): Invoice {
  const currency = row.currency as CurrencyCode;
  const total = money(row.totalAmount, currency);
  const paid = money(row.paidAmount, currency);
  const outstanding = balanceDue(total, paid);
  const isOpen = row.status === 'issued' || row.status === 'partially_paid';
  const overdueDays = isOpen ? daysOverdue(row.dueDate, today) : 0;

  return {
    id: row.id,
    number: row.number,
    status: row.status as Invoice['status'],
    // Derived, never stored: a stored `overdue` flag is wrong the next morning.
    overdue: isOpen && overdueDays > 0 && outstanding.amount > 0,
    daysOverdue: Math.max(overdueDays, 0),
    clientId: row.clientId,
    clientName: row.clientName,
    projectId: row.projectId,
    currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    purchaseOrder: row.purchaseOrder,
    subtotal: toMoneyOutput(money(row.subtotalAmount, currency)),
    discount: toMoneyOutput(money(row.discountAmount, currency)),
    tax: toMoneyOutput(money(row.taxAmount, currency)),
    total: toMoneyOutput(total),
    paid: toMoneyOutput(paid),
    balanceDue: toMoneyOutput(outstanding),
    notes: row.notes,
    terms: row.terms,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listInvoices(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    status?: string;
    clientId?: string;
    projectId?: string;
    from?: string;
    to?: string;
    overdueOnly?: boolean;
  },
): Promise<Page<Invoice>> {
  const today = toIsoDate(ctx.now);
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(invoices.status, query.status as never));
  if (query.clientId) filters.push(eq(invoices.clientId, query.clientId));
  if (query.projectId) filters.push(eq(invoices.projectId, query.projectId));
  if (query.from) filters.push(gte(invoices.issueDate, query.from));
  if (query.to) filters.push(lte(invoices.issueDate, query.to));
  if (query.overdueOnly) {
    filters.push(
      sql`${invoices.status} in ('issued', 'partially_paid')
          and ${invoices.dueDate} < ${today}
          and ${invoices.totalAmount} > ${invoices.paidAmount}`,
    );
  }

  const page = await paginate<InvoiceRow>(invoiceQuery(ctx), invoices, ctx, {
    limit: query.limit,
    cursor: query.cursor,
    filters,
  });
  return mapPage(page, (row) => toInvoice(row, today));
}

async function getInvoiceRow(ctx: RequestContext, id: string): Promise<InvoiceRow> {
  return findByIdOrThrow<InvoiceRow>(invoiceQuery(ctx), invoices, ctx, id, 'Invoice');
}

export async function getInvoice(ctx: RequestContext, id: string): Promise<InvoiceDetail> {
  const row = await getInvoiceRow(ctx, id);
  const currency = row.currency as CurrencyCode;

  const lineRows = await ctx.db
    .select()
    .from(invoiceLines)
    .where(
      and(eq(invoiceLines.organizationId, ctx.auth.organizationId), eq(invoiceLines.invoiceId, id)),
    )
    .orderBy(asc(invoiceLines.position));

  const paymentRows = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, ctx.auth.organizationId), eq(payments.invoiceId, id)))
    .orderBy(asc(payments.paidAt));

  return {
    ...toInvoice(row, toIsoDate(ctx.now)),
    lines: lineRows.map<InvoiceLineOut>((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: line.quantityMilli / QUANTITY_SCALE,
      unitPrice: toMoneyOutput(money(line.unitPriceAmount, currency)),
      taxRate: line.taxRateBp / 100,
      discountRate: line.discountRateBp / 100,
      projectId: line.projectId,
      subtotal: toMoneyOutput(money(line.lineSubtotalAmount, currency)),
      discount: toMoneyOutput(money(line.lineDiscountAmount, currency)),
      tax: toMoneyOutput(money(line.lineTaxAmount, currency)),
      total: toMoneyOutput(money(line.lineTotalAmount, currency)),
    })),
    payments: paymentRows.map<Payment>((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: toMoneyOutput(readMoneyOr(payment.amountAmount, payment.amountCurrency, currency)),
      paidAt: payment.paidAt,
      method: payment.method as Payment['method'],
      reference: payment.reference,
      notes: payment.notes,
      createdAt: iso(payment.createdAt),
    })),
  };
}

/* --------------------------------------------------------------- writes -- */

export async function createInvoice(
  ctx: RequestContext,
  input: CreateInvoiceInput,
): Promise<InvoiceDetail> {
  await assertBelongsToOrganization(ctx, clients, input.clientId, 'Client');
  await assertBelongsToOrganization(ctx, projects, input.projectId, 'Project');

  const currency = input.currency as CurrencyCode;

  // Checked *before* the arithmetic: summing mixed currencies throws a
  // CurrencyMismatchError, which would surface as an unhelpful 500 rather than
  // the 412 that tells the caller exactly what is wrong.
  assertLinesMatchCurrency(input.lines, input.currency);

  const computed = computeInvoice(
    input.lines.map((line) => ({
      quantityMilli: toQuantityMilli(line.quantity),
      unitPrice: fromMoneyInput(line.unitPrice),
      taxRateBp: toBasisPoints(line.taxRate),
      discountRateBp: toBasisPoints(line.discountRate),
    })),
    currency,
  );

  const id = newId('invoice');
  const issueDate = input.issueDate ?? null;

  await ctx.db.transaction(async (tx) => {
    await tx.insert(invoices).values({
      id,
      organizationId: ctx.auth.organizationId,
      clientId: input.clientId,
      projectId: input.projectId ?? null,
      // A draft carries a provisional reference; the gapless number is
      // allocated at issue, so abandoned drafts do not burn one.
      number: input.number ?? `DRAFT-${id.slice(-8).toUpperCase()}`,
      status: 'draft',
      currency: input.currency,
      issueDate,
      dueDate: input.dueDate ?? null,
      purchaseOrder: input.purchaseOrder ?? null,
      subtotalAmount: computed.totals.subtotal.amount,
      discountAmount: computed.totals.discount.amount,
      taxAmount: computed.totals.tax.amount,
      totalAmount: computed.totals.total.amount,
      paidAmount: 0,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await insertLines(tx, ctx, id, input.lines, computed.lines);

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'invoice.created',
      resourceType: 'invoice',
      resourceId: id,
      after: { clientId: input.clientId, total: computed.totals.total.amount, currency },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getInvoice(ctx, id);
}

export async function updateInvoice(
  ctx: RequestContext,
  id: string,
  input: UpdateInvoiceInput,
): Promise<InvoiceDetail> {
  const before = await getInvoiceRow(ctx, id);

  if (before.status !== 'draft') {
    throw preconditionFailed(
      `Only a draft invoice can be edited; this one is ${before.status}. Void it and issue a new one.`,
    );
  }

  await assertBelongsToOrganization(ctx, clients, input.clientId, 'Client');
  await assertBelongsToOrganization(ctx, projects, input.projectId ?? undefined, 'Project');

  const currency = before.currency as CurrencyCode;
  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'clientId',
    'projectId',
    'issueDate',
    'dueDate',
    'purchaseOrder',
    'notes',
    'terms',
    'tags',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  await ctx.db.transaction(async (tx) => {
    if (input.lines) {
      assertLinesMatchCurrency(input.lines, currency);
      const computed = computeInvoice(
        input.lines.map((line) => ({
          quantityMilli: toQuantityMilli(line.quantity),
          unitPrice: fromMoneyInput(line.unitPrice),
          taxRateBp: toBasisPoints(line.taxRate),
          discountRateBp: toBasisPoints(line.discountRate),
        })),
        currency,
      );
      patch.subtotalAmount = computed.totals.subtotal.amount;
      patch.discountAmount = computed.totals.discount.amount;
      patch.taxAmount = computed.totals.tax.amount;
      patch.totalAmount = computed.totals.total.amount;

      await tx
        .delete(invoiceLines)
        .where(
          and(
            eq(invoiceLines.organizationId, ctx.auth.organizationId),
            eq(invoiceLines.invoiceId, id),
          ),
        );
      await insertLines(tx, ctx, id, input.lines, computed.lines);
    }

    await tx
      .update(invoices)
      .set(patch)
      .where(scopeById(invoices, ctx.auth.organizationId, id));

    const changes = diffSnapshot(before as unknown as Record<string, unknown>, patch);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'invoice.updated',
      resourceType: 'invoice',
      resourceId: id,
      before: changes.before,
      after: changes.after,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getInvoice(ctx, id);
}

/**
 * Issue a draft.
 *
 * Allocates the gapless number, stamps the issue and due dates, and freezes
 * the document. The counter row is locked for the duration of the transaction,
 * so two concurrent issues serialise rather than colliding.
 */
export async function issueInvoice(ctx: RequestContext, id: string): Promise<InvoiceDetail> {
  const before = await getInvoiceRow(ctx, id);

  if (!canTransitionInvoice(before.status as Invoice['status'], 'issued')) {
    throw preconditionFailed(`An invoice in status "${before.status}" cannot be issued`);
  }

  const [lineCount] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(invoiceLines)
    .where(
      and(eq(invoiceLines.organizationId, ctx.auth.organizationId), eq(invoiceLines.invoiceId, id)),
    );
  if ((lineCount?.total ?? 0) === 0) {
    throw preconditionFailed('An invoice needs at least one line before it can be issued');
  }

  const issueDate = before.issueDate ?? toIsoDate(ctx.now);

  await ctx.db.transaction(async (tx) => {
    const number = await allocateInvoiceNumber(tx, ctx.auth.organizationId, issueDate, ctx.now);

    let dueDate = before.dueDate;
    if (!dueDate) {
      const [client] = await tx
        .select({ paymentTermsDays: clients.paymentTermsDays })
        .from(clients)
        .where(scopeById(clients, ctx.auth.organizationId, before.clientId))
        .limit(1);
      dueDate = dueDateFor(issueDate, client?.paymentTermsDays ?? 30);
    }

    await tx
      .update(invoices)
      .set({
        status: 'issued',
        number,
        issueDate,
        dueDate,
        issuedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(scopeById(invoices, ctx.auth.organizationId, id));

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'invoice.issued',
      resourceType: 'invoice',
      resourceId: id,
      before: { status: before.status, number: before.number },
      after: { status: 'issued', number, issueDate, dueDate },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getInvoice(ctx, id);
}

/**
 * Allocate the next number for an organization.
 *
 * `SELECT ... FOR UPDATE` on the counter row is what makes the series gapless
 * under concurrency: a second transaction blocks here until the first commits
 * or rolls back, and a rollback returns the number rather than burning it.
 */
async function allocateInvoiceNumber(
  tx: Executor,
  organizationId: string,
  issueDate: string,
  now: Date,
): Promise<string> {
  const existing = await tx
    .select({ prefix: invoiceCounters.prefix, nextNumber: invoiceCounters.nextNumber })
    .from(invoiceCounters)
    .where(eq(invoiceCounters.organizationId, organizationId))
    .for('update')
    .limit(1);

  let prefix = 'INV';
  let sequence = 1;

  if (existing.length === 0) {
    await tx
      .insert(invoiceCounters)
      .values({ organizationId, prefix, nextNumber: 2, updatedAt: now });
  } else {
    prefix = existing[0]?.prefix ?? 'INV';
    sequence = existing[0]?.nextNumber ?? 1;
    await tx
      .update(invoiceCounters)
      .set({ nextNumber: sequence + 1, updatedAt: now })
      .where(eq(invoiceCounters.organizationId, organizationId));
  }

  return formatInvoiceNumber(prefix, Number(issueDate.slice(0, 4)), sequence);
}

export async function voidInvoice(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<InvoiceDetail> {
  const before = await getInvoiceRow(ctx, id);

  if (!canTransitionInvoice(before.status as Invoice['status'], 'void')) {
    throw preconditionFailed(`An invoice in status "${before.status}" cannot be voided`);
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ status: 'void', voidedAt: ctx.now, voidReason: reason, updatedAt: ctx.now })
      .where(scopeById(invoices, ctx.auth.organizationId, id));

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'invoice.voided',
      resourceType: 'invoice',
      resourceId: id,
      before: { status: before.status },
      after: { status: 'void', reason },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getInvoice(ctx, id);
}

export async function recordPayment(
  ctx: RequestContext,
  invoiceId: string,
  input: RecordPaymentInput,
): Promise<InvoiceDetail> {
  const invoice = await getInvoiceRow(ctx, invoiceId);

  if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
    throw preconditionFailed(`Cannot record a payment against a ${invoice.status} invoice`);
  }

  const amount = fromMoneyInput(input.amount);
  if (amount.currency !== invoice.currency) {
    throw preconditionFailed(`Payment must be in ${invoice.currency}; received ${amount.currency}`);
  }
  if (amount.amount <= 0) {
    throw preconditionFailed('A payment must be a positive amount');
  }

  const currency = invoice.currency as CurrencyCode;
  const paidAfter = money(invoice.paidAmount + amount.amount, currency);
  const total = money(invoice.totalAmount, currency);
  const nextStatus = settlementStatus(total, paidAfter);

  await ctx.db.transaction(async (tx) => {
    await tx.insert(payments).values({
      id: newId('payment'),
      organizationId: ctx.auth.organizationId,
      invoiceId,
      clientId: invoice.clientId,
      amountAmount: amount.amount,
      amountCurrency: amount.currency,
      paidAt: input.paidAt ?? toIsoDate(ctx.now),
      method: input.method,
      reference: input.reference ?? null,
      recordedByUserId: ctx.auth.userId,
      notes: input.notes ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await tx
      .update(invoices)
      .set({
        paidAmount: paidAfter.amount,
        status: nextStatus === 'paid' ? 'paid' : 'partially_paid',
        paidAt: nextStatus === 'paid' ? ctx.now : null,
        updatedAt: ctx.now,
      })
      .where(scopeById(invoices, ctx.auth.organizationId, invoiceId));

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'payment.recorded',
      resourceType: 'invoice',
      resourceId: invoiceId,
      before: { paidAmount: invoice.paidAmount, status: invoice.status },
      after: { paidAmount: paidAfter.amount, status: nextStatus, amount: amount.amount },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getInvoice(ctx, invoiceId);
}

/**
 * Every line must be priced in the invoice's currency.
 *
 * Mixing them would produce a total that means nothing, and `Money` refuses to
 * add across currencies anyway — this turns that refusal into a 412 with a
 * message the caller can act on.
 */
function assertLinesMatchCurrency(lines: CreateInvoiceInput['lines'], currency: string): void {
  for (const line of lines) {
    if (line.unitPrice.currency !== currency) {
      throw preconditionFailed(
        `Line prices must be in ${currency}; found ${line.unitPrice.currency}`,
      );
    }
  }
}

async function insertLines(
  tx: Executor,
  ctx: RequestContext,
  invoiceId: string,
  lines: CreateInvoiceInput['lines'],
  computed: ReturnType<typeof computeInvoice>['lines'],
): Promise<void> {
  await tx.insert(invoiceLines).values(
    lines.map((line, index) => {
      const totals = computed[index];
      return {
        id: newId('invoiceLine'),
        organizationId: ctx.auth.organizationId,
        invoiceId,
        projectId: line.projectId ?? null,
        position: index,
        description: line.description,
        quantityMilli: toQuantityMilli(line.quantity),
        unitPriceAmount: fromMoneyInput(line.unitPrice).amount,
        taxRateBp: toBasisPoints(line.taxRate),
        discountRateBp: toBasisPoints(line.discountRate),
        lineSubtotalAmount: totals?.subtotal.amount ?? 0,
        lineDiscountAmount: totals?.discount.amount ?? 0,
        lineTaxAmount: totals?.tax.amount ?? 0,
        lineTotalAmount: totals?.total.amount ?? 0,
        createdAt: ctx.now,
      };
    }),
  );
}

/* ------------------------------------------------------------- expenses -- */

interface ExpenseRow {
  id: string;
  description: string;
  category: string;
  status: string;
  amountAmount: number;
  amountCurrency: string;
  taxAmountAmount: number | null;
  incurredAt: string;
  projectId: string | null;
  employeeId: string | null;
  vendor: string | null;
  documentId: string | null;
  billable: boolean;
  approvedAt: Date | null;
  rejectionReason: string | null;
  notes: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSelection = {
  id: expenses.id,
  description: expenses.description,
  category: expenses.category,
  status: expenses.status,
  amountAmount: expenses.amountAmount,
  amountCurrency: expenses.amountCurrency,
  taxAmountAmount: expenses.taxAmountAmount,
  incurredAt: expenses.incurredAt,
  projectId: expenses.projectId,
  employeeId: expenses.employeeId,
  vendor: expenses.vendor,
  documentId: expenses.documentId,
  billable: expenses.billable,
  approvedAt: expenses.approvedAt,
  rejectionReason: expenses.rejectionReason,
  notes: expenses.notes,
  tags: expenses.tags,
  metadata: expenses.metadata,
  createdAt: expenses.createdAt,
  updatedAt: expenses.updatedAt,
};

function toExpense(row: ExpenseRow): Expense {
  const currency = row.amountCurrency as CurrencyCode;
  return {
    id: row.id,
    description: row.description,
    category: row.category as Expense['category'],
    status: row.status as Expense['status'],
    amount: toMoneyOutput(money(row.amountAmount, currency)),
    taxAmount: toMoneyOutputOrNull(readMoney(row.taxAmountAmount, currency)),
    incurredAt: row.incurredAt,
    projectId: row.projectId,
    employeeId: row.employeeId,
    vendor: row.vendor,
    documentId: row.documentId,
    billable: row.billable,
    approvedAt: isoOrNull(row.approvedAt),
    rejectionReason: row.rejectionReason,
    notes: row.notes,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listExpenses(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    status?: string;
    category?: string;
    projectId?: string;
    employeeId?: string;
    from?: string;
    to?: string;
  },
): Promise<Page<Expense>> {
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(expenses.status, query.status as never));
  if (query.category) filters.push(eq(expenses.category, query.category as never));
  if (query.projectId) filters.push(eq(expenses.projectId, query.projectId));
  if (query.employeeId) filters.push(eq(expenses.employeeId, query.employeeId));
  if (query.from) filters.push(gte(expenses.incurredAt, query.from));
  if (query.to) filters.push(lte(expenses.incurredAt, query.to));

  const page = await paginate<ExpenseRow>(
    ctx.db.select(expenseSelection).from(expenses).$dynamic(),
    expenses,
    ctx,
    { limit: query.limit, cursor: query.cursor, filters },
  );
  return mapPage(page, toExpense);
}

export async function getExpense(ctx: RequestContext, id: string): Promise<Expense> {
  return toExpense(
    await findByIdOrThrow<ExpenseRow>(
      ctx.db.select(expenseSelection).from(expenses).$dynamic(),
      expenses,
      ctx,
      id,
      'Expense',
    ),
  );
}

export async function createExpense(
  ctx: RequestContext,
  input: CreateExpenseInput,
): Promise<Expense> {
  await assertBelongsToOrganization(ctx, projects, input.projectId, 'Project');

  const amount = fromMoneyInput(input.amount);
  const tax = input.taxAmount ? fromMoneyInput(input.taxAmount) : null;
  if (tax && tax.currency !== amount.currency) {
    throw preconditionFailed('Expense tax must be in the same currency as the amount');
  }

  const id = newId('expense');

  await ctx.db.transaction(async (tx) => {
    await tx.insert(expenses).values({
      id,
      organizationId: ctx.auth.organizationId,
      description: input.description,
      category: input.category,
      // Filing an expense submits it; `draft` exists for imports and drafts
      // created by an integration.
      status: 'submitted',
      amountAmount: amount.amount,
      amountCurrency: amount.currency,
      taxAmountAmount: tax?.amount ?? null,
      incurredAt: input.incurredAt,
      projectId: input.projectId ?? null,
      employeeId: input.employeeId ?? null,
      vendor: input.vendor ?? null,
      documentId: input.documentId ?? null,
      billable: input.billable,
      submittedByUserId: ctx.auth.userId,
      notes: input.notes ?? null,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'expense.created',
      resourceType: 'expense',
      resourceId: id,
      after: { description: input.description, amount: amount.amount, category: input.category },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getExpense(ctx, id);
}

/**
 * Approve or reject an expense.
 *
 * Self-approval is refused: the person who filed a claim is not the person who
 * signs it off. That is the smallest useful separation of duties, and the one
 * an auditor asks about first.
 */
export async function reviewExpense(
  ctx: RequestContext,
  id: string,
  approved: boolean,
  reason?: string,
): Promise<Expense> {
  const [row] = await ctx.db
    .select({
      id: expenses.id,
      status: expenses.status,
      submittedByUserId: expenses.submittedByUserId,
    })
    .from(expenses)
    .where(scopeById(expenses, ctx.auth.organizationId, id))
    .limit(1);

  if (!row) throw notFound('Expense', id);

  if (row.status === 'approved' || row.status === 'paid') {
    throw conflict(`This expense is already ${row.status}`);
  }
  if (row.submittedByUserId === ctx.auth.userId) {
    throw conflict('An expense cannot be approved by the person who filed it');
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        status: approved ? 'approved' : 'rejected',
        approvedByUserId: ctx.auth.userId,
        approvedAt: approved ? ctx.now : null,
        rejectionReason: approved ? null : (reason ?? null),
        updatedAt: ctx.now,
      })
      .where(scopeById(expenses, ctx.auth.organizationId, id));

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: approved ? 'expense.approved' : 'expense.rejected',
      resourceType: 'expense',
      resourceId: id,
      before: { status: row.status },
      after: { status: approved ? 'approved' : 'rejected', reason },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getExpense(ctx, id);
}

/* -------------------------------------------------------------- reports -- */

export interface AgingRow {
  label: ReturnType<typeof agingBucket>;
  amount: number;
  invoiceCount: number;
}

/** Receivables grouped into the conventional 0/30/60/90+ buckets. */
export async function receivablesAging(
  ctx: RequestContext,
  currency: CurrencyCode,
): Promise<{ rows: AgingRow[]; total: number }> {
  const today = toIsoDate(ctx.now);

  const open = await ctx.db
    .select({
      dueDate: invoices.dueDate,
      totalAmount: invoices.totalAmount,
      paidAmount: invoices.paidAmount,
    })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid')`,
      ),
    );

  const buckets = new Map<AgingRow['label'], AgingRow>([
    ['current', { label: 'current', amount: 0, invoiceCount: 0 }],
    ['1-30', { label: '1-30', amount: 0, invoiceCount: 0 }],
    ['31-60', { label: '31-60', amount: 0, invoiceCount: 0 }],
    ['61-90', { label: '61-90', amount: 0, invoiceCount: 0 }],
    ['90+', { label: '90+', amount: 0, invoiceCount: 0 }],
  ]);

  let total = 0;
  for (const invoice of open) {
    const outstanding = invoice.totalAmount - invoice.paidAmount;
    if (outstanding <= 0) continue;
    const bucket = buckets.get(agingBucket(invoice.dueDate, today));
    if (!bucket) continue;
    bucket.amount += outstanding;
    bucket.invoiceCount += 1;
    total += outstanding;
  }

  return { rows: [...buckets.values()], total };
}

export { BASIS_POINTS, QUANTITY_SCALE };
