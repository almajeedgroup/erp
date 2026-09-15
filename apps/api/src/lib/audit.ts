import { newId } from '@almajeed/shared';
import type { Executor } from '@almajeed/db';
import { auditLogs } from '@almajeed/db';

/**
 * The audit log.
 *
 * Every state change writes one row, inside the same transaction as the change
 * itself where one exists — an audit trail that can be written after a
 * successful commit and then fail is not an audit trail. Denied attempts are
 * recorded too, with `succeeded: false`; those are usually the interesting
 * rows when someone asks what happened.
 *
 * Snapshots are redacted before they are stored. An audit log that faithfully
 * records a password hash or a national id has turned itself into a second,
 * less protected copy of the sensitive data.
 */

/** Fields never written to the audit log, whatever table they came from. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'keyHash',
  'nationalId',
  'bankAccount',
  'compensationAmount',
  'compensationCurrency',
  'embedding',
]);

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  /** `resource.verb`, past tense: `invoice.issued`, `client.deleted`. */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  succeeded?: boolean;
}

export function redactSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (entry instanceof Date) {
      output[key] = entry.toISOString();
      continue;
    }
    output[key] = entry;
  }
  return output;
}

/** Write one audit row. Pass a transaction to make it atomic with the change. */
export async function writeAudit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    id: newId('auditLog'),
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    before: redactSnapshot(entry.before),
    after: redactSnapshot(entry.after),
    requestId: entry.requestId ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    succeeded: entry.succeeded ?? true,
  });
}

/** Compute the changed subset of a record, for a compact `before`/`after` pair. */
export function diffSnapshot<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    if (!Object.is(normalize(previous), normalize(next))) {
      changedBefore[key] = previous;
      changedAfter[key] = next;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value;
}
