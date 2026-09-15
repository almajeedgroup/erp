import { createHash } from 'node:crypto';
import { dependencyFailed } from '@almajeed/shared';
import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../../config/env.js';

/**
 * The model boundary.
 *
 * Everything the agent needs from a model provider is behind this interface:
 * one completion call and one embedding call. Two consequences follow, and
 * both are the reason the abstraction exists:
 *
 *  1. **The test suite never calls a paid API.** `createMockProvider` returns
 *     deterministic, seeded output, so agent behaviour, tool dispatch and
 *     retrieval ranking are all covered by ordinary unit tests that run
 *     offline in CI.
 *  2. **Swapping providers is a config change.** Nothing above this file
 *     imports the Anthropic SDK.
 *
 * See docs/05-ai/llm-integration.md.
 */

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

export interface AiTextBlock {
  type: 'text';
  text: string;
}

export interface AiToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AiContentBlock = AiTextBlock | AiToolUseBlock;

export interface AiToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: AiContentBlock[] }
  | { role: 'user'; content: AiToolResult[] };

export interface AiCompletionRequest {
  system: string;
  messages: AiMessage[];
  tools: AiToolDefinition[];
  maxOutputTokens: number;
}

export interface AiCompletionResponse {
  content: AiContentBlock[];
  /** `tool_use` means the model wants a tool run before it can answer. */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  readonly model: string;
  complete: (request: AiCompletionRequest) => Promise<AiCompletionResponse>;
  /** Embeddings for retrieval. Returns one vector per input, all unit length. */
  embed: (texts: string[]) => Promise<number[][]>;
}

/* ------------------------------------------------------------------ mock -- */

/**
 * A deterministic stand-in for a model.
 *
 * Completions echo a summary of what was retrieved and which tools were
 * offered, which is enough to assert that the agent loop wired everything up
 * correctly. Embeddings are a seeded hash projection: not semantically
 * meaningful, but stable, unit-length, and similar for similar strings — which
 * makes ranking assertions possible without a network call.
 */
export function createMockProvider(dimensions: number): AiProvider {
  return {
    name: 'mock',
    model: 'mock-model',

    complete: async (request) => {
      const lastUser = [...request.messages]
        .reverse()
        .find((message) => message.role === 'user' && typeof message.content === 'string');
      const question = typeof lastUser?.content === 'string' ? lastUser.content : '';

      // If a tool is offered whose name appears in the question, ask for it —
      // this exercises the tool-dispatch path end to end without a model.
      const requested = request.tools.find((tool) =>
        question.toLowerCase().includes(tool.name.replaceAll('_', ' ')),
      );
      const alreadyRan = request.messages.some(
        (message) => Array.isArray(message.content) && message.content.some(isToolResult),
      );

      if (requested && !alreadyRan) {
        return {
          content: [
            {
              type: 'tool_use',
              id: `toolu_${createHash('sha256').update(question).digest('hex').slice(0, 16)}`,
              name: requested.name,
              input: {},
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: estimateTokens(question), outputTokens: 12 },
        };
      }

      const text = `[mock] ${question.trim() || 'No question supplied.'}`;
      return {
        content: [{ type: 'text', text }],
        stopReason: 'end_turn',
        usage: { inputTokens: estimateTokens(question), outputTokens: estimateTokens(text) },
      };
    },

    embed: async (texts) => texts.map((text) => hashEmbedding(text, dimensions)),
  };
}

/** Stable pseudo-embedding: hash the token set into a fixed-width unit vector. */
export function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    for (let byte = 0; byte < 8; byte += 1) {
      const index = ((digest[byte] ?? 0) * 256 + (digest[byte + 8] ?? 0)) % dimensions;
      // Sign taken from a third byte so unrelated tokens can cancel out.
      const sign = ((digest[byte + 16] ?? 0) & 1) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/* ------------------------------------------------------------- anthropic -- */

export function createAnthropicProvider(config: AppConfig): AiProvider {
  const client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 2 });

  return {
    name: 'anthropic',
    model: config.ai.model,

    complete: async (request) => {
      try {
        const response = await client.messages.create({
          model: config.ai.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          })),
          messages: request.messages.map(toAnthropicMessage),
        });

        return {
          content: response.content.flatMap(fromAnthropicBlock),
          stopReason: mapStopReason(response.stop_reason),
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      } catch (error) {
        throw dependencyFailed('anthropic', error);
      }
    },

    /**
     * Anthropic does not serve an embeddings endpoint, so retrieval uses the
     * same deterministic projection as the mock provider. Swapping in a real
     * embedding service means implementing this one method — the chunking,
     * storage and ranking around it do not change. ADR-0005 has the detail.
     */
    embed: async (texts) => texts.map((text) => hashEmbedding(text, config.ai.embeddingDimensions)),
  };
}

export function createAiProvider(config: AppConfig): AiProvider {
  return config.ai.provider === 'anthropic'
    ? createAnthropicProvider(config)
    : createMockProvider(config.ai.embeddingDimensions);
}

/* ----------------------------------------------------------------- utils -- */

function isToolResult(block: unknown): boolean {
  return typeof block === 'object' && block !== null && 'toolUseId' in block;
}

/** Rough token estimate for accounting when a provider does not report one. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toAnthropicMessage(message: AiMessage): Anthropic.MessageParam {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content.map((block) =>
        block.type === 'text'
          ? { type: 'text' as const, text: block.text }
          : { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input },
      ),
    };
  }

  if (typeof message.content === 'string') {
    return { role: 'user', content: message.content };
  }

  return {
    role: 'user',
    content: message.content.map((result) => ({
      type: 'tool_result' as const,
      tool_use_id: result.toolUseId,
      content: result.content,
      is_error: result.isError ?? false,
    })),
  };
}

function fromAnthropicBlock(block: Anthropic.ContentBlock): AiContentBlock[] {
  if (block.type === 'text') return [{ type: 'text', text: block.text }];
  if (block.type === 'tool_use') {
    return [
      {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      },
    ];
  }
  return [];
}

function mapStopReason(reason: string | null): AiCompletionResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'other';
  }
}
