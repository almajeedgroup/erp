import {
  approveExpenseSchema,
  createExpenseSchema,
  createInvoiceSchema,
  errorBodySchema,
  expenseSchema,
  id,
  invoiceDetailSchema,
  invoiceSchema,
  listExpensesQuerySchema,
  listInvoicesQuerySchema,
  pageOf,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createExpense,
  createInvoice,
  getExpense,
  getInvoice,
  issueInvoice,
  listExpenses,
  listInvoices,
  recordPayment,
  reviewExpense,
  updateInvoice,
  voidInvoice,
} from './service.js';

const invoiceParams = z.object({ invoiceId: id('invoice') });
const expenseParams = z.object({ expenseId: id('expense') });

export const invoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('invoice:read'),
      schema: {
        tags: ['finance'],
        summary: 'List invoices',
        description:
          '`overdue` and `daysOverdue` are derived at read time from the due date and the ' +
          'outstanding balance — they are never stored, so they cannot go stale.',
        querystring: listInvoicesQuerySchema,
        response: { 200: pageOf(invoiceSchema), 403: errorBodySchema },
      },
    },
    async (request) => listInvoices(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('invoice:create'),
      schema: {
        tags: ['finance'],
        summary: 'Create a draft invoice',
        description:
          'Totals are computed server-side from the lines; any totals in the request body ' +
          'are rejected by the schema. Every line must be priced in the invoice currency. ' +
          'A gapless number is allocated at issue, not here.',
        body: createInvoiceSchema,
        response: {
          201: invoiceDetailSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createInvoice(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:invoiceId',
    {
      preHandler: app.requirePermission('invoice:read'),
      schema: {
        tags: ['finance'],
        summary: 'Fetch an invoice with its lines and payments',
        params: invoiceParams,
        response: { 200: invoiceDetailSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getInvoice(request.ctx(), request.params.invoiceId),
  );

  app.patch(
    '/:invoiceId',
    {
      preHandler: app.requirePermission('invoice:update'),
      schema: {
        tags: ['finance'],
        summary: 'Edit a draft invoice',
        description:
          'Refused with 412 once the invoice has been issued — an issued document is ' +
          'immutable and is corrected by voiding and re-issuing.',
        params: invoiceParams,
        body: updateInvoiceSchema,
        response: {
          200: invoiceDetailSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => updateInvoice(request.ctx(), request.params.invoiceId, request.body),
  );

  app.post(
    '/:invoiceId/issue',
    {
      preHandler: app.requirePermission('invoice:issue'),
      schema: {
        tags: ['finance'],
        summary: 'Issue a draft invoice',
        description:
          'Allocates the next gapless number from a transactionally locked counter, stamps ' +
          'the issue date and derives the due date from the client’s payment terms.',
        params: invoiceParams,
        response: {
          200: invoiceDetailSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => issueInvoice(request.ctx(), request.params.invoiceId),
  );

  app.post(
    '/:invoiceId/void',
    {
      preHandler: app.requirePermission('invoice:void'),
      schema: {
        tags: ['finance'],
        summary: 'Void an issued invoice',
        description: 'The row is kept, with the reason, so the series stays unbroken.',
        params: invoiceParams,
        body: voidInvoiceSchema,
        response: {
          200: invoiceDetailSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => voidInvoice(request.ctx(), request.params.invoiceId, request.body.reason),
  );

  app.post(
    '/:invoiceId/payments',
    {
      preHandler: app.requirePermission('payment:record'),
      schema: {
        tags: ['finance'],
        summary: 'Record a payment',
        description:
          'Advances the invoice to partially_paid or paid. The payment currency must match ' +
          'the invoice. Overpayment settles the invoice rather than erroring.',
        params: invoiceParams,
        body: recordPaymentSchema,
        response: {
          200: invoiceDetailSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => recordPayment(request.ctx(), request.params.invoiceId, request.body),
  );
};

export const expenseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('expense:read'),
      schema: {
        tags: ['finance'],
        summary: 'List expenses',
        querystring: listExpensesQuerySchema,
        response: { 200: pageOf(expenseSchema), 403: errorBodySchema },
      },
    },
    async (request) => listExpenses(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('expense:create'),
      schema: {
        tags: ['finance'],
        summary: 'File an expense',
        body: createExpenseSchema,
        response: {
          201: expenseSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createExpense(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:expenseId',
    {
      preHandler: app.requirePermission('expense:read'),
      schema: {
        tags: ['finance'],
        summary: 'Fetch one expense',
        params: expenseParams,
        response: { 200: expenseSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getExpense(request.ctx(), request.params.expenseId),
  );

  app.post(
    '/:expenseId/review',
    {
      preHandler: app.requirePermission('expense:approve'),
      schema: {
        tags: ['finance'],
        summary: 'Approve or reject an expense',
        description:
          'Separation of duties: the person who filed a claim cannot approve it, and an ' +
          'already-approved claim cannot be reviewed again.',
        params: expenseParams,
        body: approveExpenseSchema,
        response: {
          200: expenseSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) =>
      reviewExpense(
        request.ctx(),
        request.params.expenseId,
        request.body.approved,
        request.body.reason,
      ),
  );
};
