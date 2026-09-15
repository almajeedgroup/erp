import { type Citation, newId } from '@almajeed/shared';
import { documentChunks, documents, scope } from '@almajeed/db';
import { and, eq } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';

/**
 * Retrieval.
 *
 * A small, honest RAG pipeline: chunk, embed, store, and rank by cosine
 * similarity at query time. Three properties matter more than the ranking
 * algorithm itself, and all three are enforced here rather than trusted to the
 * prompt:
 *
 *  1. **Retrieval is scoped to the caller's organization**, through the same
 *     `scope()` helper as every other query. The agent cannot retrieve across
 *     tenants even if a model asks it to.
 *  2. **Indexing is opt-in.** Only documents flagged `indexForAi` are chunked,
 *     and `confidential` ones are excluded regardless. Consent is a stored
 *     property, not a policy in a system prompt.
 *  3. **Every answer can be traced.** A chunk returns with its document id,
 *     title, position and score, so a claim without a citation is visibly a
 *     claim without a citation.
 *
 * Similarity is computed in the application rather than by pgvector. ADR-0005
 * records why, and the threshold at which that should change.
 */

/** Target chunk size in characters. ~250 tokens, comfortably inside any window. */
export const CHUNK_SIZE = 1_000;
/** Overlap so a fact spanning a boundary is retrievable from either side. */
export const CHUNK_OVERLAP = 150;

/** Content types whose text can be extracted without a parser library. */
export const INDEXABLE_CONTENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

export interface Chunk {
  index: number;
  content: string;
  /** Rough estimate; used for budgeting a prompt, not for billing. */
  tokenCount: number;
}

/**
 * Split text into overlapping chunks, preferring paragraph and sentence
 * boundaries so a chunk is a readable unit rather than a slice through a word.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) {
    return [{ index: 0, content: normalized, tokenCount: estimateTokens(normalized) }];
  }

  // An overlap at or above the chunk size makes the window advance one
  // character at a time — quadratic work and a chunk per character. Half the
  // window is the most that is ever useful, so clamp rather than trust.
  const safeOverlap = Math.min(Math.max(overlap, 0), Math.floor(size / 2));

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);

    if (end < normalized.length) {
      // Prefer to break at a paragraph, then a sentence, then a space — but
      // only if the boundary is in the last third, so chunks stay well filled.
      const window = normalized.slice(start, end);
      const floor = Math.floor(size * 0.66);
      const boundary = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('\n'),
      );
      if (boundary > floor) end = start + boundary + 1;
    }

    const content = normalized.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({ index, content, tokenCount: estimateTokens(content) });
      index += 1;
    }

    if (end >= normalized.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Cosine similarity between two vectors.
 *
 * Returns 0 for a length mismatch rather than throwing: a re-indexed corpus
 * can briefly hold vectors from two different embedding models, and a ranking
 * function is the wrong place to crash over it.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Index one document's text. Replaces any existing chunks for that document. */
export async function indexDocument(
  ctx: RequestContext,
  documentId: string,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  const embeddings = await ctx.services.ai.embed(chunks.map((chunk) => chunk.content));

  await ctx.db.transaction(async (tx) => {
    await tx
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, ctx.auth.organizationId),
          eq(documentChunks.documentId, documentId),
        ),
      );

    await tx.insert(documentChunks).values(
      chunks.map((chunk, position) => ({
        id: newId('documentChunk'),
        organizationId: ctx.auth.organizationId,
        documentId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: embeddings[position] ?? null,
        embeddingModel: ctx.services.ai.model,
        createdAt: ctx.now,
      })),
    );
  });

  return chunks.length;
}

export async function removeDocumentFromIndex(
  ctx: RequestContext,
  documentId: string,
): Promise<void> {
  await ctx.db
    .delete(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, ctx.auth.organizationId),
        eq(documentChunks.documentId, documentId),
      ),
    );
}

export interface SearchOptions {
  limit: number;
  minScore: number;
}

/**
 * Rank the organization's indexed chunks against a query.
 *
 * Candidates are restricted in SQL to this tenant's non-confidential,
 * AI-enabled documents *before* anything is scored, so a chunk the caller
 * should never see cannot win on similarity.
 */
export async function searchChunks(
  ctx: RequestContext,
  query: string,
  options: SearchOptions,
): Promise<Citation[]> {
  const [queryEmbedding] = await ctx.services.ai.embed([query]);
  if (!queryEmbedding) return [];

  const candidates = await ctx.db
    .select({
      documentId: documentChunks.documentId,
      title: documents.title,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      embedding: documentChunks.embedding,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      scope(
        documents,
        ctx.auth.organizationId,
        eq(documents.indexForAi, true),
        eq(documents.confidential, false),
      ),
    );

  return candidates
    .map((candidate) => ({
      documentId: candidate.documentId,
      title: candidate.title,
      chunkIndex: candidate.chunkIndex,
      score: candidate.embedding ? cosineSimilarity(queryEmbedding, candidate.embedding) : 0,
      excerpt: excerpt(candidate.content),
    }))
    .filter((candidate) => candidate.score >= options.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}

function excerpt(content: string, length = 400): string {
  return content.length <= length ? content : `${content.slice(0, length).trimEnd()}…`;
}
