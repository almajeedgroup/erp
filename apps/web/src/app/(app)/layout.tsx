import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import { apiFetch } from '@/lib/api';
import { initials } from '@/lib/format';
import { getAccessToken } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { logout } from '../login/actions';

/**
 * The application shell.
 *
 * The session is resolved once here, on the server, and navigation is filtered
 * by the caller's permissions. Hiding a link is a usability decision, not a
 * security one — the API enforces the same permission independently, so a user
 * who types the URL still gets a 403 rather than data.
 */

interface NavItem {
  href: Route;
  label: string;
  permission: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', permission: 'organization:read' }],
  },
  {
    section: 'Commercial',
    items: [
      { href: '/clients', label: 'Clients', permission: 'client:read' },
      { href: '/projects', label: 'Projects', permission: 'project:read' },
      { href: '/tasks', label: 'Tasks', permission: 'task:read' },
    ],
  },
  {
    section: 'Finance',
    items: [
      { href: '/invoices', label: 'Invoices', permission: 'invoice:read' },
      { href: '/expenses', label: 'Expenses', permission: 'expense:read' },
      { href: '/analytics', label: 'Analytics', permission: 'analytics:read' },
    ],
  },
  {
    section: 'Organization',
    items: [
      { href: '/employees', label: 'Employees', permission: 'employee:read' },
      { href: '/documents', label: 'Documents', permission: 'document:read' },
      { href: '/audit', label: 'Audit log', permission: 'audit:read' },
    ],
  },
  {
    section: 'Assistant',
    items: [{ href: '/assistant', label: 'AI assistant', permission: 'ai:chat' }],
  },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await getAccessToken())) redirect('/login');

  const user = await apiFetch<SessionUser>('/api/v1/auth/me');
  const granted = new Set(user.permissions);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-border-subtle bg-surface-raised lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
            AM
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{user.organizationName}</p>
            <p className="text-xs text-ink-faint">Al-Majeed ERP</p>
          </div>
        </div>

        <nav className="px-3 pb-4" aria-label="Main">
          {NAV.map((group) => {
            const visible = group.items.filter((item) => granted.has(item.permission));
            if (visible.length === 0) return null;

            return (
              <div key={group.section} className="mb-4">
                <p className="px-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint">
                  {group.section}
                </p>
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.href}>
                      <NavLink href={item.href}>{item.label}</NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-border-subtle px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-ink-muted">
              {initials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{user.name}</p>
              <p className="text-xs capitalize text-ink-faint">{user.role}</p>
            </div>
          </div>
          <form action={logout} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
