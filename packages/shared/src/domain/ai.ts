import { z } from 'zod';
import { id, mediumText, paginationQuerySchema, shortText } from './common.js';

/**
 * The AI agent contract.
 *
 * Three rules shape everything in this file and its implementation:
 *
 *  1. The agent is a *caller of the API*, not a second path into the database.
 *     Every tool it invokes runs through the same service functions, with the
 *     same organization scope and the same RBAC check as an HTTP request from
 *     the user it is acting for. It can never see more than they can.
 *  2. Retrieved document text is **data, never instruction**. It is delivered
 *     inside a clearly fenced block with an explicit statement that its content
 *     must not be followed as a command. See docs/05-ai/prompt-engineering.md.
 *  3. Writes require confirmation. Tools are tagged read or write; a write tool
 *     returns a proposal the user has to approve before it executes.
 */

export const AI_TOOL_NAMES = [
  'search_clients',
  'search_projects',
  'search_tasks',
  'search_invoices',
  'search_documents',
  'get_analytics_overview',
  'get_project_profitability',
  'get_receivables_aging',
  'create_task',
  'draft_invoice',
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Tools that change state. These always require explicit confirmation. */
export const AI_WRITE_TOOLS: readonly AiToolName[] = ['create_task', 'draft_invoice'];

export const chatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000),
});

export const chatRequestSchema = z.strictObject({
  conversationId: id('conversation').optional(),
  message: z.string().trim().min(1).max(8_000),
  /** Opt in to retrieval over documents flagged `indexForAi`. */
  useRetrieval: z.boolean().default(true),
  /** Allow the agent to propose (never execute) state changes. */
  allowWrites: z.boolean().default(false),
});

export const toolCallSchema = z.object({
  name: z.enum(AI_TOOL_NAMES),
  input: z.record(z.string(), z.unknown()),
  /** Present for write tools: the user must approve before anything happens. */
  requiresConfirmation: z.boolean(),
});

export const citationSchema = z.object({
  documentId: id('document'),
  title: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  score: z.number(),
  excerpt: z.string(),
});

export const chatResponseSchema = z.object({
  conversationId: id('conversation'),
  messageId: id('message'),
  content: z.string(),
  citations: z.array(citationSchema),
  toolCalls: z.array(toolCallSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    steps: z.number().int().nonnegative(),
  }),
  /** `true` when the model stopped because it hit the step ceiling. */
  truncated: z.boolean(),
});

export const searchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(20).default(5),
  minScore: z.number().min(0).max(1).default(0.15),
});

export const searchResponseSchema = z.object({
  results: z.array(citationSchema),
});

export const createConversationSchema = z.strictObject({
  title: shortText.optional(),
});

export const listConversationsQuerySchema = paginationQuerySchema;

export const feedbackSchema = z.strictObject({
  messageId: id('message'),
  rating: z.enum(['up', 'down']),
  comment: mediumText.optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
