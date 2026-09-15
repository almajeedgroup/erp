import {
  type Role,
  type SessionUser,
  type TokenPair,
  conflict,
  forbidden,
  invalidCredentials,
  newId,
  notFound,
  permissionsFor,
  tokenRevoked,
  unauthenticated,
} from '@almajeed/shared';
import type { Database, Executor } from '@almajeed/db';
import { memberships, organizations, refreshTokens, users } from '@almajeed/db';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { AppServices } from '../../context.js';
import { writeAudit } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

/**
 * Authentication.
 *
 * Three properties this module is built to hold, each of which is a test:
 *
 *  1. **Login does not enumerate users.** A wrong email and a wrong password
 *     return the same error, the same status and comparable timing.
 *  2. **Refresh tokens rotate, and replay is detected.** Every refresh issues a
 *     new token and retires the old one. Presenting a token that was already
 *     used revokes the entire family — the standard response to a stolen token
 *     being replayed after the legitimate client has moved on.
 *  3. **Brute force gets expensive.** Consecutive failures lock the account for
 *     a growing window; a success resets the counter.
 *
 * docs/03-security/authn.md carries the reasoning in full.
 */

/** Failures tolerated before the account locks. */
const LOCKOUT_THRESHOLD = 8;
/** Base lockout, doubled for each additional failure, capped at 15 minutes. */
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 900_000;

export interface AuthDeps {
  db: Database;
  services: AppServices;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  now: Date;
}

export interface RegisterInput {
  organizationName: string;
  organizationSlug?: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: SessionUser;
  tokens: TokenPair;
}

/* ------------------------------------------------------------- register -- */

/**
 * Create an organization and its first user, who becomes the `owner`.
 *
 * Everything happens in one transaction: a half-created tenant with a user but
 * no membership would leave someone able to log in and see nothing, with no
 * obvious way to repair it.
 */
export async function register(deps: AuthDeps, input: RegisterInput): Promise<AuthResult> {
  const slug = input.organizationSlug ?? slugify(input.organizationName);

  const existing = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing.length > 0) {
    throw conflict('An account with that email already exists');
  }

  const passwordHash = await deps.services.passwords.hash(input.password);

  const organizationId = newId('organization');
  const userId = newId('user');
  const membershipId = newId('membership');

  await deps.db.transaction(async (tx) => {
    const slugTaken = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (slugTaken.length > 0) {
      throw conflict(`The organization slug "${slug}" is taken`, { slug });
    }

    await tx.insert(organizations).values({
      id: organizationId,
      name: input.organizationName,
      slug,
    });

    await tx.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
      passwordHash,
      status: 'active',
      emailVerifiedAt: null,
    });

    await tx.insert(memberships).values({
      id: membershipId,
      organizationId,
      userId,
      role: 'owner',
      status: 'active',
    });

    await writeAudit(tx, {
      organizationId,
      actorUserId: userId,
      action: 'organization.created',
      resourceType: 'organization',
      resourceId: organizationId,
      after: { name: input.organizationName, slug },
      requestId: deps.requestId,
      ipAddress: deps.ipAddress,
      userAgent: deps.userAgent,
    });
  });

  const tokens = await issueTokens(deps, {
    userId,
    organizationId,
    membershipId,
    role: 'owner',
  });

  return {
    user: buildSessionUser({
      userId,
      email: input.email,
      name: input.name,
      role: 'owner',
      organizationId,
      organizationName: input.organizationName,
    }),
    tokens,
  };
}

/* ---------------------------------------------------------------- login -- */

