# ADR-0006 · Keyset pagination everywhere

**Status:** Accepted · **Date:** 2026-01

## Context

Every list endpoint needs paging. The default reflex is `LIMIT`/`OFFSET`,
because it maps directly to a page number and every ORM makes it easy.

It has two problems that both show up in exactly the workload this product has:
long lists that people scroll, and lists that other people are editing while
they scroll.

## Decision

Keyset (cursor) pagination on `(created_at DESC, id DESC)` for every list
endpoint. No `OFFSET` anywhere.

The predicate is a Postgres **row-value comparison**:

```sql
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT $4
```

not the hand-rolled equivalent
(`created_at < $2 OR (created_at = $2 AND id < $3)`). The row-value form is what
the planner turns into a single index range scan, and it is far harder to get
subtly wrong at a tie.

Cursors are opaque base64url of `createdAt|id`. `limit + 1` rows are fetched so
the presence of a next page is known without a second `COUNT(*)`.

Implemented in
[`apps/api/src/lib/query.ts`](../../../apps/api/src/lib/query.ts) and
[`packages/shared/src/pagination.ts`](../../../packages/shared/src/pagination.ts).
Every listable table carries the matching index.

## Consequences

**Good.** Constant-time paging. Page 1 and page 400 cost the same, because both
are an index seek plus a scan of `limit` rows. `OFFSET 10000` reads ten thousand
rows to discard 9,975 of them.

**Good.** Stable under concurrent writes. With `OFFSET`, a row inserted above
your position pushes one row from page 2 onto page 3 — so you never see it —
and a deletion pulls one up so you see it twice. On a list people are actively
editing, that is a real and confusing bug. A keyset cursor is a position in the
data, not a count, so it is immune.

**Good.** One index serves the tenant filter and the ordering together.

**Bad.** No page numbers, and no "jump to page 7". Acceptable: these are
scrollable operational lists, and the useful navigation is filtering, not
pagination arithmetic.

**Bad.** No total count. Deliberate — `COUNT(*)` over a large filtered set is
the expensive part of most paginated endpoints, and "About 2,400" is rarely
worth it. Where a count genuinely matters it is a separate, explicit endpoint.

**Bad.** The ordering is fixed. Sorting a list by, say, invoice total would need
a different cursor keyed on `(total_amount, id)` and a matching index. That is a
per-endpoint decision, not a free parameter.

**Bad.** Clients must treat the cursor as opaque. Mitigated by making a
malformed cursor mean "start from the beginning" rather than a 400 — a stale
bookmark should not be an error a user has to understand.

## Alternatives considered

**`LIMIT`/`OFFSET`.** Simple, familiar, supports page numbers. Rejected for the
two reasons above; the skipped-and-duplicated-rows problem is the one that
actually bites users.

**Offset for shallow pages, keyset beyond.** Two code paths and two sets of
bugs, to buy page numbers on the first few pages. Rejected.

**Timestamp-only cursors.** Simpler, and wrong: two rows created in the same
millisecond — entirely normal for a bulk import — either get skipped or repeat
forever. The id is what makes the key unique.

**Encrypting or signing the cursor.** The cursor contains a timestamp and an id
the caller already has, and it is only usable within their own tenant scope. Not
worth the key management.
