import { refreshTokens, users } from '@almajeed/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerOrganization, type TestContext } from '../../test/harness.js';

describe('auth', () => {
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

  describe('POST /auth/register', () => {
    it('creates an organization whose first user is the owner', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          organizationName: 'Al-Majeed Contracting',
          name: 'Owner',
          email: 'owner@almajeed.test',
          password: 'correct horse battery staple',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.user.role).toBe('owner');
      expect(body.user.email).toBe('owner@almajeed.test');
      expect(body.user.permissions).toContain('invoice:issue');
      expect(body.tokens.tokenType).toBe('Bearer');
      expect(body.tokens.accessToken.split('.')).toHaveLength(3);
    });

    it('never returns the password hash', async () => {
      const session = await registerOrganization(ctx);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: session.headers,
      });
      expect(response.body).not.toContain('argon2');
      expect(response.body).not.toContain('passwordHash');
    });

    it('rejects a duplicate email', async () => {
      await registerOrganization(ctx, { email: 'taken@example.com' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          organizationName: 'Another Co',
          name: 'Someone',
          email: 'taken@example.com',
          password: 'correct horse battery staple',
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
    });

    it('rejects a weak password with a field-level issue', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          organizationName: 'Co',
          name: 'Someone',
          email: 'someone@example.com',
          password: 'short',
        },
      });
      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.error.code).toBe('validation_failed');
      expect(body.error.issues.some((i: { path: string }) => i.path === 'password')).toBe(true);
    });

    it('rejects unknown fields instead of ignoring them', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          organizationName: 'Co',
          name: 'Someone',
          email: 'someone@example.com',
          password: 'correct horse battery staple',
          role: 'owner',
          isAdmin: true,
        },
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await registerOrganization(ctx, { email: 'user@example.com' });
    });

    it('returns a token pair for correct credentials', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'correct horse battery staple' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().tokens.refreshToken).toBeTruthy();
    });

    it('is case-insensitive on the email', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: '  USER@Example.com ', password: 'correct horse battery staple' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('gives an identical answer for a wrong password and an unknown email', async () => {
      const wrongPassword = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'wrong password entirely' },
      });
      const unknownEmail = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong password entirely' },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json().error.code).toBe(unknownEmail.json().error.code);
      expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
    });

    it('locks the account after repeated failures and stays quiet about it', async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'user@example.com', password: `wrong-guess-${attempt}` },
        });
      }

      const [row] = await ctx.database.db
        .select({ lockedUntil: users.lockedUntil, failures: users.failedLoginCount })
        .from(users)
        .where(eq(users.email, 'user@example.com'));
      expect(row?.failures).toBe(8);
      expect(row?.lockedUntil).toBeInstanceOf(Date);

      // Even the correct password is refused while locked — and the error is
      // the same one a wrong password produces.
      const locked = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'correct horse battery staple' },
      });
      expect(locked.statusCode).toBe(401);
      expect(locked.json().error.code).toBe('invalid_credentials');
    });

    it('clears the failure counter after a success', async () => {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'wrong' },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'correct horse battery staple' },
      });

      const [row] = await ctx.database.db
        .select({ failures: users.failedLoginCount })
        .from(users)
        .where(eq(users.email, 'user@example.com'));
      expect(row?.failures).toBe(0);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the token pair', async () => {
      const session = await registerOrganization(ctx);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tokens.refreshToken).not.toBe(session.refreshToken);
      expect(body.user.id).toBe(session.userId);
    });

    it('detects replay and revokes the whole family', async () => {
      const session = await registerOrganization(ctx);

      const first = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(first.statusCode).toBe(200);
      const rotated = first.json().tokens.refreshToken;

      // An attacker replays the original token after the client has moved on.
      const replay = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(replay.statusCode).toBe(401);
      expect(replay.json().error.code).toBe('token_revoked');

      // The legitimate client's current token is revoked too: we cannot tell
      // which party is the thief, so both are logged out.
      const afterReplay = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: rotated },
      });
      expect(afterReplay.statusCode).toBe(401);
    });

    it('records the replay in the audit log', async () => {
      const session = await registerOrganization(ctx);
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });

      const { auditLogs } = await import('@almajeed/db');
      const rows = await ctx.database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'auth.refresh_replay_detected'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.succeeded).toBe(false);
    });

    it('rejects an unknown refresh token', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'a'.repeat(43) },
      });
      expect(response.statusCode).toBe(401);
    });

    it('stores refresh tokens hashed, never in the clear', async () => {
      const session = await registerOrganization(ctx);
      const rows = await ctx.database.db.select().from(refreshTokens);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toHaveLength(64);
      expect(rows[0]?.tokenHash).not.toBe(session.refreshToken);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the family and is idempotent', async () => {
      const session = await registerOrganization(ctx);

      const first = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });
      expect(first.statusCode).toBe(200);

      const second = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });
      expect(second.statusCode).toBe(200);

      const refreshAfter = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(refreshAfter.statusCode).toBe(401);
    });

    it('does not reveal whether an unknown token existed', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: 'z'.repeat(43) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });

  describe('GET /auth/me', () => {
    it('requires a token', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('unauthenticated');
    });

    it('rejects a tampered token', async () => {
      const session = await registerOrganization(ctx);
      const [header, payload] = session.accessToken.split('.');
      const forged = `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${forged}` },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a token signed with the wrong key', async () => {
      const session = await registerOrganization(ctx);
      const other = await createTestContext({
        JWT_SECRET: 'a-completely-different-secret-32char!',
      });
      try {
        const response = await other.app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: session.headers,
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await other.close();
      }
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and revokes existing sessions', async () => {
      const session = await registerOrganization(ctx, { email: 'rotate@example.com' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: session.headers,
        payload: {
          currentPassword: 'correct horse battery staple',
          newPassword: 'an entirely different passphrase',
        },
      });
      expect(response.statusCode).toBe(200);

      const oldRefresh = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(oldRefresh.statusCode).toBe(401);

      const newLogin = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'rotate@example.com', password: 'an entirely different passphrase' },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it('refuses when the current password is wrong', async () => {
      const session = await registerOrganization(ctx);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: session.headers,
        payload: { currentPassword: 'not it', newPassword: 'an entirely different passphrase' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('operational endpoints', () => {
    it('serves liveness without touching the database', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('ok');
    });

    it('serves readiness', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(200);
    });

    it('echoes a correlation id on every response', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'trace-abc-123' },
      });
      expect(response.headers['x-request-id']).toBe('trace-abc-123');
    });

    it('returns a structured 404 for an unknown route', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('not_found');
      expect(response.json().error.requestId).toBeTruthy();
    });
  });
});
