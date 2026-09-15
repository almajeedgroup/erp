import 'server-only';
import { cookies } from 'next/headers';

/**
 * Session handling.
 *
 * The browser never sees an access token. The web app is a backend-for-
 * frontend: tokens live in `httpOnly`, `sameSite=lax`, `secure` cookies that
 * JavaScript cannot read, and every call to the API is made by a server
 * component or a route handler that attaches the bearer header itself.
 *
 * This is the single most valuable thing the web layer does for security. A
 * token in `localStorage` is readable by any script that manages to run on the
 * page — one XSS and the attacker has a working session they can replay from
 * anywhere. An `httpOnly` cookie is not readable, and `sameSite=lax` keeps it
 * from riding along on a cross-site form post.
 *
 * See docs/03-security/authn.md.
 */

const ACCESS_COOKIE = 'amg_at';
const REFRESH_COOKIE = 'amg_rt';

/** Slightly less than the access token's own lifetime, so the cookie expires first. */
const ACCESS_MAX_AGE = 14 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax',
  // Cookies are only sent over TLS outside local development.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export async function setSessionCookies(tokens: SessionTokens): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.accessToken, { ...baseCookie, maxAge: ACCESS_MAX_AGE });
  store.set(REFRESH_COOKIE, tokens.refreshToken, { ...baseCookie, maxAge: REFRESH_MAX_AGE });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

export const COOKIE_NAMES = { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE } as const;
