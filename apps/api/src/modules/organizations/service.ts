import {
  type InviteMemberInput,
  type Page,
  type Role,
  canAssignRole,
  conflict,
  forbidden,
  newId,
  notFound,
} from '@almajeed/shared';
import { auditLogs, memberships, organizations, refreshTokens, users } from '@almajeed/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { writeAudit } from '../../lib/audit.js';
import { keysetAfter, keysetOrder, pageFrom } from '../../lib/query.js';
import { iso, isoOrNull } from '../../lib/serialize.js';

/**
 * Organization administration.
 *
 * The interesting logic here is role assignment, which is the classic
 * privilege-escalation surface. Three rules, all enforced server-side:
 *
 *  - You need `member:update_role` at all (only `owner` and `admin` have it).
 *  - You may only assign a role strictly below your own.
 *  - Only an `owner` may mint another `owner`, or remove one.
 *
 * The last organization owner cannot be demoted or removed, because an
 * organization nobody can administer is unrecoverable without operator
 * intervention.
 */

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  country: string | null;
  timezone: string;
  vatNumber: string | null;
  defaultTaxRate: number;
  createdAt: string;
}

export async function getOrganization(ctx: RequestContext): Promise<OrganizationRecord> {
  const [row] = await ctx.db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, ctx.auth.organizationId), isNull(organizations.deletedAt)))
    .limit(1);

  if (!row) throw notFound('Organization', ctx.auth.organizationId);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseCurrency: row.baseCurrency,
    country: row.country,
    timezone: row.timezone,
    vatNumber: row.vatNumber,
    defaultTaxRate: row.defaultTaxRate,
    createdAt: iso(row.createdAt),
  };
}

export async function updateOrganization(
  ctx: RequestContext,
  input: {
    name?: string;
    baseCurrency?: string;
    country?: string;
    timezone?: string;
    vatNumber?: string;
    defaultTaxRate?: number;
  },
): Promise<OrganizationRecord> {
  const before = await getOrganization(ctx);

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'name',
    'baseCurrency',
    'country',
    'timezone',
    'vatNumber',
    'defaultTaxRate',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  await ctx.db.transaction(async (tx) => {
    await tx.update(organizations).set(patch).where(eq(organizations.id, ctx.auth.organizationId));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: ctx.auth.organizationId,
      before: { name: before.name, baseCurrency: before.baseCurrency },
      after: patch,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getOrganization(ctx);
}

/* --------------------------------------------------------------- members -- */

export interface MemberRecord {
  userId: string;
  membershipId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export async function listMembers(ctx: RequestContext): Promise<MemberRecord[]> {
  const rows = await ctx.db
    .select({
      userId: users.id,
      membershipId: memberships.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      status: memberships.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, ctx.auth.organizationId), isNull(users.deletedAt)))
    .orderBy(memberships.createdAt);

  return rows.map((row) => ({
    ...row,
    role: row.role as Role,
    lastLoginAt: isoOrNull(row.lastLoginAt),
    createdAt: iso(row.createdAt),
  }));
}

/**
 * Add a member.
 *
 * This is the direct-provisioning path: the administrator sets an initial
 * password which the new member changes on first login. An email-invitation
 * flow with a single-use token is the natural next step and is described in
 * docs/08-modules/clients.md — it needs a mail transport, which this service
 * deliberately does not yet own.
 */
export async function inviteMember(
  ctx: RequestContext,
  input: InviteMemberInput,
): Promise<MemberRecord> {
  if (!canAssignRole(ctx.auth.role, input.role)) {
    throw forbidden(`A ${ctx.auth.role} cannot grant the ${input.role} role`);
  }

  const passwordHash = await ctx.services.passwords.hash(input.password);

  const [existingUser] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const userId = existingUser?.id ?? newId('user');
  const membershipId = newId('membership');

  await ctx.db.transaction(async (tx) => {
    if (existingUser) {
      const [alreadyMember] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, ctx.auth.organizationId),
            eq(memberships.userId, existingUser.id),
          ),
        )
        .limit(1);
      if (alreadyMember) throw conflict('That person is already a member of this organization');
    } else {
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
        status: 'active',
      });
    }

    await tx.insert(memberships).values({
      id: membershipId,
      organizationId: ctx.auth.organizationId,
      userId,
      role: input.role,
      status: 'active',
      invitedByUserId: ctx.auth.userId,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'member.added',
      resourceType: 'membership',
      resourceId: membershipId,
      after: { email: input.email, role: input.role },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  const members = await listMembers(ctx);
  const created = members.find((member) => member.membershipId === membershipId);
  if (!created) throw notFound('Membership', membershipId);
  return created;
}

export async function updateMemberRole(
  ctx: RequestContext,
  targetUserId: string,
  role: Role,
): Promise<MemberRecord> {
  const membership = await requireMembership(ctx, targetUserId);

  if (!canAssignRole(ctx.auth.role, role)) {
    throw forbidden(`A ${ctx.auth.role} cannot grant the ${role} role`);
  }
  if (membership.role === 'owner' && ctx.auth.role !== 'owner') {
    throw forbidden('Only an owner can change another owner’s role');
  }
  if (membership.role === 'owner' && role !== 'owner') {
    await assertNotLastOwner(ctx, targetUserId);
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ role, updatedAt: ctx.now })
      .where(eq(memberships.id, membership.id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'member.role_changed',
      resourceType: 'membership',
      resourceId: membership.id,
      before: { role: membership.role },
      after: { role },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  const members = await listMembers(ctx);
  const updated = members.find((member) => member.userId === targetUserId);
  if (!updated) throw notFound('Membership', targetUserId);
  return updated;
}

export async function removeMember(ctx: RequestContext, targetUserId: string): Promise<void> {
  const membership = await requireMembership(ctx, targetUserId);

  if (targetUserId === ctx.auth.userId) {
    throw conflict('You cannot remove your own membership');
  }
  if (membership.role === 'owner') {
    if (ctx.auth.role !== 'owner') throw forbidden('Only an owner can remove another owner');
    await assertNotLastOwner(ctx, targetUserId);
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ status: 'revoked', updatedAt: ctx.now })
      .where(eq(memberships.id, membership.id));

    // Revoking access has to take their live sessions with it, or they keep
    // working until their refresh token expires.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: ctx.now })
      .where(
        and(
          eq(refreshTokens.userId, targetUserId),
          eq(refreshTokens.organizationId, ctx.auth.organizationId),
          isNull(refreshTokens.revokedAt),
        ),
      );

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'member.removed',
      resourceType: 'membership',
      resourceId: membership.id,
      before: { userId: targetUserId, role: membership.role },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });
}

