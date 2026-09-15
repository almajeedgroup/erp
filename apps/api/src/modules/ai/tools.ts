import {
  type AiToolName,
  type Permission,
  AI_WRITE_TOOLS,
  forbidden,
  toIsoDate,
} from '@almajeed/shared';
import type { RequestContext } from '../../context.js';
import { listClients } from '../clients/service.js';
import { listInvoices } from '../finance/service.js';
import {
  overview,
  projectProfitability,
  receivablesAging,
  resolveRange,
} from '../analytics/metrics.js';
import { listProjects } from '../projects/service.js';
import { listTasks } from '../tasks/service.js';
import { searchChunks } from './retrieval.js';
import type { AiToolDefinition } from './provider.js';

/**
 * The agent's tools.
 *
 * The rule that makes this safe: **a tool is a caller of the same service
 * functions an HTTP request uses, with the same `RequestContext`.** It gets
 * the same organization scope and the same permission checks. There is no
 * privileged path, no service-role key, and no way for the model to reach data
 * the person it is acting for could not fetch themselves through the API.
 *
 * Two further controls:
 *
 *  - Tools the caller lacks permission for are **not offered** to the model at
 *    all. A model cannot be tempted by a capability it never sees, and the
 *    permission is re-checked at dispatch anyway in case the offer list and
 *    the executor ever disagree.
 *  - Write tools do not write. They return a structured *proposal*; the user
 *    confirms it through the ordinary endpoint. A model that has been talked
 *    into issuing an invoice still cannot issue one.
 */

export interface ToolSpec {
  name: AiToolName;
  description: string;
  permission: Permission;
  inputSchema: Record<string, unknown>;
  execute: (ctx: RequestContext, input: Record<string, unknown>) => Promise<unknown>;
}

const limitProperty = {
  type: 'integer',
  minimum: 1,
  maximum: 20,
  description: 'Maximum rows to return (default 5).',
} as const;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asLimit = (value: unknown, fallback = 5): number => {
  const parsed = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 20) : fallback;
};

