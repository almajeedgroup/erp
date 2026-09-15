import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

/**
 * Migration runner.
 *
 * Deliberately a library function rather than a CLI-only concern, so the same
 * code path is used by `npm run db:migrate`, by the release job and by any
 * future bootstrapping script. Drizzle records applied files in
 * `__drizzle_migrations` and takes an advisory lock, so two API replicas
 * starting at once cannot both apply the same migration.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
}
