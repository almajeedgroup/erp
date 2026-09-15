import 'server-only';
import { redirect } from 'next/navigation';
import { getAccessToken, getRefreshToken, setSessionCookies } from './session';

/**
 * The server-side API client.
 *
 * Every function here runs on the server. The browser makes no direct request
 * to the API at all — it talks to this app, and this app talks to the API with
 * a bearer token read from an `httpOnly` cookie. That keeps the token out of
 * reach of any script on the page, and keeps the API's CORS policy narrow.
 *
 * On a 401 the client tries exactly one refresh and replays the request. One,
 * not a loop: if the refresh also fails the session is genuinely gone, and
 * retrying would just be a slower way to end up at the login page.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the automatic refresh-and-replay, used by the refresh call itself. */
  noRetry?: boolean;
  /** Next.js cache directives. Reads default to no-store; this is live data. */
  cache?: RequestCache;
}

async function call(
  path: string,
  token: string | null,
  options: RequestOptions,
): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: options.cache ?? 'no-store',
  });
}

/**
 * Call the API as the signed-in user.
 *
 * Throws `ApiError` for a handled failure; redirects to the login page when the
 * session cannot be renewed.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  let response = await call(path, token, options);

  if (response.status === 401 && !options.noRetry) {
    const renewed = await tryRefresh();
    if (!renewed) redirect('/login?reason=expired');
    response = await call(path, renewed, { ...options, noRetry: true });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'internal_error',
      body?.error.message ?? `Request failed with ${response.status}`,
      body?.error.issues,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Like `apiFetch`, but returns `null` for a 403/404 instead of throwing. */
export async function apiFetchOrNull<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  try {
    return await apiFetch<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

async function tryRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const body = (await response.json()) as {
    tokens: { accessToken: string; refreshToken: string };
  };
  await setSessionCookies(body.tokens);
  return body.tokens.accessToken;
}

/** Unauthenticated call, for login and registration. */
export async function apiPublic<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.error.code ?? 'internal_error',
      errorBody?.error.message ?? `Request failed with ${response.status}`,
      errorBody?.error.issues,
    );
  }

  return (await response.json()) as T;
}

export { API_BASE_URL };
