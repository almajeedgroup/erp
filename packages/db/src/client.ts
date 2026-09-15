import { sql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;

/**
 * The database handle.
 *
 * Typed against the driver-agnostic `PgDatabase` rather than
 * `NodePgDatabase`, so the same service code runs against the connection pool
 * in production and against an in-process PGlite instance in the test suite.
 * Nothing in `apps/api` imports a driver directly.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type Transaction = PgTransaction<
  PgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/** Anything you can run a query on: the pool, or a transaction inside it. */
export type Executor = Database | Transaction;

export interface DatabaseOptions {
  url: string;
  /**
   * Upper bound on pooled connections. Sized against Postgres `max_connections`
   * divided by the number of API replicas — over-provisioning here is how you
   * get "sorry, too many clients already" during a deploy.
   */
  poolMax?: number;
  ssl?: boolean;
  /** Fail fast rather than queueing forever behind an exhausted pool. */
  connectionTimeoutMillis?: number;
  /** Cheap protection against a single pathological query pinning a connection. */
  statementTimeoutMillis?: number;
  logger?: boolean;
}

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  /** `SELECT 1` — used by the readiness probe, not the liveness probe. */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: options.statementTimeoutMillis ?? 30_000,
    application_name: 'almajeed-erp-api',
  });

  // A pool error with no listener takes the process down. Swallowing it is
  // wrong too, so it is logged and the connection is discarded by the pool.
  pool.on('error', (error) => {
    console.error('[db] idle client error', error);
  });

  const db = drizzle(pool, { schema, logger: options.logger ?? false }) as unknown as Database;

  return {
    db,
    pool,
    ping: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
