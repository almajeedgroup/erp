import { AppError, tokenExpired, unauthenticated } from '@almajeed/shared';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';

/**
 * Access tokens.
 *
 * Short-lived (15 minutes by default), signed HS256 JWTs carrying the three
 * facts every request needs: who the caller is, which organization they are
 * acting in, and what role they hold there. Those come from the token and
 * nowhere else — never from a header, a path parameter or a body field — which
 * is what makes tenant scoping and RBAC trustworthy.
 *
 * Refresh tokens are deliberately **not** JWTs. They are opaque random
 * strings, stored as SHA-256 hashes with a rotation family (see
 * `modules/auth/service.ts`), because the one thing a JWT cannot do well is be
 * revoked. Short-lived access token + revocable refresh token is the standard
 * answer, and it is written up in docs/03-security/authn.md.
 */

export interface AccessTokenClaims {
  userId: string;
  organizationId: string;
  role: string;
  /** Membership id — lets a revoked membership invalidate a live token early. */
  membershipId: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export interface TokenServiceOptions {
  secret: string;
  issuer: string;
  audience: string;
  accessTokenTtl: number;
}

export interface TokenService {
  issueAccessToken: (claims: AccessTokenClaims) => Promise<string>;
  verifyAccessToken: (token: string) => Promise<VerifiedAccessToken>;
  readonly accessTokenTtl: number;
}

export function createTokenService(options: TokenServiceOptions): TokenService {
  const key = new TextEncoder().encode(options.secret);

  return {
    accessTokenTtl: options.accessTokenTtl,

    issueAccessToken: async (claims) =>
      new SignJWT({
        org: claims.organizationId,
        role: claims.role,
        mem: claims.membershipId,
      })
        // `alg` is pinned at signing *and* at verification. Accepting whatever
        // the token's own header claims is the classic JWT confusion bug.
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(claims.userId)
        .setIssuer(options.issuer)
        .setAudience(options.audience)
        .setIssuedAt()
        .setExpirationTime(`${options.accessTokenTtl}s`)
        .setJti(crypto.randomUUID())
        .sign(key),

    verifyAccessToken: async (token) => {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: options.issuer,
          audience: options.audience,
          clockTolerance: 5,
        });

        const { sub, org, role, mem, jti, iat, exp } = payload as Record<string, unknown>;
        if (
          typeof sub !== 'string' ||
          typeof org !== 'string' ||
          typeof role !== 'string' ||
          typeof mem !== 'string' ||
          typeof jti !== 'string' ||
          typeof iat !== 'number' ||
          typeof exp !== 'number'
        ) {
          throw unauthenticated('Malformed access token');
        }

        return {
          userId: sub,
          organizationId: org,
          role,
          membershipId: mem,
          jti,
          issuedAt: iat,
          expiresAt: exp,
        };
      } catch (error) {
        if (AppError.is(error)) throw error;
        if (error instanceof joseErrors.JWTExpired) throw tokenExpired();
        throw unauthenticated('Invalid access token');
      }
    },
  };
}

/**
 * Pull a bearer token out of an Authorization header.
 *
 * Returns `null` rather than throwing so the caller decides whether an absent
 * credential is a 401 or simply an anonymous request.
 */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}
