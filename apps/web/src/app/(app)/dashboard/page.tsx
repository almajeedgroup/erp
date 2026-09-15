import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, Stat, Table, Td, Th, toneForStatus } from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, hours, label, money, moneyCompact, number, percent } from '@/lib/format';
import type { Invoice, Overview, Page, Task } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The dashboard.
 *
 * Every tile carries its own definition in the hint line. That is not padding:
 * "revenue" means something specific here (issued invoices in the period, on an
 * accrual basis) and a reader who assumes it means cash collected will draw the
 * wrong conclusion from a correct number.
 *
 * Panels the viewer lacks permission for are simply absent — `apiFetchOrNull`
 * turns a 403 into `null` rather than failing the whole page, so a `member`
 * gets a useful dashboard instead of an error.
 */
export default async function DashboardPage() {
  const [overview, overdue, tasks] = await Promise.all([
    apiFetchOrNull<Overview>('/api/v1/analytics/overview'),
    apiFetchOrNull<Page<Invoice>>('/api/v1/invoices?overdueOnly=true&limit=5'),
    apiFetchOrNull<Page<Task>>('/api/v1/tasks?openOnly=true&limit=6'),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Rolling twelve months, in the organization’s reporting currency.
        </p>
      </header>

      {overview ? (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Revenue"
              value={moneyCompact(overview.revenue)}
              hint="Issued invoices, accrual basis"
            />
            <Stat
              label="Expenses"
              value={moneyCompact(overview.expenses)}
              hint="Approved claims only"
            />
            <Stat
              label="Gross margin"
              value={percent(overview.grossMarginPercent)}
              hint="Revenue less expenses"
              tone={
                overview.grossMarginPercent === null
                  ? 'neutral'
                  : overview.grossMarginPercent >= 30
                    ? 'positive'
                    : 'caution'
              }
            />
            <Stat
              label="Receivable"
              value={moneyCompact(overview.accountsReceivable)}
              hint={`${moneyCompact(overview.overdueReceivable)} of it overdue`}
              tone={Number(overview.overdueReceivable.amount) > 0 ? 'caution' : 'neutral'}
            />
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Utilisation"
              value={percent(overview.utilizationPercent)}
              hint={`${hours(overview.billableHours)} billable of ${hours(
                overview.billableHours + overview.nonBillableHours,
              )}`}
            />
            <Stat
              label="Active projects"
              value={number(overview.activeProjects)}
              hint={`${number(overview.activeClients)} active clients`}
            />
            <Stat
              label="Open tasks"
              value={number(overview.openTasks)}
              hint={`${number(overview.overdueTasks)} past their due date`}
              tone={overview.overdueTasks > 0 ? 'caution' : 'neutral'}
            />
            <Stat
              label="People"
              value={number(overview.activeEmployees)}
              hint="Active employee records"
            />
          </div>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {overdue ? (
          <Card title="Overdue invoices" description="Issued, past due, still unpaid.">
            {overdue.items.length === 0 ? (
              <EmptyState title="Nothing overdue" hint="Every issued invoice is within terms." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Client</Th>
                    <Th align="right">Outstanding</Th>
                    <Th align="right">Late</Th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium text-accent-strong hover:underline"
                        >
                          {invoice.number}
                        </Link>
                      </Td>
                      <Td>{invoice.clientName ?? '—'}</Td>
                      <Td align="right" numeric>
                        {money(invoice.balanceDue)}
                      </Td>
                      <Td align="right" numeric>
                        <Badge tone="negative">{invoice.daysOverdue}d</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}

        {tasks ? (
          <Card title="Open work" description="Everything not yet done or cancelled.">
            {tasks.items.length === 0 ? (
              <EmptyState title="Nothing open" hint="The board is clear." />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {tasks.items.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{task.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {task.projectName ?? 'No project'}
                        {task.dueDate ? ` · due ${date(task.dueDate)}` : ''}
                      </p>
                    </div>
                    <Badge tone={task.overdue ? 'negative' : toneForStatus(task.status)}>
                      {task.overdue ? 'Overdue' : label(task.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {!overview && !overdue && !tasks ? (
        <EmptyState
          title="Nothing to show yet"
          hint="Your role doesn’t grant access to the dashboard panels."
        />
      ) : null}
    </>
  );
}
