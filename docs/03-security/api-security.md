# API security

The controls at the HTTP boundary. None of them replace authorization — they
remove whole classes of problem so the interesting controls have less to defend.

Implemented in [`apps/api/src/plugins/`](../../apps/api/src/plugins/) and
[`apps/api/src/server.ts`](../../apps/api/src/server.ts).

## Input validation

Zod on every body, query string and path parameter, with **strict objects**.

```ts
export const createClientSchema = z.strictObject({
  name: shortText,
  status: clientStatusSchema.default('lead'),
  // ...
});
```

An unexpected key is a 422, not a silently ignored field. That is what makes
mass assignment unreachable: a client cannot smuggle `{"role":"owner"}` into a
profile update, because the schema for that route has no `role` key at all and
the request is rejected before a handler runs.

Every string has a maximum length, every number a range, every array a bound.
Unbounded input is a denial-of-service vector before it is anything else.

Ids are validated by kind. A `prj_...` supplied where a client id belongs is a
422 from the route schema, so it never reaches a query.

## Output validation

Responses are validated against their declared schema too. A handler returning
the wrong shape is a 500 with a loud log line rather than a subtly wrong payload
a client discovers in production.

It also means the OpenAPI document cannot drift: both it and the runtime
validation come from the same Zod schema.

## Rate limiting

Keyed on the authenticated principal where there is one, and the IP otherwise:

```ts
keyGenerator: (request) => request.auth ? `user:${request.auth.userId}` : `ip:${request.ip}`
```

IP alone punishes everyone behind one corporate NAT for a single noisy client.
Principal alone leaves the login endpoint — the one that most needs a limit —
unprotected, because there is no principal yet.

| Scope | Default | Why |
| --- | --- | --- |
| Global | 300 / minute | Ordinary API traffic |
| `/auth/login`, `/auth/refresh`, `/auth/change-password` | 10 / 15 minutes | Credential stuffing is the attack that actually happens |
| `/auth/register` | 5 / hour | Each one creates a tenant |
| `/ai/chat` | 30 / minute | Costs money per call; this is a spend control as much as an abuse control |

All operator-tunable. `/health` and `/ready` are never limited — a rate-limited
health check turns a traffic spike into an outage.

The current limiter is in-memory, so with multiple replicas the effective limit
is the configured value times the replica count. Acceptable at one or two
replicas; beyond that it needs a shared store, and the plugin supports Redis.

## Security headers

helmet, with a policy suited to a JSON API:

```ts
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'none'"],      // this service answers JSON; nothing may load
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
},
xContentTypeOptions: true,        // no MIME sniffing
referrerPolicy: { policy: 'no-referrer' },
crossOriginResourcePolicy: { policy: 'same-site' },
hsts: production ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
```

A null CSP on an API is not decorative. If a response is ever coerced into being
rendered as HTML, this is what stops it doing anything.

HSTS is production-only — sending it in development pins `localhost` to HTTPS in
the browser and produces a confusing afternoon.

The web tier has its own, necessarily looser, policy — see
[`apps/web/next.config.ts`](../../apps/web/next.config.ts). It relaxes
`unsafe-eval` in development only, where React's development build needs it;
loosening it globally to quieten a dev console is how a real CSP gets thrown
away.

## CORS

An explicit allow-list, never a reflected `Origin`:

```ts
origin: (origin, callback) => {
  if (!origin) return callback(null, true);   // curl, server-side fetch, probes
  callback(null, allowedOrigins.has(origin));
}
```

Reflecting whatever arrives is functionally `origin: *` with credentials, which
browsers reject anyway — but the reflex to "just make CORS work" is how it gets
written.

Because the browser never calls the API directly
([ADR-0007](../02-architecture/adr/0007-bff-session-cookies.md)), the allow-list
has one entry and CORS is close to irrelevant here. That is the point: the
architecture removed the problem rather than configuring around it.

## Request correlation

Every request gets an id — an inbound `x-request-id` if present and plausible,
otherwise a generated one. It is echoed in the response header, included in
every log line, stored on every audit row, and returned in every error body.

A user quotes an id from an error message and an operator finds the exact log
line and audit row. That is the whole debugging story, and it costs almost
nothing.

An inbound id is length-capped before it is trusted, so it cannot be used to
inject into a log line.

## Body limits

| Limit | Value |
| --- | --- |
| JSON body | 1 MiB |
| File upload | 25 MiB, enforced **while reading** |
| Multipart fields | 20 fields, 8 KiB each |
| Page size | 100 |

Enforcing the upload limit while reading rather than after buffering is the
difference between a limit and a suggestion.

## Errors

Typed failures answer with a stable code and, for validation, the specific
fields. Everything else is logged in full — stack, cause chain, route — and
answered with a bare 500 plus the request id.

Stack traces, SQL fragments and driver messages in an HTTP response are a
reconnaissance gift. "Security Misconfiguration" in the OWASP Top 10 is mostly
this mistake.

## Proxy trust

`trustProxy` is enabled only in production, where a proxy is actually in front.

Trusting it unconditionally lets any client spoof `X-Forwarded-For`, which
defeats both rate limiting and the audit trail's idea of who did what.

## Documentation endpoints

The interactive console is served in development only. In production the raw
OpenAPI document remains available at `/openapi.json` so clients can still be
generated, but an interactive console against a system holding payroll is not
something to leave on by accident.

## What is not here

**No API gateway.** Rate limiting, authentication and validation are in the
application. A gateway adds a place to enforce them earlier, and a place for
policy to disagree with the application.

**No mutual TLS between services.** Worth it when the network is not trusted.

**No request signing.** Bearer tokens over TLS are appropriate for first-party
clients. A public API with third-party integrations would want HMAC-signed
requests with a timestamp and nonce.

**No idempotency keys.** See
[API design](../02-architecture/api-design.md#idempotency) — the gap is real and
described honestly there.
