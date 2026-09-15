import {
  type CreateProjectInput,
  type CreateTimeEntryInput,
  type Page,
  type Project,
  type ProjectMember,
  type TimeEntry,
  type UpdateProjectInput,
  conflict,
  newId,
  notFound,
  preconditionFailed,
} from '@almajeed/shared';
import {
  clients,
  projectMembers,
  projects,
  scope,
  scopeById,
  timeEntries,
  users,
} from '@almajeed/db';
import { type SQL, and, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { diffSnapshot, writeAudit } from '../../lib/audit.js';
import { fromMoneyInput, readMoney, toMoneyOutputOrNull } from '../../lib/money.js';
import { likePattern, mapPage } from '../../lib/query.js';
import {
  assertActiveMember,
  assertBelongsToOrganization,
  findByIdOrThrow,
  paginate,
} from '../../lib/repository.js';
import { iso, isoOrNull } from '../../lib/serialize.js';

/**
 * Projects and time.
 *
 * The rule that shapes this module: **a time entry that has been invoiced is
 * immutable**. Once minutes have been billed to a client, editing them
 * silently changes what the books say happened. Corrections go through a
 * credit note on the invoice, not through rewriting history — so
 * `invoicedInvoiceId` is checked on every mutation.
 */

interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  clientId: string | null;
  clientName: string | null;
  status: string;
  billingType: string;
  currency: string;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  hourlyRateAmount: number | null;
  hourlyRateCurrency: string | null;
  startDate: string | null;
  endDate: string | null;
  managerId: string | null;
  health: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const projectSelection = {
  id: projects.id,
  name: projects.name,
  code: projects.code,
  clientId: projects.clientId,
  clientName: clients.name,
  status: projects.status,
  billingType: projects.billingType,
  currency: projects.currency,
  budgetAmount: projects.budgetAmount,
  budgetCurrency: projects.budgetCurrency,
  hourlyRateAmount: projects.hourlyRateAmount,
  hourlyRateCurrency: projects.hourlyRateCurrency,
  startDate: projects.startDate,
  endDate: projects.endDate,
  managerId: projects.managerId,
  health: projects.health,
  description: projects.description,
  tags: projects.tags,
  metadata: projects.metadata,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

const projectQuery = (ctx: RequestContext) =>
  ctx.db
    .select(projectSelection)
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .$dynamic();

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    clientId: row.clientId,
    clientName: row.clientName,
    status: row.status as Project['status'],
    billingType: row.billingType as Project['billingType'],
    currency: row.currency,
    budget: toMoneyOutputOrNull(readMoney(row.budgetAmount, row.budgetCurrency, 'SAR')),
    hourlyRate: toMoneyOutputOrNull(readMoney(row.hourlyRateAmount, row.hourlyRateCurrency, 'SAR')),
    startDate: row.startDate,
    endDate: row.endDate,
    managerId: row.managerId,
    health: row.health as Project['health'],
    description: row.description,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listProjects(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    status?: string;
    clientId?: string;
    health?: string;
    q?: string;
  },
): Promise<Page<Project>> {
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(projects.status, query.status as never));
  if (query.clientId) filters.push(eq(projects.clientId, query.clientId));
  if (query.health) filters.push(eq(projects.health, query.health as never));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(or(ilike(projects.name, pattern), ilike(projects.code, pattern)));
  }

  const page = await paginate<ProjectRow>(projectQuery(ctx), projects, ctx, {
    limit: query.limit,
    cursor: query.cursor,
    filters,
  });
  return mapPage(page, toProject);
}

async function getProjectRow(ctx: RequestContext, id: string): Promise<ProjectRow> {
  return findByIdOrThrow<ProjectRow>(projectQuery(ctx), projects, ctx, id, 'Project');
}

export async function getProject(ctx: RequestContext, id: string): Promise<Project> {
  return toProject(await getProjectRow(ctx, id));
}

