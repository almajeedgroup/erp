# Secrets management

Where secrets live, how they get to the process, how they rotate, and the ways
they leak.

## The inventory

| Secret | Purpose | Blast radius if leaked |
| --- | --- | --- |
| `JWT_SECRET` | Signs access tokens | **Total.** Forge a token for any user in any organization |
| `PASSWORD_PEPPER` | Mixed into every password hash | With a database dump: offline cracking becomes feasible |
| `DATABASE_URL` | Database credentials | Every tenant's data |
| `ANTHROPIC_API_KEY` | Model provider | Spend, and whatever is sent in prompts |
| `S3_SECRET_ACCESS_KEY` | Object storage | Every stored document |

Two of these are catastrophic on their own. That is worth knowing before
deciding where to put them.

## Where they live

**Never in the repository.** `.gitignore` excludes `.env` and `.env.*`, with two
deliberate exceptions: `.env.example`, which contains placeholders, and
`.env.demo`, whose values are fake by construction and only ever point at an
in-memory database.

**Never in an image.** `.dockerignore` excludes `.env` files. A secret baked
into a layer is in the registry, in every pull, and in every developer's cache.

**Never in an environment variable in a CI log.** GitHub Actions masks declared
secrets, but a script that echoes one defeats that.

**In production:** a secret manager — AWS Secrets Manager, GCP Secret Manager,
Azure Key Vault, or Kubernetes Secrets backed by one. Injected as environment
variables at start, or mounted as files.

**In development:** a local `.env`, copied from `.env.example`. It contains
nothing that matters, because a developer's database contains seed data.

## How the application reads them

Once, at boot, validated:

```ts
const config = loadConfig();   // apps/api/src/config/env.ts
```

Nothing else in the codebase reads `process.env`. That has three consequences
worth the constraint: the server is constructible in a test with an explicit
config object; every secret the process needs is visible in one schema; and a
missing or malformed value stops the container from starting rather than
surfacing as a 500 at 3am on the first login.

Production additionally refuses to start if `JWT_SECRET` or `PASSWORD_PEPPER`
still carries the `.env.example` placeholder, or if `DATABASE_SSL` is false. A
deployment that boots with the sample key is worse than one that refuses to
boot.

## Generating them

```bash
openssl rand -base64 48
```

Minimum 32 characters, enforced by the schema. Never derived from a passphrase,
never reused between environments, never reused between secrets.

## Rotation

| Secret | Cadence | Procedure | User impact |
| --- | --- | --- | --- |
| `JWT_SECRET` | Quarterly, or on suspicion | Update, rolling restart | Access tokens invalid; refresh recovers silently |
| `PASSWORD_PEPPER` | **Only on compromise** | Update, then force a password reset for everyone | Everyone must reset. A break-glass control |
| `DATABASE_URL` | Quarterly | Create a new role, update, restart, drop the old role | None if rolled correctly |
| `ANTHROPIC_API_KEY` | Quarterly, or on suspicion | Create new, update, revoke old | None |
| TLS certificates | Automated, 90 days | ACME | None |

Zero-downtime `JWT_SECRET` rotation needs the verifier to accept both the old and
new key for one access-token lifetime. Not implemented — today a rotation
invalidates current access tokens, which recover silently via refresh. That is
acceptable; if it stops being, add a `JWT_SECRET_PREVIOUS` and try both.

## How secrets leak

The interesting part, because these are the routes that actually get used.

**Logs.** The most common. Prevented by configuring redaction at the pino sink
rather than at call sites, so it applies even to an incautious
`log.info({ req })`:

```ts
redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'password',
          'passwordHash', 'token', 'accessToken', 'refreshToken',
          'nationalId', 'bankAccount', /* ... */],
  censor: '[redacted]',
}
```

Redaction at the sink is the only version that actually holds.

**Error responses.** Prevented by the error boundary: typed failures answer with
a code, everything else is a bare 500.

**The audit log.** Prevented by redacting snapshots before storage.

**Git history.** A committed secret is in every clone forever; rewriting history
does not help once it has been pushed. If it happens: rotate the secret first,
then worry about the history. Secret scanning on the repository catches the
common shapes.

**A crash dump or heap snapshot.** Contains everything in memory, including the
JWT secret. Treat dumps as secrets.

**A developer's machine.** The reason development secrets are worthless: a
compromised laptop yields nothing.

## What is in the repository on purpose

`.env.demo` is committed, with values like
`demo-only-jwt-secret-not-for-production-use`.

That is safe and deliberate: it configures an in-memory database that exists for
the lifetime of one process, seeded with fictional data, and the production
config validator rejects placeholder-shaped secrets outright. The alternative —
a demo that requires manual setup — means the demo does not get used, which
costs more than it saves.

## Secrets in CI

GitHub Actions secrets, referenced as `${{ secrets.NAME }}`. The values in
`ci.yml` are clearly-labelled throwaways for an ephemeral service container.

Workflows declare `permissions: contents: read` explicitly, because the default
token is more powerful than most jobs need.

## What is missing

- **No automated rotation.** Rotation is a documented manual procedure. The
  managed secret managers all support scheduled rotation with a Lambda or
  equivalent; wiring it up is the next step.
- **No envelope encryption for application-level secrets.** Not needed while the
  platform's secret manager holds them.
- **No secret scanning in the pre-commit hook.** Repository-level scanning
  catches pushes; catching it before the commit is better.