export async function login(deps: AuthDeps, input: LoginInput): Promise<AuthResult> {
  const [account] = await deps.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      status: users.status,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    .limit(1);

  if (!account) {
    // Burn the same CPU a real verification would, then fail identically.
    await deps.services.passwords.equalizeTiming();
    throw invalidCredentials();
  }

  if (account.lockedUntil && account.lockedUntil > deps.now) {
    await deps.services.passwords.equalizeTiming();
    // Same error as a wrong password: revealing "this account is locked" tells
    // an attacker the address is real and that their guessing is landing.
    throw invalidCredentials();
  }

  const correct = await deps.services.passwords.verify(input.password, account.passwordHash);

  if (!correct) {
    await recordFailedLogin(deps, account.id, account.failedLoginCount);
    throw invalidCredentials();
  }

  if (account.status !== 'active') {
    throw forbidden('This account is not active. Contact an administrator.');
  }

  const [membership] = await deps.db
    .select({
      id: memberships.id,
      organizationId: memberships.organizationId,
      role: memberships.role,
      organizationName: organizations.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, account.id),
        eq(memberships.status, 'active'),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(memberships.createdAt)
    .limit(1);

  if (!membership) {
    throw forbidden('This account does not belong to an active organization');
  }

  await deps.db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: deps.now, updatedAt: deps.now })
    .where(eq(users.id, account.id));

  const tokens = await issueTokens(deps, {
    userId: account.id,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
  });

  await writeAudit(deps.db, {
    organizationId: membership.organizationId,
    actorUserId: account.id,
    action: 'auth.logged_in',
    resourceType: 'user',
    resourceId: account.id,
    requestId: deps.requestId,
    ipAddress: deps.ipAddress,
    userAgent: deps.userAgent,
  });

  return {
    user: buildSessionUser({
      userId: account.id,
      email: account.email,
      name: account.name,
      role: membership.role,
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
    }),
    tokens,
  };
}

async function recordFailedLogin(
  deps: AuthDeps,
  userId: string,
  previousFailures: number,
): Promise<void> {
  const failures = previousFailures + 1;
  const lockedUntil =
    failures >= LOCKOUT_THRESHOLD
      ? new Date(
          deps.now.getTime() +
            Math.min(LOCKOUT_BASE_MS * 2 ** (failures - LOCKOUT_THRESHOLD), LOCKOUT_MAX_MS),
        )
      : null;

  await deps.db
    .update(users)
    .set({ failedLoginCount: failures, lockedUntil, updatedAt: deps.now })
    .where(eq(users.id, userId));
}

/* -------------------------------------------------------------- refresh -- */

/**
 * Rotate a refresh token.
 *
 * The presented token is looked up by hash. If it is valid and unused, it is
 * marked replaced and a fresh token is issued in the same family. If it has
 * *already* been replaced, that is a replay: the whole family is revoked, which
 * logs out both the attacker and the legitimate client — the correct outcome,
 * because one of them is holding a stolen token and we cannot tell which.
 */
export async function refresh(deps: AuthDeps, presentedToken: string): Promise<AuthResult> {
  const tokenHash = sha256(presentedToken);

  const [stored] = await deps.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!stored) throw unauthenticated('Invalid refresh token');

  if (stored.replacedByTokenId || stored.revokedAt) {
    await revokeFamily(deps.db, stored.familyId, deps.now);
    await writeAudit(deps.db, {
      organizationId: stored.organizationId,
      actorUserId: stored.userId,
      action: 'auth.refresh_replay_detected',
      resourceType: 'refresh_token',
      resourceId: stored.id,
      requestId: deps.requestId,
      ipAddress: deps.ipAddress,
      userAgent: deps.userAgent,
      succeeded: false,
    });
    throw tokenRevoked('Refresh token has already been used; all sessions were revoked');
  }

  if (stored.expiresAt <= deps.now) {
    throw unauthenticated('Refresh token has expired');
  }

  const [context] = await deps.db
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      membershipStatus: memberships.status,
      organizationName: organizations.name,
      userEmail: users.email,
      userName: users.name,
      userStatus: users.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.userId, stored.userId),
        eq(memberships.organizationId, stored.organizationId),
      ),
    )
    .limit(1);

  if (!context || context.membershipStatus !== 'active' || context.userStatus !== 'active') {
    await revokeFamily(deps.db, stored.familyId, deps.now);
    throw unauthenticated('Session is no longer valid');
  }

  const next = await issueTokens(
    deps,
    {
      userId: stored.userId,
      organizationId: stored.organizationId,
      membershipId: context.membershipId,
      role: context.role,
    },
    stored.familyId,
  );

  await deps.db
    .update(refreshTokens)
    .set({ replacedByTokenId: next.refreshTokenId, revokedAt: deps.now })
    .where(eq(refreshTokens.id, stored.id));

  return {
    user: buildSessionUser({
      userId: stored.userId,
      email: context.userEmail,
      name: context.userName,
      role: context.role,
      organizationId: stored.organizationId,
      organizationName: context.organizationName,
    }),
    tokens: next.pair,
  };
}

