import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authed,
  createTestContext,
  registerOrganization,
  type TestContext,
  type TestSession,
} from '../../test/harness.js';

describe('clients', () => {
  let ctx: TestContext;
  let owner: TestSession;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
    owner = await registerOrganization(ctx);
  });

  const create = async (session: TestSession, body: Record<string, unknown>) =>
    authed(ctx, session)({ method: 'POST', url: '/api/v1/clients', payload: body });

  describe('create and read', () => {
    it('creates a client with sensible defaults', async () => {
      const response = await create(owner, { name: 'Riyadh Metro Authority' });
      expect(response.statusCode).toBe(201);

      const client = response.json();
      expect(client.id).toMatch(/^cli_[0-9a-f]{32}$/);
      expect(client.status).toBe('lead');
      expect(client.billingCurrency).toBe('SAR');
      expect(client.paymentTermsDays).toBe(30);
      expect(client.tags).toEqual([]);
    });

    it('round-trips every supplied field', async () => {
      const response = await create(owner, {
        name: 'Gulf Logistics',
        legalName: 'Gulf Logistics Co. LLC',
        status: 'active',
        email: 'Accounts@Gulf.example',
        phone: '+966 55 123 4567',
        website: 'https://gulf.example',
        taxNumber: '300012345600003',
        billingCurrency: 'AED',
        paymentTermsDays: 45,
        acquisitionChannel: 'referral',
        address: { line1: 'King Fahd Rd', city: 'Riyadh', country: 'sa' },
        tags: ['logistics', 'enterprise'],
      });

      const client = response.json();
      expect(client.legalName).toBe('Gulf Logistics Co. LLC');
      expect(client.email).toBe('accounts@gulf.example'); // normalised
      expect(client.billingCurrency).toBe('AED');
      expect(client.paymentTermsDays).toBe(45);
      expect(client.address.country).toBe('SA'); // upper-cased
      expect(client.tags).toEqual(['logistics', 'enterprise']);
    });

    it('rejects an unknown currency', async () => {
      const response = await create(owner, { name: 'X', billingCurrency: 'XYZ' });
      expect(response.statusCode).toBe(422);
    });

    it('fetches one client by id', async () => {
      const created = (await create(owner, { name: 'Acme' })).json();
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients/${created.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Acme');
    });

    it('404s on a well-formed id that does not exist', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients/cli_${'0'.repeat(32)}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('422s on an id of the wrong resource kind', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients/prj_${'0'.repeat(32)}`,
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('tenant isolation', () => {
    it('never returns another organization’s clients in a list', async () => {
      await create(owner, { name: 'Ours' });
      const other = await registerOrganization(ctx);
      await create(other, { name: 'Theirs' });

      const ourList = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/clients' });
      expect(ourList.json().items.map((c: { name: string }) => c.name)).toEqual(['Ours']);

      const theirList = await authed(ctx, other)({ method: 'GET', url: '/api/v1/clients' });
      expect(theirList.json().items.map((c: { name: string }) => c.name)).toEqual(['Theirs']);
    });

    it('404s — not 403 — when reading another tenant’s client by its exact id', async () => {
      const other = await registerOrganization(ctx);
      const theirs = (await create(other, { name: 'Theirs' })).json();

      const response = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients/${theirs.id}`,
      });
      // 404 rather than 403: a 403 would confirm the record exists.
      expect(response.statusCode).toBe(404);
    });

    it('refuses to update another tenant’s client', async () => {
      const other = await registerOrganization(ctx);
      const theirs = (await create(other, { name: 'Theirs' })).json();

      const response = await authed(ctx, owner)({
        method: 'PATCH',
        url: `/api/v1/clients/${theirs.id}`,
        payload: { name: 'Hijacked' },
      });
      expect(response.statusCode).toBe(404);

      const unchanged = await authed(ctx, other)({
        method: 'GET',
        url: `/api/v1/clients/${theirs.id}`,
      });
      expect(unchanged.json().name).toBe('Theirs');
    });

    it('refuses to delete another tenant’s client', async () => {
      const other = await registerOrganization(ctx);
      const theirs = (await create(other, { name: 'Theirs' })).json();

      const response = await authed(ctx, owner)({
        method: 'DELETE',
        url: `/api/v1/clients/${theirs.id}`,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('permissions', () => {
    it('lets a viewer read but not write', async () => {
      const viewer = await addMember(ctx, owner, 'viewer');

      const list = await authed(ctx, viewer)({ method: 'GET', url: '/api/v1/clients' });
      expect(list.statusCode).toBe(200);

      const created = await create(viewer, { name: 'Nope' });
      expect(created.statusCode).toBe(403);
      expect(created.json().error.code).toBe('forbidden');
    });

    it('lets a manager create and update but not delete', async () => {
      const manager = await addMember(ctx, owner, 'manager');

      const created = await create(manager, { name: 'Managed Co' });
      expect(created.statusCode).toBe(201);

      const updated = await authed(ctx, manager)({
        method: 'PATCH',
        url: `/api/v1/clients/${created.json().id}`,
        payload: { status: 'active' },
      });
      expect(updated.statusCode).toBe(200);

      const deleted = await authed(ctx, manager)({
        method: 'DELETE',
        url: `/api/v1/clients/${created.json().id}`,
      });
      expect(deleted.statusCode).toBe(403);
    });

    it('denies a member without client:create', async () => {
      const member = await addMember(ctx, owner, 'member');
      expect((await create(member, { name: 'Nope' })).statusCode).toBe(403);
    });
  });

  describe('listing', () => {
    beforeEach(async () => {
      for (const name of ['Alpha Trading', 'Beta Works', 'Gamma Group']) {
        await create(owner, { name, status: name.startsWith('Alpha') ? 'active' : 'lead' });
      }
    });

    it('filters by status', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: '/api/v1/clients?status=active',
      });
      expect(response.json().items).toHaveLength(1);
      expect(response.json().items[0].name).toBe('Alpha Trading');
    });

    it('searches by name', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: '/api/v1/clients?q=beta',
      });
      expect(response.json().items).toHaveLength(1);
    });

    it('treats a wildcard in the search term literally', async () => {
      const response = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/clients?q=%25' });
      expect(response.json().items).toHaveLength(0);
    });

    it('pages with a stable cursor', async () => {
      const first = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/clients?limit=2' });
      const firstPage = first.json();
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toBeTruthy();

      const second = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      });
      const secondPage = second.json();
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBe(null);

      const ids = [...firstPage.items, ...secondPage.items].map((c: { id: string }) => c.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('rejects an over-large page size rather than silently clamping', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: '/api/v1/clients?limit=5000',
      });
      expect(response.statusCode).toBe(422);
    });

    it('treats a corrupt cursor as the first page', async () => {
      const response = await authed(ctx, owner)({
        method: 'GET',
        url: '/api/v1/clients?cursor=not-a-real-cursor',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(3);
    });
  });

  describe('deletion', () => {
    it('soft-deletes and hides the client afterwards', async () => {
      const client = (await create(owner, { name: 'Gone' })).json();

      const deleted = await authed(ctx, owner)({
        method: 'DELETE',
        url: `/api/v1/clients/${client.id}`,
      });
      expect(deleted.statusCode).toBe(200);

      const fetched = await authed(ctx, owner)({
        method: 'GET',
        url: `/api/v1/clients/${client.id}`,
      });
      expect(fetched.statusCode).toBe(404);

      const list = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/clients' });
      expect(list.json().items).toHaveLength(0);
    });
  });

  describe('contacts', () => {
    it('keeps at most one primary contact', async () => {
      const client = (await create(owner, { name: 'Contact Co' })).json();
      const call = authed(ctx, owner);

      await call({
        method: 'POST',
        url: `/api/v1/clients/${client.id}/contacts`,
        payload: { name: 'First', isPrimary: true },
      });
      await call({
        method: 'POST',
        url: `/api/v1/clients/${client.id}/contacts`,
        payload: { name: 'Second', isPrimary: true },
      });

      const list = await call({ method: 'GET', url: `/api/v1/clients/${client.id}/contacts` });
      const primaries = list.json().filter((c: { isPrimary: boolean }) => c.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].name).toBe('Second');
    });

    it('refuses to add a contact to another tenant’s client', async () => {
      const other = await registerOrganization(ctx);
      const theirs = (await create(other, { name: 'Theirs' })).json();

      const response = await authed(ctx, owner)({
        method: 'POST',
        url: `/api/v1/clients/${theirs.id}/contacts`,
        payload: { name: 'Intruder', isPrimary: false },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('audit trail', () => {
    it('records creation, update and deletion', async () => {
      const client = (await create(owner, { name: 'Audited' })).json();
      const call = authed(ctx, owner);
      await call({
        method: 'PATCH',
        url: `/api/v1/clients/${client.id}`,
        payload: { status: 'active' },
      });
      await call({ method: 'DELETE', url: `/api/v1/clients/${client.id}` });

      const audit = await call({ method: 'GET', url: '/api/v1/organization/audit' });
      const actions = audit.json().items.map((row: { action: string }) => row.action);
      expect(actions).toContain('client.created');
      expect(actions).toContain('client.updated');
      expect(actions).toContain('client.deleted');
    });

    it('records the actor and the request id', async () => {
      await create(owner, { name: 'Traced' });
      const audit = await authed(ctx, owner)({
        method: 'GET',
        url: '/api/v1/organization/audit?action=client.created',
      });
      const row = audit.json().items[0];
      expect(row.actorUserId).toBe(owner.userId);
      expect(row.requestId).toBeTruthy();
    });

    it('is not readable by a manager', async () => {
      const manager = await addMember(ctx, owner, 'manager');
      const response = await authed(ctx, manager)({
        method: 'GET',
        url: '/api/v1/organization/audit',
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
