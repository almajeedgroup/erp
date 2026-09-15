# Coding standards

Conventions are only worth writing down when they buy something. Each of these
does; the reason is given alongside, and where a tool can enforce it, the tool
does — a standard that lives only in a document is a standard that decays.

## Enforced by tooling

| Rule | Tool | Config |
| --- | --- | --- |
| Formatting | Prettier | `.prettierrc` — 100 columns, single quotes, trailing commas, LF |
| No unused values | ESLint | `@typescript-eslint/no-unused-vars`, `^_` escapes it |
| `import type` for types | ESLint | `consistent-type-imports`, inline fix style |
| No stray `console.log` | ESLint | `no-console`, allowing `warn`/`error`; off in tests and scripts |
| `===` except vs `null` | ESLint | `eqeqeq: ['error', 'smart']` |
| Strict types | tsc | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `useUnknownInCatchVariables` |

`npm run verify` runs all of it. Nothing below needs a reviewer to remember it.

## TypeScript

**Strict, and then some.** `noUncheckedIndexedAccess` is the one people notice:
`array[0]` is `T | undefined`, so you handle the empty case or you assert it.
It is noisy for about a day and then it stops you shipping the bug where a
filtered list came back empty.

`exactOptionalPropertyTypes` is deliberately **off**. It is the right setting
in principle, but Drizzle's inferred insert types and several Fastify option
objects model "absent" and "explicitly undefined" as the same thing; turning it
on produces casts at those boundaries, and a cast is worse than the rule it
silences. Revisit when those libraries tighten.

**`verbatimModuleSyntax`.** Type-only imports must say so. It removes the class
of bug where a value import survives compilation and drags a module into a
bundle that did not need it.

**Relative imports carry `.js`.** NodeNext ESM: `import { scope } from './tenancy.js'`
in a file called `tenancy.ts`. The specifier describes runtime, not source.

**Branded ids.** `Id<'client'>` is `string` with a phantom brand, minted by
`newId('client')` in `packages/shared/src/ids.ts`. A `ClientId` cannot be passed
where a `ProjectId` is expected, and the prefix (`cli_`, `prj_`) makes an id in
a log line self-describing. The cost is a cast at the database boundary; the
benefit is that the most common ERP bug — passing the wrong id to the right
function — becomes a compile error.

**No `any`.** `no-explicit-any` is a warning rather than an error so that a
genuine boundary (a third-party type that lies) does not block a build, but
every one in the tree should have a comment next to it. `unknown` plus a
narrowing function is almost always what was meant.

## Modules

Each API module is a directory under `apps/api/src/modules/` with:

```
routes.ts    HTTP: schemas, permissions, status codes. No business logic.
service.ts   Business logic: takes (ctx, input), returns domain objects.
*.test.ts    Integration tests through the real server.
```

**Services take a `RequestContext`, never a `FastifyRequest`.** This is the
convention with the most leverage in the codebase. Because a service cannot see
the request, it cannot read the organization id from a path parameter — it only
has `ctx.auth.organizationId`, which came from a verified token. The same
property makes services callable from the seed script, a background job, and the
AI agent's tool layer without HTTP. See `apps/api/src/context.ts`.

