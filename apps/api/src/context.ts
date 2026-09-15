import type { Permission, Role } from '@almajeed/shared';
import type { Database, Executor } from '@almajeed/db';
import type { AppConfig } from './config/env.js';
import type { PasswordHasher } from './lib/password.js';
import type { StorageDriver } from './lib/storage.js';
import type { TokenService } from './lib/tokens.js';
import type { AiProvider } from './modules/ai/provider.js';

/**
 * Request context.
 *
 * Services take a context and an input, and nothing else. They never see the
 * Fastify request, which means:
 *
 *  - they cannot accidentally read the organization id from a path parameter
 *    instead of the verified token,
 *  - they are callable from a background job, a CLI script or the AI agent's
 *    tool layer with no HTTP involved,
 *  - and they are trivially testable without spinning up a server.
 *
 * `auth` is always present on a service context. Unauthenticated routes do not
 * call services that need one.
 */

export interface AuthContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  /** Resolved from the role once per request, so `can()` is not called in a loop. */
  permissions: ReadonlySet<Permission>;
}

export interface RequestContext {
  db: Database;
  auth: AuthContext;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** Injected so tests can pin "now" and date-sensitive logic stays deterministic. */
  now: Date;
  services: AppServices;
}

/** A context bound to a transaction, for multi-statement writes. */
export interface TxContext extends Omit<RequestContext, 'db'> {
  db: Executor;
}

export interface AppServices {
  config: AppConfig;
  tokens: TokenService;
  passwords: PasswordHasher;
  storage: StorageDriver;
  ai: AiProvider;
  clock: () => Date;
}

/** Narrow a request context onto a transaction executor. */
export function withExecutor(ctx: RequestContext, executor: Executor): TxContext {
  return { ...ctx, db: executor };
}
