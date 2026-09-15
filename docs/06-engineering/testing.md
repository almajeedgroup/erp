# Testing

294 tests across 21 files. They run in about thirty seconds, need no Docker, no port
and no network, and they run identically on a laptop and in CI. That property is
not incidental — it is the reason the suite gets run before every push instead of
being something CI does after you have moved on.

```bash
npm test              # once
npm run test:watch    # on change
npm run test:coverage # with v8 coverage
```

## The shape of the suite

| Layer | Where | What it proves | Count |
| --- | --- | --- | --- |
| Pure unit | `packages/shared/src/*.test.ts` | Money, dates, ids, pagination, RBAC, error mapping | 75 |
| Data access | `packages/db/src/*.test.ts` | The tenant predicate; schema invariants | 14 |
| Pure domain | `apps/api/src/modules/finance/totals.test.ts`, `ai/retrieval.test.ts`, `lib/password.test.ts` | Arithmetic and algorithms, no database | 36 |
| Integration | `apps/api/src/modules/*/[module].test.ts`, `seed/seed.test.ts` | The real server, end to end through HTTP | 169 |

There is no mocking layer between the integration tests and the database. They
run against genuine Postgres and the genuine Fastify server — the only
substitutions are the model provider and the storage driver, and both are
substituted at the same seam production uses to swap providers.

## Why PGlite

