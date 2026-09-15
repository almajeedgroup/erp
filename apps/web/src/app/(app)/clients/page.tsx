import type { Metadata } from 'next';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, toneForStatus } from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, label } from '@/lib/format';
import { NoAccess } from '@/components/ui';
import type { Client, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const query = new URLSearchParams({ limit: '50' });
  if (filters.status) query.set('status', filters.status);
  if (filters.q) query.set('q', filters.q);

  const page = await apiFetchOrNull<Page<Client>>(`/api/v1/clients?${query}`);
  if (!page) return <NoAccess permission="client:read" />;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every counterparty, from first contact to long-term account."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No clients yet" hint="Add one to start tracking work against it." />
        ) : (
          <Table minWidth="40rem">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Channel</Th>
                <Th>Currency</Th>
                <Th align="right">Terms</Th>
                <Th align="right">Added</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((client) => (
                <tr key={client.id}>
                  <Td>
                    <span className="font-medium text-ink">{client.name}</span>
                    {client.legalName && client.legalName !== client.name ? (
                      <span className="block text-xs text-ink-faint">{client.legalName}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={toneForStatus(client.status)}>{label(client.status)}</Badge>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{label(client.acquisitionChannel)}</span>
                  </Td>
                  <Td>
                    <span className="numeric text-ink-muted">{client.billingCurrency}</span>
                  </Td>
                  <Td align="right" numeric>
                    {client.paymentTermsDays === 0
                      ? 'On receipt'
                      : `Net ${client.paymentTermsDays}`}
                  </Td>
                  <Td align="right">
                    <span className="text-ink-muted">{date(client.createdAt)}</span>
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
