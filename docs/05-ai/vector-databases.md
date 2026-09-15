# Vector databases

What they are, what this system uses instead, and the concrete point at which
that should change.

## The problem they solve

Given a query vector, find the k nearest vectors among millions, fast.

Exact nearest-neighbour search is O(n) — compare against everything. At a
thousand vectors that is instant; at ten million it is not. Vector databases
provide **approximate** nearest-neighbour indexes that trade a small amount of
recall for orders of magnitude of speed.

## The index types

| Index | How | Trade |
| --- | --- | --- |
| **Flat** | Compare against everything | Exact, O(n). Fine to surprisingly large n |
| **IVFFlat** | Cluster, then search the nearest clusters | Fast, needs training, quality depends on cluster count |
| **HNSW** | A navigable small-world graph | Fast and accurate; more memory, slower to build |
| **PQ** | Compress vectors into codebooks | Huge memory saving, lower accuracy |

HNSW is the usual default for quality; IVFFlat when memory is tight.

Worth knowing: **flat search is competitive for far longer than people expect.**
A hundred thousand 1,536-dimension vectors is about 600 MB and a few hundred
milliseconds of brute-force scoring. Reaching for a vector database at a
thousand vectors is premature.

## What this system does

Embeddings in JSONB, cosine similarity in the application, candidates filtered
in SQL by tenant and consent **before** scoring.

[ADR-0005](../02-architecture/adr/0005-embeddings-as-jsonb.md) records the
reasoning, the cost, and the migration path. The short version: the corpus is
thousands of chunks per organization, and keeping the test suite hermetic —
no extension, no container — catches more bugs than the performance difference
is worth.

The cost is stated honestly there: retrieval is O(n) in the tenant's chunk
count, and every candidate's vector crosses the wire from Postgres. At 1,536
dimensions that is ~12 KB of JSON per chunk.

## When to change

Concretely, so the decision is made on evidence:

- A single organization exceeds ~20,000 indexed chunks
- p95 latency on `POST /ai/search` exceeds 500 ms
- The API process shows memory pressure attributable to retrieval

## The options, in order of preference

### 1. pgvector

A Postgres extension adding a `vector` type with HNSW and IVFFlat indexes.

```sql
CREATE EXTENSION vector;
ALTER TABLE document_chunks ADD COLUMN embedding_vec vector(1536);
CREATE INDEX ON document_chunks USING hnsw (embedding_vec vector_cosine_ops);

SELECT ... FROM document_chunks
WHERE organization_id = $1 AND ...
ORDER BY embedding_vec <=> $2
LIMIT 5;
```

**The obvious next step**, for reasons that matter here:

- No new datastore to operate, back up or keep consistent
- The tenant and consent filters stay in the same `WHERE` clause, so the
  security property is unchanged
- The document row and its chunks stay in one transaction
- `docker-compose.yml` already uses `pgvector/pgvector:pg17`, so it costs nothing
  to be ready

The only real cost is the test suite: the PGlite build in use has no pgvector, so
retrieval tests would move to the real-Postgres CI job.

### 2. A dedicated vector database

Pinecone, Weaviate, Qdrant, Milvus.

Genuinely better at scale — billions of vectors, sophisticated filtering,
managed operations. And a second datastore, which means:

- A new failure mode where a document exists and its chunks do not
- Two backups to keep consistent
- The tenant filter enforced in two places, in two query languages
- Another vendor and another bill

That third point is the one that matters for this system. The security property
"a chunk the caller cannot see cannot win on similarity" is currently guaranteed
by a SQL `WHERE` clause on the same query. Splitting the store means
re-establishing it in a different system, and a mistake there is a cross-tenant
leak.

Justified when retrieval becomes a product in its own right, not before.

### 3. A managed embedding and retrieval service

Some providers offer the whole pipeline behind one API. Less control, less
work, and the consent model becomes theirs rather than yours — which is
disqualifying for a system where "confidential documents are never indexed" must
be provably true.

## Hybrid search — the cheaper improvement

Before reaching for any of the above, the improvement with the best ratio of
gain to effort is **combining keyword and vector search**.

Postgres full-text search needs no extension:

```sql
ALTER TABLE document_chunks ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX ON document_chunks USING gin (content_tsv);
```

Keyword search catches exactly what embeddings handle poorly — a project code, an
invoice number, a proper noun, an exact phrase. Embeddings catch what keyword
search misses — a question phrased differently from the document.

Combining them (reciprocal rank fusion is the usual method) measurably beats
either alone, costs one index, and adds no new component.

**This is the next retrieval improvement worth making**, ahead of pgvector,
because the current bottleneck is quality rather than speed.

## Dimensions and cost

| Model | Dimensions | Storage per 100k chunks |
| --- | --- | --- |
| Small embedding models | 384 | ~150 MB |
| Mid-size | 768 | ~300 MB |
| Large | 1,536 | ~600 MB |
| Very large | 3,072 | ~1.2 GB |

More dimensions is not uniformly better. Above about 768 the accuracy gain is
modest and the storage and compute costs are linear. Some models support
truncation — taking the first 512 of 1,536 dimensions — which is often a better
trade than it sounds.

## Practical notes

**Normalise vectors.** If every vector is unit length, cosine similarity is
just the dot product, which is faster. `hashEmbedding` already normalises.

**Store the model name with the vector.** A corpus mid-reindex holds vectors
from two models, and mixing them silently produces nonsense rankings.
`document_chunks.embedding_model` exists for this, and `cosineSimilarity`
returns 0 on a dimension mismatch rather than throwing — a ranking function is
the wrong place to crash.

**Reindexing is a migration.** Changing the embedding model means re-embedding
every chunk. Plan for it: it is a background job that does not exist yet, which
is another argument for the job runner.