export async function createProject(
  ctx: RequestContext,
  input: CreateProjectInput,
): Promise<Project> {
  await assertBelongsToOrganization(ctx, clients, input.clientId, 'Client');
  await assertActiveMember(ctx, input.managerId);

  const id = newId('project');
  const budget = input.budget ? fromMoneyInput(input.budget) : null;
  const hourlyRate = input.hourlyRate ? fromMoneyInput(input.hourlyRate) : null;

  await ctx.db.transaction(async (tx) => {
    if (input.code) {
      const [taken] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(scope(projects, ctx.auth.organizationId, eq(projects.code, input.code)))
        .limit(1);
      if (taken) throw conflict(`Project code "${input.code}" is already in use`);
    }

    await tx.insert(projects).values({
      id,
      organizationId: ctx.auth.organizationId,
      name: input.name,
      code: input.code ?? null,
      clientId: input.clientId ?? null,
      status: input.status,
      billingType: input.billingType,
      currency: input.currency,
      budgetAmount: budget?.amount ?? null,
      budgetCurrency: budget?.currency ?? null,
      hourlyRateAmount: hourlyRate?.amount ?? null,
      hourlyRateCurrency: hourlyRate?.currency ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      managerId: input.managerId ?? null,
      health: input.health,
      description: input.description ?? null,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'project.created',
      resourceType: 'project',
      resourceId: id,
      after: { name: input.name, billingType: input.billingType, clientId: input.clientId },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getProject(ctx, id);
}

export async function updateProject(
  ctx: RequestContext,
  id: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const before = await getProjectRow(ctx, id);
  await assertBelongsToOrganization(ctx, clients, input.clientId, 'Client');
  await assertActiveMember(ctx, input.managerId);

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'name',
    'code',
    'clientId',
    'status',
    'billingType',
    'startDate',
    'endDate',
    'managerId',
    'health',
    'description',
    'tags',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  if (input.budget !== undefined) {
    const budget = input.budget ? fromMoneyInput(input.budget) : null;
    patch.budgetAmount = budget?.amount ?? null;
    patch.budgetCurrency = budget?.currency ?? null;
  }
  if (input.hourlyRate !== undefined) {
    const rate = input.hourlyRate ? fromMoneyInput(input.hourlyRate) : null;
    patch.hourlyRateAmount = rate?.amount ?? null;
    patch.hourlyRateCurrency = rate?.currency ?? null;
  }

  // The cross-field rule from the create schema still has to hold on update:
  // a project cannot be switched to fixed price without a contract value.
  const nextBillingType = (patch.billingType as string | undefined) ?? before.billingType;
  const nextBudget =
    patch.budgetAmount !== undefined ? (patch.budgetAmount as number | null) : before.budgetAmount;
  if (nextBillingType === 'fixed_price' && nextBudget === null) {
    throw preconditionFailed('A fixed-price project requires a budget');
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set(patch)
      .where(scopeById(projects, ctx.auth.organizationId, id));
    const changes = diffSnapshot(before as unknown as Record<string, unknown>, patch);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'project.updated',
      resourceType: 'project',
      resourceId: id,
      before: changes.before,
      after: changes.after,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getProject(ctx, id);
}

export async function deleteProject(ctx: RequestContext, id: string): Promise<void> {
  const project = await getProjectRow(ctx, id);

  const [billed] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(timeEntries)
    .where(
      scope(
        timeEntries,
        ctx.auth.organizationId,
        eq(timeEntries.projectId, id),
        sql`${timeEntries.invoicedInvoiceId} is not null`,
      ),
    );

  if ((billed?.total ?? 0) > 0) {
    throw conflict('This project has invoiced time and cannot be deleted', {
      invoicedEntries: billed?.total,
    });
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ deletedAt: ctx.now, updatedAt: ctx.now })
      .where(scopeById(projects, ctx.auth.organizationId, id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: id,
      before: { name: project.name, status: project.status },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });
}

/* ---------------------------------------------------------------- members -- */

export async function listProjectMembers(
  ctx: RequestContext,
  projectId: string,
): Promise<ProjectMember[]> {
  await getProjectRow(ctx, projectId);

  const rows = await ctx.db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      userName: users.name,
      role: projectMembers.role,
      allocationPercent: projectMembers.allocationPercent,
      hourlyRateAmount: projectMembers.hourlyRateAmount,
      hourlyRateCurrency: projectMembers.hourlyRateCurrency,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .leftJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.organizationId, ctx.auth.organizationId),
        eq(projectMembers.projectId, projectId),
      ),
    )
    .orderBy(projectMembers.createdAt);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    userName: row.userName,
    role: row.role,
    allocationPercent: row.allocationPercent,
    hourlyRate: toMoneyOutputOrNull(readMoney(row.hourlyRateAmount, row.hourlyRateCurrency, 'SAR')),
    createdAt: iso(row.createdAt),
  }));
}

