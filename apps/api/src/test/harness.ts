import { createHash } from 'node:crypto';
import type { Role } from '@almajeed/shared';
import { createTestDatabase, type TestDatabase } from '@almajeed/db/testing';
import { type AppConfig, envSchema, toConfig } from '../config/env.js';
import type { StorageDriver, StoredObject } from '../lib/storage.js';
import { createMockProvider, type AiProvider } from '../modules/ai/provider.js';
import { buildServer, type ApiServer } from '../server.js';

/**
 * The integration test harness.
 *
 * Builds a complete API against in-process Postgres (PGlite), a memory storage
 * driver and the deterministic model provider, then drives it through
 * `app.inject()`. No port is bound, no container runs and no external service
 * is called, so the whole suite is hermetic and runs in CI unchanged.
 *
 * The clock is pinned, so any report or due-date calculation is reproducible.
 */

export const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test/test',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-32+',
  PASSWORD_PEPPER: 'test-password-pepper-long-enough-32char',
  AI_PROVIDER: 'mock',
  STORAGE_DRIVER: 'local',
  // Limits are raised, not removed, so a test can still lower one deliberately
  // (see security.test.ts) while the rest of the suite is not throttled.
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  REGISTER_RATE_LIMIT_MAX: '100000',
} as const;

export function createMemoryStorage(): StorageDriver & { contents: Map<string, Buffer> } {
  const contents = new Map<string, Buffer>();
  return {
    name: 'local',
    contents,
    put: async (key, body): Promise<StoredObject> => {
      contents.set(key, body);
      return {
        key,
        sizeBytes: body.byteLength,
        checksum: createHash('sha256').update(body).digest('hex'),
      };
    },
    get: async (key) => {
      const value = contents.get(key);
      if (!value) throw new Error(`No such object: ${key}`);
      return value;
    },
    delete: async (key) => {
      contents.delete(key);
    },
    exists: async (key) => contents.has(key),
  };
}

export interface TestContext {
  app: ApiServer;
  database: TestDatabase;
  storage: ReturnType<typeof createMemoryStorage>;
  config: AppConfig;
  ai: AiProvider;
  /** Advance or pin the clock the server sees. */
  setNow: (value: Date) => void;
  close: () => Promise<void>;
}

export async function createTestContext(
  overrides: Partial<Record<keyof typeof TEST_ENV, string>> = {},
): Promise<TestContext> {
  const database = await createTestDatabase();
  const config = toConfig(envSchema.parse({ ...TEST_ENV, ...overrides }));
  const storage = createMemoryStorage();
  const ai = createMockProvider(config.ai.embeddingDimensions);

  let now = FIXED_NOW;

  const app = await buildServer({
    config,
    db: database.db,
    storage,
    ai,
    clock: () => now,
  });

  return {
    app,
    // `truncate` clears stored objects too, so a test asserting on what is in
    // the object store sees only its own uploads.
    database: {
      ...database,
      truncate: async () => {
        await database.truncate();
        storage.contents.clear();
      },
    },
    storage,
    config,
    ai,
    setNow: (value) => {
      now = value;
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

/* ------------------------------------------------------------- fixtures -- */

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  organizationId: string;
  role: Role;
  /** `Authorization: Bearer ...`, ready to spread into an inject call. */
  headers: { authorization: string };
}

let sequence = 0;

/** Register a fresh organization whose first user is an `owner`. */
export async function registerOrganization(
  ctx: TestContext,
  options: { name?: string; email?: string; password?: string } = {},
): Promise<TestSession> {
  sequence += 1;
  const name = options.name ?? `Al-Majeed ${sequence}`;
  const email = options.email ?? `owner${sequence}@example.com`;
  const password = options.password ?? 'correct horse battery staple';

  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: name, name: `Owner ${sequence}`, email, password },
  });

  if (response.statusCode !== 201) {
    throw new Error(`register failed (${response.statusCode}): ${response.body}`);
  }

  const body = response.json();
  return toSession(body);
}

/** Invite a member with a given role and log in as them. */
export async function addMember(
  ctx: TestContext,
  session: TestSession,
  role: Role,
  options: { email?: string; password?: string } = {},
): Promise<TestSession> {
  sequence += 1;
  const email = options.email ?? `member${sequence}@example.com`;
  const password = options.password ?? 'correct horse battery staple';

  const invited = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/organization/members',
    headers: session.headers,
    payload: { email, name: `Member ${sequence}`, role, password },
  });

  if (invited.statusCode !== 201) {
    throw new Error(`invite failed (${invited.statusCode}): ${invited.body}`);
  }

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });

  if (login.statusCode !== 200) {
    throw new Error(`login failed (${login.statusCode}): ${login.body}`);
  }

  return toSession(login.json());
}

function toSession(body: {
  user: { id: string; organizationId: string; role: Role };
  tokens: { accessToken: string; refreshToken: string };
}): TestSession {
  return {
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    userId: body.user.id,
    organizationId: body.user.organizationId,
    role: body.user.role,
    headers: { authorization: `Bearer ${body.tokens.accessToken}` },
  };
}

/** `inject` with the session's bearer token already attached. */
export function authed(ctx: TestContext, session: TestSession) {
  return (options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }) =>
    ctx.app.inject({
      method: options.method,
      url: options.url,
      headers: { ...session.headers, ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    });
}
