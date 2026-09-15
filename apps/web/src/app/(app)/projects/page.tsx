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
import type { Page, Project } from '@/lib/types';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const page = await apiFetchOrNull<Page<Project>>('/api/v1/projects?limit=50');
  if (!page) return <NoAccess permission="project:read" />;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery work, its billing model and how healthy it looks."
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No projects yet" hint="Create one against a client to begin." />
        ) : (
          <Table minWidth="46rem">
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th>Health</Th>
                <Th>Billing</Th>
                <Th align="right">Budget</Th>
                <Th align="right">Ends</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((project) => (
                <tr key={project.id}>
                  <Td>
                    <span className="font-medium text-ink">{project.name}</span>
                    {project.code ? (
                      <span className="ml-2 font-mono text-xs text-ink-faint">{project.code}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{project.clientName ?? 'Internal'}</span>
                  </Td>
                  <Td>
                    <Badge tone={toneForStatus(project.status)}>{label(project.status)}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={toneForStatus(project.health)}>{label(project.health)}</Badge>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{label(project.billingType)}</span>
                  </Td>
                  <Td align="right" numeric>
                    {money(project.budget)}
                  </Td>
                  <Td align="right">
                    <span className="text-ink-muted">{date(project.endDate)}</span>
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
