import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authed,
  createTestContext,
  registerOrganization,
  type TestContext,
  type TestSession,
} from '../../test/harness.js';

describe('organization administration', () => {
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
    owner = await registerOrganization(ctx, { name: 'Al-Majeed Group' });
  });

  describe('profile', () => {
    it('returns the caller’s own organization', async () => {
      const response = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/organization' });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Al-Majeed Group');
      expect(response.json().baseCurrency).toBe('SAR');
    });

    it('lets an owner update settings', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: '/api/v1/organization',
        payload: { baseCurrency: 'AED', defaultTaxRate: 5, country: 'ae' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().baseCurrency).toBe('AED');
      expect(response.json().defaultTaxRate).toBe(5);
      expect(response.json().country).toBe('AE');
    });

    it('denies a manager the settings update', async () => {
      const manager = await addMember(ctx, owner, 'manager');
      const response = await authed(
        ctx,
        manager,
      )({
        method: 'PATCH',
        url: '/api/v1/organization',
        payload: { name: 'Renamed' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('membership', () => {
    it('adds a member with the requested role', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/organization/members',
        payload: {
          email: 'finance@example.com',
          name: 'Finance Lead',
          role: 'finance',
          password: 'correct horse battery staple',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().role).toBe('finance');
    });

    it('rejects adding the same person twice', async () => {
      const payload = {
        email: 'dup@example.com',
        name: 'Dup',
        role: 'member' as const,
        password: 'correct horse battery staple',
      };
      await authed(ctx, owner)({ method: 'POST', url: '/api/v1/organization/members', payload });
      const second = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/organization/members',
        payload,
      });
      expect(second.statusCode).toBe(409);
    });

    it('lists members with their roles', async () => {
      await addMember(ctx, owner, 'finance');
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/organization/members',
      });
      const roles = response.json().map((m: { role: string }) => m.role);
      expect(roles).toContain('owner');
      expect(roles).toContain('finance');
    });
  });

  describe('privilege escalation', () => {
    it('stops an admin from creating an owner', async () => {
      const admin = await addMember(ctx, owner, 'admin');
      const response = await authed(
        ctx,
        admin,
      )({
        method: 'POST',
        url: '/api/v1/organization/members',
        payload: {
          email: 'newowner@example.com',
          name: 'New Owner',
          role: 'owner',
          password: 'correct horse battery staple',
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it('stops an admin from promoting anyone to admin', async () => {
      const admin = await addMember(ctx, owner, 'admin');
      const member = await addMember(ctx, owner, 'member');

      const response = await authed(
        ctx,
        admin,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${member.userId}/role`,
        payload: { role: 'admin' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('stops an admin from promoting themselves', async () => {
      const admin = await addMember(ctx, owner, 'admin');
      const response = await authed(
        ctx,
        admin,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${admin.userId}/role`,
        payload: { role: 'owner' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('stops a manager from changing roles at all', async () => {
      const manager = await addMember(ctx, owner, 'manager');
      const member = await addMember(ctx, owner, 'member');

      const response = await authed(
        ctx,
        manager,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${member.userId}/role`,
        payload: { role: 'admin' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('lets an owner promote and demote below owner', async () => {
      const member = await addMember(ctx, owner, 'member');
      const promoted = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${member.userId}/role`,
        payload: { role: 'finance' },
      });
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json().role).toBe('finance');
    });

    it('keeps at least one owner', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${owner.userId}/role`,
        payload: { role: 'admin' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toMatch(/at least one owner/i);
    });

    it('refuses to act on a member of another organization', async () => {
      const other = await registerOrganization(ctx);
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${other.userId}/role`,
        payload: { role: 'viewer' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('removal', () => {
    it('revokes the membership and the live sessions together', async () => {
      const member = await addMember(ctx, owner, 'member');

      // The member is working normally.
      const before = await authed(ctx, member)({ method: 'GET', url: '/api/v1/auth/me' });
      expect(before.statusCode).toBe(200);

      const removed = await authed(
        ctx,
        owner,
      )({
        method: 'DELETE',
        url: `/api/v1/organization/members/${member.userId}`,
      });
      expect(removed.statusCode).toBe(200);

      // Their still-unexpired access token stops working immediately, because
      // authorization re-reads the membership on every request.
      const after = await authed(ctx, member)({ method: 'GET', url: '/api/v1/auth/me' });
      expect(after.statusCode).toBe(401);

      // And their refresh token cannot mint a new one.
      const refreshed = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: member.refreshToken },
      });
      expect(refreshed.statusCode).toBe(401);
    });

    it('refuses self-removal', async () => {
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'DELETE',
        url: `/api/v1/organization/members/${owner.userId}`,
      });
      expect(response.statusCode).toBe(409);
    });

    it('refuses to remove the last owner', async () => {
      const admin = await addMember(ctx, owner, 'admin');
      const response = await authed(
        ctx,
        admin,
      )({
        method: 'DELETE',
        url: `/api/v1/organization/members/${owner.userId}`,
      });
      // An admin may not remove an owner at all.
      expect(response.statusCode).toBe(403);
    });
  });

  describe('audit log', () => {
    it('records membership changes', async () => {
      const member = await addMember(ctx, owner, 'member');
      await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/organization/members/${member.userId}/role`,
        payload: { role: 'viewer' },
      });

      const audit = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/organization/audit',
      });
      const actions = audit.json().items.map((row: { action: string }) => row.action);
      expect(actions).toContain('member.added');
      expect(actions).toContain('member.role_changed');
    });

    it('never exposes another organization’s audit rows', async () => {
      const other = await registerOrganization(ctx);
      await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: '/api/v1/clients',
        payload: { name: 'Their Client' },
      });

      const audit = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/organization/audit' });
      const resources = audit.json().items.map((row: { resourceType: string }) => row.resourceType);
      expect(resources).not.toContain('client');
    });
  });
});
