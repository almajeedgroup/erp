# Module map

Eight modules. The arrows are dependencies: a module points at what it reads
from. Nothing points back up, which is what keeps the graph a graph.

```
                    ORGANIZATION
              (tenancy, members, audit)
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
     CLIENTS          EMPLOYEES          TASKS
        │                 │                 │
        └────► PROJECTS ◄─┘                 │
                  │  ▲                      │
                  │  └──────────────────────┘
                  ▼
               FINANCE
          (invoices, payments,
              expenses)
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   ANALYTICS            DOCUMENTS
        │                   │
        └────► AI AGENT ◄───┘
```

## What each module owns

| Module | Owns | Key invariant |
| --- | --- | --- |
| [Organization](../02-architecture/multi-tenancy.md) | Tenants, users, memberships, roles, the audit log | An organization always has at least one owner |
| [Clients](08-modules/clients.md) | Client accounts and their contacts | Cannot be deleted while active projects or unpaid invoices reference it |
| [Projects](08-modules/projects.md) | Projects, assignments, time entries | Invoiced time is immutable |
| [Employees](08-modules/employees.md) | People, employment, compensation | Sensitive fields are stripped, not hidden |
| [Finance](08-modules/finance.md) | Invoices, lines, payments, expenses | A draft is editable; an issued invoice is not |
| [Documents](08-modules/documents.md) | Files and their metadata | The stored content type comes from the bytes, not the request |
| [Tasks](08-modules/tasks.md) | Work items and comments | `completedAt` is a consequence of status, never an input |
| [Analytics](08-modules/analytics.md) | Derived metrics only | Owns no tables; every figure defined exactly once |
| [AI agent](08-modules/ai-agent.md) | Conversations, messages, retrieval chunks | Tools run as the caller, with the caller's permissions |

## Why the arrows point this way

**Clients and Employees do not know about each other.** A client is a
counterparty; an employee is a person on the payroll. The only place they meet
is a project, which is exactly where the business question lives ("who worked on
what, for whom").

**Projects is the hub.** Time, expenses, invoices and tasks all reference a
project. That makes profitability a single join rather than a reconciliation,
which was the whole point.

**Finance reads Projects, not the reverse.** An invoice knows its project; a
project does not track its invoices as a field. The relationship is queried,
not stored, so it cannot go stale.

**Analytics owns no tables.** It is pure derivation over the others. The moment
it owns a table, there are two sources of truth for revenue and they will
disagree — see [analytics](08-modules/analytics.md) for the definitions it is
the sole owner of.

**The AI agent sits at the bottom.** It reads from everything and writes to
nothing except its own conversation history. It is a *caller* of the same
service functions an HTTP request uses, with the same organization scope and the
same permission checks — not a second path into the database. That placement is
the whole security argument; see [agents](../05-ai/agents.md).

## Where the code lives

```
packages/shared/     Domain core: ids, money, errors, RBAC, validation schemas
packages/db/         Drizzle schema, migrations, tenant scoping
apps/api/            Fastify service — one directory per module
apps/web/            Next.js application — one route per module
```

A module in `apps/api/src/modules/<name>/` is consistently:

| File | Responsibility |
| --- | --- |
| `service.ts` | Business rules. Takes a `RequestContext`, never an HTTP request |
| `routes.ts` | HTTP shape: paths, schemas, permissions, status codes |
| `<name>.test.ts` | Integration tests through the real server |

The split matters: because services never see a Fastify request, they cannot
accidentally read the organization id from a path parameter instead of the
verified token, and they are callable from a background job, a CLI script or
the agent's tool layer with no HTTP involved.

## Adding a module

1. Tables in `packages/db/src/schema/`, with `organization_id` and the
   `(organization_id, created_at desc, id desc)` index every listable table has.
2. `npm run db:generate` and commit the migration.
3. Validation schemas in `packages/shared/src/domain/`, strict objects so
   unknown keys are rejected.
4. Permissions in `packages/shared/src/rbac.ts`, added to each role that should
   hold them. The matrix is the policy; there is no wildcard.
5. `service.ts` using `paginate`, `findByIdOrThrow` and `scope` — never a
   hand-written `organization_id` comparison.
6. `routes.ts` with `app.requirePermission(...)` on every route.
7. Tests, including at least one that reads another tenant's row by its exact id
   and expects 404.
8. A page in `docs/08-modules/`.
