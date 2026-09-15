import {
  type CreateTaskInput,
  type Page,
  type Task,
  type TaskComment,
  type UpdateTaskInput,
  TERMINAL_TASK_STATUSES,
  conflict,
  newId,
  notFound,
  toIsoDate,
} from '@almajeed/shared';
import {
  clients,
  projects,
  scope,
  scopeById,
  taskComments,
  tasks,
  timeEntries,
  users,
} from '@almajeed/db';
import { type SQL, and, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { diffSnapshot, writeAudit } from '../../lib/audit.js';
import { likePattern, mapPage } from '../../lib/query.js';
import {
  assertActiveMember,
  assertBelongsToOrganization,
  findByIdOrThrow,
  paginate,
} from '../../lib/repository.js';
import { iso, isoOrNull } from '../../lib/serialize.js';

/**
 * Tasks.
 *
 * Board ordering uses a sparse `position` (1000, 2000, 3000, ...). Dragging a
 * card between two others writes one row — the midpoint — instead of
 * renumbering every sibling, which is what makes a board with a few thousand
 * cards still feel instant.
 *
 * `overdue` is derived at read time, like the invoice flag, so it cannot be
 * stale.
 */

const POSITION_STEP = 1_000;

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  parentTaskId: string | null;
  position: number;
  completedAt: Date | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const selection = {
  id: tasks.id,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  estimateMinutes: tasks.estimateMinutes,
  projectId: tasks.projectId,
  projectName: projects.name,
  clientId: tasks.clientId,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  parentTaskId: tasks.parentTaskId,
  position: tasks.position,
  completedAt: tasks.completedAt,
  tags: tasks.tags,
  metadata: tasks.metadata,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
};

const taskQuery = (ctx: RequestContext) =>
  ctx.db
    .select(selection)
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .$dynamic();

function toTask(row: TaskRow, today: string, loggedMinutes = 0): Task {
  const isTerminal = (TERMINAL_TASK_STATUSES as readonly string[]).includes(row.status);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    dueDate: row.dueDate,
    overdue: !isTerminal && row.dueDate !== null && row.dueDate < today,
    estimateMinutes: row.estimateMinutes,
    loggedMinutes,
    projectId: row.projectId,
    projectName: row.projectName,
    clientId: row.clientId,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    parentTaskId: row.parentTaskId,
    position: row.position,
    completedAt: isoOrNull(row.completedAt),
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listTasks(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    status?: string;
    priority?: string;
    projectId?: string;
    assigneeId?: string;
    dueBefore?: string;
    openOnly?: boolean;
    q?: string;
  },
): Promise<Page<Task>> {
  const today = toIsoDate(ctx.now);
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(tasks.status, query.status as never));
  if (query.priority) filters.push(eq(tasks.priority, query.priority as never));
  if (query.projectId) filters.push(eq(tasks.projectId, query.projectId));
  if (query.assigneeId) filters.push(eq(tasks.assigneeId, query.assigneeId));
  if (query.dueBefore) filters.push(lte(tasks.dueDate, query.dueBefore));
  if (query.openOnly) filters.push(sql`${tasks.status} not in ('done', 'cancelled')`);
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)));
  }

  const page = await paginate<TaskRow>(taskQuery(ctx), tasks, ctx, {
    limit: query.limit,
    cursor: query.cursor,
    filters,
  });

  const logged = await loggedMinutesFor(
    ctx,
    page.items.map((row) => row.id),
  );
  return mapPage(page, (row) => toTask(row, today, logged.get(row.id) ?? 0));
}

/**
 * Logged minutes for a batch of tasks in one query.
 *
 * Doing this per task would be the classic N+1: a 25-row board page turning
 * into 26 round trips.
 */
async function loggedMinutesFor(
  ctx: RequestContext,
  taskIds: string[],
): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({
      taskId: timeEntries.taskId,
      minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
    })
    .from(timeEntries)
    .where(scope(timeEntries, ctx.auth.organizationId, inArray(timeEntries.taskId, taskIds)))
    .groupBy(timeEntries.taskId);

  return new Map(
    rows.filter((row) => row.taskId !== null).map((row) => [row.taskId as string, row.minutes]),
  );
}

async function getTaskRow(ctx: RequestContext, id: string): Promise<TaskRow> {
  return findByIdOrThrow<TaskRow>(taskQuery(ctx), tasks, ctx, id, 'Task');
}

export async function getTask(ctx: RequestContext, id: string): Promise<Task> {
  const row = await getTaskRow(ctx, id);
  const logged = await loggedMinutesFor(ctx, [id]);
  return toTask(row, toIsoDate(ctx.now), logged.get(id) ?? 0);
}

