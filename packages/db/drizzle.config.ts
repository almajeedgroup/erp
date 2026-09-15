import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * Migrations are generated into `./drizzle` and committed. They are never
 * applied by `drizzle-kit push` in any environment that holds real data:
 * `push` diffs and mutates live, which is fine for a scratch database and
 * unacceptable for one holding invoices. Deployments run
 * `npm run db:migrate`, which applies the committed SQL in order and records
 * each file in `__drizzle_migrations`.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp',
  },
  strict: true,
  verbose: true,
});
