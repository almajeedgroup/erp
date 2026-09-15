# Architecture decision records

Short documents recording a decision that was hard to make and would be hard to
reverse, written at the time it was made.

The value is not the decision — that is visible in the code. It is the
**alternatives that lost and why**, so that in a year someone with a good idea
can tell whether it was already considered, and so that when a constraint
changes the decision can be revisited deliberately rather than drifted away
from.

Format: context, decision, consequences, and the alternatives with the reason
each was rejected. Status is `Accepted` until something supersedes it.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-typescript-monorepo.md) | A TypeScript monorepo, one language end to end | Accepted |
| [0002](0002-shared-schema-multi-tenancy.md) | Shared schema multi-tenancy with mandatory scoping | Accepted |
| [0003](0003-integer-minor-units-for-money.md) | Money as integer minor units, never a decimal type | Accepted |
| [0004](0004-pglite-for-tests.md) | Test against in-process Postgres, not mocks or containers | Accepted |
| [0005](0005-embeddings-as-jsonb.md) | Embeddings as JSONB with app-side cosine, not pgvector | Accepted |
| [0006](0006-keyset-pagination.md) | Keyset pagination everywhere, no OFFSET | Accepted |
| [0007](0007-bff-session-cookies.md) | Tokens in httpOnly cookies behind a backend-for-frontend | Accepted |
| [0008](0008-agent-tools-as-api-callers.md) | Agent tools are callers of the same services, with the same permissions | Accepted |
