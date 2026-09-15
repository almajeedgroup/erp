# ADR-0001 · A TypeScript monorepo

**Status:** Accepted · **Date:** 2026-01

## Context

The product needs an HTTP API, a web application, a shared domain model and a
database layer. A small team has to maintain all of it.

The single largest source of defects in a system like this is drift between
layers: the API starts returning `dueDate` as a timestamp, the web app still
expects a date, and nothing catches it until a user sees "Invalid Date". The
second largest is duplicated validation — the same rule written twice, in two
languages, diverging quietly.

## Decision

One language, TypeScript, across the API and the web application, in a single
npm-workspaces monorepo. Shared domain logic lives in `@almajeed/shared` and is
imported by both.

Four workspaces:

```
packages/shared    Framework-free: ids, money, errors, RBAC, validation schemas
packages/db        Drizzle schema, migrations, tenant scoping
apps/api           Fastify service
apps/web           Next.js application
```

## Consequences

**Good.** One definition of a client, a role, an invoice line. A field removed
from a response is a compile error in the web app rather than a blank cell. One
toolchain, one lint config, one test runner, one CI pipeline. A change spanning
schema, API and UI is one commit and one review, atomically.

**Bad.** TypeScript is not the best language for everything. Numeric and
data-processing work is more natural in Python, and if this product grows a
serious forecasting or ML component, that component should be Python and talk
over HTTP rather than be forced into this repository.

**Bad.** A monorepo needs discipline about layering, or `shared` accumulates
framework imports and stops being shareable. Enforced by convention and review:
`shared` imports nothing from the workspace, `db` knows nothing about HTTP.

**Bad.** Build order matters. `shared` must be built before `db`, which must be
built before `api`. Handled by TypeScript project references and an explicit
`build:packages` script; the test suite sidesteps it entirely by aliasing the
workspace packages to their source.

## Alternatives considered

**Separate repositories per service.** Rejected: it converts every cross-cutting
change into a coordinated multi-repo release, and it makes the shared domain
model a published package with a version number — which means two versions of
"what a client is" can be live at once, which is the problem we were solving.

**Python backend, TypeScript frontend.** Python is a better fit for the AI and
analytics work, and FastAPI plus Pydantic is a genuinely good stack. Rejected
because it duplicates the domain model across two languages, and every schema
change becomes two changes that can disagree. The AI work here is
orchestration — prompts, tools, retrieval — not numerical computing, and
orchestration is fine in TypeScript.

**Go for the API.** Excellent for a service like this: fast, low memory, easy to
deploy. Rejected for the same reason — it splits the domain model, and the team
maintaining this is small.

**A build orchestrator (Nx, Turborepo).** Real value on a large monorepo with
many packages and slow builds. Rejected as premature at four workspaces, where
`tsc -b` plus a few npm scripts is the entire build system and has no
configuration to learn.
