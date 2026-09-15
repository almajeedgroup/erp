# Secure coding

The habits that prevent whole classes of bug, rather than a list of things not
to do. Each one here is visible in the codebase.

## Make the safe thing the default thing

The single most useful principle. If the correct way is also the easiest way,
people take it under deadline pressure — and deadline pressure is when security
bugs get written.

**Tenant scoping is inside the helpers.** `paginate` and `findByIdOrThrow`
apply `scope()` themselves, so the shortest path to a list query is also the
scoped one. Writing an unscoped query requires deliberately going around them.

**Redaction is inside the mapper.** `toEmployee` strips sensitive fields, so a
new endpoint that returns an employee inherits the redaction. Forgetting it
requires not using the mapper.

**Strict schemas are the convention.** `z.strictObject` everywhere means
adding a field to a request requires adding it to the schema, which is the
moment to ask whether it should be settable.

The general shape: put the control in the path everyone already walks.

## Parse, don't validate

Convert untrusted input into a trusted type at the boundary, once, and work with
the trusted type afterwards.

```ts
// At the boundary: unknown -> CreateClientInput, or a 422.
const input = createClientSchema.parse(body);
// Everywhere after: the type system knows what this is.
```

The alternative — checking validity repeatedly and passing raw input around — is
how a check gets skipped on one path.

Branded ids are the same idea: `Id<'client'>` is not assignable to
`Id<'project'>`, so passing the wrong id is a compile error rather than a
cross-resource read.

## Fail closed

Every decision defaults to denial.

```ts
export function can(role: Role | string, permission: Permission | string): boolean {
  if (!isRole(role) || !isPermission(permission)) return false;  // unknown → no
  return GRANT_SETS.get(role)?.has(permission) ?? false;         // absent → no
}
```

Content sniffing does the same: an unidentified file resolves to
`application/octet-stream`, which is not on the allow-list. "I could not tell
what this is" becomes a rejection rather than a guess.

## Validate on the way out as well as in

Responses are checked against their declared schema. A handler returning the
wrong shape is a 500 with a loud log line, not a subtly wrong payload discovered
in production.

It is also what keeps the OpenAPI document honest: it and the runtime check come
from the same schema.

## Never trust a client's description of its own data

The `Content-Type` on an upload is a claim by the uploader, and uploaders
include attackers. The server sniffs the leading bytes and stores the **sniffed**
type.

A declared type that should carry a signature but does not is refused outright
rather than helpfully reclassified — otherwise `invoice.pdf` containing HTML
gets stored, and served, as text.

The same reflex applies to `X-Forwarded-For` (trusted only where a proxy is
actually in front), to an inbound request id (length-capped before use), and to
a filename (never used as a storage path).

## Compute totals server-side

The invoice schema has no `total` field. A client cannot send one, so there is
nothing to validate or ignore. Totals come from the lines, computed by pure
functions that are tested exhaustively.

The general rule: if a value is derivable from other values, derive it. A field
the client can set is a field the client can set wrongly.

## Derive anything time-dependent at read time

`overdue`, `daysOverdue`, `balanceDue`, a task's `overdue` flag, every analytics
figure. None are stored.

A stored `overdue` flag is wrong the next morning, and the job that was meant to
keep it honest is the job that silently stops running.

## One place for each invariant

Tenant scoping: one module. Money arithmetic: one module. The permission matrix:
one constant. Error taxonomy: one file. Date handling: one module, UTC-only.

An invariant enforced in five places is an invariant enforced in four places
after the next refactor.

## Use the database for what it is good at

A partial unique index enforces "one primary contact per client" under
concurrency; a read-then-write cannot. Enums reject bad statuses arriving from a
backfill script. Foreign keys with considered `ON DELETE` behaviour keep the
graph consistent. `SELECT ... FOR UPDATE` makes invoice numbering gapless.

Application-level checks are advisory. Database constraints are not.

## Transactions around multi-step changes

Anything that writes more than one row is in a transaction, and the audit row is
written inside it:

```ts
await ctx.db.transaction(async (tx) => {
  await tx.insert(clients).values(values);
  await writeAudit(tx, { /* ... */ });
});
```

An audit trail that can fail after the change it describes succeeded is not an
audit trail.

## Log the denials

Permission denials, refresh replays and lockouts are logged with the actor, the
route and the request id. Those are the rows that matter when someone asks what
happened.

## Handle errors without disclosing

```ts
if (AppError.is(error)) {
  return reply.status(error.status).send(error.toBody(requestId));
}
request.log.error({ requestId, err: error, route }, 'unhandled error');
return reply.status(500).send(internalError(error).toBody(requestId));
```

`AppError.details` exists for the log line and is never serialised. A `notFound`
carries the id it was looking for — useful in a log, disclosure in a response.

## Bound everything

Every string has a maximum length. Every array has a maximum size. Every page
has a maximum. The agent loop has a step ceiling. Uploads have a byte limit
enforced while reading. The chunker clamps an overlap that would make it
quadratic.

Unbounded input is a denial-of-service vector before it is anything else.

## Write the test that tries to break it

Not "does it work" but "what happens when someone tries". The tests that matter
most in this codebase:

- Read another tenant's row by its exact id → 404
- Forge a token, tamper with one, sign one with a different key → 401
- Replay a spent refresh token → family revoked
- Send `{"role":"owner"}` in a body → 422
- Upload HTML declared as a PDF → 415
- Promote yourself → 403
- Approve your own expense → 409
- Feed the agent a prompt-injection payload → nothing widens

## Comment the why, never the what

```ts
// Checked *before* the arithmetic: summing mixed currencies throws a
// CurrencyMismatchError, which would surface as an unhelpful 500 rather than
// the 412 that tells the caller exactly what is wrong.
assertLinesMatchCurrency(input.lines, input.currency);
```

The next person can read what the code does. What they cannot recover is why it
is in that order — and that is exactly the knowledge that stops someone
"tidying" it back into a bug.

## Dependencies

Fewer is better. Every dependency is code you did not read running with your
privileges.

Before adding one: is it a few lines to write? (`safeEqual` is six.) Is it
maintained? How many transitive dependencies does it bring? Does it need
network or filesystem access it should not have?

`npm ci` from a committed lockfile, `npm audit` in CI, grouped Dependabot PRs.
