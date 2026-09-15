import type { Metadata } from 'next';
import {
  Badge,
  Card,
  EmptyState,
  NoAccess,
  PageHeader,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import type { Expense, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Expenses' };

export default async function ExpensesPage() {
  const page = await apiFetchOrNull<Page<Expense>>('/api/v1/expenses?limit=50');
  if (!page) return <NoAccess permission="expense:read" />;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Claims are approved by finance, never by the person who filed them."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No expenses filed" />
        ) : (
          <Table minWidth="38rem">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Incurred</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((expense) => (
                <tr key={expense.id}>
                  <Td>
                    <span className="font-medium text-ink">{expense.description}</span>
                    {expense.vendor ? (
                      <span className="block text-xs text-ink-faint">{expense.vendor}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{label(expense.category)}</span>
                  </Td>
                  <Td>
                    <Badge tone={toneForStatus(expense.status)}>{label(expense.status)}</Badge>
                  </Td>
                  <Td align="right" numeric>
                    {money(expense.amount)}
                  </Td>
                  <Td align="right">
                    <span className="text-ink-muted">{date(expense.incurredAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
