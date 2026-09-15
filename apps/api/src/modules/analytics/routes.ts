import {
  analyticsRangeSchema,
  cashFlowForecastSchema,
  errorBodySchema,
  overviewSchema,
  pipelineSchema,
  projectProfitabilitySchema,
  receivablesAgingSchema,
  revenueSeriesSchema,
  timeSeriesQuerySchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  cashFlowForecast,
  overview,
  pipeline,
  projectProfitability,
  receivablesAging,
  resolveRange,
  revenueSeries,
} from './metrics.js';

/**
 * Analytics.
 *
 * Read-only, and every endpoint resolves its window and currency through
 * `resolveRange` so "no parameters" means the same thing everywhere: the
 * organization's base currency over a rolling twelve months.
 */
export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/overview',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Headline metrics',
        description:
          'Revenue is accrual (issued invoices in the period), expenses are approved only, ' +
          'and receivables are a balance rather than a flow. Amounts in a currency other ' +
          'than the reporting one are excluded rather than converted at a guessed rate.',
        querystring: analyticsRangeSchema,
        response: { 200: overviewSchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      return overview(ctx, await resolveRange(ctx, request.query));
    },
  );

  app.get(
    '/revenue',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Revenue and expenses over time',
        description:
          'Emits every bucket in the range, including empty ones, so a chart shows a gap ' +
          'as a gap instead of joining two distant points.',
        querystring: timeSeriesQuerySchema,
        response: { 200: revenueSeriesSchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      const range = await resolveRange(ctx, request.query);
      return revenueSeries(ctx, range, request.query.granularity);
    },
  );

  app.get(
    '/project-profitability',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Per-project margin',
        description:
          'margin = billed revenue − labour cost − direct expenses. Labour is valued at ' +
          'each employee’s cost rate, not their billable rate: the question is what the ' +
          'work cost, not what it sold for.',
        querystring: analyticsRangeSchema,
        response: { 200: projectProfitabilitySchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      return projectProfitability(ctx, await resolveRange(ctx, request.query));
    },
  );

  app.get(
    '/receivables-aging',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Aged receivables',
        description:
          'Outstanding balances in the conventional current/1-30/31-60/61-90/90+ buckets.',
        querystring: analyticsRangeSchema,
        response: { 200: receivablesAgingSchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      return receivablesAging(ctx, await resolveRange(ctx, request.query));
    },
  );

  app.get(
    '/cash-flow',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Thirteen-week cash forecast',
        description:
          'A deliberately simple direct-method projection: open receivables in the week ' +
          'they fall due, approved expenses in the week incurred. No payment-behaviour ' +
          'weighting and no recurring commitments — it is a forecast, not a treasury system.',
        querystring: analyticsRangeSchema,
        response: { 200: cashFlowForecastSchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      return cashFlowForecast(ctx, await resolveRange(ctx, request.query));
    },
  );

  app.get(
    '/pipeline',
    {
      preHandler: app.requirePermission('analytics:read'),
      schema: {
        tags: ['analytics'],
        summary: 'Client pipeline by status and acquisition channel',
        description: 'The denominator for customer-acquisition-cost analysis by channel.',
        response: { 200: pipelineSchema, 403: errorBodySchema },
      },
    },
    async (request) => pipeline(request.ctx()),
  );
};
