import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';
import { getAccessToken } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  if (await getAccessToken()) redirect('/dashboard');
  const { reason } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
            AM
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Al-Majeed ERP</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to continue</p>
        </div>

        {reason === 'expired' ? (
          <p
            role="status"
            className="mb-4 rounded-lg border border-border-subtle bg-caution-soft px-3 py-2 text-sm text-caution"
          >
            Your session expired. Please sign in again.
          </p>
        ) : null}

        <LoginForm />

        <p className="mt-6 text-center text-xs text-ink-faint">
          Seeded demo: <span className="font-mono">owner@almajeed.test</span> ·{' '}
          <span className="font-mono">correct horse battery staple</span>
        </p>
      </div>
    </main>
  );
}
