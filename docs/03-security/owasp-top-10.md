# OWASP Top 10 (2021) — mapped to this codebase

Each category, what it means here, what answers it, and the test that holds it.
A control with no test is a control that will quietly stop working.

---

## A01 · Broken Access Control

The category most breaches are actually filed under, and the one this
architecture spends the most effort on.

### Tenant isolation

Every business table carries `organization_id`, every query is scoped through
one module, and lookups match id **and** organization in the same predicate.

```ts
// packages/db/src/tenancy.ts
scopeById(clients, ctx.auth.organizationId, id)
// → organization_id = $1 AND deleted_at IS NULL AND id = $2
```

The organization id comes from the verified access token — never a path
parameter, query string, header or body field.

A guessed id from another tenant returns zero rows, reported as **404, not
403**. A 403 would confirm the record exists.

> **Tests** · `packages/db/src/tenancy.test.ts` — cross-tenant reads by exact
> id, soft-delete visibility, cascade behaviour. Every module test file also
> asserts 404 for another tenant's row, on read, update and delete.

### Function-level authorization

Every route declares its permission:

```ts
app.get('/', { preHandler: app.requirePermission('client:read') }, ...)
```

Deny by default: a permission absent from a role's set is denied, and an unknown
permission string is denied. There is no wildcard branch — even `owner` is
defined by enumeration.

> **Tests** · `packages/shared/src/rbac.test.ts` asserts `viewer` holds no
> write permission at all, and that compensation is gated behind
> `employee:read_sensitive`. Module tests assert 403 per role per endpoint.

### Privilege escalation

A caller may assign only a role strictly below their own; only an `owner` may
mint or remove another `owner`; the last owner cannot be demoted or removed.

> **Tests** · `modules/organizations/organizations.test.ts` — six escalation
> attempts, including an admin promoting themselves.

### Foreign keys are not authorization

A foreign key proves a row exists, not that you own it. Every id arriving in a
body is checked with `assertBelongsToOrganization`, and every user id with
`assertActiveMember` — because `users` is a global table and a bare FK would
accept a stranger.

---

## A02 · Cryptographic Failures

| Concern | Answer |
| --- | --- |
| Passwords | Argon2id, 19 MiB / 2 iterations / parallelism 1, with a server-side pepper passed as Argon2's `secret` |
| Refresh tokens | Stored as SHA-256 hashes; the plaintext exists only in the client |
| API keys | Same — hashed, with a non-secret display prefix |
| Access tokens | HS256, short-lived, algorithm pinned at verification |
| In transit | TLS 1.2+ terminated at the edge; HSTS with preload in production |
| At rest | Managed-database encryption plus encrypted object storage |
| Secret comparison | `safeEqual` hashes both sides to a fixed length and uses `timingSafeEqual` |

The pepper matters and is easy to skip: it lives in the secret manager, not the
database, so a stolen dump alone is not crackable.

> **Tests** · `apps/api/src/lib/password.test.ts` parses a produced hash and
> asserts the `$argon2id$v=19$m=19456,t=2,p=1$` prefix, so a silent downgrade of
> the work factor fails the build. It also asserts a hash is useless under a
> different pepper.

See [encryption](encryption.md).

---

## A03 · Injection

**SQL.** Drizzle parameterises everything. No query is built by string
concatenation. The `sql` template tag interpolates as parameters, not text.

**Search patterns.** User input going into `ILIKE` is escaped, so a search for
`100%` does not match every row. Not a SQL-injection fix — the value is already
parameterised — but a correctness one.

**Command injection.** No shell is invoked anywhere in the application.

**Path traversal.** Storage keys are generated server-side and never derived
from a filename. `resolveSafe` in the local storage driver refuses a resolved
path outside the root rather than sanitising and continuing.

**Prompt injection.** Treated as a first-class injection category — see
[prompt engineering](../05-ai/prompt-engineering.md) and A01 above for why the
defence is RBAC rather than phrasing.

> **Tests** · `clients.test.ts` asserts a `%` search term is treated literally.
> `documents.test.ts` asserts a traversal filename never produces a path
> separator in the stored record. `ai.test.ts` feeds an injection payload and
> asserts no tool widens.

---

## A04 · Insecure Design

Design-level choices, not bugs:

- **Immutable issued invoices.** Corrections go through void and re-issue, so
  both documents survive. No amount of input validation substitutes for this.
- **Separation of duties.** The person who files an expense cannot approve it.
- **Gapless invoice numbering** via a transactionally locked counter, because
  `MAX+1` races and a sequence leaks gaps.