/** Revoke the presented token's family. Idempotent, and never leaks validity. */
export async function logout(deps: AuthDeps, presentedToken: string): Promise<void> {
  const [stored] = await deps.db
    .select({
      familyId: refreshTokens.familyId,
      organizationId: refreshTokens.organizationId,
      userId: refreshTokens.userId,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(presentedToken)))
    .limit(1);

  if (!stored) return; // Unknown token: nothing to do, and nothing to disclose.

  await revokeFamily(deps.db, stored.familyId, deps.now);
  await writeAudit(deps.db, {
    organizationId: stored.organizationId,
    actorUserId: stored.userId,
    action: 'auth.logged_out',
    resourceType: 'user',
    resourceId: stored.userId,
    requestId: deps.requestId,
    ipAddress: deps.ipAddress,
    userAgent: deps.userAgent,
  });
}

/* ------------------------------------------------------------- password -- */

export async function changePassword(
  deps: AuthDeps,
  userId: string,
  organizationId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const [account] = await deps.db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!account) throw notFound('User', userId);

  const correct = await deps.services.passwords.verify(currentPassword, account.passwordHash);
  if (!correct) throw invalidCredentials('Current password is incorrect');

  const passwordHash = await deps.services.passwords.hash(newPassword);

  await deps.db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: deps.now }).where(eq(users.id, userId));

    // A password change invalidates every existing session. If the change was
    // prompted by a compromise, leaving old refresh tokens live defeats it.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: deps.now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    await writeAudit(tx, {
      organizationId,
      actorUserId: userId,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: userId,
      requestId: deps.requestId,
      ipAddress: deps.ipAddress,
      userAgent: deps.userAgent,
    });
  });
}

/* ---------------------------------------------------------------- utils -- */

interface TokenSubject {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
}

async function issueTokens(deps: AuthDeps, subject: TokenSubject): Promise<TokenPair>;
async function issueTokens(
  deps: AuthDeps,
  subject: TokenSubject,
  familyId: string,
): Promise<{ pair: TokenPair; refreshTokenId: string }>;
async function issueTokens(
  deps: AuthDeps,
  subject: TokenSubject,
  familyId?: string,
): Promise<TokenPair | { pair: TokenPair; refreshTokenId: string }> {
  const accessToken = await deps.services.tokens.issueAccessToken({
    userId: subject.userId,
    organizationId: subject.organizationId,
    membershipId: subject.membershipId,
    role: subject.role,
  });

  const refreshTokenValue = randomToken(32);
  const refreshTokenId = newId('session');
  const family = familyId ?? newId('session');

  await deps.db.insert(refreshTokens).values({
    id: refreshTokenId,
    userId: subject.userId,
    organizationId: subject.organizationId,
    tokenHash: sha256(refreshTokenValue),
    familyId: family,
    expiresAt: new Date(deps.now.getTime() + deps.services.config.auth.refreshTokenTtl * 1_000),
    userAgent: deps.userAgent,
    ipAddress: deps.ipAddress,
  });

  const pair: TokenPair = {
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: deps.services.config.auth.accessTokenTtl,
    tokenType: 'Bearer',
  };

  return familyId ? { pair, refreshTokenId } : pair;
}

async function revokeFamily(db: Executor, familyId: string, now: Date): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/** Housekeeping: drop refresh tokens that are expired or long revoked. */
export async function pruneRefreshTokens(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const deleted = await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, now), lt(refreshTokens.revokedAt, cutoff)))
    .returning({ id: refreshTokens.id });
  return deleted.length;
}

export function buildSessionUser(input: {
  userId: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  organizationName: string;
}): SessionUser {
  return {
    id: input.userId,
    email: input.email,
    name: input.name,
    role: input.role,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    permissions: permissionsFor(input.role),
  };
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length >= 2 ? base : `org-${randomToken(4).toLowerCase()}`;
}
