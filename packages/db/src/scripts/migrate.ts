/**
 * Apply committed migrations. Run by `npm run db:migrate` and by the release
 * job before new application containers start taking traffic.
 */
import { createDatabase } from '../client.js';
import { runMigrations } from '../migrator.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const handle = createDatabase({ url, poolMax: 1, ssl: process.env.DATABASE_SSL === 'true' });

try {
  console.log('applying migrations...');
  await runMigrations(handle.db);
  console.log('migrations applied');
} catch (error) {
  console.error('migration failed:', error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