export async function createTask(ctx: RequestContext, input: CreateTaskInput): Promise<Task> {
  await assertBelongsToOrganization(ctx, projects, input.projectId, 'Project');
  await assertBelongsToOrganization(ctx, clients, input.clientId, 'Client');
  await assertActiveMember(ctx, input.assigneeId);
  if (input.parentTaskId) await getTaskRow(ctx, input.parentTaskId);

  const id = newId('task');
  const position = await nextPosition(ctx, input.projectId ?? null);
  const isTerminal = (TERMINAL_TASK_STATUSES as readonly string[]).includes(input.status);

  await ctx.db.transaction(async (tx) => {
    await tx.insert(tasks).values({
      id,
      organizationId: ctx.auth.organizationId,
      title: input.title,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      clientId: input.clientId ?? null,
      assigneeId: input.assigneeId ?? null,
      createdByUserId: ctx.auth.userId,
      parentTaskId: input.parentTaskId ?? null,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      position,
      completedAt: isTerminal ? ctx.now : null,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'task.created',
      resourceType: 'task',
      resourceId: id,
      after: { title: input.title, projectId: input.projectId, assigneeId: input.assigneeId },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getTask(ctx, id);
}

async function nextPosition(ctx: RequestContext, projectId: string | null): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`coalesce(max(${tasks.position}), 0)::int` })
    .from(tasks)
    .where(
      scope(
        tasks,
        ctx.auth.organizationId,
        projectId ? eq(tasks.projectId, projectId) : sql`${tasks.projectId} is null`,
      ),
    );
  return (row?.max ?? 0) + POSITION_STEP;
}

export async function updateTask(
  ctx: RequestContext,
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const before = await getTaskRow(ctx, id);
  await assertBelongsToOrganization(ctx, projects, input.projectId ?? undefined, 'Project');
  await assertBelongsToOrganization(ctx, clients, input.clientId ?? undefined, 'Client');
  await assertActiveMember(ctx, input.assigneeId);

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'title',
    'description',
    'projectId',
    'clientId',
    'assigneeId',
    'status',
    'priority',
    'dueDate',
    'estimateMinutes',
    'position',
    'tags',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  // `completedAt` is a consequence of the status, never set directly: a
  // client-supplied completion timestamp is how burn-down charts start lying.
  if (input.status !== undefined) {
    const isTerminal = (TERMINAL_TASK_STATUSES as readonly string[]).includes(input.status);
    const wasTerminal = (TERMINAL_TASK_STATUSES as readonly string[]).includes(before.status);
    if (isTerminal && !wasTerminal) patch.completedAt = ctx.now;
    if (!isTerminal && wasTerminal) patch.completedAt = null;
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set(patch)
      .where(scopeById(tasks, ctx.auth.organizationId, id));
    const changes = diffSnapshot(before as unknown as Record<string, unknown>, patch);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'task.updated',
      resourceType: 'task',
      resourceId: id,
      before: changes.before,
      after: changes.after,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getTask(ctx, id);
}

export async function deleteTask(ctx: RequestContext, id: string): Promise<void> {
  const task = await getTaskRow(ctx, id);

  const [children] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(scope(tasks, ctx.auth.organizationId, eq(tasks.parentTaskId, id)));

  if ((children?.total ?? 0) > 0) {
    throw conflict('This task has subtasks; delete or reparent them first', {
      subtasks: children?.total,
    });
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ deletedAt: ctx.now, updatedAt: ctx.now })
      .where(scopeById(tasks, ctx.auth.organizationId, id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'task.deleted',
      resourceType: 'task',
      resourceId: id,
      before: { title: task.title, status: task.status },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });
}

/* -------------------------------------------------------------- comments -- */

export async function listComments(ctx: RequestContext, taskId: string): Promise<TaskComment[]> {
  await getTaskRow(ctx, taskId);

  const rows = await ctx.db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      authorUserId: taskComments.authorUserId,
      authorName: users.name,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorUserId))
    .where(scope(taskComments, ctx.auth.organizationId, eq(taskComments.taskId, taskId)))
    .orderBy(taskComments.createdAt);

  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

export async function addComment(
  ctx: RequestContext,
  taskId: string,
  body: string,
): Promise<TaskComment> {
  await getTaskRow(ctx, taskId);

  const id = newId('comment');
  await ctx.db.insert(taskComments).values({
    id,
    organizationId: ctx.auth.organizationId,
    taskId,
    authorUserId: ctx.auth.userId,
    body,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  const comments = await listComments(ctx, taskId);
  const created = comments.find((comment) => comment.id === id);
  if (!created) throw notFound('Comment', id);
  return created;
}

export async function deleteComment(
  ctx: RequestContext,
  taskId: string,
  commentId: string,
): Promise<void> {
  await getTaskRow(ctx, taskId);

  const removed = await ctx.db
    .update(taskComments)
    .set({ deletedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        scopeById(taskComments, ctx.auth.organizationId, commentId),
        eq(taskComments.taskId, taskId),
        // Only the author may remove their own comment; moderation is a
        // separate concern and would need its own permission.
        eq(taskComments.authorUserId, ctx.auth.userId),
      ),
    )
    .returning({ id: taskComments.id });

  if (removed.length === 0) throw notFound('Comment', commentId);
}
