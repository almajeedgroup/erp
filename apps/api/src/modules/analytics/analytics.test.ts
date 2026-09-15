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

describe('analytics', () => {
  let ctx: TestContext;
  let owner: TestSession;
  let clientId: string;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
    owner = await registerOrganization(ctx);
    const call = authed(ctx, owner);

    clientId = (
      await call({
        method: 'POST',
        url: '/api/v1/clients',
        payload: { name: 'Riyadh Metro', status: 'active', acquisitionChannel: 'referral' },
      })
    ).json().id;

    projectId = (
      await call({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'Phase 2', clientId, status: 'active' },
      })
    ).json().id;
  });

  const issueInvoice = async (amountMinorUnits: string, issueDate = '2026-06-01') => {
    const call = authed(ctx, owner);
    const draft = await call({
      method: 'POST',
      url: '/api/v1/invoices',
      payload: {
        clientId,
        projectId,
        currency: 'SAR',
        issueDate,
        lines: [{ description: 'Work', quantity: 1, unitPrice: sar(amountMinorUnits) }],
      },
    });
    const issued = await call({
      method: 'POST',
      url: `/api/v1/invoices/${draft.json().id}/issue`,
    });
    return issued.json();
  };

  const approveExpense = async (amountMinorUnits: string, incurredAt = '2026-06-02') => {
    const member = await addMember(ctx, owner, 'member');
    const filed = await authed(
      ctx,
      member,
    )({
      method: 'POST',
      url: '/api/v1/expenses',
      payload: {
        description: 'Materials',
        category: 'subcontractor',
        amount: sar(amountMinorUnits),
        incurredAt,
        projectId,
      },
    });
    await authed(
      ctx,
      owner,
    )({
      method: 'POST',
      url: `/api/v1/expenses/${filed.json().id}/review`,
      payload: { approved: true },
    });
    return filed.json();
  };

  describe('overview', () => {
    it('reports zeroed metrics for a new organization', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/analytics/overview',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.currency).toBe('SAR');
      expect(body.revenue).toEqual(sar('0'));
      // A margin on zero revenue is undefined, not zero — reporting 0% would
      // put a misleading number on a dashboard.
      expect(body.grossMarginPercent).toBe(null);
      expect(body.utilizationPercent).toBe(null);
      expect(body.activeClients).toBe(1);
      expect(body.activeProjects).toBe(1);
    });

    it('counts issued invoices as revenue and approved expenses as cost', async () => {
      await issueInvoice('1000000'); // 10,000.00
      await approveExpense('250000'); // 2,500.00

      const body = (
        await authed(ctx, owner)({ method: 'GET', url: '/api/v1/analytics/overview' })
      ).json();

      expect(body.revenue).toEqual(sar('1000000'));
      expect(body.expenses).toEqual(sar('250000'));
      expect(body.grossProfit).toEqual(sar('750000'));
      expect(body.grossMarginPercent).toBe(75);
    });

    it('excludes a draft invoice from revenue', async () => {
      await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/invoices',
        payload: {
          clientId,
          currency: 'SAR',
          issueDate: '2026-06-01',
          lines: [{ description: 'Work', quantity: 1, unitPrice: sar('500000') }],
        },
      });

      const body = (
        await authed(ctx, owner)({ method: 'GET', url: '/api/v1/analytics/overview' })
      ).json();
      expect(body.revenue).toEqual(sar('0'));
    });

    it('excludes an unapproved expense from cost', async () => {
      const member = await addMember(ctx, owner, 'member');
      await authed(
        ctx,
        member,
      )({
        method: 'POST',
        url: '/api/v1/expenses',
        payload: { description: 'Pending', amount: sar('900000'), incurredAt: '2026-06-02' },
      });

      const body = (
        await authed(ctx, owner)({ method: 'GET', url: '/api/v1/analytics/overview' })
      ).json();
      expect(body.expenses).toEqual(sar('0'));
    });

    it('tracks receivables as a balance, net of payments', async () => {
      const invoice = await issueInvoice('1000000');
      await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/invoices/${invoice.id}/payments`,
        payload: { amount: sar('400000') },
      });

      const body = (
        await authed(ctx, owner)({ method: 'GET', url: '/api/v1/analytics/overview' })
      ).json();
      expect(body.accountsReceivable).toEqual(sar('600000'));
    });

    it('computes utilisation from billable and non-billable minutes', async () => {
      const call = authed(ctx, owner);
      await call({
        method: 'POST',
        url: '/api/v1/time-entries',
        payload: { projectId, date: '2026-06-10', minutes: 360, billable: true },
      });
      await call({
        method: 'POST',
        url: '/api/v1/time-entries',
        payload: { projectId, date: '2026-06-10', minutes: 120, billable: false },
      });

      const body = (await call({ method: 'GET', url: '/api/v1/analytics/overview' })).json();
      expect(body.billableHours).toBe(6);
      expect(body.nonBillableHours).toBe(2);
      expect(body.utilizationPercent).toBe(75);
    });

    it('ignores amounts in a currency other than the reporting one', async () => {
      const call = authed(ctx, owner);
      const usdClient = await call({
        method: 'POST',
        url: '/api/v1/clients',
        payload: { name: 'US Client', billingCurrency: 'USD' },
      });
      const draft = await call({
        method: 'POST',
        url: '/api/v1/invoices',
        payload: {
          clientId: usdClient.json().id,
          currency: 'USD',
          issueDate: '2026-06-01',
          lines: [
            { description: 'Work', quantity: 1, unitPrice: { amount: '900000', currency: 'USD' } },
          ],
        },
      });
      await call({ method: 'POST', url: `/api/v1/invoices/${draft.json().id}/issue` });

      // Excluded rather than converted at a guessed rate.
      const body = (await call({ method: 'GET', url: '/api/v1/analytics/overview' })).json();
      expect(body.revenue).toEqual(sar('0'));

      const usd = (
        await call({ method: 'GET', url: '/api/v1/analytics/overview?currency=USD' })
      ).json();
      expect(usd.revenue).toEqual({ amount: '900000', currency: 'USD' });
    });

    it('never mixes another organization’s figures in', async () => {
      await issueInvoice('1000000');
      const other = await registerOrganization(ctx);

      const body = (
        await authed(ctx, other)({ method: 'GET', url: '/api/v1/analytics/overview' })
      ).json();
      expect(body.revenue).toEqual(sar('0'));
      expect(body.activeClients).toBe(0);
    });
  });

  describe('revenue series', () => {
    it('emits every bucket in the range, including empty ones', async () => {
      await issueInvoice('1000000', '2026-04-15');

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/analytics/revenue?from=2026-03-01&to=2026-06-30&granularity=month',
      });

      const points = response.json().points;
      expect(points.map((p: { period: string }) => p.period)).toEqual([
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
      ]);
      expect(points[0].revenue).toEqual(sar('0'));
      expect(points[1].revenue).toEqual(sar('1000000'));
    });
  });

  describe('project profitability', () => {
    it('values labour at cost rate, not billable rate', async () => {
      const call = authed(ctx, owner);

      const employee = await call({
        method: 'POST',
        url: '/api/v1/employees',
        payload: {
          firstName: 'Sara',
          lastName: 'Ahmed',
          costRate: sar('10000'), // 100.00/hour cost
          billableRate: sar('40000'), // 400.00/hour billed
        },
      });

      await issueInvoice('1000000'); // 10,000.00 billed
      await call({
        method: 'POST',
        url: '/api/v1/time-entries',
        payload: {
          projectId,
          employeeId: employee.json().id,
          date: '2026-06-10',
          minutes: 600, // 10 hours
        },
      });

      const response = await call({
        method: 'GET',
        url: '/api/v1/analytics/project-profitability',
      });

      const row = response
        .json()
        .rows.find((r: { projectId: string }) => r.projectId === projectId);
      expect(row.billedRevenue).toEqual(sar('1000000'));
      expect(row.laborCost).toEqual(sar('100000')); // 10h x 100.00, not x 400.00
      expect(row.margin).toEqual(sar('900000'));
      expect(row.marginPercent).toBe(90);
      expect(row.hours).toBe(10);
    });
  });

  describe('receivables aging', () => {
    it('buckets an overdue invoice by how late it is', async () => {
      await issueInvoice('1000000', '2026-01-01'); // due 2026-01-31, now is 2026-06-15

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/analytics/receivables-aging',
      });

      const body = response.json();
      expect(body.total).toEqual(sar('1000000'));
      const bucket = body.buckets.find(
        (b: { amount: { amount: string } }) => b.amount.amount !== '0',
      );
      expect(bucket.label).toBe('90+');
      expect(bucket.invoiceCount).toBe(1);
    });
  });

  describe('cash flow', () => {
    it('projects thirteen weeks from today', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/analytics/cash-flow',
      });
      expect(response.json().weeks).toHaveLength(13);
      expect(response.json().weeks[0].weekStart).toBe('2026-06-15'); // a Monday
    });

    it('places an overdue receivable in the first week', async () => {
      await issueInvoice('1000000', '2026-01-01');

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/analytics/cash-flow',
      });
      expect(response.json().weeks[0].expectedInflow).toEqual(sar('1000000'));
    });
  });

  describe('permissions', () => {
    it('is readable by a viewer', async () => {
      const viewer = await addMember(ctx, owner, 'viewer');
      const response = await authed(
        ctx,
        viewer,
      )({
        method: 'GET',
        url: '/api/v1/analytics/overview',
      });
      expect(response.statusCode).toBe(200);
    });

    it('is denied to a plain member', async () => {
      const member = await addMember(ctx, owner, 'member');
      const response = await authed(
        ctx,
        member,
      )({
        method: 'GET',
        url: '/api/v1/analytics/overview',
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
