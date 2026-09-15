import { newId } from '@almajeed/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scope, scopeById, scopeIncludingDeleted } from './tenancy.js';
import { clients, contacts, organizations } from './schema/index.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

/**
 * Tenant isolation is the security property this whole package exists to
 * uphold, so it gets adversarial tests rather than happy-path ones: the
 * questions asked here are "can org A see org B's row given its exact id?"
 * and "does a soft-deleted row come back by accident?".
 */
describe('tenant scoping', () => {
  let ctx: TestDatabase;
  const orgA = newId('organization');
  const orgB = newId('organization');
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    ctx = await createTestDatabase();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.truncate();
    await ctx.db.insert(organizations).values([
      { id: orgA, name: 'Al-Majeed Contracting', slug: 'almajeed' },
      { id: orgB, name: 'Rival Holdings', slug: 'rival' },
    ]);
    clientA = newId('client');
    clientB = newId('client');
    await ctx.db.insert(clients).values([
      { id: clientA, organizationId: orgA, name: 'Client of A' },
      { id: clientB, organizationId: orgB, name: 'Client of B' },
    ]);
  });

  it('returns only rows belonging to the organization', async () => {
    const rows = await ctx.db.select().from(clients).where(scope(clients, orgA));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Client of A');
  });

  it('returns nothing when another tenant guesses an exact id', async () => {
    const rows = await ctx.db
      .select()
      .from(clients)
      .where(scopeById(clients, orgA, clientB));
    expect(rows).toHaveLength(0);
  });

  it('finds a row by id inside its own tenant', async () => {
    const rows = await ctx.db
      .select()
      .from(clients)
      .where(scopeById(clients, orgA, clientA));
    expect(rows).toHaveLength(1);
  });

  it('hides soft-deleted rows by default but can include them explicitly', async () => {
    await ctx.db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, clientA));

    expect(await ctx.db.select().from(clients).where(scope(clients, orgA))).toHaveLength(0);
    expect(
      await ctx.db.select().from(clients).where(scopeIncludingDeleted(clients, orgA)),
    ).toHaveLength(1);
  });

  it('keeps the tenant filter even when extra conditions are supplied', async () => {
    const rows = await ctx.db
      .select()
      .from(clients)
      .where(scope(clients, orgA, eq(clients.name, 'Client of B')));
    expect(rows).toHaveLength(0);
  });

  it('cascades deletes from the organization to its rows', async () => {
    await ctx.db.delete(organizations).where(eq(organizations.id, orgB));
    const all = await ctx.db.select().from(clients);
    expect(all.map((row) => row.organizationId)).toEqual([orgA]);
  });
});

describe('database-level constraints', () => {
  let ctx: TestDatabase;
  const org = newId('organization');

  beforeAll(async () => {
    ctx = await createTestDatabase();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.truncate();
    await ctx.db.insert(organizations).values({ id: org, name: 'Al-Majeed', slug: 'almajeed' });
  });

  it('rejects a value outside an enum', async () => {
    await expect(
      ctx.db.insert(clients).values({
        id: newId('client'),
        organizationId: org,
        name: 'Bad status',
        // The enum is enforced by Postgres, not only by Zod.
        status: 'definitely_not_a_status' as never,
      }),
    ).rejects.toThrow();
  });

  it('rejects a row pointing at a non-existent organization', async () => {
    await expect(
      ctx.db.insert(clients).values({
        id: newId('client'),
        organizationId: newId('organization'),
        name: 'Orphan',
      }),
    ).rejects.toThrow();
  });

  it('enforces one organization slug globally', async () => {
    await expect(
      ctx.db
        .insert(organizations)
        .values({ id: newId('organization'), name: 'Copy', slug: 'almajeed' }),
    ).rejects.toThrow();
  });

  it('allows only one primary contact per client', async () => {
    const clientId = newId('client');
    await ctx.db.insert(clients).values({ id: clientId, organizationId: org, name: 'Client' });
    await ctx.db.insert(contacts).values({
      id: newId('contact'),
      organizationId: org,
      clientId,
      name: 'First',
      isPrimary: true,
    });

    await expect(
      ctx.db.insert(contacts).values({
        id: newId('contact'),
        organizationId: org,
        clientId,
        name: 'Second',
        isPrimary: true,
      }),
    ).rejects.toThrow();

    // A non-primary contact is fine, and so is a second primary once the
    // first is soft-deleted — which is what the partial index buys us.
    await expect(
      ctx.db.insert(contacts).values({
        id: newId('contact'),
        organizationId: org,
        clientId,
        name: 'Third',
        isPrimary: false,
      }),
    ).resolves.toBeDefined();
  });

  it('stores money as integer minor units without precision loss', async () => {
    const { invoices } = await import('./schema/index.js');
    const clientId = newId('client');
    await ctx.db.insert(clients).values({ id: clientId, organizationId: org, name: 'Client' });

    const invoiceId = newId('invoice');
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      organizationId: org,
      clientId,
      number: 'INV-0001',
      currency: 'SAR',
      totalAmount: 9_007_199_254_740_990,
    });

    const [row] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row?.totalAmount).toBe(9_007_199_254_740_990);
  });
});