- **Soft deletes** on everything financial, so an audit trail cannot be removed
  by deleting the row it describes.
- **Write tools that do not write.** The agent proposes; a person confirms.
- **Derived over stored** for anything time-dependent (`overdue`,
  `balance_due`, every analytics figure), so it cannot go stale.

---

## A05 · Security Misconfiguration

**Boot-time validation.** Configuration is parsed and validated at startup, and
a production deployment that still carries a `.env.example` placeholder secret,
or has `DATABASE_SSL=false`, **refuses to start**. Failing at boot is far better
than failing at 3am on the first login.

**Error disclosure.** Typed failures answer with a code and, for validation, the
specific fields. Everything else is logged in full and answered with a bare 500
plus a request id. No stack traces, SQL fragments or driver messages reach a
client.

**Headers.** helmet with a null CSP on the API (it serves JSON, so nothing may
load or execute), `frame-ancestors 'none'`, `nosniff`, `no-referrer`, and HSTS
in production only.

**CORS.** An explicit allow-list, never a reflected `Origin`.

**Docs.** The interactive console is disabled in production.

**Containers.** Non-root user, multi-stage build, no dev dependencies in the
runtime image, `CMD` exec'ing node directly so the process receives SIGTERM.

> **Tests** · `auth.test.ts` asserts the structured 404 shape and that a request
> id is echoed. The config schema's `superRefine` is what enforces the boot
> checks.

---

## A06 · Vulnerable and Outdated Components

- `npm ci` from a committed lockfile, so builds are reproducible.
- `npm audit --audit-level=high` in CI. Gated at high deliberately: blocking
  every build on a moderate advisory in a dev-only transitive dependency trains
  people to ignore the check, which is worse than not having it.
- Dependabot weekly, grouped into one production and one development PR —
  a dozen separate patch bumps a week is how dependency PRs start getting
  rubber-stamped.
- CodeQL on push and weekly, because a new rule can find a bug in code that has
  not changed.

---

## A07 · Identification and Authentication Failures

| Concern | Answer |
| --- | --- |
| Weak passwords | 12-character minimum, 128 maximum. **No composition rules** — they push people toward `Password1!` and measurably reduce entropy |
| Brute force | Per-account lockout with growing backoff after 8 failures, plus a tight rate limit |
| User enumeration | Identical response and comparable timing for unknown email and wrong password; a locked account is indistinguishable from a wrong one |
| Session fixation | A new token family per login |
| Token theft | Rotation with replay detection — a spent token revokes the family |
| Revocation | Membership re-read per request, so removal or demotion takes effect immediately |
| Password change | Revokes every other session |

**Gap:** no MFA. This is the largest single authentication gap and the next
piece of work — TOTP for `owner` and `admin` first.

> **Tests** · `auth.test.ts` — 26 tests including identical-error assertions,
> lockout, replay detection, cross-key token rejection and session revocation on
> password change.

See [authentication](authn.md).

---

## A08 · Software and Data Integrity Failures

- No dynamic code loading. No `eval`, no remote scripts.
- CI builds from a lockfile; images are built in CI, not on a laptop.
- Migrations travel inside the API image, so the version that applies them is
  the version tested against them.
- CI fails if the Drizzle schema has drifted from the committed migrations.
- Uploads are validated by content sniffing, not by their declared type.

**Gap:** no artifact signing or SBOM. The next step for supply-chain integrity.

---

## A09 · Security Logging and Monitoring Failures

**Every state change writes an audit row**, in the same transaction as the
change. An audit trail written after a successful commit — which can then fail —
is not an audit trail.

Rows carry the actor, the action, the resource, a redacted before/after pair,
the request id, the IP and the user agent. **Denied attempts are recorded too**,
with `succeeded: false`; those are usually the interesting rows.

Structured JSON logs with redaction configured at the sink, so an incautious
`log.info({ req })` still cannot emit an `Authorization` header.

The request id ties a user's complaint to a log line and an audit row.

Specifically logged: permission denials, refresh replay, login lockout, document
downloads, and AI token usage per message.

**Gap:** no alerting is wired up — see [monitoring](../04-infrastructure/monitoring.md)
for what should fire.

---

## A10 · Server-Side Request Forgery

Low surface: the application makes exactly two outbound calls, both to
configured hosts — the model provider and, in future, object storage. No
user-supplied URL is ever fetched.

The one URL-shaped field a user can set (`clients.website`) is stored and
displayed, never fetched server-side.

If a webhook or a "fetch this URL" feature is ever added, it needs an explicit
allow-list, DNS rebinding protection, and a block on private address ranges.
Writing that down now is cheaper than remembering it later.
