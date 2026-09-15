import { createDatabase, runMigrations } from '@almajeed/db';
import { loadConfig } from './config/env.js';
import { buildServer } from './server.js';

/**
 * Process entry point.
 *
 * Responsible for exactly three things: load and validate configuration, wire
 * the real dependencies, and shut down cleanly. All the interesting behaviour
 * lives in `buildServer`, which takes its dependencies as arguments — that
 * split is what makes the whole API testable in-process.
 *
 * Graceful shutdown matters more than it looks. On a rolling deploy the
 * orchestrator sends SIGTERM and then waits; a process that exits immediately
 * drops the requests it was mid-way through, which users see as random 502s
 * during every release. So: stop accepting connections, let in-flight requests
 * finish, close the pool, exit.
 */

const config = loadConfig();
const handle = createDatabase({
  url: config.database.url,
  poolMax: config.database.poolMax,
  ssl: config.database.ssl,
});

const app = await buildServer({ config, db: handle.db });

// Applying migrations here suits a single-service deployment: Drizzle takes an
// advisory lock, so replicas starting together serialise rather than racing.
// At larger scale this moves to a release job that runs before any new
// container takes traffic — see docs/04-infrastructure/ci-cd.md.
if (process.env.RUN_MIGRATIONS_ON_BOOT === 'true') {
  app.log.info('applying migrations');
  await runMigrations(handle.db);
}

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, env: config.env },
    'al-majeed erp api listening',
  );
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start');
  await handle.close();
  process.exit(1);
}

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  // A second SIGTERM during a slow drain should not start a second shutdown.
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, 'shutting down');

  // Backstop: if a hung request keeps the drain from finishing, exit anyway
  // rather than hanging until the orchestrator SIGKILLs us.
  const timer = setTimeout(() => {
    app.log.error('shutdown timed out; exiting');
    process.exit(1);
  }, 15_000);
  timer.unref();

  try {
    await app.close();
    await handle.close();
    app.log.info('shutdown complete');
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

// An unhandled rejection leaves the process in an unknown state. Log it with
// full detail and let the orchestrator restart us, rather than limping on.
process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  app.log.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});
