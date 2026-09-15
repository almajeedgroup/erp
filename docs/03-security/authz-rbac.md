# Authorization and RBAC

Deciding what an authenticated caller may do. The policy lives in
[`packages/shared/src/rbac.ts`](../../packages/shared/src/rbac.ts), which is the
single source of truth — this page describes it, but the file is the policy.

## Two layers, both always on

**Tenant isolation** is not a permission. It is a property of the data-access
layer: every query is scoped by `organization_id` regardless of role. An `owner`
has no more cross-tenant visibility than a `viewer` — which is none. See
[multi-tenancy](../02-architecture/multi-tenancy.md).

**Permissions** are this page. A role maps to a fixed set of `resource:action`
grants, checked before a handler runs.

Both apply to every request. Neither substitutes for the other.

## Roles

Six, chosen to match how a services business is actually staffed rather than to
be maximally flexible.

| Role | Who | Shape of access |
| --- | --- | --- |
| `owner` | 1–2 people | Everything, including deleting the organization and managing owners |
| `admin` | Operations lead | Runs the organization day to day. Cannot delete it or demote an owner |
| `finance` | Accounting | Sees money everywhere, including compensation. Cannot restructure projects or people |
| `manager` | Delivery lead | Owns projects, tasks and time. Reads invoices, cannot issue them. Cannot see salaries |
| `member` | Individual contributor | Does the work, logs time, files expenses |
| `viewer` | Auditor, advisor, stakeholder | Read-only, everywhere they can see at all |

## Permissions

45 grants in `resource:action` form. The full matrix is the `GRANTS` constant;
the interesting rows:

| Permission | owner | admin | finance | manager | member | viewer |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `client:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `client:create` | ✓ | ✓ | | ✓ | | |
| `client:delete` | ✓ | ✓ | | | | |
| `employee:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `employee:read_sensitive` | ✓ | ✓ | ✓ | | | |
| `invoice:read` | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `invoice:issue` | ✓ | ✓ | ✓ | | | |
| `invoice:void` | ✓ | ✓ | ✓ | | | |
| `payment:record` | ✓ | ✓ | ✓ | | | |
| `expense:create` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `expense:approve` | ✓ | ✓ | ✓ | | | |
| `time_entry:approve` | ✓ | ✓ | | ✓ | | |
| `task:delete` | ✓ | ✓ | | ✓ | | |
| `analytics:read` | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `audit:read` | ✓ | ✓ | | | | |
| `ai:chat` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `member:update_role` | ✓ | ✓ | | | | |

Three deliberate shapes worth noting:

**A manager cannot see salaries.** `employee:read_sensitive` is finance and
above. A delivery manager needs to know who is available, not what they earn.

**A manager cannot issue invoices.** They can read them, so they know what has
been billed against their project, but issuing is finance's job. That is a
separation-of-duties boundary, not an oversight.

**A viewer cannot use the AI assistant.** The assistant costs money per call and
a viewer is usually an external party. The tools it would offer are read-only
anyway, so this is a spend decision rather than a data one, and it is the kind
of thing a customer might reasonably ask to change.

## Deny by default

```ts
export function can(role: Role | string, permission: Permission | string): boolean {
  if (!isRole(role) || !isPermission(permission)) return false;
  return GRANT_SETS.get(role)?.has(permission) ?? false;
}
```

An unknown role is denied. An unknown permission string is denied. There is no
wildcard branch — even `owner` is defined by enumerating every permission, so
adding a permission requires deciding, explicitly, which roles get it.

A test asserts that every permission a role holds exists in the catalogue, so a
typo in the matrix is a failing test rather than a silently dead grant.

## Where it is enforced

**Route level**, before a handler runs:

```ts
app.post('/', { preHandler: app.requirePermission('client:create') }, ...)
```

**Field level**, inside the single mapper every read path goes through:

```ts
function toEmployee(row: EmployeeRow, canSeeSensitive: boolean): Employee {
  const base = { /* ...safe fields... */ compensation: null, nationalId: null };
  if (!canSeeSensitive) return base;
  return { ...base, compensation: ..., nationalId: ... };
}
```

Putting it in the mapper rather than in each endpoint means a *new* endpoint
that returns an employee inherits the redaction automatically. There is no way
to add a route that forgets it without also bypassing `toEmployee`.

Writing a sensitive field requires the permission to **read** it. Otherwise
someone without `employee:read_sensitive` could set a salary they cannot see —
a data-integrity problem and an oracle: set a value, observe whether anything
changed.

**Business-rule level**, where the rule is about relationships rather than
resources:

- An expense cannot be approved by the person who filed it.
- A comment can only be deleted by its author.
- An AI conversation is readable only by the person who started it — same
  organization is not enough, because a colleague's chat history is not
  organizational data the way an invoice is.

## Privilege escalation

The classic hole. Three rules, in `canAssignRole`:

```ts
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'member:update_role')) return false;   // must hold the permission
  if (target === 'owner') return actor === 'owner';      // only an owner mints an owner
  return RANK[actor] > RANK[target] || actor === 'owner'; // strictly below your own
}
```

So an `admin` cannot create an `owner`, cannot promote anyone to `admin`, and
cannot promote themselves. Plus, in the service layer: the last remaining owner
cannot be demoted or removed, because an organization nobody can administer is
unrecoverable without operator intervention.

Six escalation attempts are tested explicitly.

## Revocation takes effect immediately

Removing a membership updates the row **and** revokes that member's refresh
tokens, in the same transaction. Because authorization re-reads the membership
on every request, their existing, still-unexpired access token stops working on
the next call rather than up to fifteen minutes later.

Tested: a member is working normally, is removed, and their next request is a
401 — and their refresh token cannot mint a new one.

## The agent inherits all of this

The AI agent's tools call the same service functions with the same
`RequestContext`, so they get the same permission checks. Tools the caller lacks
permission for are never offered to the model, and are re-checked at dispatch.

That is the reason a prompt-injection attack cannot escalate: the model's
beliefs are not an input to `can()`. See
[ADR-0008](../02-architecture/adr/0008-agent-tools-as-api-callers.md).

## Where this model runs out

RBAC is coarse. It cannot express "a manager may see projects they are assigned
to, but not others". Today a manager sees every project in their organization.

For a business of this size that is usually correct — people work across
projects and artificial walls create friction. When it stops being correct, the
answer is **relationship-based** checks layered on top of RBAC (the
`project_members` table already exists), not a rewrite into attribute-based
access control. Start with the one resource that needs it rather than
generalising.

The other known limit: permissions are not customisable per organization. A
customer who wants a seventh role cannot have one. Making the matrix
data-driven is possible but would move the policy out of a reviewed,
version-controlled, tested file and into a database table — which is a
meaningful loss, and should only be paid for a real requirement.
