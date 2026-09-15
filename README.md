<div align="center">

# Al-Majeed ERP

**Clients, projects, employees, finance, documents, tasks, analytics and an AI
agent — in one system, with one definition of every number.**

[![CI](https://github.com/almajeedgroup/erp/actions/workflows/ci.yml/badge.svg)](https://github.com/almajeedgroup/erp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-3178c6.svg)](tsconfig.base.json)

</div>

---

## Try it in one command

```bash
git clone https://github.com/almajeedgroup/erp.git
cd erp && npm install && npm run demo
```

Open <http://localhost:3000>. No database to install, nothing to configure — the
API boots [PGlite](https://pglite.dev) (real PostgreSQL compiled to WebAssembly,
running in-process), applies the committed migrations and seeds a full
organization.

Sign in with password `correct horse battery staple` as any of:

| Email | Role | What changes |
| --- | --- | --- |
| `owner@almajeed.test` | owner | Everything |
| `finance@almajeed.test` | finance | Issues invoices, sees salaries, cannot restructure projects |
| `manager@almajeed.test` | manager | Runs delivery, reads invoices, cannot issue them |
| `engineer@almajeed.test` | member | Logs time, files expenses, sees no invoices |
| `auditor@almajeed.test` | viewer | Reads; writes nothing |

Signing in as each in turn is the fastest way to understand the system: the
navigation, the columns and the API responses all change, because permissions
are enforced at the route and rendered from the same grant matrix.

## The modules

```
                        ┌─────────────────┐
                        │  AL-MAJEED ERP  │
                        └────────┬────────┘
                                 │
        ┌────────────────┬───────┴────────┬────────────────┐
        │                │                │                │
   ┌────▼────┐     ┌─────▼─────┐   ┌──────▼──────┐         │
   │ CLIENTS │     │ PROJECTS  │   │  EMPLOYEES  │         │
   └────┬────┘     └─────┬─────┘   └──────┬──────┘         │
        │                │                │                │
        └────────────────┴───────┬────────┘                │
                                 │                         │
                          ┌──────▼──────┐                  │
                          │   FINANCE   │                  │
                          └──────┬──────┘                  │
                                 │                         │
                          ┌──────▼──────┐                  │
                          │  DOCUMENTS  │                  │
                          └──────┬──────┘                  │
                                 │                         │
                          ┌──────▼──────┐                  │
                          │    TASKS    │                  │
                          └──────┬──────┘                  │
                                 │                         │
                          ┌──────▼──────┐                  │
                          │  ANALYTICS  │◀─────────────────┘
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │  AI  AGENT  │
                          └─────────────┘
```

Each module has a page describing what it owns, its rules, its endpoints and
what it deliberately does not do:

[Clients](docs/08-modules/clients.md) ·
[Projects](docs/08-modules/projects.md) ·
[Employees](docs/08-modules/employees.md) ·
[Finance](docs/08-modules/finance.md) ·
[Documents](docs/08-modules/documents.md) ·
[Tasks](docs/08-modules/tasks.md) ·
[Analytics](docs/08-modules/analytics.md) ·
[AI agent](docs/08-modules/ai-agent.md)

## What makes it different

**Money is never a float.** Every amount is an integer count of minor units with
a currency. Quantities are thousandths, tax rates are basis points. Splitting
uses largest-remainder allocation, so the parts always sum to the whole.
[ADR-0003](docs/02-architecture/adr/0003-integer-minor-units-for-money.md)

**Tenant isolation has exactly one implementation.** Every read and write goes
through `scope()` in `packages/db/src/tenancy.ts`, which produces
`organization_id = $1 AND deleted_at IS NULL`. Nothing else may hand-write that
predicate — a scoping bug is not a bug, it is a cross-tenant breach, so there is
one place it can happen and that place is tested hard.
[Multi-tenancy](docs/02-architecture/multi-tenancy.md)

**Authorization is deny-by-default.** Six roles, 45 permissions, no wildcard —
even `owner` is defined by enumeration. Permissions are checked in a
`preHandler` before any route body runs, and membership is re-read every
request, so deactivating someone takes effect immediately.
[RBAC](docs/03-security/authz-rbac.md)

**Every number is defined once.** Revenue, profit, receivables, labour cost —
all in `metrics.ts`, called by the API, the dashboard and the AI agent alike.
Two dashboards disagreeing about "revenue" is the classic ERP failure, and one
definition is the only cure. [Analytics](docs/08-modules/analytics.md)

**The AI agent cannot exceed the user.** Its tools are ordinary callers of the
same services the HTTP routes use, carrying the same context and the same
permissions. A `member` asking about salaries gets what a `member` would get:
nothing. Not a filter on the output — an inability to fetch.
[ADR-0008](docs/02-architecture/adr/0008-agent-tools-as-api-callers.md)

**Tests need no Docker.** 294 tests against real PostgreSQL running in-process,
in about a minute, identically on a laptop and in CI.
[Testing](docs/06-engineering/testing.md)

## Architecture

```
Browser ──HTTPS──▶  Next.js 16 (BFF)  ──HTTP──▶  Fastify 5 API  ──▶  PostgreSQL 17
                    server components            stateless             │
                    httpOnly cookies             Zod + RBAC            │
                                                       │              │
                                                Object storage    embeddings
                                                (documents)       (JSONB)
                                                       │
                                                Model provider
```

Two stateless services and one database. Everything durable is in Postgres or
object storage; the API holds no session state and no cache, which is what makes
scaling a replica-count change.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript 5.9, NodeNext ESM | One language across API, web and shared domain |
| API | Fastify 5 + `fastify-type-provider-zod` | One Zod schema is validation, types **and** the OpenAPI document |
| Database | PostgreSQL 17 + Drizzle 0.45 | SQL you can read, types you cannot drift from |
| Web | Next.js 16, React 19, Tailwind 4 | Server components; the browser never holds a token |
| Auth | Argon2id + JWT + rotating refresh tokens | OWASP parameters, pinned by test; replay detection |
| Tests | Vitest + PGlite | Real Postgres, no container |
| AI | Provider interface, Anthropic or mock | Swappable, and the mock is the kill switch |

[System architecture](docs/02-architecture/system-architecture.md) ·
[Data model](docs/02-architecture/data-model.md) ·
[ADRs](docs/02-architecture/adr/)

## Development

```bash
make up          # Postgres via Docker
make migrate     # apply migrations
make seed        # demo data
make dev         # API on :4000, web on :3000
make verify      # format + lint + typecheck + test — what CI runs
make help        # everything else
```

```
packages/shared   Domain types, money, RBAC, Zod schemas. No I/O, no framework
packages/db       Drizzle schema, migrations, the tenancy helper, the test database
apps/api          Fastify server. Modules own routes + services
apps/web          Next.js App Router. Server components; a BFF for cookies
docs              Why the system is the way it is
infra             Dockerfiles
```

Dependencies point one way: `web → api (HTTP)`, `api → db → shared`.

API reference: `/docs` when the server is running (Swagger UI), or
`/openapi.json` in production.

[Getting started](docs/06-engineering/getting-started.md) ·
[Coding standards](docs/06-engineering/coding-standards.md) ·
[Git workflow](docs/06-engineering/git-workflow.md)

## Documentation

**[The full index is in `docs/`](docs/README.md)** — 74 pages, ~12,500 lines,
across nine sections.

| Section | Covers |
| --- | --- |
| [00 Overview](docs/00-overview/) | Vision, module map, glossary |
| [01 Business](docs/01-business/) | Business model, pricing, unit economics, cash flow, sales, contracts, fundraising, valuation |
| [02 Architecture](docs/02-architecture/) | System architecture, data model, API design, multi-tenancy, 8 ADRs |
| [03 Security](docs/03-security/) | Threat model, OWASP Top 10, authn, authz, encryption, secrets, cloud, privacy, pentest basics |
| [04 Infrastructure](docs/04-infrastructure/) | Linux, Docker, CI/CD, cloud, Postgres, BaaS, DNS/TLS, storage, monitoring, backups |
| [05 AI](docs/05-ai/) | Strategy, ML fundamentals, LLM integration, RAG, agents, vector databases, prompting, evaluation, fine-tuning, vision/speech, inference |
| [06 Engineering](docs/06-engineering/) | Getting started, standards, Git, testing, debugging, data structures & algorithms, system design |
| [07 Operations](docs/07-operations/) | Runbook, incident response, disaster recovery, service levels |
| [08 Modules](docs/08-modules/) | One page per module |

**Every claim in these pages points at a file or a test**, and where something is
not built, the page says so and explains what would need to be true to build it.
Aspirational documentation is the most expensive kind.

## Security

Report a vulnerability privately — see [SECURITY.md](SECURITY.md). Do not open a
public issue.

Highlights, each with its implementation named in
[the OWASP mapping](docs/03-security/owasp-top-10.md):

- Argon2id (19 MiB, t=2, p=1) with a pepper via Argon2's native `secret`
  parameter, and a real decoy hash so response timing does not reveal which
  accounts exist
- Refresh-token families with rotation and replay detection — a reused token
  revokes the whole family
- Uploads identified by magic bytes, not by the uploader's claim; unidentified
  bytes are rejected rather than guessed
- Strict CSP, HSTS, `nosniff`, sandboxed downloads
- Configuration that refuses to boot in production on placeholder secrets

## Status

Working software with an honest list of gaps. Each module page ends with a "Not
built" section; the largest are: no credit notes, no multi-currency conversion,
no virus scanning on uploads, no notifications, no automated tests for the web
app, and no load testing of any kind.

Nothing in this repository claims to be finished that is not.

## License

[MIT](LICENSE)
