import type { Metadata } from 'next';
import { Badge, Card, EmptyState, NoAccess, PageHeader, toneForStatus } from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, label, minutesAsHours } from '@/lib/format';
import type { Page, Task } from '@/lib/types';

export const metadata: Metadata = { title: 'Tasks' };

const COLUMNS = ['todo', 'in_progress', 'blocked', 'in_review', 'done'] as const;

/**
 * A read-only board.
 *
 * Grouping happens here rather than in the API because the API returns one
 * ordered page and the board is a presentation of it. Fetching five times, once
 * per column, would be five round trips for the same rows.
 */
export default async function TasksPage() {
  const page = await apiFetchOrNull<Page<Task>>('/api/v1/tasks?limit=100');
  if (!page) return <NoAccess permission="task:read" />;

  const byStatus = new Map<string, Task[]>(COLUMNS.map((status) => [status, []]));
  for (const task of page.items) {
    byStatus.get(task.status)?.push(task);
  }

  return (
    <>
      <PageHeader title="Tasks" description="Work in flight, grouped by state." />

      {page.items.length === 0 ? (
        <Card>
          <EmptyState title="Nothing on the board" hint="Add a task to get started." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((status) => {
            const tasks = byStatus.get(status) ?? [];
            return (
              <section
                key={status}
                className="rounded-xl border border-border-subtle bg-surface-raised"
              >
                <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink">{label(status)}</h2>
                  <span className="numeric text-xs text-ink-faint">{tasks.length}</span>
                </div>
                <ul className="space-y-2 p-3">
                  {tasks.length === 0 ? (
                    <li className="px-1 py-2 text-xs text-ink-faint">Empty</li>
                  ) : (
                    tasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-lg border border-border-subtle bg-surface p-3"
                      >
                        <p className="text-sm font-medium text-ink">{task.title}</p>
                        <p className="mt-1 truncate text-xs text-ink-muted">
                          {task.projectName ?? 'No project'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge tone={task.priority === 'urgent' ? 'negative' : 'neutral'}>
                            {label(task.priority)}
                          </Badge>
                          {task.dueDate ? (
                            <Badge tone={task.overdue ? 'negative' : 'neutral'}>
                              {date(task.dueDate)}
                            </Badge>
                          ) : null}
                          {task.loggedMinutes > 0 ? (
                            <Badge tone={toneForStatus(task.status)}>
                              {minutesAsHours(task.loggedMinutes)}
                            </Badge>
                          ) : null}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
