import {
  type CreateEmployeeInput,
  type Employee,
  type Page,
  type UpdateEmployeeInput,
  conflict,
  newId,
  notFound,
} from '@almajeed/shared';
import { employees, scope, scopeById } from '@almajeed/db';
import { type SQL, eq, ilike, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { diffSnapshot, writeAudit } from '../../lib/audit.js';
import { fromMoneyInput, readMoney, toMoneyOutputOrNull } from '../../lib/money.js';
import { likePattern, mapPage } from '../../lib/query.js';
import { assertActiveMember, findByIdOrThrow, paginate } from '../../lib/repository.js';
import { iso } from '../../lib/serialize.js';

/**
 * Employees.
 *
 * Compensation, national id and bank details are the most sensitive data in
 * the product. They are gated on `employee:read_sensitive`, and the gate is
 * applied **in the mapper** — the single function every read path goes
 * through — rather than per endpoint. A new endpoint that returns an employee
 * therefore inherits the redaction automatically; there is no way to add a
 * route that forgets it without also bypassing `toEmployee`.
 *
 * The same fields are excluded from the audit-log snapshots and from AI
 * retrieval. See docs/03-security/data-privacy.md.
 */

interface EmployeeRow {
  id: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  managerId: string | null;
  employmentType: string;
  status: string;
  hiredAt: string | null;
  terminatedAt: string | null;
  compensationAmount: number | null;
  compensationCurrency: string | null;
  payPeriod: string;
  nationalId: string | null;
  bankAccount: string | null;
  costRateAmount: number | null;
  costRateCurrency: string | null;
  billableRateAmount: number | null;
  billableRateCurrency: string | null;
  weeklyHours: number;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const selection = {
  id: employees.id,
  employeeNumber: employees.employeeNumber,
  firstName: employees.firstName,
  lastName: employees.lastName,
  userId: employees.userId,
  email: employees.email,
  phone: employees.phone,
  jobTitle: employees.jobTitle,
  department: employees.department,
  managerId: employees.managerId,
  employmentType: employees.employmentType,
  status: employees.status,
  hiredAt: employees.hiredAt,
  terminatedAt: employees.terminatedAt,
  compensationAmount: employees.compensationAmount,
  compensationCurrency: employees.compensationCurrency,
  payPeriod: employees.payPeriod,
  nationalId: employees.nationalId,
  bankAccount: employees.bankAccount,
  costRateAmount: employees.costRateAmount,
  costRateCurrency: employees.costRateCurrency,
  billableRateAmount: employees.billableRateAmount,
  billableRateCurrency: employees.billableRateCurrency,
  weeklyHours: employees.weeklyHours,
  tags: employees.tags,
  metadata: employees.metadata,
  createdAt: employees.createdAt,
  updatedAt: employees.updatedAt,
};

/**
 * Row -> response, with the sensitive block included only when the caller
 * holds `employee:read_sensitive`.
 */
function toEmployee(row: EmployeeRow, canSeeSensitive: boolean): Employee {
  const base: Employee = {
    id: row.id,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    userId: row.userId,
    email: row.email,
    phone: row.phone,
    jobTitle: row.jobTitle,
    department: row.department,
    managerId: row.managerId,
    employmentType: row.employmentType as Employee['employmentType'],
    status: row.status as Employee['status'],
    hiredAt: row.hiredAt,
    terminatedAt: row.terminatedAt,
    weeklyHours: row.weeklyHours,
    billableRate: toMoneyOutputOrNull(
      readMoney(row.billableRateAmount, row.billableRateCurrency, 'SAR'),
    ),
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),

    compensation: null,
    payPeriod: null,
    costRate: null,
    nationalId: null,
    bankAccount: null,
  };

  if (!canSeeSensitive) return base;

  return {
    ...base,
    compensation: toMoneyOutputOrNull(
      readMoney(row.compensationAmount, row.compensationCurrency, 'SAR'),
    ),
    payPeriod: row.payPeriod as Employee['payPeriod'],
    costRate: toMoneyOutputOrNull(readMoney(row.costRateAmount, row.costRateCurrency, 'SAR')),
    nationalId: row.nationalId,
    bankAccount: row.bankAccount,
  };
}

function canSeeSensitive(ctx: RequestContext): boolean {
  return ctx.auth.permissions.has('employee:read_sensitive');
}

export async function listEmployees(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    status?: string;
    department?: string;
    employmentType?: string;
    q?: string;
  },
): Promise<Page<Employee>> {
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(employees.status, query.status as never));
  if (query.department) filters.push(eq(employees.department, query.department));
  if (query.employmentType) {
    filters.push(eq(employees.employmentType, query.employmentType as never));
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(employees.firstName, pattern),
        ilike(employees.lastName, pattern),
        ilike(employees.email, pattern),
        ilike(employees.jobTitle, pattern),
      ),
    );
  }

  const page = await paginate<EmployeeRow>(
    ctx.db.select(selection).from(employees).$dynamic(),
    employees,
    ctx,
    { limit: query.limit, cursor: query.cursor, filters },
  );

  const sensitive = canSeeSensitive(ctx);
  return mapPage(page, (row) => toEmployee(row, sensitive));
}

async function getEmployeeRow(ctx: RequestContext, id: string): Promise<EmployeeRow> {
  return findByIdOrThrow<EmployeeRow>(
    ctx.db.select(selection).from(employees).$dynamic(),
    employees,
    ctx,
    id,
    'Employee',
  );
}

