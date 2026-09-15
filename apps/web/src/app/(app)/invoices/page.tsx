import type { Metadata } from 'next';
import Link from 'next/link';
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
import type { Invoice, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Invoices' };

export default async function InvoicesPage() {
  const page = await apiFetchOrNull<Page<Invoice>>('/api/v1/invoices?limit=50');
  if (!page) return <NoAccess permission="invoice:read" />;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Drafts are editable; once issued, a document is corrected by voiding and re-issuing."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Draft one against a client." />
        ) : (
          <Table minWidth="42rem">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Due</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((invoice) => (
                <tr key={invoice.id}>
                  <Td>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-accent-strong hover:underline"
                    >
                      {invoice.number}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{invoice.clientName ?? '—'}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={toneForStatus(invoice.status)}>{label(invoice.status)}</Badge>
                      {invoice.overdue ? (
                        <Badge tone="negative">{invoice.daysOverdue}d late</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td align="right" numeric>
                    {money(invoice.total)}
                  </Td>
                  <Td align="right" numeric>
                    {money(invoice.balanceDue)}
                  </Td>
                  <Td align="right">
                    <span className="text-ink-muted">{date(invoice.dueDate)}</span>
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