export async function addProjectMember(
  ctx: RequestContext,
  projectId: string,
  input: {
    userId: string;
    role: string;
    allocationPercent: number;
    hourlyRate?: { amount: string; currency: string };
  },
): Promise<ProjectMember[]> {
  await getProjectRow(ctx, projectId);
  await assertActiveMember(ctx, input.userId);

  const rate = input.hourlyRate ? fromMoneyInput(input.hourlyRate) : null;

  const existing = await ctx.db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.organizationId, ctx.auth.organizationId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (existing.length > 0) throw conflict('That person is already on this project');

  await ctx.db.transaction(async (tx) => {
    await tx.insert(projectMembers).values({
      id: newId('projectMember'),
      organizationId: ctx.auth.organizationId,
      projectId,
      userId: input.userId,
      role: input.role,
      allocationPercent: input.allocationPercent,
      hourlyRateAmount: rate?.amount ?? null,
      hourlyRateCurrency: rate?.currency ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'project.member_added',
      resourceType: 'project',
      resourceId: projectId,
      after: { userId: input.userId, role: input.role },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return listProjectMembers(ctx, projectId);
}

export async function removeProjectMember(
  ctx: RequestContext,
  projectId: string,
  userId: string,
): Promise<void> {
  await getProjectRow(ctx, projectId);

  const removed = await ctx.db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.organizationId, ctx.auth.organizationId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .returning({ id: projectMembers.id });

  if (removed.length === 0) throw notFound('Project member', userId);

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'project.member_removed',
    resourceType: 'project',
    resourceId: projectId,
    before: { userId },
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

/* ------------------------------------------------------------ time entries -- */

interface TimeEntryRow {
  id: string;
  projectId: string;
  projectName: string | null;
  taskId: string | null;
  employeeId: string | null;
  userId: string | null;
  date: string;
  minutes: number;
  billable: boolean;
  approvedAt: Date | null;
  invoicedInvoiceId: string | null;
  notes: string | null;
  createdAt: Date;
}

const timeEntrySelection = {
  id: timeEntries.id,
  projectId: timeEntries.projectId,
  projectName: projects.name,
  taskId: timeEntries.taskId,
  employeeId: timeEntries.employeeId,
  userId: timeEntries.userId,
  date: timeEntries.date,
  minutes: timeEntries.minutes,
  billable: timeEntries.billable,
  approvedAt: timeEntries.approvedAt,
  invoicedInvoiceId: timeEntries.invoicedInvoiceId,
  notes: timeEntries.notes,
  createdAt: timeEntries.createdAt,
};

function toTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    taskId: row.taskId,
    employeeId: row.employeeId,
    userId: row.userId,
    date: row.date,
    minutes: row.minutes,
    hours: Math.round((row.minutes / 60) * 100) / 100,
    billable: row.billable,
    approvedAt: isoOrNull(row.approvedAt),
    invoicedInvoiceId: row.invoicedInvoiceId,
    notes: row.notes,
    createdAt: iso(row.createdAt),
  };
}

export async function listTimeEntries(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    projectId?: string;
    employeeId?: string;
    from?: string;
    to?: string;
    billable?: boolean;
    approved?: boolean;
  },
): Promise<Page<TimeEntry>> {
  const filters: (SQL | undefined)[] = [];
  if (query.projectId) filters.push(eq(timeEntries.projectId, query.projectId));
  if (query.employeeId) filters.push(eq(timeEntries.employeeId, query.employeeId));
  if (query.from) filters.push(gte(timeEntries.date, query.from));
  if (query.to) filters.push(lte(timeEntries.date, query.to));
  if (query.billable !== undefined) filters.push(eq(timeEntries.billable, query.billable));
  if (query.approved !== undefined) {
    filters.push(
      query.approved
        ? sql`${timeEntries.approvedAt} is not null`
        : sql`${timeEntries.approvedAt} is null`,
    );
  }

  const page = await paginate<TimeEntryRow>(
    ctx.db
      .select(timeEntrySelection)
      .from(timeEntries)
      .leftJoin(projects, eq(projects.id, timeEntries.projectId))
      .$dynamic(),
    timeEntries,
    ctx,
    { limit: query.limit, cursor: query.cursor, filters },
  );
  return mapPage(page, toTimeEntry);
}

export async function createTimeEntry(
  ctx: RequestContext,
  input: CreateTimeEntryInput,
): Promise<TimeEntry> {
  const project = await getProjectRow(ctx, input.projectId);

  if (project.status === 'completed' || project.status === 'cancelled') {
    throw preconditionFailed(`Cannot log time against a ${project.status} project`);
  }

  const id = newId('timeEntry');

  await ctx.db.transaction(async (tx) => {
    await tx.insert(timeEntries).values({
      id,
      organizationId: ctx.auth.organizationId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      employeeId: input.employeeId ?? null,
      userId: ctx.auth.userId,
      date: input.date,
      minutes: input.minutes,
      billable: input.billable,
      notes: input.notes ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'time_entry.created',
      resourceType: 'time_entry',
      resourceId: id,
      after: { projectId: input.projectId, minutes: input.minutes, date: input.date },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  const [created] = await ctx.db
    .select(timeEntrySelection)
    .from(timeEntries)
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(scopeById(timeEntries, ctx.auth.organizationId, id))
    .limit(1);

  if (!created) throw notFound('Time entry', id);
  return toTimeEntry(created);
}

export async function approveTimeEntry(ctx: RequestContext, id: string): Promise<TimeEntry> {
  const [entry] = await ctx.db
    .select(timeEntrySelection)
    .from(timeEntries)
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(scopeById(timeEntries, ctx.auth.organizationId, id))
    .limit(1);

  if (!entry) throw notFound('Time entry', id);
  if (entry.invoicedInvoiceId) {
    throw preconditionFailed('This entry is already on an invoice and cannot be changed');
  }

  await ctx.db
    .update(timeEntries)
    .set({ approvedAt: ctx.now, approvedByUserId: ctx.auth.userId, updatedAt: ctx.now })
    .where(scopeById(timeEntries, ctx.auth.organizationId, id));

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'time_entry.approved',
    resourceType: 'time_entry',
    resourceId: id,
    after: { approvedAt: ctx.now.toISOString() },
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return toTimeEntry({ ...entry, approvedAt: ctx.now });
}

export async function deleteTimeEntry(ctx: RequestContext, id: string): Promise<void> {
  const [entry] = await ctx.db
    .select({ id: timeEntries.id, invoicedInvoiceId: timeEntries.invoicedInvoiceId })
    .from(timeEntries)
    .where(scopeById(timeEntries, ctx.auth.organizationId, id))
    .limit(1);

  if (!entry) throw notFound('Time entry', id);
  if (entry.invoicedInvoiceId) {
    throw preconditionFailed('This entry is already on an invoice and cannot be deleted');
  }

  await ctx.db
    .update(timeEntries)
    .set({ deletedAt: ctx.now, updatedAt: ctx.now })
    .where(scopeById(timeEntries, ctx.auth.organizationId, id));

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'time_entry.deleted',
    resourceType: 'time_entry',
    resourceId: id,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}
