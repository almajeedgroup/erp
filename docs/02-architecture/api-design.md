# API design

A JSON API over HTTP, mounted at `/api/v1`. The OpenAPI 3.1 document is
generated from the same Zod schemas the routes validate against, so it cannot
describe a field that does not exist — browse it at `/docs` in development, or
fetch `/openapi.json` in production.

## Versioning

The version is in the path, not a header. `/api/v1/clients`.

A version in a header is technically tidier and practically worse: it is
invisible in a log line, in a browser address bar and in a curl command someone
pastes into a ticket. Path versioning also makes running v1 and v2 side by side
during a migration trivial — two route prefixes, one process.

Within a version, additive changes are fair game (new endpoints, new optional
fields, new enum values on a response). Removing a field, renaming one, making
an optional field required, or narrowing an accepted range is a new version.

## Resources

| Prefix | Module |
| --- | --- |
| `/auth` | Register, login, refresh, logout, me, change password |
| `/organization` | Profile, members, roles, audit log |
| `/clients` | Clients and their contacts |
| `/projects` | Projects and project members |
| `/time-entries` | Time, mounted at the root because the useful queries are cross-project |
| `/employees` | People |
| `/invoices` | Invoices, issue, void, payments |
| `/expenses` | Expenses and review |
| `/documents` | Upload, download, metadata |
| `/tasks` | Tasks and comments |
| `/analytics` | Derived reports |
| `/ai` | Chat, search, conversations, tools |

Verbs that are not CRUD get their own sub-resource rather than a `PATCH` with a
magic field: `POST /invoices/:id/issue`, `POST /invoices/:id/void`,
`POST /expenses/:id/review`. Issuing an invoice is not "updating its status" —
it allocates a number, stamps dates and freezes the document — and an endpoint
that says so is clearer and easier to authorise separately.

## Pagination

Keyset, on `(created_at DESC, id DESC)`.

```
GET /api/v1/clients?limit=25&cursor=MjAyNi0wMy0wMVQxMDowMDowMC4wMDBafGNsaV8...
```

```json
{ "items": [ ... ], "nextCursor": "MjAyNi0wMy0wMVQwOTo..." }
```

`OFFSET` degrades linearly — page 400 reads 10,000 rows to discard 9,975 — and
silently skips or repeats rows when the underlying set changes mid-scroll, which
it does on a list people are actively editing. Keyset is one index range scan
regardless of depth, and stable under concurrent writes.

The cursor is opaque base64url and clients must treat it that way. A malformed
cursor is treated as "start from the beginning" rather than a 400: cursors are
not something a user can be expected to reason about, and a stale bookmark
should not be an error they have to understand.

`limit` is capped at 100 and an over-large value is a 422 rather than a silent
clamp — silently returning 100 when 5,000 was asked for makes a client's paging
logic wrong in a way that is hard to notice.

Fetching `limit + 1` rows is how the presence of a next page is known without a
second `COUNT(*)`.

## Errors

Every handled failure returns the same envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed",
    "issues": [{ "path": "lines[0].unitPrice.amount", "message": "must be an integer number of minor units" }],
    "requestId": "req_3f1a8b2c..."
  }
}
```

`code` is a stable machine-readable string from a closed set
([`packages/shared/src/errors.ts`](../../packages/shared/src/errors.ts)).
`message` is for a human. `issues` appears on validation failures with a path
into the request body. `requestId` is on everything.

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthenticated`, `invalid_credentials`, `token_expired`, `token_revoked` | No session, or the credential is not usable |
| 403 | `forbidden` | Authenticated, but the role lacks the permission |
| 404 | `not_found` | No such resource — **or** it belongs to another tenant |
| 409 | `conflict` | A rule about the current state, e.g. deleting a client with unpaid invoices |
| 412 | `precondition_failed` | A rule about a transition, e.g. editing an issued invoice |
| 413 | `payload_too_large` | Upload over the limit |
| 415 | `unsupported_media_type` | Content type not on the allow-list |
| 422 | `validation_failed` | The request does not match its schema |
| 429 | `rate_limited` | Over the budget for this principal or IP |
| 5xx | `internal_error`, `dependency_failed` | Our problem |

**409 versus 412.** A 409 is about the state of the world — "this client still
has unpaid invoices". A 412 is about the transition you asked for — "an invoice
in status `issued` cannot be issued". The distinction tells a client whether
retrying after changing something else might work.

**404 versus 403 for another tenant's record.** Always 404. A 403 would confirm
that the record exists, which is information the caller is not entitled to. This
is asserted by a test in every module.

Unhandled errors are logged in full — stack, cause chain, route — and answered
with a bare 500 carrying only the request id. No stack traces, no SQL fragments,
no driver messages reach a client.

## Validation

Zod, on the way in and on the way out.

Request objects are **strict**: an unexpected key is a 422, not a silently
ignored field. That is what makes mass assignment unreachable — a client cannot
smuggle `{"role":"owner"}` into a profile update, because the schema for that
route has no `role` key at all and the request is rejected before a handler
runs.

Responses are validated against their declared schema too. A handler returning
the wrong shape is a 500 with a loud log line rather than a subtly wrong payload
that a client discovers in production.

## Authentication

`Authorization: Bearer <access token>`. Access tokens are short-lived HS256 JWTs
(15 minutes by default); refresh tokens are opaque random strings, stored
hashed, and rotate on every use. See [authentication](../03-security/authn.md).

## Money on the wire

```json
{ "amount": "150000", "currency": "SAR" }
```

`amount` is an integer count of minor units, **as a string**. A JSON number
would be parsed as an IEEE-754 double by most clients, and a large total would
lose precision silently. A string cannot.

## Dates on the wire

Calendar dates are `YYYY-MM-DD`. Timestamps are RFC 3339 with an offset, always
UTC. A field named `...Date` is a calendar date; a field named `...At` is an
instant.

## Idempotency

Not implemented, and worth being precise about the gap.

`GET`, `PATCH` and `DELETE` are naturally idempotent here. `POST` is not: two
clicks on "record payment" record two payments.

The intended design is an `Idempotency-Key` header on the money-moving POSTs,
with the key and the first response stored per organization for 24 hours and a
replay returning the stored response. The header is already in the CORS
allow-list. It is not built because it needs a storage table and careful
handling of the in-flight case, and doing it half-way is worse than not at all.

Until then the practical mitigation is in the client: the submit button disables
on submit, and the audit log makes a double entry easy to spot and reverse.

## Rate limiting

Keyed on the authenticated principal where there is one, and the IP otherwise.

IP alone punishes everyone behind one corporate NAT for a single noisy client.
Principal alone leaves the login endpoint — the one that most needs a limit —
unprotected, since there is no principal yet.

Budgets are operator-tunable (`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`,
`REGISTER_RATE_LIMIT_*`). The credential endpoints carry a much tighter budget
than ordinary reads, and the AI chat endpoint tighter still, because it costs
money per call.

`/health` and `/ready` are never throttled: a rate-limited health check turns a
traffic spike into an outage.

## Documentation

`/docs` serves a browsable UI in development. In production the UI is off — an
interactive console against a system holding payroll is not something to leave
on by accident — and the raw document is served at `/openapi.json` so client
generation keeps working.
