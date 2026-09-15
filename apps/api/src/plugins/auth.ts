import {
  type Permission,
  forbidden,
  isRole,
  permissionsFor,
  unauthenticated,
} from '@almajeed/shared';
import { memberships, users } from '@almajeed/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { AppServices, AuthContext, RequestContext } from '../context.js';
import type { Database } from '@almajeed/db';
import { bearerFrom } from '../lib/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated when a valid bearer token was presented; `null` otherwise. */
    auth: AuthContext | null;
    /** The service-layer context for this request. Throws if unauthenticated. */
    ctx: () => RequestContext;
  }

  interface FastifyInstance {
    /** The database handle, for the few routes that run before a session exists. */
    db: Database;
    /** Process-wide collaborators (tokens, hashing, storage, model provider). */
    services: AppServices;
    /** preHandler: require a valid session. */
    authenticate: preHandlerHookHandler;
    /** preHandler factory: require a session *and* a specific permission. */
    requirePermission: (permission: Permission) => preHandlerHookHandler;
  }
}

export interface AuthPluginOptions {
  db: Database;
  services: AppServices;
}

/**
 * Authentication and authorization.
 *
 * The flow, in order, for every request that carries a bearer token:
 *
 *  1. Verify the JWT signature, issuer, audience and expiry, with the
 *     algorithm pinned.
 *  2. Re-read the membership row. This costs one indexed query and buys
 *     **revocation**: removing someone from an organization, or suspending
 *     their user, takes effect on their next request rather than whenever
 *     their access token happens to expire. For a system holding payroll and
 *     invoices, that trade is obviously worth making.
 *  3. Expand the role into its permission set once, so route guards are a set
 *     lookup rather than a matrix walk.
 *
 * The organization id comes from step 1 and is carried on `request.auth`.
 * No route reads it from anywhere else.
 */
export const authPlugin = fp(
  async (app: FastifyInstance, options: AuthPluginOptions) => {
    const { db, services } = options;

    app.decorate('db', db);
    app.decorate('services', services);

    app.decorateRequest('auth', null);
    app.decorateRequest('ctx', function (this: FastifyRequest) {
      if (!this.auth) throw unauthenticated();
      return {
        db,
        auth: this.auth,
        requestId: this.id,
        ipAddress: this.ip ?? null,
        userAgent: this.headers['user-agent'] ?? null,
        now: services.clock(),
        services,
      } satisfies RequestContext;
    });

    app.addHook('onRequest', async (request: FastifyRequest) => {
      const token = bearerFrom(request.headers.authorization);
      if (!token) return;

      const claims = await services.tokens.verifyAccessToken(token);

      const [row] = await db
        .select({
          membershipId: memberships.id,
          role: memberships.role,
          membershipStatus: memberships.status,
          userStatus: users.status,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.id, claims.membershipId),
            eq(memberships.userId, claims.userId),
            eq(memberships.organizationId, claims.organizationId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);

      if (!row || row.membershipStatus !== 'active' || row.userStatus !== 'active') {
        // The token is cryptographically fine but the access behind it is gone.
        throw unauthenticated('Session is no longer valid');
      }

      // The role is read from the database, not from the token, so a demotion
      // takes effect immediately instead of at the next token refresh.
      if (!isRole(row.role)) throw unauthenticated('Session is no longer valid');

      request.auth = {
        userId: claims.userId,
        organizationId: claims.organizationId,
        membershipId: row.membershipId,
        role: row.role,
        permissions: new Set(permissionsFor(row.role)),
      };
    });

    app.decorate('authenticate', async function (request: FastifyRequest, _reply: FastifyReply) {
      if (!request.auth) throw unauthenticated();
    });

    app.decorate('requirePermission', (permission: Permission): preHandlerHookHandler => {
      return async function (request: FastifyRequest, _reply: FastifyReply) {
        if (!request.auth) throw unauthenticated();
        if (!request.auth.permissions.has(permission)) {
          request.log.warn(
            {
              requestId: request.id,
              userId: request.auth.userId,
              organizationId: request.auth.organizationId,
              role: request.auth.role,
              permission,
              route: `${request.method} ${request.url}`,
            },
            'permission denied',
          );
          throw forbidden(`This action requires the "${permission}" permission`);
        }
      };
    });
  },
  { name: 'auth' },
);

/** Convenience for handlers that need to branch on a permission inline. */
export function hasPermission(request: FastifyRequest, permission: Permission): boolean {
  return request.auth?.permissions.has(permission) ?? false;
}
