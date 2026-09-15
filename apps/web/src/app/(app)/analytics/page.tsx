import type { Metadata } from 'next';
import { Bar, Card, EmptyState, NoAccess, PageHeader, Table, Td, Th } from '@/components/ui';
import { RevenueChart } from '@/components/revenue-chart';
import { apiFetchOrNull } from '@/lib/api';
import { date, hours, money, moneyCompact, number, percent } from '@/lib/format';
import type {
  CashFlowForecast,
  ProjectProfitability,
  ReceivablesAging,
  RevenueSeries,
} from '@/lib/types';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage() {
  const [revenue, profitability, aging, cashFlow] = await Promise.all([
    apiFetchOrNull<RevenueSeries>('/api/v1/analytics/revenue?granularity=month'),
    apiFetchOrNull<ProjectProfitability>('/api/v1/analytics/project-profitability'),
    apiFetchOrNull<ReceivablesAging>('/api/v1/analytics/receivables-aging'),
    apiFetchOrNull<CashFlowForecast>('/api/v1/analytics/cash-flow'),
  ]);

  if (!revenue && !profitability && !aging && !cashFlow) {
    return <NoAccess permission="analytics:read" />;
  }

  const agingMax = aging
    ? Math.max(...aging.buckets.map((bucket) => Number(bucket.amount.amount)), 1)
    : 1;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Each figure is defined once, server-side. Amounts outside the reporting currency are excluded rather than converted at a guessed rate."
      />

      <div className="space-y-4">
        {revenue ? (
          <Card
            title="Revenue and expenses"
            description="Issued invoices against approved expenses, by month."
          >
            {revenue.points.length === 0 ? (
              <EmptyState title="No activity in this window" />
            ) : (
              <RevenueChart points={revenue.points} />
            )}
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {aging ? (
            <Card
              title="Receivables aging"
              description={`${money(aging.total)} outstanding in total.`}
            >
              {Number(aging.total.amount) === 0 ? (
                <EmptyState title="Nothing outstanding" />
              ) : (
                <ul className="space-y-3">
                  {aging.buckets.map((bucket) => (
                    <li key={bucket.label}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-ink">
                          {bucket.label === 'current' ? 'Not yet due' : `${bucket.label} days`}
                        </span>
                        <span className="numeric text-ink-muted">
                          {money(bucket.amount)}
                          <span className="ml-2 text-xs text-ink-faint">
                            {number(bucket.invoiceCount)}
                          </span>
                        </span>
                      </div>
                      <Bar
                        value={Number(bucket.amount.amount)}
                        max={agingMax}
                        tone={bucket.label === 'current' ? 'accent' : 'negative'}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {cashFlow ? (
            <Card
              title="Thirteen-week cash forecast"
              description="Open receivables in the week they fall due, less approved spend. A projection, not a treasury model."
            >
              <Table minWidth="24rem">
                <thead>
                  <tr>
                    <Th>Week</Th>
                    <Th align="right">In</Th>
                    <Th align="right">Out</Th>
                    <Th align="right">Running</Th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlow.weeks.slice(0, 8).map((week) => (
                    <tr key={week.weekStart}>
                      <Td>
                        <span className="text-ink-muted">{date(week.weekStart)}</span>
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(week.expectedInflow)}
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(week.expectedOutflow)}
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(week.closingBalance)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        {profitability ? (
          <Card
            title="Project profitability"
            description="Billed revenue less labour at cost rate and direct expenses."
          >
            {profitability.rows.length === 0 ? (
              <EmptyState title="No project activity in this window" />
            ) : (
              <Table minWidth="48rem">
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Client</Th>
                    <Th align="right">Billed</Th>
                    <Th align="right">Labour</Th>
                    <Th align="right">Expenses</Th>
                    <Th align="right">Margin</Th>
                    <Th align="right">Hours</Th>
                  </tr>
                </thead>
                <tbody>
                  {profitability.rows.map((row) => (
                    <tr key={row.projectId}>
                      <Td>
                        <span className="font-medium text-ink">{row.name}</span>
                      </Td>
                      <Td>
                        <span className="text-ink-muted">{row.clientName ?? 'Internal'}</span>
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(row.billedRevenue)}
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(row.laborCost)}
                      </Td>
                      <Td align="right" numeric>
                        {moneyCompact(row.directExpenses)}
                      </Td>
                      <Td align="right" numeric>
                        <span
                          className={
                            Number(row.margin.amount) < 0 ? 'text-negative' : 'text-positive'
                          }
                        >
                          {moneyCompact(row.margin)}
                          <span className="ml-1 text-xs text-ink-faint">
                            {percent(row.marginPercent)}
                          </span>
                        </span>
                      </Td>
                      <Td align="right" numeric>
                        {hours(row.hours)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
