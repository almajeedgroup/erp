# Data structures and algorithms

Business software is not short of algorithms; it is short of places where
choosing the wrong one is obvious. This page is the ones this codebase actually
contains, with the file, the complexity, and what goes wrong with the naive
alternative. Nothing here is a textbook exercise — every entry is running code.

## Largest remainder allocation

**`packages/shared/src/money.ts` → `allocate()`**

Split 100.00 three ways. `33.33 × 3 = 99.99`. The missing halala has to go
somewhere, and "somewhere" cannot be arbitrary, because the parts are invoice
lines and their sum is what a client pays.

```
allocate(m, weights):
  total      = sum(weights)
  base[i]    = floor(m.amount * weights[i] / total)
  remainder  = m.amount - sum(base)
  distribute one extra unit to the `remainder` largest fractional parts,
  ties broken by index
```

**O(n log n)**, from the sort on fractional part. The invariant — `sum(parts)
=== original` — holds for every input including negatives and zero weights, and
is asserted directly in `money.test.ts`.

The naive alternative is `round(total * weight / sum)` per part, which does not
sum to the whole and produces an invoice whose lines do not add up to its total.
That is not a rounding error; it is an invoice a client will refuse to pay.

## Keyset pagination

**`packages/shared/src/pagination.ts`, `apps/api/src/lib/repository.ts`**

`OFFSET 10000` makes Postgres produce 10,025 rows and throw away 10,000. The
cost grows linearly with the page number, and rows inserted during paging shift
everything, so a user scrolling sees duplicates and misses.

Instead the cursor carries the last row's sort key, and the next page asks for
everything strictly after it:

```sql
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT $4 + 1
```

The row-value comparison `(created_at, id) < (…, …)` is the important part: it is
a single lexicographic comparison that a B-tree index on
`(organization_id, created_at DESC, id DESC)` can satisfy as a **range scan**.
Written as `created_at < $2 OR (created_at = $2 AND id < $3)` it means the same
thing and the planner frequently will not use the index for it.

`id` is the tiebreaker, because `created_at` is not unique — two rows inserted
in the same millisecond would otherwise let a row be skipped or repeated.

**O(log n + k)** per page, independent of depth.

Two details worth copying: the query asks for `limit + 1` rows, so `hasMore` is
known without a second `COUNT(*)`; and `decodeCursor` returns `null` rather than
throwing on malformed input, so a tampered cursor is a 422 rather than a 500.
[ADR-0006](../02-architecture/adr/0006-keyset-pagination.md) records the
trade-off: no page numbers and no "jump to page 7".

## Hash set lookup for permissions

**`packages/shared/src/rbac.ts`**

Six roles × 45 permissions. The obvious implementation is
`GRANTS[role].includes(permission)` — an **O(n)** array scan on a path that runs
on *every request*, sometimes several times.

Instead the matrix is transformed once, at module load, into a `Map<Role,
Set<Permission>>`:

```ts
const GRANT_SETS = new Map<Role, ReadonlySet<Permission>>(
  ROLES.map((role) => [role, new Set(GRANTS[role])] as const),
);
```

`can()` is then **O(1)**. And because `AuthContext` resolves the role's
permission set once per request, the per-check cost inside a handler is a single
`Set.has`.

The complexity is not the point at this scale — 45 elements is nothing. The
point is that it costs the same to write correctly, and that the shape makes the
deny-by-default property obvious: `GRANT_SETS.get(role)?.has(permission) ?? false`
has no branch that can accidentally allow.

## Sliding window with overlap

**`apps/api/src/modules/ai/retrieval.ts` → `chunkText()`**

Documents are split into overlapping windows before embedding. Overlap exists
because a sentence split across a boundary is retrievable from neither side.

```
step = size - overlap
for start = 0; start < text.length; start += step
```

**O(n)** in the document length — *provided `step > 0`*.

This is where the interesting bug was. With `overlap >= size`, `step <= 0`, and
the loop was falling back to advancing by one character: a 10,000-character
document produced **9,901 chunks** instead of 10, each nearly identical, each
sent to an embedding API. A cost and latency incident, not a crash, which is the
kind that survives review.

```ts
const safeOverlap = Math.min(Math.max(overlap, 0), Math.floor(size / 2));
```

Clamping at half the window keeps `step >= size / 2`, which bounds the chunk
count at `2n / size`. Pinned by a test that passes a degenerate overlap and
asserts the count.

**The general lesson:** any loop whose increment is computed rather than
constant needs the increment proven positive, not assumed.

## Cosine similarity, linear scan

**`apps/api/src/modules/ai/retrieval.ts` → `cosineSimilarity()`, `search()`**

Retrieval compares a query embedding against every stored chunk for the
organization:

```
similarity(a, b) = dot(a, b) / (norm(a) * norm(b))
```

