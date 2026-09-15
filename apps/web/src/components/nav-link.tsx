'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A navigation link that knows whether it is the current page.
 *
 * `aria-current="page"` is what a screen reader announces; the styling is the
 * sighted equivalent of the same fact, not a substitute for it.
 */
export function NavLink({ href, children }: { href: Route; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-accent-soft font-medium text-accent-strong'
          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