async function requireMembership(
  ctx: RequestContext,
  targetUserId: string,
): Promise<{ id: string; role: Role }> {
  const [row] = await ctx.db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, ctx.auth.organizationId),
        eq(memberships.userId, targetUserId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(1);

  if (!row) throw notFound('Membership', targetUserId);
  return { id: row.id, role: row.role as Role };
}

/** An organization with no owner is unadministrable, so the last one is pinned. */
async function assertNotLastOwner(ctx: RequestContext, targetUserId: string): Promise<void> {
  const owners = await ctx.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, ctx.auth.organizationId),
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
      ),
    );

  const remaining = owners.filter((owner) => owner.userId !== targetUserId);
  if (remaining.length === 0) {
    throw conflict('An organization must keep at least one owner');
  }
}

/* ------------------------------------------------------------- audit log -- */

export interface AuditRecord {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  succeeded: boolean;
  requestId: string | null;
  ipAddress: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export async function listAuditLog(
  ctx: RequestContext,
  query: { limit: number; cursor?: string; action?: string; resourceType?: string },
): Promise<Page<AuditRecord>> {
  const conditions = [
    eq(auditLogs.organizationId, ctx.auth.organizationId),
    query.action ? eq(auditLogs.action, query.action) : undefined,
    query.resourceType ? eq(auditLogs.resourceType, query.resourceType) : undefined,
    keysetAfter(auditLogs, query.cursor),
  ].filter((condition) => condition !== undefined);

  const rows = await ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      actorUserId: auditLogs.actorUserId,
      actorName: users.name,
      succeeded: auditLogs.succeeded,
      requestId: auditLogs.requestId,
      ipAddress: auditLogs.ipAddress,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(...conditions))
    .orderBy(...keysetOrder(auditLogs))
    .limit(query.limit + 1);

  const page = pageFrom(rows, query.limit);
  return {
    items: page.items.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
    nextCursor: page.nextCursor,
  };
}
