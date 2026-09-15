import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/env.js';

/**
 * Transport-level hardening.
 *
 * None of this replaces authorization — it removes whole classes of problem so
 * the interesting controls have less to defend. Each choice below is mapped to
 * its OWASP Top 10 entry in docs/03-security/owasp-top-10.md.
 */
export const securityPlugin = fp(
  async (app: FastifyInstance, options: { config: AppConfig }) => {
    const { config } = options;

    await app.register(helmet, {
      /**
       * This service answers JSON, so the strictest possible policy applies:
       * nothing may be loaded, framed, or executed. The docs UI is the one
       * exception and relaxes it on its own prefix.
       */
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      // Browsers must not sniff a JSON response into something executable.
      xContentTypeOptions: true,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // HSTS only matters over TLS, and setting it in dev breaks localhost.
      hsts: config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    });

    /**
     * CORS is an explicit allow-list of origins, never a reflected wildcard.
     * `credentials: true` with `origin: '*'` is rejected by browsers anyway,
     * and reflecting whatever `Origin` arrives is how a CSRF-adjacent bug gets
     * introduced. Only the configured web origin may call this API from a
     * browser; server-to-server callers are unaffected by CORS entirely.
     */
    const allowedOrigins = new Set(
      config.webOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );

    await app.register(cors, {
      origin: (origin, callback) => {
        // No Origin header: curl, a server-side fetch, a health probe.
        if (!origin) return callback(null, true);
        callback(null, allowedOrigins.has(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    });

    /**
     * Rate limiting is keyed on the authenticated principal when there is one
     * and on the IP otherwise. Keying on IP alone punishes everyone behind one
     * corporate NAT for a single noisy client; keying on the principal alone
     * leaves the login endpoint — the one that most needs a limit — unprotected.
     */
    await app.register(rateLimit, {
      global: true,
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.windowMs,
      keyGenerator: (request) => {
        const auth = request.auth;
        return auth ? `user:${auth.userId}` : `ip:${request.ip}`;
      },
      // Health and readiness probes must never be throttled.
      allowList: (request) => request.url === '/health' || request.url === '/ready',
      addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
  },
  { name: 'security' },
);