**Routes declare their permission, services assume it.** A route is
`preHandler: app.requirePermission('invoice:issue')`. Services do not re-check
the permission (they check *business* preconditions like "is this invoice
already issued"). One place to look, one place to get it wrong.

**Every query goes through `scope()`.** Never hand-write
`eq(table.organizationId, ...)`. `packages/db/src/tenancy.ts` is the only file
allowed to express the tenant predicate, and it is tested hard, because a
scoping bug is not a bug — it is a cross-tenant breach.

## Money

**Never a float.** `Money` is `{ amount: number, currency: CurrencyCode }` where
`amount` is an integer count of minor units — 1,250 SAR halalas, not 12.50. All
arithmetic goes through `packages/shared/src/money.ts`; nothing multiplies a
price by a quantity inline.

The same applies to the *inputs* of a money calculation, or the exactness of the
money is theatre. Quantities are stored as thousandths (`7.5 hours` → `7500`,
column `quantity_milli`) and rates as basis points (`15%` → `1500`, column
`tax_rate_bp`). The API surface stays human — you send `quantity: 7.5` and
`taxRate: 15` — and `toQuantityMilli`/`toBasisPoints` in
`apps/api/src/modules/finance/totals.ts` convert once, at the boundary.

On the wire, `Money.amount` is a **string** of minor units (`"575000"`, not
`575000`), because a JSON number is a float and a large enough total would lose
precision in transit. `toDTO`/`fromDTO` in `money.ts` own that conversion.

Splitting uses `allocate()`, which distributes remainder pennies by largest
remainder so the parts always sum to the whole. [ADR-0003](../02-architecture/adr/0003-integer-minor-units-for-money.md)
has the full argument.

## Errors

One error type, `AppError`, with a closed set of codes in
`packages/shared/src/errors.ts`. Each code maps to exactly one HTTP status in
`apps/api/src/plugins/errors.ts`.

```ts
throw errors.preconditionFailed('Invoice has already been issued');
```

Not `throw new Error(...)`, and not a bare `reply.code(412)`. The reasons:
the client gets a stable machine-readable `code` it can branch on, the status
mapping lives in one place, and an unrecognised throw becomes a 500 with the
detail logged and *not* returned — which is how internal messages stop leaking.

**Errors carry no user input in production messages.** `notFound('client', id)`
is fine; echoing a submitted string back is how reflected XSS gets into an
error path.

## Validation

Zod, in `packages/shared/src/domain/`, used for three things at once:

1. request validation (`fastify-type-provider-zod`),
2. TypeScript types (`z.infer`), so the handler's parameter type *is* the
   validated shape,
3. the OpenAPI 3.1 document, generated from the same schemas.

That is why the schemas live in `shared` rather than next to the routes: the
web app imports them too, so the client and the server cannot disagree about
the contract.

Request bodies use `z.strictObject` — an unknown key is a 422, not silently
dropped. It catches typos in integrations and it stops mass-assignment.

Responses are validated too, on the way out. It costs a little CPU and it has
already caught a service returning a `Date` where the contract said string.

## Web

**Server components by default.** `'use client'` only where there is genuine
interactivity (`login-form.tsx`, `assistant.tsx`, `revenue-chart.tsx`). Data
fetching happens on the server, where the session cookie is readable and the
API token never reaches the browser.

**No token in client JavaScript.** Cookies are `httpOnly`, `sameSite=lax`,
`secure` outside development. The browser holds a session; the server holds the
token. [ADR-0007](../02-architecture/adr/0007-bff-session-cookies.md).

**Formatting money is a client-side concern only for display.** `lib/format.ts`
takes the `MoneyDTO` off the wire; it never does arithmetic. Arithmetic happens
once, on the server, in one place.

## Comments

Comment the **why**, not the what. `// increment i` is noise; the comment above
the `SELECT ... FOR UPDATE` in `allocateInvoiceNumber` explaining that gapless
numbering is a legal requirement in some jurisdictions is the difference between
a future reader keeping the lock and "optimising" it away.

File-level block comments explain the file's job and its constraints. If a
function needs one, it usually wants a better name first.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `demo-data.ts` |
| Types, interfaces | PascalCase, no `I` prefix | `RequestContext` |
| Functions, variables | camelCase | `allocateInvoiceNumber` |
| Constants | SCREAMING_SNAKE | `MAX_PAGE_SIZE` |
| Database tables/columns | snake_case, plural tables | `invoice_lines.unit_price_amount` |
| Permissions | `resource:action` | `invoice:issue` |
| Id prefixes | 3–4 letters, `_` | `inv_`, `prj_` |

Booleans read as assertions: `isTerminal`, `canSeeSensitive`, `indexForAi`.
A boolean named `status` will eventually hold three states.

## Dependencies

A new runtime dependency needs a reason that survives the question "what breaks
if we write the twenty lines ourselves?". The current tree is deliberately
small: Fastify and its plugins, Drizzle, Zod, jose, argon2, pino, the Anthropic
SDK, Next and React. `npm audit --audit-level=high` gates the build.

Pin the major, allow the minor (`^`). `overrides` exists for one entry — esbuild
— to lift a transitive dependency past an advisory.
