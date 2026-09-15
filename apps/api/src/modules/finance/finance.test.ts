import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authed,
  createTestContext,
  registerOrganization,
  type TestContext,
  type TestSession,
} from '../../test/harness.js';

const sar = (amount: string) => ({ amount, currency: 'SAR' });

describe('finance', () => {
  let ctx: TestContext;
  let owner: TestSession;
  let clientId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
    owner = await registerOrganization(ctx);
    const client = await authed(
      ctx,
      owner,
    )({
      method: 'POST',
      url: '/api/v1/clients',
      payload: { name: 'Riyadh Metro', paymentTermsDays: 30 },
    });
    clientId = client.json().id;
  });

  const draft = async (session = owner, overrides: Record<string, unknown> = {}) =>
    authed(
      ctx,
      session,
    )({
      method: 'POST',
      url: '/api/v1/invoices',
      payload: {
        clientId,
        currency: 'SAR',
        lines: [
          {
            description: 'Consulting, March',
            quantity: 10,
            unitPrice: sar('50000'), // 500.00
            taxRate: 15,
          },
        ],
        ...overrides,
      },
    });

  describe('drafting', () => {
    it('computes totals server-side from the lines', async () => {
      const response = await draft();
      expect(response.statusCode).toBe(201);

      const invoice = response.json();
      expect(invoice.status).toBe('draft');
      expect(invoice.subtotal).toEqual(sar('500000')); // 5,000.00
      expect(invoice.tax).toEqual(sar('75000')); // 750.00
      expect(invoice.total).toEqual(sar('575000')); // 5,750.00
      expect(invoice.balanceDue).toEqual(sar('575000'));
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0].quantity).toBe(10);
    });

    it('ignores client-supplied totals because the schema has no such field', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/invoices',
        payload: {
          clientId,
          currency: 'SAR',
          total: sar('1'),
          lines: [{ description: 'X', quantity: 1, unitPrice: sar('10000') }],
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it('refuses a line priced in another currency', async () => {
      const response = await draft(owner, {
        lines: [{ description: 'X', quantity: 1, unitPrice: { amount: '100', currency: 'USD' } }],
      });
      expect(response.statusCode).toBe(412);
    });

    it('refuses an invoice with no lines', async () => {
      const response = await draft(owner, { lines: [] });
      expect(response.statusCode).toBe(422);
    });

    it('refuses a client from another organization', async () => {
      const other = await registerOrganization(ctx);
      const theirClient = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: '/api/v1/clients',
        payload: { name: 'Theirs' },
      });

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/invoices',
        payload: {
          clientId: theirClient.json().id,
          currency: 'SAR',
          lines: [{ description: 'X', quantity: 1, unitPrice: sar('100') }],
        },
      });
      expect(response.statusCode).toBe(404);
    });

    it('allows editing while it is a draft', async () => {
      const invoice = (await draft()).json();
      const updated = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/invoices/${invoice.id}`,
        payload: {
          lines: [{ description: 'Revised', quantity: 1, unitPrice: sar('10000'), taxRate: 15 }],
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().total).toEqual(sar('11500'));
    });
  });

  describe('issuing', () => {
    it('allocates a gapless number and derives the due date from payment terms', async () => {
      const invoice = (await draft()).json();

      const issued = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/issue`,
      });
      expect(issued.statusCode).toBe(200);

      const body = issued.json();
      expect(body.status).toBe('issued');
      expect(body.number).toBe('INV-2026-0001');
      expect(body.issueDate).toBe('2026-06-15'); // the pinned clock
      expect(body.dueDate).toBe('2026-07-15'); // +30 days
    });

    it('numbers invoices consecutively with no gaps', async () => {
      const numbers: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const invoice = (await draft()).json();
        const issued = await authed(
          ctx,
          owner,
        )({
          method: 'POST',
          url: `/api/v1/invoices/${invoice.id}/issue`,
        });
        numbers.push(issued.json().number);
      }
      expect(numbers).toEqual(['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003', 'INV-2026-0004']);
    });

    it('numbers each organization independently', async () => {
      const first = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${first.id}/issue` });

      const other = await registerOrganization(ctx);
      const theirClient = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: '/api/v1/clients',
        payload: { name: 'Theirs' },
      });
      const theirDraft = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: '/api/v1/invoices',
        payload: {
          clientId: theirClient.json().id,
          currency: 'SAR',
          lines: [{ description: 'X', quantity: 1, unitPrice: sar('100') }],
        },
      });
      const theirIssued = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${theirDraft.json().id}/issue`,
      });

      // Their series starts at 1 too — counters are per organization.
      expect(theirIssued.json().number).toBe('INV-2026-0001');
    });

    it('makes an issued invoice immutable', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });

      const edit = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/invoices/${invoice.id}`,
        payload: { notes: 'sneaky change' },
      });
      expect(edit.statusCode).toBe(412);
      expect(edit.json().error.message).toMatch(/only a draft/i);
    });

    it('refuses to issue the same invoice twice', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });
      const again = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/issue`,
      });
      expect(again.statusCode).toBe(412);
    });

    it('requires invoice:issue, which a manager does not hold', async () => {
      const manager = await addMember(ctx, owner, 'manager');
      const invoice = (await draft()).json();
      const response = await authed(
        ctx,
        manager,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/issue`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('payment', () => {
    let invoiceId: string;

    beforeEach(async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });
      invoiceId = invoice.id;
    });

    it('moves to partially_paid and tracks the balance', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        payload: { amount: sar('200000'), method: 'bank_transfer' },
      });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe('partially_paid');
      expect(body.paid).toEqual(sar('200000'));
      expect(body.balanceDue).toEqual(sar('375000'));
      expect(body.payments).toHaveLength(1);
    });

    it('settles the invoice when paid in full across several payments', async () => {
      const call = authed(ctx, owner);
      await call({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        payload: { amount: sar('300000') },
      });
      const final = await call({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        payload: { amount: sar('275000') },
      });

      expect(final.json().status).toBe('paid');
      expect(final.json().balanceDue).toEqual(sar('0'));
      expect(final.json().payments).toHaveLength(2);
    });

    it('treats an overpayment as settled rather than an error', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        payload: { amount: sar('999999') },
      });
      expect(response.json().status).toBe('paid');
      expect(response.json().balanceDue).toEqual(sar('0'));
    });

    it('refuses a payment in the wrong currency', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        payload: { amount: { amount: '100', currency: 'USD' } },
      });
      expect(response.statusCode).toBe(412);
    });

    it('refuses a zero or negative payment', async () => {
      for (const amount of ['0', '-100']) {
        const response = await authed(
          ctx,
          owner,
        )({
          method: 'POST',
          url: `/api/v1/invoices/${invoiceId}/payments`,
          payload: { amount: sar(amount) },
        });
        expect(response.statusCode).toBe(412);
      }
    });

    it('refuses a payment against a draft', async () => {
      const newDraft = (await draft()).json();
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${newDraft.id}/payments`,
        payload: { amount: sar('1000') },
      });
      expect(response.statusCode).toBe(412);
    });
  });

  describe('voiding', () => {
    it('voids an issued invoice and keeps the row', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });

      const voided = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/void`,
        payload: { reason: 'Wrong client contact' },
      });
      expect(voided.statusCode).toBe(200);
      expect(voided.json().status).toBe('void');

      const fetched = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/invoices/${invoice.id}`,
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json().number).toBe('INV-2026-0001');
    });

    it('refuses to void a draft', async () => {
      const invoice = (await draft()).json();
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/void`,
        payload: { reason: 'nope' },
      });
      expect(response.statusCode).toBe(412);
    });
  });

  describe('overdue detection', () => {
    it('reports overdue only after the due date passes', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });

      const before = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/invoices/${invoice.id}`,
      });
      expect(before.json().overdue).toBe(false);

      ctx.setNow(new Date('2026-08-01T12:00:00.000Z')); // past the 2026-07-15 due date
      const after = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/invoices/${invoice.id}`,
      });
      expect(after.json().overdue).toBe(true);
      expect(after.json().daysOverdue).toBe(17);

      ctx.setNow(new Date('2026-06-15T12:00:00.000Z'));
    });

    it('filters the list to overdue invoices', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });

      ctx.setNow(new Date('2026-08-01T12:00:00.000Z'));
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/invoices?overdueOnly=true',
      });
      expect(response.json().items).toHaveLength(1);

      ctx.setNow(new Date('2026-06-15T12:00:00.000Z'));
      const none = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/invoices?overdueOnly=true',
      });
      expect(none.json().items).toHaveLength(0);
    });
  });

  describe('expenses', () => {
    it('files an expense as submitted', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: {
          description: 'AWS, March',
          category: 'infrastructure',
          amount: sar('120000'),
          incurredAt: '2026-03-31',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('submitted');
    });

    it('refuses self-approval', async () => {
      const filed = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: {
          description: 'Dinner',
          amount: sar('40000'),
          incurredAt: '2026-03-01',
        },
      });

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/expenses/${filed.json().id}/review`,
        payload: { approved: true },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toMatch(/cannot be approved by the person who filed/i);
    });

    it('lets a different approver approve it', async () => {
      const member = await addMember(ctx, owner, 'member');
      const filed = await authed(
        ctx,
        member,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: { description: 'Taxi', amount: sar('9000'), incurredAt: '2026-03-02' },
      });

      const approved = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/expenses/${filed.json().id}/review`,
        payload: { approved: true },
      });
      expect(approved.statusCode).toBe(200);
      expect(approved.json().status).toBe('approved');
      expect(approved.json().approvedAt).toBeTruthy();
    });

    it('records a rejection with its reason', async () => {
      const member = await addMember(ctx, owner, 'member');
      const filed = await authed(
        ctx,
        member,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: { description: 'Gift', amount: sar('500000'), incurredAt: '2026-03-02' },
      });

      const rejected = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/expenses/${filed.json().id}/review`,
        payload: { approved: false, reason: 'Outside policy' },
      });
      expect(rejected.json().status).toBe('rejected');
      expect(rejected.json().rejectionReason).toBe('Outside policy');
    });

    it('refuses to review an already-approved expense', async () => {
      const member = await addMember(ctx, owner, 'member');
      const filed = await authed(
        ctx,
        member,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: { description: 'Taxi', amount: sar('9000'), incurredAt: '2026-03-02' },
      });
      const url = `/api/v1/expenses/${filed.json().id}/review`;
      await authed(ctx, owner)({ method: 'POST', url, payload: { approved: true } });

      const again = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url,
        payload: { approved: false, reason: 'changed my mind' },
      });
      expect(again.statusCode).toBe(409);
    });

    it('denies approval to a member', async () => {
      const first = await addMember(ctx, owner, 'member');
      const second = await addMember(ctx, owner, 'member');
      const filed = await authed(
        ctx,
        first,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: { description: 'Taxi', amount: sar('9000'), incurredAt: '2026-03-02' },
      });

      const response = await authed(
        ctx,
        second,
      )({
        method: 'POST',
        url: `/api/v1/expenses/${filed.json().id}/review`,
        payload: { approved: true },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('hides another organization’s invoices', async () => {
      const invoice = (await draft()).json();
      const other = await registerOrganization(ctx);

      const list = await authed(ctx, other)({ method: 'GET', url: '/api/v1/invoices' });
      expect(list.json().items).toHaveLength(0);

      const direct = await authed(
        ctx,
        other,
      )({
        method: 'GET',
        url: `/api/v1/invoices/${invoice.id}`,
      });
      expect(direct.statusCode).toBe(404);
    });

    it('refuses a payment against another organization’s invoice', async () => {
      const invoice = (await draft()).json();
      await authed(ctx, owner)({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/issue` });

      const other = await registerOrganization(ctx);
      const response = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/payments`,
        payload: { amount: sar('1000') },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
