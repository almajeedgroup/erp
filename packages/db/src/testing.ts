import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from './client.js';
import * as schema from './schema/index.js';

/**
 * The test database.
 *
 * Tests run against **real Postgres** — PGlite is Postgres compiled to
 * WebAssembly, running in the same process. That buys the thing integration
 * tests usually give up: enum constraints, foreign keys, partial unique
 * indexes and transaction semantics are all genuinely exercised, with no
 * container to start, no port to allocate and no shared state between CI jobs.
 *
 * The same committed migrations that run in production are applied here, so a
 * migration that does not apply cleanly fails the test suite rather than the
 * deploy.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface TestDatabase {
  db: Database;
  client: PGlite;
  /** Empty every table but keep the schema. Cheaper than re-migrating. */
  truncate: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;

  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    client,
    truncate: async () => {
      const result = await client.query<{ tablename: string }>(
        `select tablename from pg_tables
          where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
      );
      const tables = result.rows.map((row) => `"${row.tablename}"`);
      if (tables.length === 0) return;
      await client.exec(`truncate table ${tables.join(', ')} restart identity cascade;`);
    },
    close: async () => {
      await client.close();
    },
  };
}

/** Assert the migration set applies to an empty database and leaves the expected tables. */
export async function listTables(db: Database): Promise<string[]> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const rows = (result as unknown as { rows: { tablename: string }[] }).rows ?? [];
  return rows.map((row) => row.tablename);
}