The integration tests run against [PGlite](https://pglite.dev): PostgreSQL
compiled to WebAssembly, running inside the test process.

That means a real query planner, real constraints, real transactions, real
`SELECT ... FOR UPDATE`, real `ON CONFLICT` — the things a mocked repository
silently gets wrong. And it means no container to start, no port to race on, no
`docker` in CI, and no cleanup step that leaves orphaned volumes on a laptop.

The honest limitation: it is a single-connection WASM build, so it cannot
demonstrate lock contention between concurrent connections, and it is not
byte-for-byte the server that runs in production. Two things close that gap:

- a **CI job against real Postgres** (`pgvector/pgvector:pg17`) applies the
  committed migrations through the real `node-postgres` driver, applies them a
  second time to prove idempotence, seeds, and then fails the build if
  `drizzle-kit generate` produces a diff — meaning the Drizzle schema was edited
  without a migration;
- anything genuinely concurrency-shaped gets reasoned about explicitly and, if
  it matters, exercised by hand against the compose stack.

[ADR-0004](../02-architecture/adr/0004-pglite-for-tests.md) records the decision
and what would make us revisit it.

## The harness

`apps/api/src/test/harness.ts`. One call builds the whole system:

```ts
const ctx = await createTestContext();
// ctx.app       a real Fastify server, driven through app.inject()
// ctx.database  PGlite, migrated
// ctx.storage   in-memory storage driver
// ctx.ai        the deterministic mock model provider
// ctx.setNow()  move the clock
```

Four decisions inside it are worth knowing:

**The clock is pinned.** `FIXED_NOW = 2026-06-15T12:00:00Z`, injected as
`clock` into the server. Every due-date calculation, aging bucket and reporting
range is therefore deterministic. Nothing in the codebase calls `new Date()`
directly in business logic; it takes `ctx.now`. Without this, a receivables
aging test passes for 29 days and then fails on a Tuesday.

**`app.inject()`, not a socket.** Fastify dispatches the request through the
full lifecycle — hooks, validation, serialization, error handling — without
binding a port. Same code path, no networking.

**Rate limits are raised, not removed.** The limiter is still wired, so its
hooks still run; the limits are set high enough not to throttle the suite, and a
test can lower one through `createTestContext` overrides.

**`truncate()` between tests, not a fresh database.** Recreating PGlite per test
costs seconds; truncating costs milliseconds. It also clears the in-memory
storage map — a document uploaded in one test used to survive into the next,
which is exactly the sort of bleed that makes a suite flaky.

## What a good test looks like here

From `apps/api/src/modules/finance/finance.test.ts`:

```ts
it('refuses a line priced in another currency', async () => {
  const response = await draft(owner, {
    lines: [{ description: 'X', quantity: 1, unitPrice: { amount: '100', currency: 'USD' } }],
  });
  expect(response.statusCode).toBe(412);
});
```

It goes through HTTP and it distinguishes 412 from 422 and from 500 — which
matters, because the bug this test found returned 500. A test asserting only
`statusCode !== 201` would have passed against the broken code.

Its neighbour is the one I would point at first:

```ts
it('ignores client-supplied totals because the schema has no such field', async () => {
  // ... payload includes total: sar('1')
  expect(response.statusCode).toBe(422);
});
```

Totals are computed server-side from the lines. Because request bodies are
`z.strictObject`, a client that tries to dictate the total does not get it
quietly ignored — it gets rejected.

Three rules:

1. **Assert the contract, not the implementation.** Status code, error code,
   response body. Not "the service called this function".
2. **A test must fail if the behaviour is reverted.** If it does not, it is
   documentation with a green tick.
3. **Name the invariant, not the mechanics.** "refuses to issue an invoice whose
   lines are in another currency", not "test issue 3".

## What the tests have actually caught

These are not hypotheticals — each one was a real bug found by writing the test,
and each is now pinned by it:

- **Currency validated after arithmetic.** A mixed-currency invoice threw
  `CurrencyMismatchError` out of the money layer, which is not an `AppError`, so
  the client got a 500 instead of a 412. Fixed by extracting
  `assertLinesMatchCurrency` and calling it *before* `computeInvoice`, on both
  the create and update paths.
- **Content-type sniffing too permissive.** An HTML file declared as
  `application/pdf` fell through to a `text/plain` fallback and was accepted
  (201 instead of 415). Fixed with a `SIGNATURE_REQUIRED` set — unidentified
  bytes now resolve to `application/octet-stream`, which is not on the
  allow-list.
- **Degenerate chunk overlap.** An overlap greater than or equal to the window
  size advanced the cursor one character at a time: 10,000 characters produced
  9,901 chunks. Fixed by clamping the overlap to half the window.

A third was a flaky test rather than a product bug, and is worth recording
because flakes are the expensive kind. `seed.test.ts` asserted that
`items[0].compensation` was non-null for a finance user. The seed writes two
employees, only one of whom has a salary, in a single transaction — so they share
`created_at`, the keyset tiebreaker (`id DESC`) falls to randomly-suffixed ids,
and roughly half of runs put the salaryless employee first. It now finds the
employee by name and asserts that **the same person** is returned with the
sensitive block for one role and without it for another, which is the invariant
that was meant all along.

The general rule: `items[0]` is only safe after asserting the list has exactly
one element. Two other assertions in the suite index position 0 and are fine for
exactly that reason.

Two other cases went the other way — the test was wrong and the implementation
was right. The receivables bucket for 2026-02-10 → 2026-03-15 is `31-60`, not
`61-90`, because that is 33 days; and a traversal filename like
`../../etc/passwd` never reaches the service as a path, because busboy has
already applied `basename()`. Both tests were rewritten to assert the real
invariant. Getting this wrong in the other direction — "fixing" working code to
match a wrong test — is the more expensive mistake, which is why a failing test
gets read before it gets satisfied.

## What is deliberately not tested

Saying so is part of the point of this page.

- **The web app has no automated tests.** It was verified end to end by hand in
  a real browser: signing in through the form, all eleven authenticated pages
  returning 200 with the right heading, `document.cookie` empty while the session
  works, and invoice arithmetic reconciling on screen. That is a manual check, and it will
  rot. Playwright covering sign-in, one create flow and one permission-denied
  view is the first thing to add.
- **Concurrency.** The gapless invoice numbering takes a row lock
  (`SELECT ... FOR UPDATE` on `invoice_counters`), which is the correct shape,
  but no test races two writers at it. PGlite cannot; a test against the compose
  stack could.
- **Load and soak.** No performance baseline exists. The keyset pagination and
  the index set are reasoned about in [system design](system-design.md), not
  measured.
- **The real model provider.** Every AI test runs against the deterministic mock.
  The Anthropic path is exercised by hand. See
  [AI evaluation](../05-ai/evaluation.md) for the offline evaluation set, which
  is a different thing from a unit test and is also not wired into CI.
- **Migrations down.** There are no down migrations. Rollback is
  restore-from-backup plus roll-forward; see
  [disaster recovery](../07-operations/disaster-recovery.md).

## Coverage

v8 coverage over `packages/*/src` and `apps/api/src`, uploaded as a CI artifact.
No threshold gate. A percentage target produces tests written to touch lines
rather than to check behaviour, and the moment that happens the number stops
meaning anything. Use it to find *untouched* code, which is a real signal, and
ignore the headline.
