import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, toneForStatus } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import type { InvoiceDetail } from '@/lib/types';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;

  let invoice: InvoiceDetail;
  try {
    invoice = await apiFetch<InvoiceDetail>(`/api/v1/invoices/${invoiceId}`);
  } catch (error) {
    // The API answers 404 for another tenant's invoice as well as a missing
    // one, and the UI keeps that indistinguishable.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={invoice.number}
        description={`${invoice.clientName ?? 'Unknown client'} · issued ${date(invoice.issueDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={toneForStatus(invoice.status)}>{label(invoice.status)}</Badge>
            {invoice.overdue ? <Badge tone="negative">{invoice.daysOverdue}d late</Badge> : null}
          </div>
        }
      />

      <Link
        href="/invoices"
        className="mb-4 inline-block text-sm text-accent-strong hover:underline"
      >
        ← All invoices
      </Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Lines">
          <Table minWidth="30rem">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit</Th>
                <Th align="right">Tax</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <Td>{line.description}</Td>
                  <Td align="right" numeric>
                    {line.quantity}
                  </Td>
                  <Td align="right" numeric>
                    {money(line.unitPrice)}
                  </Td>
                  <Td align="right" numeric>
                    {line.taxRate}%
                  </Td>
                  <Td align="right" numeric>
                    {money(line.total)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <dl className="mt-5 ml-auto max-w-xs space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(invoice.subtotal)} />
            {Number(invoice.discount.amount) > 0 ? (
              <Row label="Discount" value={`− ${money(invoice.discount)}`} />
            ) : null}
            <Row label="Tax" value={money(invoice.tax)} />
            <Row label="Total" value={money(invoice.total)} emphasis />
            <Row label="Paid" value={money(invoice.paid)} />
            <Row label="Balance due" value={money(invoice.balanceDue)} emphasis />
          </dl>
        </Card>

        <Card title="Payments">
          {invoice.payments.length === 0 ? (
            <EmptyState title="No payments recorded" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="numeric text-sm font-medium text-ink">
                      {money(payment.amount)}
                    </span>
                    <span className="text-xs text-ink-faint">{date(payment.paidAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {label(payment.method)}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({
  label: rowLabel,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 ${
        emphasis ? 'border-t border-border-subtle pt-1.5 font-semibold text-ink' : 'text-ink-muted'
      }`}
    >
      <dt>{rowLabel}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}
