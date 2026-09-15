# ADR-0005 · Embeddings as JSONB, not pgvector

**Status:** Accepted · **Date:** 2026-02

## Context

The AI assistant retrieves relevant document text before answering. That needs
embeddings stored and ranked by similarity.

The obvious answer is `pgvector`: a `vector(1536)` column, an HNSW or IVFFlat
index, and `ORDER BY embedding <=> $1 LIMIT 5` in SQL.

Two things complicate it. The corpus here is small — an organization's indexed
documents are handbooks, contracts and reports, which is thousands of chunks,
not millions. And pgvector is an extension, which means the test database must
have it too; the PGlite build this project uses does not ship it.

## Decision

Store embeddings as JSONB arrays of floats in `document_chunks.embedding`, and
compute cosine similarity in the application.

Candidates are restricted **in SQL** to the caller's organization,
non-confidential, AI-enabled documents before anything is scored — so a chunk
the caller should never see cannot win on similarity regardless of the ranking.

Implemented in
[`apps/api/src/modules/ai/retrieval.ts`](../../../apps/api/src/modules/ai/retrieval.ts).

## Consequences

**Good.** No extension. The test suite stays hermetic — retrieval, ranking and
citation are covered by ordinary tests with no container and no network.

**Good.** The ranking function is plain, readable TypeScript that can be unit
tested directly, including the edge cases that matter: a dimension mismatch
returns 0 rather than throwing, because a corpus mid-reindex can briefly hold
vectors from two different models and a ranking function is the wrong place to
crash over it.

**Good.** Switching embedding models is a reindex, not a migration. The model
name is stored per chunk, so a mixed corpus is detectable.

**Bad, and the real cost.** Retrieval is O(n) in the tenant's chunk count, and
every candidate's vector crosses the wire from Postgres to the application. At
1,536 dimensions that is roughly 12 KB of JSON per chunk. A thousand chunks is
~12 MB per query — fine. A hundred thousand is not.

**Bad.** No index. Postgres cannot help; the whole candidate set is scanned.

**Bad.** Memory pressure scales with corpus size, on the API process rather than
the database.

## When to change this

Concretely, so the decision gets revisited on evidence rather than vibes. Move
to pgvector when **any** of these is true:

- A single organization exceeds ~20,000 indexed chunks
- p95 latency of `POST /ai/search` exceeds 500 ms
- The API process shows memory pressure attributable to retrieval

## The migration, when that happens

1. Use a Postgres image with pgvector — `docker-compose.yml` already specifies
   `pgvector/pgvector:pg17`, so this costs nothing today.
2. `CREATE EXTENSION vector;` and add a `vector(1536)` column alongside the
   JSONB one.
3. Backfill from the JSONB column.
4. Build an HNSW index.
5. Switch `searchChunks` to `ORDER BY embedding <=> $1 LIMIT $2`, keeping the
   same tenant and consent predicates in the `WHERE` clause.
6. Drop the JSONB column once the read path has been on the new one for a
   release.

For tests, either load pgvector into PGlite if the build supports it by then, or
run retrieval tests against the real Postgres job that already exists in CI.

## Alternatives considered

**pgvector now.** The right long-term answer, rejected today only because it
would cost the hermetic test suite — which catches far more bugs than the
performance difference is worth at this corpus size.

**A dedicated vector database (Pinecone, Weaviate, Qdrant).** A second datastore
to operate, back up and keep consistent with Postgres, plus a new failure mode
where a document exists but its chunks do not. Not justified until retrieval is
a product in its own right. See
[vector databases](../../05-ai/vector-databases.md).

**Postgres full-text search instead of embeddings.** `tsvector` with a GIN index
is fast, indexed, extension-free and genuinely good at keyword matching.
Rejected as the sole mechanism because it cannot answer "what are the payment
terms for the metro contract?" when the document says "net 45 days from invoice
date" without the word "terms" nearby. It is, however, an excellent *complement*
— hybrid keyword-plus-vector retrieval is the natural next improvement, and it
needs no extension either.
