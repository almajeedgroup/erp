import {
  type CurrencyCode,
  type Granularity,
  type Overview,
  type ProjectProfitability,
  type ReceivablesAging,
  add,
  defaultReportingRange,
  money,
  periodKey,
  periodRange,
  startOfWeek,
  subtract,
  toIsoDate,
  toDTO,
  zero,
} from '@almajeed/shared';
import {
  clients,
  employees,
  expenses,
  invoices,
  organizations,
  projects,
  scope,
  tasks,
  timeEntries,
} from '@almajeed/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { valueOfMinutes } from '../finance/totals.js';
import { receivablesAging as agingRows } from '../finance/service.js';

/**
 * Metrics.
 *
 * Every number the product reports is defined exactly once, here, with the
 * formula written next to it. Two dashboards disagreeing about "revenue" is
 * the classic ERP failure, and the cure is not better dashboards — it is one
 * definition, in one file, that everything else calls.
 *
 * Definitions used throughout:
 *
 *   revenue    Sum of issued (non-void, non-draft) invoice totals whose issue
 *              date falls in the period. Accrual, not cash: the money is
 *              earned when the invoice is issued, not when it is collected.
 *   expenses   Sum of *approved* expenses incurred in the period. Submitted
 *              but unapproved claims are not yet a cost of doing business.
 *   AR         Issued invoice totals minus payments received, for all time —
 *              a balance, not a flow, so the period does not apply.
 *   labor cost Logged minutes valued at each employee's cost rate.
 *
 * All of it is single-currency: amounts in another currency are excluded
 * rather than converted at a guessed rate. Multi-currency consolidation needs
 * a rate table with dated rows, which is written up as a follow-up in
 * docs/08-modules/analytics.md.
 */

export interface RangeInput {
  from?: string;
  to?: string;
  currency?: string;
}

export interface ResolvedRange {
  from: string;
  to: string;
  currency: CurrencyCode;
}

/** Fill in the organization's base currency and a rolling 12-month window. */
export async function resolveRange(ctx: RequestContext, input: RangeInput): Promise<ResolvedRange> {
  const fallback = defaultReportingRange(ctx.now);

  let currency = input.currency as CurrencyCode | undefined;
  if (!currency) {
    const [organization] = await ctx.db
      .select({ baseCurrency: organizations.baseCurrency })
      .from(organizations)
      .where(eq(organizations.id, ctx.auth.organizationId))
      .limit(1);
    currency = (organization?.baseCurrency ?? 'SAR') as CurrencyCode;
  }

  return {
    from: input.from ?? fallback.from,
    to: input.to ?? fallback.to,
    currency,
  };
}

