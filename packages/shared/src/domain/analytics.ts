import { z } from 'zod';
import { currencySchema, id, isoDate, moneySchema } from './common.js';

/**
 * Analytics contracts.
 *
 * Every metric returned here is defined once, in docs/08-modules/analytics.md,
 * and computed in one place (apps/api/src/modules/analytics/metrics.ts). Two
 * dashboards disagreeing about "revenue" is the classic ERP failure; the cure
 * is a single definition with the formula written next to the field.
 */

export const analyticsRangeSchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
  currency: currencySchema.optional(),
});

export const GRANULARITIES = ['day', 'week', 'month', 'quarter'] as const;
export const granularitySchema = z.enum(GRANULARITIES);

export const timeSeriesQuerySchema = analyticsRangeSchema.extend({
  granularity: granularitySchema.default('month'),
});

export const moneyPointSchema = z.object({
  period: z.string(),
  value: moneySchema,
});

/** Headline numbers for the dashboard tiles. */
export const overviewSchema = z.object({
  currency: currencySchema,
  /** Sum of issued, non-void invoice totals in the period. */
  revenue: moneySchema,
  /** Sum of approved expenses in the period. */
  expenses: moneySchema,
  /** revenue - expenses. */
  grossProfit: moneySchema,
  /** grossProfit / revenue, as a percentage. `null` when revenue is zero. */
  grossMarginPercent: z.number().nullable(),
  /** Issued invoice totals minus payments received, regardless of period. */
  accountsReceivable: moneySchema,
  /** The slice of receivables whose due date has passed. */
  overdueReceivable: moneySchema,
  activeClients: z.number().int().nonnegative(),
  activeProjects: z.number().int().nonnegative(),
  activeEmployees: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  billableHours: z.number().nonnegative(),
  nonBillableHours: z.number().nonnegative(),
  /** billableHours / (billableHours + nonBillableHours) as a percentage. */
  utilizationPercent: z.number().nullable(),
});

export const revenueSeriesSchema = z.object({
  currency: currencySchema,
  granularity: granularitySchema,
  points: z.array(
    z.object({
      period: z.string(),
      revenue: moneySchema,
      expenses: moneySchema,
      net: moneySchema,
    }),
  ),
});

/** Per-project economics: the answer to "is this work actually profitable?". */
export const projectProfitabilitySchema = z.object({
  currency: currencySchema,
  rows: z.array(
    z.object({
      projectId: id('project'),
      name: z.string(),
      clientName: z.string().nullable(),
      billedRevenue: moneySchema,
      /** Hours x each employee's cost rate. */
      laborCost: moneySchema,
      directExpenses: moneySchema,
      margin: moneySchema,
      marginPercent: z.number().nullable(),
      hours: z.number().nonnegative(),
    }),
  ),
});

/** Aged receivables in the conventional 0/30/60/90+ buckets. */
export const receivablesAgingSchema = z.object({
  currency: currencySchema,
  buckets: z.array(
    z.object({
      label: z.enum(['current', '1-30', '31-60', '61-90', '90+']),
      amount: moneySchema,
      invoiceCount: z.number().int().nonnegative(),
    }),
  ),
  total: moneySchema,
});

/** Simple direct-method forecast: expected collections minus committed spend. */
export const cashFlowForecastSchema = z.object({
  currency: currencySchema,
  openingBalance: moneySchema,
  weeks: z.array(
    z.object({
      weekStart: isoDate,
      expectedInflow: moneySchema,
      expectedOutflow: moneySchema,
      closingBalance: moneySchema,
    }),
  ),
});

export const pipelineSchema = z.object({
  byStatus: z.array(
    z.object({ status: z.string(), clients: z.number().int().nonnegative() }),
  ),
  byChannel: z.array(
    z.object({ channel: z.string(), clients: z.number().int().nonnegative() }),
  ),
});

export type Overview = z.infer<typeof overviewSchema>;
export type ProjectProfitability = z.infer<typeof projectProfitabilitySchema>;
export type ReceivablesAging = z.infer<typeof receivablesAgingSchema>;
