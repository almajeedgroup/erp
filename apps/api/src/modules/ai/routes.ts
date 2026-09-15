import {
  chatRequestSchema,
  chatResponseSchema,
  citationSchema,
  createConversationSchema,
  errorBodySchema,
  feedbackSchema,
  id,
  listConversationsQuerySchema,
  okSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  chat,
  createConversation,
  listConversations,
  listMessages,
  recordFeedback,
} from './agent.js';
import { searchChunks } from './retrieval.js';
import { TOOLS, availableTools } from './tools.js';

const conversationParams = z.object({ conversationId: id('conversation') });

const conversationSchema = z.object({
  id: id('conversation'),
  title: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const messageSchema = z.object({
  id: id('message'),
  role: z.string(),
  content: z.string(),
  citations: z.unknown().nullable(),
  toolCalls: z.unknown().nullable(),
  createdAt: z.string(),
});

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  permission: z.string(),
  write: z.boolean(),
  available: z.boolean(),
});

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * The agent costs money per call, so it carries a much tighter budget than
   * ordinary reads. This is a spend control as much as an abuse control.
   */
  const chatLimit = { rateLimit: { max: 30, timeWindow: 60_000 } };

  app.post(
    '/chat',
    {
      preHandler: app.requirePermission('ai:chat'),
      config: chatLimit,
      schema: {
        tags: ['ai'],
        summary: 'Ask the agent',
        description:
          'Runs a bounded tool-calling loop. The agent sees only tools the caller has ' +
          'permission for, and every tool runs through the same services and the same ' +
          'organization scope as an ordinary request — it cannot reach data you could not ' +
          'fetch yourself. Write tools return a proposal to confirm; they never write. ' +
          'Retrieved document text is delivered as fenced data and is never treated as ' +
          'instruction. `truncated: true` means the step ceiling was reached.',
        body: chatRequestSchema,
        response: { 200: chatResponseSchema, 403: errorBodySchema, 429: errorBodySchema },
      },
    },
    async (request) => chat(request.ctx(), request.body),
  );

  app.post(
    '/search',
    {
      preHandler: app.requirePermission('document:read'),
      schema: {
        tags: ['ai'],
        summary: 'Semantic search over indexed documents',
        description:
          'Only documents flagged `indexForAi` and not marked confidential are searchable, ' +
          'and only within the caller’s organization.',
        body: searchRequestSchema,
        response: { 200: searchResponseSchema, 403: errorBodySchema },
      },
    },
    async (request) => {
      const results = await searchChunks(request.ctx(), request.body.query, {
        limit: request.body.limit,
        minScore: request.body.minScore,
      });
      return { results };
    },
  );

  app.get(
    '/conversations',
    {
      preHandler: app.requirePermission('ai:chat'),
      schema: {
        tags: ['ai'],
        summary: 'List your conversations',
        description: 'Conversations are private to the person who started them.',
        querystring: listConversationsQuerySchema,
        response: { 200: z.array(conversationSchema), 403: errorBodySchema },
      },
    },
    async (request) => listConversations(request.ctx(), request.query.limit),
  );

  app.post(
    '/conversations',
    {
      preHandler: app.requirePermission('ai:chat'),
      schema: {
        tags: ['ai'],
        summary: 'Start a conversation',
        body: createConversationSchema,
        response: { 201: z.object({ conversationId: id('conversation') }), 403: errorBodySchema },
      },
    },
    async (request, reply) => {
      const conversationId = await createConversation(request.ctx(), request.body.title);
      return reply.status(201).send({ conversationId });
    },
  );

  app.get(
    '/conversations/:conversationId/messages',
    {
      preHandler: app.requirePermission('ai:chat'),
      schema: {
        tags: ['ai'],
        summary: 'Read a conversation',
        params: conversationParams,
        response: {
          200: z.array(messageSchema),
          403: errorBodySchema,
          404: errorBodySchema,
        },
      },
    },
    async (request) => listMessages(request.ctx(), request.params.conversationId),
  );

  app.post(
    '/feedback',
    {
      preHandler: app.requirePermission('ai:chat'),
      schema: {
        tags: ['ai'],
        summary: 'Rate an answer',
        description:
          'The raw signal for offline evaluation — see docs/05-ai/evaluation.md for how ' +
          'these are used to build a regression set.',
        body: feedbackSchema,
        response: { 200: okSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      await recordFeedback(
        request.ctx(),
        request.body.messageId,
        request.body.rating,
        request.body.comment,
      );
      return { ok: true as const };
    },
  );

  app.get(
    '/tools',
    {
      preHandler: app.requirePermission('ai:chat'),
      schema: {
        tags: ['ai'],
        summary: 'What the agent can do for you',
        description:
          'Every tool, with the permission it needs and whether your role currently grants ' +
          'it. Useful for explaining to a user why the agent declined something.',
        response: { 200: z.array(toolSchema), 403: errorBodySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx();
      const granted = new Set(availableTools(ctx, true).map((tool) => tool.name));
      return TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        permission: tool.permission,
        write: tool.name === 'create_task' || tool.name === 'draft_invoice',
        available: granted.has(tool.name),
      }));
    },
  );

  // Referenced so the citation schema is emitted into the OpenAPI components
  // even though it only appears nested inside chat and search responses.
  void citationSchema;
};
