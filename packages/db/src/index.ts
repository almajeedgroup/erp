/**
 * `@almajeed/db` — schema, migrations and tenant-scoped data access.
 *
 * The API imports `Database`, the schema tables and the `scope*` helpers from
 * here and never reaches for a driver. That is what lets the test suite run
 * the identical service code against in-process Postgres.
 */
export * from './client.js';
export * from './tenancy.js';
export * from './migrator.js';
export * as schemaTables from './schema/index.js';
export * from './schema/index.js';
