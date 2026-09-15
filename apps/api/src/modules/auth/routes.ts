import {
  authResponseSchema,
  changePasswordSchema,
  errorBodySchema,
  loginSchema,
  okSchema,
  refreshSchema,
  registerSchema,
  sessionUserSchema,
} from '@almajeed/shared';
import { organizations, users } from '@almajeed/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthDeps } from './service.js';
import { buildSessionUser, changePassword, login, logout, refresh, register } from './service.js';

/**
 * Authentication routes.
 *
 * These are the only endpoints reachable without a session, so they carry the
 * tightest rate limits in the system: credential stuffing is the attack that
 * actually happens, and a global limit tuned for normal API traffic is far too
 * generous for a login form.
 */
export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const depsFor = (request: FastifyRequest): AuthDeps => ({
    db: app.db,
    services: app.services,
    requestId: request.id,
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    now: app.services.clock(),
  });

  // Credential endpoints carry their own, much tighter budget than the global
  // one — a limit tuned for ordinary API traffic is far too generous for a
  // login form. Both are operator-tunable; see AUTH_RATE_LIMIT_* in .env.example.
  const limits = app.services.config.rateLimit;
  const credentialLimit = {
    rateLimit: { max: limits.authMax, timeWindow: limits.authWindowMs },
  };
  const registerLimit = {
    rateLimit: { max: limits.registerMax, timeWindow: limits.registerWindowMs },
  };

  app.post(
    '/register',
    {
      config: registerLimit,
      schema: {
        tags: ['auth'],
        summary: 'Create an organization and its first user',
        description:
          'The created user becomes the organization `owner`. Public endpoint, rate ' +
          'limited per IP (REGISTER_RATE_LIMIT_MAX, default 5 per hour).',
        security: [],
        body: registerSchema,
        response: { 201: authResponseSchema, 409: errorBodySchema, 422: errorBodySchema },
      },
    },
    async (request, reply) => {
      const result = await register(depsFor(request), request.body);
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/login',
    {
      config: credentialLimit,
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for a token pair',
        description:
          'Returns the same error for an unknown email and a wrong password, and takes ' +
          'comparable time in both cases, so the endpoint cannot be used to enumerate users.',
        security: [],
        body: loginSchema,
        response: { 200: authResponseSchema, 401: errorBodySchema, 429: errorBodySchema },
      },
    },
    async (request) => login(depsFor(request), request.body),
  );

  app.post(
    '/refresh',
    {
      config: credentialLimit,
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token',
        description:
          'Issues a new token pair and retires the presented token. Presenting an ' +
          'already-used token is treated as a replay and revokes the entire token family.',
        security: [],
        body: refreshSchema,
        response: { 200: authResponseSchema, 401: errorBodySchema },
      },
    },
    async (request) => refresh(depsFor(request), request.body.refreshToken),
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token family',
        description: 'Idempotent, and returns the same response for an unknown token.',
        security: [],
        body: refreshSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      await logout(depsFor(request), request.body.refreshToken);
      return { ok: true as const };
    },
  );

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'The current session',
        description: 'Identity, organization, role and the resolved permission list.',
        response: { 200: sessionUserSchema, 401: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();

      const [row] = await ctx.db
        .select({
          email: users.email,
          name: users.name,
          organizationName: organizations.name,
        })
        .from(users)
        .innerJoin(organizations, eq(organizations.id, ctx.auth.organizationId))
        .where(eq(users.id, ctx.auth.userId))
        .limit(1);

      return buildSessionUser({
        userId: ctx.auth.userId,
        email: row?.email ?? '',
        name: row?.name ?? '',
        role: ctx.auth.role,
        organizationId: ctx.auth.organizationId,
        organizationName: row?.organizationName ?? '',
      });
    },
  );

  app.post(
    '/change-password',
    {
      preHandler: app.authenticate,
      config: credentialLimit,
      schema: {
        tags: ['auth'],
        summary: 'Change the current user’s password',
        description: 'Revokes every other session on success.',
        body: changePasswordSchema,
        response: { 200: okSchema, 401: errorBodySchema, 422: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      await changePassword(
        depsFor(request),
        ctx.auth.userId,
        ctx.auth.organizationId,
        request.body.currentPassword,
        request.body.newPassword,
      );
      return { ok: true as const };
    },
  );
};
