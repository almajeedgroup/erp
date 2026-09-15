/**
 * `npm run db:seed` — load demo data into the configured database.
 *
 * A thin wrapper: the dataset itself lives in `src/seed/demo-data.ts` as a
 * plain function, so the same code is exercised by `seed.test.ts` against
 * in-process Postgres on every CI run. A seed script that only ever runs by
 * hand is a seed script that is broken half the time.
 */
import { createDatabase } from '@almajeed/db';
import { loadConfig } from '../config/env.js';
import type { AppServices } from '../context.js';
import { createPasswordHasher } from '../lib/password.js';
import { createStorage } from '../lib/storage.js';
import { createTokenService } from '../lib/tokens.js';
import { createAiProvider } from '../modules/ai/provider.js';
import { seedDemoData } from '../seed/demo-data.js';

const config = loadConfig();
const handle = createDatabase({
  url: config.database.url,
  poolMax: 2,
  ssl: config.database.ssl,
});

const services: AppServices = {
  config,
  tokens: createTokenService({
    secret: config.auth.jwtSecret,
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    accessTokenTtl: config.auth.accessTokenTtl,
  }),
  passwords: createPasswordHasher(config.auth.passwordPepper),
  storage: createStorage(config),
  ai: createAiProvider(config),
  clock: () => new Date(),
};

try {
  await seedDemoData({
    db: handle.db,
    services,
    log: (message) => console.log(message),
  });
} catch (error) {
  console.error('seed failed:', error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
