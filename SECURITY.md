# Security policy

## Reporting a vulnerability

Email **security@almajeed.example** with enough detail to reproduce the issue.
Please do not open a public issue for a security report.

We aim to acknowledge within two working days and to give a remediation
timeline within five. If you would like credit in the release notes, say so and
we will include it.

Please do not run automated scanners against a production deployment, and do not
access, modify or retain data belonging to anyone else while investigating.

## Supported versions

The `main` branch is the supported version. This is a first-party application,
not a distributed library, so there are no maintained release branches.

## What we consider in scope

- Authentication and session handling (`apps/api/src/modules/auth`)
- Authorization and tenant isolation (`packages/shared/src/rbac.ts`,
  `packages/db/src/tenancy.ts`)
- Anything that lets one organization read or modify another's data
- Upload handling, and anything that could get a stored file executed
- Prompt injection that results in the AI agent exceeding the caller's own
  permissions — note that the agent's tools enforce RBAC independently, so a
  model that follows injected instructions should still reach nothing extra

## Out of scope

- Missing security headers on `/docs`, which is disabled in production
- Rate-limit thresholds, which are operator-configurable
- Reports generated solely by an automated scanner, with no demonstrated impact
- The deliberately weak secrets in `.env.demo`, which exist only for the
  in-memory demo profile

## How this codebase approaches security

The reasoning behind each control is written down rather than implied:

- `docs/03-security/owasp-top-10.md` — each Top 10 category and what answers it
- `docs/03-security/threat-model.md` — assets, actors, and what we are defending
- `docs/03-security/authn.md`, `authz-rbac.md` — the two hardest parts
