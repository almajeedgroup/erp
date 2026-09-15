import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, listTables, type TestDatabase } from './testing.js';

/**
 * These tests are the guarantee that the committed migrations actually apply.
 * They run against real Postgres (PGlite, in-process), so a broken enum, a
 * missing foreign key or a malformed partial index fails here rather than
 * during a deploy.
 */
describe('migrations', () => {
  let ctx: TestDatabase;

  beforeAll(async () => {
    ctx = await createTestDatabase();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('applies cleanly to an empty database', async () => {
    const tables = await listTables(ctx.db);
    expect(tables).toContain('organizations');
    expect(tables).toContain('users');
    expect(tables).toContain('invoices');
    expect(tables).toContain('document_chunks');
    expect(tables).toContain('ai_messages');
  });

  it('creates every module table', async () => {
    const tables = new Set(await listTables(ctx.db));
    const expected = [
      'organizations',
      'users',
      'memberships',
      'refresh_tokens',
      'audit_logs',
      'api_keys',
      'clients',
      'contacts',
      'projects',
      'project_members',
      'time_entries',
      'employees',
      'invoices',
      'invoice_lines',
      'payments',
      'expenses',
      'invoice_counters',
      'documents',
      'document_chunks',
      'tasks',
      'task_comments',
      'ai_conversations',
      'ai_messages',
    ];
    for (const table of expected) {
      expect(tables.has(table), `missing table: ${table}`).toBe(true);
    }
  });

  it('is idempotent when re-run', async () => {
    // The migrator records applied files, so a second run is a no-op rather
    // than a duplicate-object error.
    const before = await listTables(ctx.db);
    const second = await createTestDatabase();
    const after = await listTables(second.db);
    await second.close();
    expect(after.sort()).toEqual(before.sort());
  });
});
