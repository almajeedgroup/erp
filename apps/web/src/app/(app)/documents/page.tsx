import type { Metadata } from 'next';
import { Badge, Card, EmptyState, NoAccess, PageHeader, Table, Td, Th } from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, label } from '@/lib/format';
import type { DocumentRecord, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Documents' };

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const page = await apiFetchOrNull<Page<DocumentRecord>>('/api/v1/documents?limit=50');
  if (!page) return <NoAccess permission="document:read" />;

  return (
    <>
      <PageHeader
        title="Documents"
        description="Contracts, receipts and reports. AI indexing is opt-in per document, and confidential files are never indexed."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No documents" hint="Upload a contract or a receipt to begin." />
        ) : (
          <Table minWidth="44rem">
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Category</Th>
                <Th>Type</Th>
                <Th align="right">Size</Th>
                <Th>Flags</Th>
                <Th align="right">Uploaded</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((document) => (
                <tr key={document.id}>
                  <Td>
                    <a
                      href={`/api/documents/${document.id}/download`}
                      className="font-medium text-accent-strong hover:underline"
                    >
                      {document.title}
                    </a>
                    <span className="block font-mono text-xs text-ink-faint">
                      {document.filename}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{label(document.category)}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-ink-faint">{document.contentType}</span>
                  </Td>
                  <Td align="right" numeric>
                    {fileSize(document.sizeBytes)}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {document.confidential ? <Badge tone="negative">Confidential</Badge> : null}
                      {document.indexForAi ? <Badge tone="accent">AI indexed</Badge> : null}
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="text-ink-muted">{date(document.createdAt)}</span>
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
