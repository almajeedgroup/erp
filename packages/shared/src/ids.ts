import { randomUUID } from 'node:crypto';

/**
 * Prefixed identifiers.
 *
 * Every row in the system carries an opaque, URL-safe, human-inspectable id of
 * the form `<prefix>_<uuidv4-without-dashes>`, e.g. `inv_3f1a...`.
 *
 * Why not bare integers or bare UUIDs?
 *   - A leaked id says what it points at, which makes logs and support
 *     conversations far easier to reason about.
 *   - Passing a client id where an invoice id was expected becomes a
 *     validation error rather than a silent cross-resource read (see the
 *     IDOR notes in docs/03-security/owasp-top-10.md).
 *   - They are non-sequential, so they do not leak row counts or growth rate.
 */
export const ID_PREFIXES = {
  organization: 'org',
  user: 'usr',
  membership: 'mem',
  session: 'ses',
  apiKey: 'key',
  client: 'cli',
  contact: 'con',
  project: 'prj',
  projectMember: 'pmb',
  employee: 'emp',
  timeEntry: 'tim',
  invoice: 'inv',
  invoiceLine: 'inl',
  payment: 'pay',
  expense: 'exp',
  document: 'doc',
  documentChunk: 'dch',
  task: 'tsk',
  comment: 'cmt',
  auditLog: 'aud',
  conversation: 'cnv',
  message: 'msg',
} as const;

export type IdPrefixName = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdPrefixName];

/** A branded id string, e.g. `Id<'client'>` is not assignable to `Id<'project'>`. */
export type Id<K extends IdPrefixName> = string & { readonly __idBrand: K };

export type OrganizationId = Id<'organization'>;
export type UserId = Id<'user'>;
export type ClientId = Id<'client'>;
export type ProjectId = Id<'project'>;
export type EmployeeId = Id<'employee'>;
export type InvoiceId = Id<'invoice'>;
export type DocumentId = Id<'document'>;
export type TaskId = Id<'task'>;

const ID_BODY = /^[0-9a-f]{32}$/;

/** Generate a new id for the given entity kind. */
export function newId<K extends IdPrefixName>(kind: K): Id<K> {
  return `${ID_PREFIXES[kind]}_${randomUUID().replaceAll('-', '')}` as Id<K>;
}

/** True when `value` is a well-formed id for `kind`. */
export function isId<K extends IdPrefixName>(kind: K, value: unknown): value is Id<K> {
  if (typeof value !== 'string') return false;
  const prefix = ID_PREFIXES[kind];
  if (!value.startsWith(`${prefix}_`)) return false;
  return ID_BODY.test(value.slice(prefix.length + 1));
}

/** Narrow an unknown value to an `Id<K>`, throwing a plain `TypeError` if it is not one. */
export function assertId<K extends IdPrefixName>(kind: K, value: unknown): Id<K> {
  if (!isId(kind, value)) {
    throw new TypeError(`Expected a ${kind} id (prefix "${ID_PREFIXES[kind]}_"), got: ${String(value)}`);
  }
  return value;
}

/** The entity kind an id belongs to, or `null` when the prefix is unknown. */
export function idKind(value: string): IdPrefixName | null {
  const underscore = value.indexOf('_');
  if (underscore <= 0) return null;
  const prefix = value.slice(0, underscore);
  const entry = Object.entries(ID_PREFIXES).find(([, p]) => p === prefix);
  return entry ? (entry[0] as IdPrefixName) : null;
}
