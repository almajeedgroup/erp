/**
 * `@almajeed/shared` — the domain core.
 *
 * This package has no framework, no database driver and no network client. It
 * holds the things the API, the web app and the background jobs must agree on:
 * identifiers, money arithmetic, the error taxonomy, the permission matrix and
 * the validation schemas for every module.
 *
 * Keeping it dependency-light is deliberate: it is imported by both the server
 * and the browser bundle, and it is the layer that is cheapest to test.
 */

export * from './ids.js';
export * from './money.js';
export * from './errors.js';
export * from './pagination.js';
export * from './rbac.js';
export * from './datetime.js';

export * from './domain/common.js';
export * from './domain/auth.js';
export * from './domain/clients.js';
export * from './domain/projects.js';
export * from './domain/employees.js';
export * from './domain/finance.js';
export * from './domain/documents.js';
export * from './domain/tasks.js';
export * from './domain/analytics.js';
export * from './domain/ai.js';
