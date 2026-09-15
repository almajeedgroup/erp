import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test/harness.js';
import { DEMO_PASSWORD, seedDemoData } from './demo-data.js';

/**
 * The seed script is the first thing a new developer runs. Running it here, in
 * full, against in-process Postgres means a broken seed fails CI rather than
 * someone's first afternoon.
 *
 * It doubles as the broadest integration test in the suite: one pass exercises
 * registration, invitations, clients, projects, employees, timesheets, the
 * whole invoice lifecycle, expense approval, tasks and document indexing in
 * the order a real organization would use them.
 */
describe('demo data', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
  });

  it('runs end to end and leaves a coherent organization', async () => {
    const result = await seedDemoData({
      db: ctx.database.db,
      services: {
        config: ctx.config,
        tokens: ctx.app.services.tokens,
        passwords: ctx.app.services.passwords,
        storage: ctx.storage,
        ai: ctx.ai,
        clock: () => new Date('2026-06-15T12:00:00.000Z'),
      },
      now: new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result.organizationId).toMatch(/^org_/);
    expect(result.accounts).toHaveLength(5);
  });

  it('leaves every seeded account able to sign in', async () => {
    const result = await seedDemoData({
      db: ctx.database.db,
      services: {
        config: ctx.config,
        tokens: ctx.app.services.tokens,
        passwords: ctx.app.services.passwords,
        storage: ctx.storage,
        ai: ctx.ai,
        clock: () => new Date('2026-06-15T12:00:00.000Z'),
      },
      now: new Date('2026-06-15T12:00:00.000Z'),
    });

    for (const account of result.accounts) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: account.email, password: DEMO_PASSWORD },
      });
      expect(response.statusCode, `${account.email} could not sign in`).toBe(200);
      expect(response.json().user.role).toBe(account.role);
    }
  });

  it('produces a dashboard with real numbers on it', async () => {
    await seedDemoData({
      db: ctx.database.db,
      services: {
        config: ctx.config,
        tokens: ctx.app.services.tokens,
        passwords: ctx.app.services.passwords,
        storage: ctx.storage,
        ai: ctx.ai,
        clock: () => new Date('2026-06-15T12:00:00.000Z'),
      },
      now: new Date('2026-06-15T12:00:00.000Z'),
    });

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@almajeed.test', password: DEMO_PASSWORD },
    });
    const headers = { authorization: `Bearer ${login.json().tokens.accessToken}` };

    const overview = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/analytics/overview',
      headers,
    });
    const metrics = overview.json();

    expect(Number(metrics.revenue.amount)).toBeGreaterThan(0);
    expect(Number(metrics.expenses.amount)).toBeGreaterThan(0);
    expect(Number(metrics.accountsReceivable.amount)).toBeGreaterThan(0);
    expect(metrics.activeClients).toBe(2);
    expect(metrics.activeProjects).toBe(3);
    expect(metrics.activeEmployees).toBe(2);
    expect(metrics.openTasks).toBe(4);
    expect(metrics.billableHours).toBeGreaterThan(0);
    expect(metrics.utilizationPercent).toBeGreaterThan(0);

    // An overdue invoice is seeded deliberately so the aging report is not empty.
    const aging = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/analytics/receivables-aging',
      headers,
    });
    expect(Number(aging.json().total.amount)).toBeGreaterThan(0);

    // And the handbook is indexed, so retrieval has something to find.
    const search = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai/search',
      headers,
      payload: { query: 'payment terms for Riyadh Metro', minScore: 0 },
    });
    expect(search.json().results.length).toBeGreaterThan(0);
  });

  it('gives each seeded role the access its job needs', async () => {
    await seedDemoData({
      db: ctx.database.db,
      services: {
        config: ctx.config,
        tokens: ctx.app.services.tokens,
        passwords: ctx.app.services.passwords,
        storage: ctx.storage,
        ai: ctx.ai,
        clock: () => new Date('2026-06-15T12:00:00.000Z'),
      },
      now: new Date('2026-06-15T12:00:00.000Z'),
    });

    const signIn = async (email: string) => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: DEMO_PASSWORD },
      });
      return { authorization: `Bearer ${response.json().tokens.accessToken}` };
    };

    // Finance sees salaries; the delivery manager does not.
    const financeHeaders = await signIn('finance@almajeed.test');
    const managerHeaders = await signIn('manager@almajeed.test');

    const asFinance = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/employees',
      headers: financeHeaders,
    });
    const asManager = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/employees',
      headers: managerHeaders,
    });

    // Pick the employee by name rather than by position: both seeded records
    // are written in the same transaction, so they share `created_at` and the
    // keyset tiebreaker (`id DESC`) leaves their order undefined between runs.
    const sara = (body: { items: { fullName: string; compensation: unknown }[] }) =>
      body.items.find((item) => item.fullName === 'Sara Ahmed');

    const financeView = sara(asFinance.json());
    const managerView = sara(asManager.json());

    expect(financeView).toBeDefined();
    expect(managerView).toBeDefined();
    // The same person, seen by two roles: the sensitive block is present for
    // one and null for the other, while the rest of the record is identical.
    expect(financeView?.compensation).not.toBe(null);
    expect(managerView?.compensation).toBe(null);
    expect(managerView?.fullName).toBe('Sara Ahmed');

    // The auditor can read the books but cannot touch them.
    const auditorHeaders = await signIn('auditor@almajeed.test');
    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/invoices',
      headers: auditorHeaders,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().items.length).toBeGreaterThan(0);

    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: auditorHeaders,
      payload: { name: 'Should not work' },
    });
    expect(write.statusCode).toBe(403);
  });
});
