'use server';

import { redirect } from 'next/navigation';
import { ApiError, apiPublic } from '@/lib/api';
import { clearSessionCookies, getRefreshToken, setSessionCookies } from '@/lib/session';

/**
 * Authentication as server actions.
 *
 * The credentials are posted to this server, exchanged with the API here, and
 * the resulting tokens are written straight into `httpOnly` cookies. They are
 * never serialised into a client component's props and never reach the
 * browser's JavaScript.
 */

export interface LoginState {
  error?: string;
}

interface AuthResponse {
  user: { id: string; name: string };
  tokens: { accessToken: string; refreshToken: string };
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  try {
    const result = await apiPublic<AuthResponse>('/api/v1/auth/login', { email, password });
    await setSessionCookies(result.tokens);
  } catch (error) {
    if (error instanceof ApiError) {
      // The API deliberately returns the same message for an unknown email and
      // a wrong password; passing it through keeps that property intact rather
      // than helpfully distinguishing the two here.
      if (error.status === 429) {
        return { error: 'Too many attempts. Wait a few minutes and try again.' };
      }
      return { error: error.message };
    }
    return { error: 'Could not reach the server. Try again shortly.' };
  }

  // `redirect` throws, so it must sit outside the try block.
  redirect('/dashboard');
}

export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    // Best effort: the cookies are cleared either way, so a failure here does
    // not leave the user stuck in a session they asked to end.
    await apiPublic('/api/v1/auth/logout', { refreshToken }).catch(() => undefined);
  }

  await clearSessionCookies();
  redirect('/login');
}
