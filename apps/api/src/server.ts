import { randomUUID } from 'node:crypto';
import type { Database } from '@almajeed/db';
import { sql } from 'drizzle-orm';
import Fastify, {
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import type { AppServices } from './context.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createPasswordHasher } from './lib/password.js';
import { createStorage, type StorageDriver } from './lib/storage.js';
import { createTokenService } from './lib/tokens.js';
import { createAiProvider, type AiProvider } from './modules/ai/provider.js';
import { authPlugin } from './plugins/auth.js';
import { docsPlugin } from './plugins/docs.js';
import { errorsPlugin } from './plugins/errors.js';
import { securityPlugin } from './plugins/security.js';
import { registerRoutes } from './routes.js';

/**
 * Server construction.
 *
 * `buildServer` takes its dependencies rather than reaching for globals, which
 * is what makes the whole API testable: the suite hands it an in-process
 * Postgres and a deterministic model provider and drives it with
 * `app.inject()` — no port, no container, no network.
 */

/**
 * The concrete server type: Zod as the type provider, pino as the logger.
 * Naming it keeps `buildServer`'s signature readable and its declaration
 * output small.
 */
export type ApiServer = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger,
  ZodTypeProvider
>;

export interface BuildServerOptions {
  config: AppConfig;
  db: Database;
  /** Overridable so tests can use a temp directory or a fake. */
  storage?: StorageDriver;
  ai?: AiProvider;
  /** Injected clock; tests pin it so date-dependent reports are deterministic. */
  clock?: () => Date;
}

export async function buildServer(options: BuildServerOptions): Promise<ApiServer> {
  const { config, db } = options;

  const app = Fastify({
    loggerInstance: createLogger(config),
    // Trust the proxy only where one is actually in front of us. Trusting it
    // unconditionally lets any client spoof `X-Forwarded-For` and defeat both
    // rate limiting and the audit trail's idea of who did what.
    trustProxy: config.isProduction,
    // Correlation id: accept an inbound one so a trace spans services, but
    // generate a fresh one when absent. Echoed on every response and in errors.
    genReqId: (request) => {
      const inbound = request.headers['x-request-id'];
      if (typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 64) return inbound;
      return `req_${randomUUID().replaceAll('-', '')}`;
    },
    requestIdHeader: false,
    bodyLimit: 1_048_576, // 1 MiB for JSON; uploads go through @fastify/multipart
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  // Zod drives both request validation and response serialization.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const services: AppServices = {
    config,
    tokens: createTokenService({
      secret: config.auth.jwtSecret,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      accessTokenTtl: config.auth.accessTokenTtl,
    }),
    passwords: createPasswordHasher(config.auth.passwordPepper),
    storage: options.storage ?? createStorage(config),
    ai: options.ai ?? createAiProvider(config),
    clock: options.clock ?? (() => new Date()),
  };

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { config });
  await app.register(docsPlugin, { config });
  await app.register(authPlugin, { db, services });

  // Liveness: is the process up? Deliberately does not touch the database —
  // a liveness probe that fails on a database blip restarts healthy pods.
  app.get('/health', { schema: { hide: true } }, async () => ({
    status: 'ok' as const,
    version: '0.1.0',
  }));

  // Readiness: should this instance receive traffic? This one does check the
  // database, because an instance that cannot query is not ready to serve.
  app.get('/ready', { schema: { hide: true } }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' as const };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(registerRoutes, { prefix: '/api/v1' });

  await app.ready();
  return app;
}
