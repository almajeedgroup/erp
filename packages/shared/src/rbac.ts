/**
 * Role-based access control.
 *
 * Two layers, and both are always enforced:
 *
 *  1. **Tenant isolation** — every query is scoped by `organization_id`, taken
 *     from the verified access token and never from the request body or a
 *     path parameter. This layer is not expressible as a permission; it is a
 *     property of the data-access layer (see packages/db/src/tenancy.ts).
 *  2. **Permissions** — this file. A role maps to a fixed set of
 *     `resource:action` grants, checked in a `preHandler` before the route
 *     body ever runs.
 *
 * Deny is the default: a permission absent from a role's set is denied, and an
 * unknown permission string is denied. There is no "allow all" branch anywhere
 * in `can()` other than the `owner` role, which is defined by enumeration like
 * every other role rather than by a wildcard.
 */

export const ROLES = ['owner', 'admin', 'finance', 'manager', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Organization & people
  'organization:read',
  'organization:update',
  'member:read',
  'member:invite',
  'member:update_role',
  'member:remove',
  'audit:read',

  // Clients
  'client:read',
  'client:create',
  'client:update',
  'client:delete',

  // Projects
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'project:assign',

  // Employees & time
  'employee:read',
  'employee:read_sensitive', // salary, national id, bank details
  'employee:create',
  'employee:update',
  'employee:delete',
  'time_entry:read',
  'time_entry:create',
  'time_entry:approve',

  // Finance
  'invoice:read',
  'invoice:create',
  'invoice:update',
  'invoice:issue',
  'invoice:void',
  'payment:read',
  'payment:record',
  'expense:read',
  'expense:create',
  'expense:approve',

  // Documents
  'document:read',
  'document:upload',
  'document:delete',

  // Tasks
  'task:read',
  'task:create',
  'task:update',
  'task:delete',

  // Analytics & AI
  'analytics:read',
  'analytics:export',
  'ai:chat',
  'ai:configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * The grant matrix.
 *
 * Read this as the product's access policy — it is the single source of truth,
 * mirrored in docs/03-security/authz-rbac.md and asserted by rbac.test.ts.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  /** Full control, including billing, roles and deletion. Usually 1-2 people. */
  owner: PERMISSIONS,

  /** Runs the organization day to day, but cannot delete it or demote owners. */
  admin: [
    'organization:read',
    'organization:update',
    'member:read',
    'member:invite',
    'member:update_role',
    'member:remove',
    'audit:read',
    'client:read',
    'client:create',
    'client:update',
    'client:delete',
    'project:read',
    'project:create',
    'project:update',
    'project:delete',
    'project:assign',
    'employee:read',
    'employee:read_sensitive',
    'employee:create',
    'employee:update',
    'employee:delete',
    'time_entry:read',
    'time_entry:create',
    'time_entry:approve',
    'invoice:read',
    'invoice:create',
    'invoice:update',
    'invoice:issue',
    'invoice:void',
    'payment:read',
    'payment:record',
    'expense:read',
    'expense:create',
    'expense:approve',
    'document:read',
    'document:upload',
    'document:delete',
    'task:read',
    'task:create',
    'task:update',
    'task:delete',
    'analytics:read',
    'analytics:export',
    'ai:chat',
    'ai:configure',
  ],

  /** Accounting. Sees money everywhere; cannot restructure projects or people. */
  finance: [
    'organization:read',
    'member:read',
    'client:read',
    'project:read',
    'employee:read',
    'employee:read_sensitive',
    'time_entry:read',
    'invoice:read',
    'invoice:create',
    'invoice:update',
    'invoice:issue',
    'invoice:void',
    'payment:read',
    'payment:record',
    'expense:read',
    'expense:create',
    'expense:approve',
    'document:read',
    'document:upload',
    'task:read',
    'analytics:read',
    'analytics:export',
    'ai:chat',
  ],

  /** Delivery lead. Owns projects, tasks and time; reads but does not issue money. */
  manager: [
    'organization:read',
    'member:read',
    'client:read',
    'client:create',
    'client:update',
    'project:read',
    'project:create',
    'project:update',
    'project:assign',
    'employee:read',
    'time_entry:read',
    'time_entry:create',
    'time_entry:approve',
    'invoice:read',
    'expense:read',
    'expense:create',
    'document:read',
    'document:upload',
    'document:delete',
    'task:read',
    'task:create',
    'task:update',
    'task:delete',
    'analytics:read',
    'ai:chat',
  ],

  /** Individual contributor. Does the work, logs time, files expenses. */
  member: [
    'organization:read',
    'member:read',
    'client:read',
    'project:read',
    'employee:read',
    'time_entry:read',
    'time_entry:create',
    'expense:read',
    'expense:create',
    'document:read',
    'document:upload',
    'task:read',
    'task:create',
    'task:update',
    'ai:chat',
  ],

  /** Read-only observer: auditors, advisors, a client-side stakeholder. */
  viewer: [
    'organization:read',
    'member:read',
    'client:read',
    'project:read',
    'employee:read',
    'time_entry:read',
    'invoice:read',
    'payment:read',
    'expense:read',
    'document:read',
    'task:read',
    'analytics:read',
  ],
};

/** Pre-built lookup sets, so `can()` is O(1) rather than a linear scan. */
const GRANT_SETS = new Map<Role, ReadonlySet<Permission>>(
  ROLES.map((role) => [role, new Set(GRANTS[role])] as const),
);

/** Seniority order, used to stop a role from granting more than it holds. */
const RANK: Record<Role, number> = {
  owner: 60,
  admin: 50,
  finance: 40,
  manager: 30,
  member: 20,
  viewer: 10,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

/** The single authorization predicate. Unknown role or permission -> `false`. */
export function can(role: Role | string, permission: Permission | string): boolean {
  if (!isRole(role) || !isPermission(permission)) return false;
  return GRANT_SETS.get(role)?.has(permission) ?? false;
}

/** True only when the role holds every listed permission. */
export function canAll(role: Role | string, permissions: readonly (Permission | string)[]): boolean {
  return permissions.every((p) => can(role, p));
}

/** True when the role holds at least one of the listed permissions. */
export function canAny(role: Role | string, permissions: readonly (Permission | string)[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function permissionsFor(role: Role): Permission[] {
  return [...GRANTS[role]];
}

export function rankOf(role: Role): number {
  return RANK[role];
}

/**
 * Privilege-escalation guard: an actor may only assign a role strictly below
 * their own, and only `owner` may mint another `owner`.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'member:update_role')) return false;
  if (target === 'owner') return actor === 'owner';
  return RANK[actor] > RANK[target] || actor === 'owner';
}