export async function overview(ctx: RequestContext, range: ResolvedRange): Promise<Overview> {
  const { from, to, currency } = range;

  const [revenueRow] = await ctx.db
    .select({ total: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::bigint` })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid', 'paid')`,
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    );

  const [expenseRow] = await ctx.db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountAmount}), 0)::bigint` })
    .from(expenses)
    .where(
      scope(
        expenses,
        ctx.auth.organizationId,
        eq(expenses.amountCurrency, currency),
        sql`${expenses.status} in ('approved', 'paid')`,
        gte(expenses.incurredAt, from),
        lte(expenses.incurredAt, to),
      ),
    );

  const [receivableRow] = await ctx.db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalAmount} - ${invoices.paidAmount}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid')`,
      ),
    );

  const [overdueRow] = await ctx.db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalAmount} - ${invoices.paidAmount}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid')`,
        sql`${invoices.dueDate} < ${toIsoDate(ctx.now)}`,
      ),
    );

  const [counts] = await ctx.db
    .select({
      activeClients: sql<number>`(
        select count(*)::int from ${clients}
        where ${clients.organizationId} = ${ctx.auth.organizationId}
          and ${clients.deletedAt} is null
          and ${clients.status} = 'active'
      )`,
      activeProjects: sql<number>`(
        select count(*)::int from ${projects}
        where ${projects.organizationId} = ${ctx.auth.organizationId}
          and ${projects.deletedAt} is null
          and ${projects.status} = 'active'
      )`,
      activeEmployees: sql<number>`(
        select count(*)::int from ${employees}
        where ${employees.organizationId} = ${ctx.auth.organizationId}
          and ${employees.deletedAt} is null
          and ${employees.status} = 'active'
      )`,
      openTasks: sql<number>`(
        select count(*)::int from ${tasks}
        where ${tasks.organizationId} = ${ctx.auth.organizationId}
          and ${tasks.deletedAt} is null
          and ${tasks.status} not in ('done', 'cancelled')
      )`,
      overdueTasks: sql<number>`(
        select count(*)::int from ${tasks}
        where ${tasks.organizationId} = ${ctx.auth.organizationId}
          and ${tasks.deletedAt} is null
          and ${tasks.status} not in ('done', 'cancelled')
          and ${tasks.dueDate} < ${toIsoDate(ctx.now)}
      )`,
    })
    .from(organizations)
    .where(eq(organizations.id, ctx.auth.organizationId));

  const [hours] = await ctx.db
    .select({
      billable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)::int`,
      nonBillable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then 0 else ${timeEntries.minutes} end), 0)::int`,
    })
    .from(timeEntries)
    .where(
      scope(
        timeEntries,
        ctx.auth.organizationId,
        gte(timeEntries.date, from),
        lte(timeEntries.date, to),
      ),
    );

  const revenue = money(Number(revenueRow?.total ?? 0), currency);
  const expenseTotal = money(Number(expenseRow?.total ?? 0), currency);
  const grossProfit = subtract(revenue, expenseTotal);

  const billableMinutes = hours?.billable ?? 0;
  const nonBillableMinutes = hours?.nonBillable ?? 0;
  const totalMinutes = billableMinutes + nonBillableMinutes;

  return {
    currency,
    revenue: toDTO(revenue),
    expenses: toDTO(expenseTotal),
    grossProfit: toDTO(grossProfit),
    grossMarginPercent: percent(grossProfit.amount, revenue.amount),
    accountsReceivable: toDTO(money(Number(receivableRow?.outstanding ?? 0), currency)),
    overdueReceivable: toDTO(money(Math.max(Number(overdueRow?.outstanding ?? 0), 0), currency)),
    activeClients: counts?.activeClients ?? 0,
    activeProjects: counts?.activeProjects ?? 0,
    activeEmployees: counts?.activeEmployees ?? 0,
    openTasks: counts?.openTasks ?? 0,
    overdueTasks: counts?.overdueTasks ?? 0,
    billableHours: round2(billableMinutes / 60),
    nonBillableHours: round2(nonBillableMinutes / 60),
    utilizationPercent: percent(billableMinutes, totalMinutes),
  };
}

/**
 * Revenue and expenses bucketed over time.
 *
 * Every bucket in the range is emitted, including empty ones, so a chart shows
 * a gap as a gap rather than silently joining two distant points.
 */
export async function revenueSeries(
  ctx: RequestContext,
  range: ResolvedRange,
  granularity: Granularity,
) {
  const { from, to, currency } = range;

  const invoiceRows = await ctx.db
    .select({ issueDate: invoices.issueDate, total: invoices.totalAmount })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid', 'paid')`,
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    );

  const expenseRows = await ctx.db
    .select({ incurredAt: expenses.incurredAt, total: expenses.amountAmount })
    .from(expenses)
    .where(
      scope(
        expenses,
        ctx.auth.organizationId,
        eq(expenses.amountCurrency, currency),
        sql`${expenses.status} in ('approved', 'paid')`,
        gte(expenses.incurredAt, from),
        lte(expenses.incurredAt, to),
      ),
    );

  const revenueByPeriod = new Map<string, number>();
  for (const row of invoiceRows) {
    if (!row.issueDate) continue;
    const key = periodKey(row.issueDate, granularity);
    revenueByPeriod.set(key, (revenueByPeriod.get(key) ?? 0) + Number(row.total));
  }

  const expensesByPeriod = new Map<string, number>();
  for (const row of expenseRows) {
    const key = periodKey(row.incurredAt, granularity);
    expensesByPeriod.set(key, (expensesByPeriod.get(key) ?? 0) + Number(row.total));
  }

  return {
    currency,
    granularity,
    points: periodRange(from, to, granularity).map((period) => {
      const revenue = money(revenueByPeriod.get(period) ?? 0, currency);
      const expenseTotal = money(expensesByPeriod.get(period) ?? 0, currency);
      return {
        period,
        revenue: toDTO(revenue),
        expenses: toDTO(expenseTotal),
        net: toDTO(subtract(revenue, expenseTotal)),
      };
    }),
  };
}