export async function getEmployee(ctx: RequestContext, id: string): Promise<Employee> {
  return toEmployee(await getEmployeeRow(ctx, id), canSeeSensitive(ctx));
}

/**
 * Writing a sensitive field requires the permission to *read* it.
 *
 * Otherwise someone without `employee:read_sensitive` could set a salary they
 * cannot see, which is both a data-integrity problem and an oracle: set a
 * value, observe whether anything changed.
 */
function assertMaySetSensitive(
  ctx: RequestContext,
  input: {
    compensation?: unknown;
    costRate?: unknown;
    nationalId?: unknown;
    bankAccount?: unknown;
  },
): void {
  const touchesSensitive =
    input.compensation !== undefined ||
    input.costRate !== undefined ||
    input.nationalId !== undefined ||
    input.bankAccount !== undefined;

  if (touchesSensitive && !canSeeSensitive(ctx)) {
    throw notFound('Employee'); // deliberately indistinguishable from "no such field"
  }
}

export async function createEmployee(
  ctx: RequestContext,
  input: CreateEmployeeInput,
): Promise<Employee> {
  assertMaySetSensitive(ctx, input);
  await assertActiveMember(ctx, input.userId);

  if (input.managerId) {
    await getEmployeeRow(ctx, input.managerId); // must be an employee in this org
  }

  const id = newId('employee');
  const compensation = input.compensation ? fromMoneyInput(input.compensation) : null;
  const costRate = input.costRate ? fromMoneyInput(input.costRate) : null;
  const billableRate = input.billableRate ? fromMoneyInput(input.billableRate) : null;

  await ctx.db.transaction(async (tx) => {
    if (input.userId) {
      const [linked] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(scope(employees, ctx.auth.organizationId, eq(employees.userId, input.userId)))
        .limit(1);
      if (linked) throw conflict('That user is already linked to an employee record');
    }

    await tx.insert(employees).values({
      id,
      organizationId: ctx.auth.organizationId,
      userId: input.userId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      department: input.department ?? null,
      managerId: input.managerId ?? null,
      employmentType: input.employmentType,
      status: input.status,
      hiredAt: input.hiredAt ?? null,
      terminatedAt: input.terminatedAt ?? null,
      compensationAmount: compensation?.amount ?? null,
      compensationCurrency: compensation?.currency ?? null,
      payPeriod: input.payPeriod,
      nationalId: input.nationalId ?? null,
      bankAccount: input.bankAccount ?? null,
      costRateAmount: costRate?.amount ?? null,
      costRateCurrency: costRate?.currency ?? null,
      billableRateAmount: billableRate?.amount ?? null,
      billableRateCurrency: billableRate?.currency ?? null,
      weeklyHours: input.weeklyHours,
      notes: input.notes ?? null,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'employee.created',
      resourceType: 'employee',
      resourceId: id,
      // The redaction list in lib/audit.ts strips compensation and ids anyway;
      // not passing them is the belt to that braces.
      after: { firstName: input.firstName, lastName: input.lastName, jobTitle: input.jobTitle },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getEmployee(ctx, id);
}

export async function updateEmployee(
  ctx: RequestContext,
  id: string,
  input: UpdateEmployeeInput,
): Promise<Employee> {
  assertMaySetSensitive(ctx, input);
  const before = await getEmployeeRow(ctx, id);
  await assertActiveMember(ctx, input.userId);

  if (input.managerId) {
    if (input.managerId === id) throw conflict('An employee cannot manage themselves');
    await getEmployeeRow(ctx, input.managerId);
  }

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'firstName',
    'lastName',
    'userId',
    'email',
    'phone',
    'jobTitle',
    'department',
    'managerId',
    'employmentType',
    'status',
    'hiredAt',
    'terminatedAt',
    'payPeriod',
    'weeklyHours',
    'nationalId',
    'bankAccount',
    'notes',
    'tags',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  for (const [key, prefix] of [
    ['compensation', 'compensation'],
    ['costRate', 'costRate'],
    ['billableRate', 'billableRate'],
  ] as const) {
    const value = input[key];
    if (value === undefined) continue;
    const money = value ? fromMoneyInput(value) : null;
    patch[`${prefix}Amount`] = money?.amount ?? null;
    patch[`${prefix}Currency`] = money?.currency ?? null;
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set(patch)
      .where(scopeById(employees, ctx.auth.organizationId, id));
    const changes = diffSnapshot(before as unknown as Record<string, unknown>, patch);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'employee.updated',
      resourceType: 'employee',
      resourceId: id,
      before: changes.before,
      after: changes.after,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getEmployee(ctx, id);
}

export async function deleteEmployee(ctx: RequestContext, id: string): Promise<void> {
  const employee = await getEmployeeRow(ctx, id);

  const [reports] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(employees)
    .where(scope(employees, ctx.auth.organizationId, eq(employees.managerId, id)));

  if ((reports?.total ?? 0) > 0) {
    throw conflict('Reassign this person’s direct reports first', { reports: reports?.total });
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({ deletedAt: ctx.now, updatedAt: ctx.now })
      .where(scopeById(employees, ctx.auth.organizationId, id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'employee.deleted',
      resourceType: 'employee',
      resourceId: id,
      before: { firstName: employee.firstName, lastName: employee.lastName },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });
}