export const TOOLS: ToolSpec[] = [
  {
    name: 'search_clients',
    description:
      'Find clients by name, status or free text. Returns name, status, billing currency ' +
      'and payment terms.',
    permission: 'client:read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against name and email.' },
        status: {
          type: 'string',
          enum: ['lead', 'prospect', 'active', 'dormant', 'churned'],
        },
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) => {
      const page = await listClients(ctx, {
        limit: asLimit(input.limit),
        q: asString(input.query),
        status: asString(input.status) as never,
      });
      return page.items.map((client) => ({
        id: client.id,
        name: client.name,
        status: client.status,
        billingCurrency: client.billingCurrency,
        paymentTermsDays: client.paymentTermsDays,
      }));
    },
  },

  {
    name: 'search_projects',
    description: 'Find projects by name, status, health or client. Returns budget and dates.',
    permission: 'project:read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'active', 'on_hold', 'completed', 'cancelled'],
        },
        health: { type: 'string', enum: ['on_track', 'at_risk', 'off_track'] },
        clientId: { type: 'string' },
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) => {
      const page = await listProjects(ctx, {
        limit: asLimit(input.limit),
        q: asString(input.query),
        status: asString(input.status),
        health: asString(input.health),
        clientId: asString(input.clientId),
      });
      return page.items.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        health: project.health,
        clientName: project.clientName,
        budget: project.budget,
        endDate: project.endDate,
      }));
    },
  },

  {
    name: 'search_tasks',
    description:
      'Find tasks by status, priority, assignee or due date. Use `openOnly` to exclude ' +
      'done and cancelled work.',
    permission: 'task:read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled'],
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        projectId: { type: 'string' },
        dueBefore: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
        openOnly: { type: 'boolean' },
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) => {
      const page = await listTasks(ctx, {
        limit: asLimit(input.limit),
        q: asString(input.query),
        status: asString(input.status),
        priority: asString(input.priority),
        projectId: asString(input.projectId),
        dueBefore: asString(input.dueBefore),
        openOnly: input.openOnly === true,
      });
      return page.items.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        overdue: task.overdue,
        projectName: task.projectName,
        assigneeName: task.assigneeName,
      }));
    },
  },

  {
    name: 'search_invoices',
    description:
      'Find invoices by status, client or date, including which are overdue and by how much.',
    permission: 'invoice:read',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'issued', 'partially_paid', 'paid', 'void', 'cancelled'],
        },
        clientId: { type: 'string' },
        overdueOnly: { type: 'boolean' },
        from: { type: 'string', description: 'ISO date, inclusive.' },
        to: { type: 'string', description: 'ISO date, inclusive.' },
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) => {
      const page = await listInvoices(ctx, {
        limit: asLimit(input.limit),
        status: asString(input.status),
        clientId: asString(input.clientId),
        overdueOnly: input.overdueOnly === true,
        from: asString(input.from),
        to: asString(input.to),
      });
      return page.items.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        clientName: invoice.clientName,
        total: invoice.total,
        balanceDue: invoice.balanceDue,
        dueDate: invoice.dueDate,
        overdue: invoice.overdue,
        daysOverdue: invoice.daysOverdue,
      }));
    },
  },

  {
    name: 'search_documents',
    description:
      'Semantic search over documents the organization has opted into AI retrieval. ' +
      'Returns excerpts with their document id so answers can be cited.',
    permission: 'document:read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: limitProperty,
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (ctx, input) => {
      const query = asString(input.query);
      if (!query) return [];
      return searchChunks(ctx, query, { limit: asLimit(input.limit), minScore: 0.05 });
    },
  },

  {
    name: 'get_analytics_overview',
    description:
      'Headline numbers: revenue, expenses, gross margin, receivables, utilisation and ' +
      'open work, for a date range.',
    permission: 'analytics:read',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO date, inclusive.' },
        to: { type: 'string', description: 'ISO date, inclusive.' },
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) =>
      overview(
        ctx,
        await resolveRange(ctx, { from: asString(input.from), to: asString(input.to) }),
      ),
  },

  {
    name: 'get_project_profitability',
    description: 'Margin per project: billed revenue minus labour cost and direct expenses.',
    permission: 'analytics:read',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (ctx, input) =>
      projectProfitability(
        ctx,
        await resolveRange(ctx, { from: asString(input.from), to: asString(input.to) }),
      ),
  },

  {
    name: 'get_receivables_aging',
    description: 'Outstanding receivables bucketed by how overdue they are.',
    permission: 'analytics:read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (ctx) => receivablesAging(ctx, await resolveRange(ctx, {})),
  },

  /* ----------------------------------------------------------- write tools -- */

  {
    name: 'create_task',
    description:
      'Propose a new task. This does NOT create anything: it returns a proposal the user ' +
      'must confirm.',
    permission: 'task:create',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        projectId: { type: 'string' },
        assigneeId: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        dueDate: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    execute: async (ctx, input) => ({
      proposal: 'create_task',
      confirmWith: 'POST /api/v1/tasks',
      payload: {
        title: asString(input.title),
        description: asString(input.description),
        projectId: asString(input.projectId),
        assigneeId: asString(input.assigneeId),
        priority: asString(input.priority) ?? 'medium',
        dueDate: asString(input.dueDate),
      },
      note: `Nothing has been created. Today is ${toIsoDate(ctx.now)}.`,
    }),
  },

  {
    name: 'draft_invoice',
    description:
      'Propose a draft invoice for a client. This does NOT create anything: it returns a ' +
      'proposal the user must confirm.',
    permission: 'invoice:create',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        currency: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPriceMinorUnits: {
                type: 'string',
                description: 'Integer minor units, e.g. "150000" for 1,500.00.',
              },
              taxRate: { type: 'number', description: 'Percent, e.g. 15.' },
            },
            required: ['description', 'quantity', 'unitPriceMinorUnits'],
            additionalProperties: false,
          },
        },
      },
      required: ['clientId', 'lines'],
      additionalProperties: false,
    },
    execute: async (_ctx, input) => ({
      proposal: 'draft_invoice',
      confirmWith: 'POST /api/v1/invoices',
      payload: input,
      note: 'Nothing has been created. Totals will be recomputed server-side on submission.',
    }),
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function isWriteTool(name: AiToolName): boolean {
  return AI_WRITE_TOOLS.includes(name);
}

/**
 * The tools this caller may actually use.
 *
 * `allowWrites` is the user's per-request choice; the permission check is the
 * system's. Both must pass.
 */
export function availableTools(ctx: RequestContext, allowWrites: boolean): ToolSpec[] {
  return TOOLS.filter((tool) => {
    if (!ctx.auth.permissions.has(tool.permission)) return false;
    if (isWriteTool(tool.name) && !allowWrites) return false;
    return true;
  });
}

export function toDefinitions(tools: ToolSpec[]): AiToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Run one tool call.
 *
 * The permission is re-checked here even though `availableTools` already
 * filtered the offer list: defence in depth costs one set lookup, and the two
 * paths could drift.
 */
export async function dispatchTool(
  ctx: RequestContext,
  name: string,
  input: Record<string, unknown>,
  allowWrites: boolean,
): Promise<unknown> {
  const tool = BY_NAME.get(name as AiToolName);
  if (!tool) throw forbidden(`Unknown tool: ${name}`);
  if (!ctx.auth.permissions.has(tool.permission)) {
    throw forbidden(`This action requires the "${tool.permission}" permission`);
  }
  if (isWriteTool(tool.name) && !allowWrites) {
    throw forbidden('Write tools are disabled for this conversation');
  }
  return tool.execute(ctx, input);
}
