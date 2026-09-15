import type { Metadata } from 'next';
import { Badge, Card, EmptyState, NoAccess, PageHeader, Table, Td, Th } from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit log' };

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorName: string | null;
  succeeded: boolean;
  requestId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export default async function AuditPage() {
  const page = await apiFetchOrNull<{ items: AuditRow[] }>('/api/v1/organization/audit?limit=100');
  if (!page) return <NoAccess permission="audit:read" />;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every state change, including attempts that were denied. The request id links a row to its log line."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <Table minWidth="46rem">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
                <Th>Actor</Th>
                <Th>Request</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <span className="text-ink-muted">{dateTime(row.createdAt)}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink">{row.action}</span>
                      {row.succeeded ? null : <Badge tone="negative">denied</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{row.resourceType}</span>
                    {row.resourceId ? (
                      <span className="block font-mono text-xs text-ink-faint">
                        {row.resourceId}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{row.actorName ?? 'system'}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-ink-faint">{row.requestId ?? '—'}</span>
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
