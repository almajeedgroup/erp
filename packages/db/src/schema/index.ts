/**
 * The complete database schema.
 *
 * Import order follows the dependency graph: tenancy first (every other table
 * references `organizations`), then the business modules.
 */
export * from './columns.js';
export * from './enums.js';
export * from './tenancy.js';
export * from './crm.js';
export * from './projects.js';
export * from './hr.js';
export * from './finance.js';
export * from './documents.js';
export * from './tasks.js';
export * from './ai.js';
