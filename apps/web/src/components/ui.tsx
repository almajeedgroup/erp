import type { ReactNode } from 'react';

/**
 * The small set of primitives every page is built from.
 *
 * Deliberately few and deliberately plain: a table, a card, a badge, an empty
 * state. An ERP screen is mostly dense tabular data, and the job of the
 * components is to keep that data legible rather than to decorate it.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border-subtle bg-surface-raised ${className}`}>
      {title ? (
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * A headline metric.
 *
 * `hint` carries the definition — "issued invoices, this period" — because a
 * number on a dashboard without its definition is how two people end up
 * arguing about revenue.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'positive' | 'caution' | 'negative';
}) {
  const toneClass = {
    neutral: 'text-ink',
    positive: 'text-positive',
    caution: 'text-caution',
    negative: 'text-negative',
  }[tone];

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-raised p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`numeric mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border-border-subtle',
  accent: 'bg-accent-soft text-accent-strong border-transparent',
  positive: 'bg-positive-soft text-positive border-transparent',
  caution: 'bg-caution-soft text-caution border-transparent',
  negative: 'bg-negative-soft text-negative border-transparent',
};

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES | string;
}) {
  const className = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/** Map a domain status onto a badge tone, in one place so it stays consistent. */
export function toneForStatus(status: string): string {
  switch (status) {
    case 'active':
    case 'paid':
    case 'approved':
    case 'done':
    case 'on_track':
      return 'positive';
    case 'at_risk':
    case 'partially_paid':
    case 'in_review':
    case 'submitted':
    case 'on_hold':
    case 'blocked':
      return 'caution';
    case 'churned':
    case 'cancelled':
    case 'void':
    case 'rejected':
    case 'off_track':
    case 'terminated':
      return 'negative';
    case 'issued':
    case 'in_progress':
    case 'prospect':
      return 'accent';
    default:
      return 'neutral';
  }
}

/**
 * A data table.
 *
 * `minWidth` is the width below which the table scrolls instead of squashing.
 * It is a prop rather than a constant because the right value depends on the
 * column count and the container: a four-column table inside a half-width
 * dashboard card needs a much smaller floor than a seven-column report at full
 * page width, and a single global value clips one or squashes the other.
 *
 * Tables are the one thing allowed to scroll horizontally on a phone — wrapping
 * a dense financial row makes it less readable, not more.
 */
export function Table({
  children,
  minWidth = '26rem',
}: {
  children: ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={`border-b border-border-subtle px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  numeric = false,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  numeric?: boolean;
}) {
  return (
    <td
      className={`border-b border-border-subtle px-3 py-2.5 text-ink ${
        align === 'right' ? 'text-right' : ''
      } ${numeric ? 'numeric' : ''}`}
    >
      {children}
    </td>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Shown when the API answers 403.
 *
 * Saying which permission is missing is deliberate: "you don't have access" is
 * a dead end, whereas naming the permission tells the user what to ask their
 * administrator for.
 */
export function NoAccess({ permission }: { permission: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">You don’t have access to this</p>
      <p className="mt-1 text-sm text-ink-muted">
        It needs the <code className="font-mono text-xs">{permission}</code> permission. An owner or
        admin can grant it.
      </p>
    </div>
  );
}

export function Bar({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: string;
}) {
  const width = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const fill =
    tone === 'negative' ? 'bg-negative' : tone === 'positive' ? 'bg-positive' : 'bg-accent';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="img"
      aria-label={`${width}%`}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}
