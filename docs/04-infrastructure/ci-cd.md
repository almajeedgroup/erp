# CI/CD

What the pipeline does, and what each gate is actually protecting against.

Defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Continuous integration

Every push, every pull request. Five jobs in parallel, each named so a failure
identifies itself in the check list rather than hiding inside one long log.

### `verify` — format, lint, typecheck, test

The same commands a developer runs locally (`npm run verify`). If CI runs
something different from what a developer can run, CI becomes an oracle people
argue with rather than a tool they use.

```
npm run format:check   # Prettier
npm run lint           # ESLint
npm run typecheck      # tsc -b, plus a project covering the tests
npm run test           # 294 tests, with coverage
```

**No database service is declared**, deliberately. The suite runs against PGlite
— Postgres compiled to WebAssembly, in-process — so there is no container to
wait for and no port to race on. That removes the most common source of CI
flakiness. See [ADR-0004](../02-architecture/adr/0004-pglite-for-tests.md).

Formatting is a separate step from linting because "you have a formatting error"
and "you have a code smell" are different problems with different fixes.

### `migrations` — the one job that needs a real server

PGlite is genuinely Postgres, but not the exact build production runs. This job
closes that gap, against `pgvector/pgvector:pg17` — the same image as
production:

1. Apply the committed migrations through the real node-postgres driver
2. **Apply them again.** Idempotence is not decorative: a deploy that restarts
   mid-migration, or two replicas starting together, must not break the database
3. Seed the demo data, which exercises every service in sequence
4. **Drift check.** `drizzle-kit generate` writes a migration only when the
   schema has changed, so a new file here means someone edited the Drizzle schema
   without generating the migration to match — a failure that would otherwise
   only appear at deploy time

That fourth step is the one worth stealing. Schema drift is invisible until it
is an outage.

### `build-web` — the Next.js build

`next build` type-checks the application as part of building it, which is why
the web app is not in the root TypeScript project references. Running both would
type-check it twice.

### `docker` — both images build

With GitHub Actions layer caching. Catches a Dockerfile that references a file
the `.dockerignore` excludes, or a build step that only works because of
something in the developer's working tree.

### `audit` — dependency advisories

`npm audit --audit-level=high`.

Gated at high deliberately. Blocking every build on a moderate advisory in a
dev-only transitive dependency trains people to ignore the check, which is worse
than not having it. Moderate advisories are handled by Dependabot at a
sustainable cadence.

## Concurrency

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

A new push supersedes the run in flight for the same branch — no point burning
minutes on a commit nobody is waiting for. Except on `main`, where every
commit's result is worth keeping.

## Permissions

```yaml
permissions:
  contents: read
```

Declared explicitly, because the default token is more powerful than most jobs
need. CodeQL adds `security-events: write` because it must.

## Continuous deployment

Not implemented in this repository, and the reason is honest: the right shape
depends on the platform, and a half-finished deployment pipeline is worse than a
clear description of what needs to exist.

What it should do:

```
main is green
  ↓
build and push images, tagged with the commit SHA
  ↓
deploy to staging
  ↓
smoke test staging
  ↓
manual approval
  ↓
run migrations (a job, not the application)
  ↓
rolling deploy to production
  ↓
watch error rate and latency
  ↓  (if they degrade)
roll back
```

### Migrations and deployment

The ordering problem everyone hits.

During a rolling deploy, old and new code run simultaneously. So **every
migration must be compatible with the currently deployed code**, which means
expand-then-contract:

| Change | Wrong | Right |
| --- | --- | --- |
| Rename a column | `ALTER ... RENAME` | Add the new column, write both, backfill, switch reads, drop the old — across three releases |
| Add a required column | `NOT NULL` with no default | Add nullable, backfill, then add the constraint |
| Drop a column | Drop it | Stop reading it, ship, then drop it in the next release |
| Add an index | `CREATE INDEX` | `CREATE INDEX CONCURRENTLY` — the plain form locks writes |

The application supports `RUN_MIGRATIONS_ON_BOOT=true`, which suits a
single-service deployment: Drizzle takes an advisory lock, so replicas starting
together serialise rather than racing. At larger scale it moves to a release job
that runs before any new container takes traffic.

Migrations travel **inside** the API image, so the version that applies them is
always the version tested against them.

### Rollback

Code rolls back by redeploying the previous image tag. That is why images are
tagged with the commit SHA rather than `latest`.

**Migrations do not roll back**, and pretending otherwise is dangerous. A `down`
migration that drops a column also drops the data in it. The real strategy is
forward-only, additive migrations that are safe to leave in place if the code
that used them is rolled back.

That is why expand-then-contract matters: it is what makes the code rollback
safe.

## Branch protection

What should be configured on `main`:

- Require the CI checks to pass
- Require one approving review
- Require the branch to be up to date before merging
- Dismiss stale approvals on new commits
- No force pushes, no deletions
- `CODEOWNERS` review on the security-sensitive paths

The `CODEOWNERS` entries are chosen deliberately — `rbac.ts`, `tenancy.ts`, the
auth plugins, password and token handling, infrastructure and workflows. Those
are the files where a subtle change has consequences far beyond the diff.

## Secrets in CI

GitHub Actions secrets, masked in logs. The values visible in `ci.yml` are
clearly-labelled throwaways for an ephemeral service container that exists for
the length of one job.

Never `echo` a secret. Masking covers declared secrets; it does not cover a
value you derived from one.

## What is missing

- **No deployment pipeline**, as described above
- **No image signing or SBOM.** The next step for supply-chain integrity
- **No end-to-end browser tests in CI.** The application was verified end to end
  in a real browser during development, but that is not automated. Playwright
  against the demo profile would be a good addition, and the demo profile exists
  partly to make it easy
- **No performance regression testing.** No baseline to compare against yet
- **No canary or blue-green deployment.** Rolling with a health check is
  sufficient at this scale