**O(k · d)** — chunks times dimensions — per search, in application memory.
At 1,000 chunks × 1,536 dimensions that is about 1.5M multiply-adds: a couple of
milliseconds, and entirely fine.

It does not stay fine. The growth is linear in corpus size and it runs on the
request path. The documented triggers for moving to a vector index —
`pgvector` with HNSW, changing this to **O(log k)** at the cost of approximate
results — are 20,000 chunks in one organization, p95 retrieval over 500 ms, or
memory pressure from loading the embeddings.
[ADR-0005](../02-architecture/adr/0005-embeddings-as-jsonb.md) has the reasoning
for starting with JSONB; [vector databases](../05-ai/vector-databases.md) covers
what changes.

The filter that keeps it honest: the scan is already scoped by
`organization_id`, so one tenant's corpus never widens another's search — and
never lengthens it either.

## B-tree indexes: the algorithm you did not write

The most consequential data structure here is one nobody in this repository
implements. Every index in `packages/db/drizzle/0000_initial_schema.sql` is a
B-tree, and the properties that matter are:

- **Ordered.** So `ORDER BY created_at DESC` can be answered by walking the
  index backwards instead of sorting.
- **Prefix-usable.** An index on `(a, b, c)` serves `WHERE a = ?`,
  `WHERE a = ? AND b = ?`, and `WHERE a = ? ORDER BY b` — but not `WHERE b = ?`.
  This is why every composite index here leads with `organization_id`: it is in
  every predicate, because `scope()` puts it there.
- **O(log n)** lookup, ~4 levels for millions of rows, and the upper levels stay
  cached.

Getting the *column order* wrong is the common failure, and `EXPLAIN` tells you
immediately: a `Seq Scan` or a `Sort` node where you expected `Index Scan`.
See [debugging](debugging.md#debugging-the-database).

## Memory-hard hashing

**`apps/api/src/lib/password.ts`**

Argon2id is deliberately the slowest algorithm in the codebase: 19 MiB of memory
and 2 iterations per verification, ~50–100 ms.

The design goal is *anti*-throughput. A fast hash (SHA-256) can be tried
billions of times per second on a GPU; Argon2id's memory requirement means an
attacker needs 19 MiB of fast memory per parallel guess, which is what collapses
the parallelism advantage. The parameters are the OWASP baseline and are pinned
by a test that asserts the encoded prefix `$argon2id$v=19$m=19456,t=2,p=1$`, so
a dependency upgrade cannot quietly weaken them.

Paired with it: `equalizeTiming()` verifies against a real decoy hash when the
email does not exist, so the response time does not reveal which accounts are
registered. That is a **timing side channel** — an algorithmic property of the
control flow, not of the hash.

## Bucketing and running totals

**`apps/api/src/modules/analytics/metrics.ts`**

Two ordinary patterns, called out because they are where analytics code usually
goes quadratic:

**Aging buckets.** `agingBucket()` in `modules/finance/totals.ts` places an
invoice into `current / 1-30 / 31-60 / 61-90 / 90+` by days overdue, and
`receivablesAging()` fills a pre-built `Map` of the five buckets in one pass —
**O(n)**, with the boundaries written as an explicit descending ladder
(`<= 0`, `<= 30`, `<= 60`, `<= 90`). 33 days overdue is `31-60`; the tests pin
exactly 30 and exactly 31, because that ladder is where an off-by-one hides.

**Cash-flow forecast.** Weekly buckets are materialised first with
`periodRange()`, then each invoice and expense is placed into one. The bucket
array is small and fixed (13 weeks), so the `findIndex` inside `indexFor` is
bounded by a constant rather than by the data — the distinction between
**O(n · w)** with tiny `w` and a genuine **O(n²)**.

Pre-materialising the buckets also makes empty weeks appear as zeros instead of
gaps, which is the difference between a chart that shows a quiet fortnight and a
chart that silently omits it.

**Grouping belongs in SQL.** `pipeline()` uses `GROUP BY` rather than fetching
rows and counting in JavaScript. Postgres has the statistics and the index;
moving n rows over the wire to count them is the classic N+1's quieter sibling.

## The ones that are not here

Worth naming, so their absence is a decision rather than an oversight:

- **No caching layer.** No LRU, no Redis. Every read hits Postgres. At this scale
  a cache would add invalidation bugs and hide the indexing problems you want to
  see. [System design](system-design.md) says when that changes.
- **No graph algorithms.** Tasks have no dependency edges, so there is no
  topological sort and no cycle detection. Adding task dependencies means adding
  both, and the cycle check is the one people forget.
- **No custom serialization.** JSON, via Zod-generated serializers.
- **No bespoke sorting.** `ORDER BY` in Postgres, always, so the ordering matches
  the index and the pagination.
