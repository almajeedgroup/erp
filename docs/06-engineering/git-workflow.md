# Git workflow

Git is the only record of *why* the code is the way it is that survives people
leaving. Treat history as a document you are writing for someone who will read
it under pressure, at 3am, trying to work out which change broke production.

## Branches

`main` is always releasable. Every commit on it has passed the full pipeline,
and the container images built from it are deployable without further thought.

Everything else is a short-lived branch off `main`:

```
feat/invoice-credit-notes
fix/aging-bucket-boundary
chore/bump-fastify
docs/threat-model
```

Short-lived means days, not weeks. A branch that lives for three weeks is not a
branch, it is a fork, and merging it is an event rather than a routine. If a
change is genuinely large, land it in pieces behind a flag rather than
accumulating it off to one side.

## Commits

Conventional Commits, because the prefix makes `git log --oneline` scannable and
because it lets a release note be generated rather than remembered:

```
feat(finance): add credit notes against issued invoices
fix(analytics): correct the 31-60 day receivables bucket boundary
refactor(db): move the tenant predicate into a single helper
docs(security): map OWASP A01 to the route-level permission check
test(ai): cover retrieval when a document has no chunks
chore(deps): bump drizzle-orm to 0.45.2
```

Scopes match the code: `shared`, `db`, `api`, `web`, plus module names
(`finance`, `ai`, `clients`) where the change is module-local.

**The body says why.** The diff already says what. A good body answers: what was
the observed problem, what did you consider, why this fix. The
`fix(analytics)` commit above should say that the boundary was computed with
`>` where the specification says `>=`, that 2026-02-10 → 2026-03-15 is 33 days
and therefore `31-60`, and that the test asserting `61-90` was wrong rather than
the implementation. That paragraph is worth more than any comment in the file,
because it is attached to the change forever.

**One logical change per commit.** A commit that renames a variable *and* fixes
a boundary condition cannot be reverted, cherry-picked or bisected cleanly.
`git add -p` is the tool for splitting work you have already done.

**Never commit a secret.** Not in a test fixture, not "temporarily", not in a
`.env` you meant to delete. `.gitignore` covers `.env`; `.env.example` and
`.env.demo` hold deliberately fake values and say so. If one does land,
rotating the secret is the fix — rewriting history only removes it from the
default view, and by then it is in someone's clone and probably in a scanner's
index. See [secrets management](../03-security/secrets-management.md).

## Before you push

```bash
npm run verify
```

`format:check → lint → typecheck → test`, the same four commands CI runs, in the
same order. Pushing something that fails CI costs a cycle of everyone's
attention and trains people to ignore red builds.

Read your own diff first: `git diff main...HEAD`. Debug logging, a commented-out
block, a `.only` on a test — they are obvious in a diff and invisible in an
editor.

## Pull requests

**Small.** Under ~400 lines of non-generated change is reviewable; past that,
review quality falls off a cliff and approval becomes a formality.

**The description answers three questions.** What changed, why, and how you know
it works. "How you know" means naming the test, or the manual steps and what you
observed — not "tested locally".

**Link the reasoning.** If the change follows from an ADR, link it. If it
*contradicts* one, the PR that changes the behaviour is the PR that supersedes
the ADR; do not leave the two disagreeing.

**Docs change in the same PR.** This repository's documentation names files and
tests. That only stays true if a behaviour change and its page move together —
which is the rule stated at the top of [the docs index](../README.md).

### Review

Reviewers look for, roughly in this order:

1. **Tenancy** — does every new query go through `scope()`?
2. **Authorization** — does every new route declare a permission, and is it the
   right one? Can a lower role reach data it should not?
3. **Money** — integer minor units throughout, no float, no inline arithmetic.
4. **Errors** — `AppError` with a code, no internal detail in the response.
5. **Tests** — does a test fail if the change is reverted? A test that passes
   both ways is documentation, not a test.
6. Then the ordinary things: naming, duplication, readability.

Approving means "I would be comfortable being paged for this". Say so with the
approval if you looked at one part only.

## Merging

**Squash merge** into `main`. The branch's intermediate commits ("wip", "fix
lint", "actually fix lint") are a working record, not a historical one; the
squashed commit is what future readers bisect. Write its message properly at
merge time rather than accepting the default concatenation.

**Merge `main` into your branch to resolve conflicts, do not rebase a shared
branch.** A rebase rewrites commits someone else may have checked out. On a
branch only you have touched, rebase freely.

## Releases

Tag `main`: `v0.3.0`, semver.

- **Patch** — bug fixes, no contract change.
- **Minor** — additive API changes. A new optional field, a new endpoint.
- **Major** — anything that breaks a client: a removed field, a narrowed type, a
  changed status code, a renamed error code.

The API is versioned in the path (`/api/v1`), so a genuinely breaking change
gets `/api/v2` running alongside rather than a flag day. See
[API design](../02-architecture/api-design.md).

Migrations are the thing that makes rollback hard. A release containing a
destructive migration cannot be rolled back by redeploying the previous image —
which is why migrations are written to be backwards-compatible with the previous
release in two steps (add the column and write to both; remove the old one a
release later). [The runbook](../07-operations/runbook.md) covers the procedure.

## CI as a contract

`.github/workflows/ci.yml` runs five jobs on every push: verify, build-web,
migrations against real Postgres, container image builds, and a dependency
audit. The migrations job also applies the migrations *twice* to prove
idempotence, and runs `drizzle-kit generate` afterwards to fail the build if the
Drizzle schema was edited without a matching migration being committed.

That last check exists because the failure it prevents — schema and migrations
drifting apart — surfaces at deploy time, in production, on someone else's
shift.