/**
 * Per-project profitability.
 *
 * margin = billed revenue - labour cost - direct expenses
 *
 * Labour is valued at each employee's **cost rate**, not their billable rate:
 * the question is what the work cost the company, not what it was sold for.
 * Time logged by someone with no cost rate on file contributes zero cost and
 * is therefore visible as suspiciously high margin — which is the honest
 * outcome, and better than silently inventing a rate.
 */
export async function projectProfitability(
  ctx: RequestContext,
  range: ResolvedRange,
): Promise<ProjectProfitability> {
  const { from, to, currency } = range;

  const projectRows = await ctx.db
    .select({
      projectId: projects.id,
      name: projects.name,
      clientName: clients.name,
    })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(scope(projects, ctx.auth.organizationId));

  const revenueRows = await ctx.db
    .select({
      projectId: invoices.projectId,
      total: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid', 'paid')`,
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    )
    .groupBy(invoices.projectId);

  const expenseRows = await ctx.db
    .select({
      projectId: expenses.projectId,
      total: sql<number>`coalesce(sum(${expenses.amountAmount}), 0)::bigint`,
    })
    .from(expenses)
    .where(
      scope(
        expenses,
        ctx.auth.organizationId,
        eq(expenses.amountCurrency, currency),
        sql`${expenses.status} in ('approved', 'paid')`,
        gte(expenses.incurredAt, from),
        lte(expenses.incurredAt, to),
      ),
    )
    .groupBy(expenses.projectId);

  const laborRows = await ctx.db
    .select({
      projectId: timeEntries.projectId,
      minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
      costRateAmount: employees.costRateAmount,
      costRateCurrency: employees.costRateCurrency,
    })
    .from(timeEntries)
    .leftJoin(employees, eq(employees.id, timeEntries.employeeId))
    .where(
      scope(
        timeEntries,
        ctx.auth.organizationId,
        gte(timeEntries.date, from),
        lte(timeEntries.date, to),
      ),
    )
    .groupBy(timeEntries.projectId, employees.costRateAmount, employees.costRateCurrency);

  const revenueByProject = new Map(
    revenueRows
      .filter((row) => row.projectId)
      .map((row) => [row.projectId as string, Number(row.total)]),
  );
  const expensesByProject = new Map(
    expenseRows
      .filter((row) => row.projectId)
      .map((row) => [row.projectId as string, Number(row.total)]),
  );

  const laborByProject = new Map<string, { cost: number; minutes: number }>();
  for (const row of laborRows) {
    const bucket = laborByProject.get(row.projectId) ?? { cost: 0, minutes: 0 };
    bucket.minutes += row.minutes;
    if (row.costRateAmount !== null && row.costRateCurrency === currency) {
      bucket.cost += valueOfMinutes(row.minutes, money(row.costRateAmount, currency)).amount;
    }
    laborByProject.set(row.projectId, bucket);
  }

  const rows = projectRows
    .map((project) => {
      const revenue = money(revenueByProject.get(project.projectId) ?? 0, currency);
      const labor = money(laborByProject.get(project.projectId)?.cost ?? 0, currency);
      const direct = money(expensesByProject.get(project.projectId) ?? 0, currency);
      const margin = subtract(revenue, add(labor, direct));

      return {
        projectId: project.projectId,
        name: project.name,
        clientName: project.clientName,
        billedRevenue: toDTO(revenue),
        laborCost: toDTO(labor),
        directExpenses: toDTO(direct),
        margin: toDTO(margin),
        marginPercent: percent(margin.amount, revenue.amount),
        hours: round2((laborByProject.get(project.projectId)?.minutes ?? 0) / 60),
      };
    })
    // A project with no activity in the window is noise on this report.
    .filter(
      (row) => row.billedRevenue.amount !== '0' || row.laborCost.amount !== '0' || row.hours > 0,
    )
    .sort((a, b) => Number(b.margin.amount) - Number(a.margin.amount));

  return { currency, rows };
}

export async function receivablesAging(
  ctx: RequestContext,
  range: ResolvedRange,
): Promise<ReceivablesAging> {
  const { rows, total } = await agingRows(ctx, range.currency);
  return {
    currency: range.currency,
    buckets: rows.map((row) => ({
      label: row.label,
      amount: toDTO(money(row.amount, range.currency)),
      invoiceCount: row.invoiceCount,
    })),
    total: toDTO(money(total, range.currency)),
  };
}

/**
 * Thirteen-week direct-method cash forecast.
 *
 * Inflow is open receivables placed in the week they fall due; outflow is
 * approved-but-unpaid expenses placed in the week they were incurred. It is a
 * deliberately simple model — no payment-behaviour weighting, no recurring
 * commitments — and it is documented as such so nobody mistakes it for a
 * treasury system.
 */
export async function cashFlowForecast(ctx: RequestContext, range: ResolvedRange, weeks = 13) {
  const { currency } = range;
  const start = startOfWeek(toIsoDate(ctx.now));

  const openInvoices = await ctx.db
    .select({
      dueDate: invoices.dueDate,
      outstanding: sql<number>`(${invoices.totalAmount} - ${invoices.paidAmount})`,
    })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.currency, currency),
        sql`${invoices.status} in ('issued', 'partially_paid')`,
      ),
    );

  const committedExpenses = await ctx.db
    .select({ incurredAt: expenses.incurredAt, amount: expenses.amountAmount })
    .from(expenses)
    .where(
      scope(
        expenses,
        ctx.auth.organizationId,
        eq(expenses.amountCurrency, currency),
        eq(expenses.status, 'approved'),
      ),
    );

  const buckets = periodRange(start, addWeeks(start, weeks - 1), 'week').map((weekStart) => ({
    weekStart,
    inflow: 0,
    outflow: 0,
  }));

  const indexFor = (date: string | null): number => {
    if (!date) return 0;
    const week = startOfWeek(date);
    const found = buckets.findIndex((bucket) => bucket.weekStart === week);
    // Anything already past, or beyond the horizon, lands in the first bucket:
    // overdue money is due now, not at some point in the past.
    return found === -1 ? 0 : found;
  };

  for (const invoice of openInvoices) {
    const outstanding = Number(invoice.outstanding);
    if (outstanding <= 0) continue;
    const bucket = buckets[indexFor(invoice.dueDate)];
    if (bucket) bucket.inflow += outstanding;
  }

  for (const expense of committedExpenses) {
    const bucket = buckets[indexFor(expense.incurredAt)];
    if (bucket) bucket.outflow += Number(expense.amount);
  }

  let balance = zero(currency);
  return {
    currency,
    openingBalance: toDTO(balance),
    weeks: buckets.map((bucket) => {
      balance = money(balance.amount + bucket.inflow - bucket.outflow, currency);
      return {
        weekStart: bucket.weekStart,
        expectedInflow: toDTO(money(bucket.inflow, currency)),
        expectedOutflow: toDTO(money(bucket.outflow, currency)),
        closingBalance: toDTO(balance),
      };
    }),
  };
}

export async function pipeline(ctx: RequestContext) {
  const byStatus = await ctx.db
    .select({ status: clients.status, total: sql<number>`count(*)::int` })
    .from(clients)
    .where(scope(clients, ctx.auth.organizationId))
    .groupBy(clients.status);

  const byChannel = await ctx.db
    .select({ channel: clients.acquisitionChannel, total: sql<number>`count(*)::int` })
    .from(clients)
    .where(scope(clients, ctx.auth.organizationId))
    .groupBy(clients.acquisitionChannel);

  return {
    byStatus: byStatus.map((row) => ({ status: row.status, clients: row.total })),
    byChannel: byChannel.map((row) => ({ channel: row.channel, clients: row.total })),
  };
}

/* ---------------------------------------------------------------- utils -- */

/** Percentage, to one decimal place. `null` when the denominator is zero. */
function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addWeeks(date: string, weeks: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}

export { and };
