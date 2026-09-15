# Employees

People, their employment terms, and the two rates that make project
profitability computable. This is the module with the most sensitive data in the
system, and its design is mostly about that.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/employees/routes.ts` |
| Service | `apps/api/src/modules/employees/service.ts` |
| Table | `employees` |
| UI | `/employees` |

## What it owns

An **employee** is an employment record: who someone is, what they do, when they
joined, what they cost and what they bill at. It is distinct from a **user**,
which is a login, and from a **membership**, which is a role in an organization.

```
user ──── membership ────▶ organization      (can sign in, has a role)
  ╲
   ╲──── employee ───────▶ organization      (is employed, has a cost)
```

`employees.user_id` is **nullable**, and that is the point. A contractor who
never signs in still has a cost rate and still appears in profitability. A
founder who signs in daily may have no employment record. Collapsing the two
would force a login for every person you pay, which is wrong in both directions.

### The two rates

| Rate | Meaning | Used by |
| --- | --- | --- |
| `cost_rate` | What an hour of this person costs the business | Project profitability — **sensitive** |
| `billable_rate` | What an hour is charged at | Invoice line defaults — not sensitive |

Splitting them is what makes margin computable. The gap between them *is* the
gross margin on delivered work, which is why cost is protected and billable is
not: a contributor needs to know what their work bills at, and does not need to
know what the business pays for it.

### Status and employment type

```
active ──▶ on_leave ──▶ suspended ──▶ terminated
```

`employment_type` is `full_time`, `part_time`, `contractor`, `intern` or
`temporary`.

## The sensitive field set

Four fields are gated behind `employee:read_sensitive`:

| Field | Why |
| --- | --- |
| `compensation` + `pay_period` | Salary |
| `cost_rate` | Reveals margin, and effectively reveals salary |
| `national_id` | Government identifier — identity-theft grade |
| `bank_account` | Payment details |

**They are stripped in the service, not in the route.** `toEmployee(row,
canSeeSensitive)` returns them as `null` for a caller without the permission,
and every code path that returns an employee — get, list, the AI agent's tools —
goes through that one function. A filter applied per route is a filter someone
forgets on the seventh route.

Note that the fields are present and `null`, not absent. The response shape is
stable, so a client does not have to branch on whether a key exists; it branches
on whether the value is there.

**Writing a sensitive field requires the permission to read it.** Otherwise
someone could set a salary they cannot see — a data-integrity problem, and an
oracle: write a value, observe whether anything changed. The refusal is a **404,
deliberately indistinguishable** from "no such field", so the response does not
confirm that the field exists.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/employees` | `employee:read` |
| POST | `/api/v1/employees` | `employee:create` |
| GET | `/api/v1/employees/:employeeId` | `employee:read` |
| PATCH | `/api/v1/employees/:employeeId` | `employee:update` |
| DELETE | `/api/v1/employees/:employeeId` | `employee:delete` |

Listing filters by status, department and employment type, and searches across
first name, last name, email and job title.

## Who can do what

| Role | Read | Read sensitive | Create | Update | Delete |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| finance | ✓ | ✓ | — | — | — |
| manager | ✓ | — | — | — | — |
| member | ✓ | — | — | — | — |
| viewer | ✓ | — | — | — | — |

The directory itself is open to everyone in the organization — names, job
titles, departments, billable rates. What splits the roles is the sensitive
block and the ability to write.

**A manager sees their team but not their salaries.** Who reports to whom, job
titles, billable rates — everything needed to run delivery — and nothing about
pay. This is the single most common access-control mistake in HR systems, and it
is why `employee:read_sensitive` is a separate permission rather than a flag on
`employee:read`. A `member` and a `viewer` see exactly the same non-sensitive
view.

**Finance reads salaries but cannot change them.** Payroll needs the numbers;
the authority to alter someone's compensation is an HR decision, not an
accounting one. Separating read from write here is the segregation of duties
that makes the audit log meaningful.

## Rules

**Deletion is soft.** Employment records are evidence — for payroll disputes, for
audits, for anything retrospective — so `deleted_at` is set and the row stays.
Hard deletion exists only for data-subject requests and is a separate, deliberate
procedure; see [data privacy](../03-security/data-privacy.md).

**Terminated is a status, not a deletion.** Setting `terminated_at` keeps the
person in historical profitability where their cost genuinely applied. Deleting
them would silently make last quarter look more profitable than it was.

**Every change is audited** — `employee.created`, `employee.updated`,
`employee.deleted` — with `before`/`after` limited to changed fields. Sensitive
values appear in those snapshots, which is intentional (a salary change is
exactly what you audit) and is why `audit:read` is restricted to owner and admin.

## Edges

- **→ [Projects](projects.md)** — cost and billable rates feed time valuation
- **→ [Analytics](analytics.md)** — labour cost in project profitability is
  logged minutes × cost rate
- **→ [Documents](documents.md)** — a document can be owned by an employee
  (contracts, identification); those are usually `confidential`
- **← Organization** — `user_id` links an employee to a login, when there is one

## Not built

- **No payroll.** No payslips, no tax withholding, no payment runs. Compensation
  is recorded, not paid. Payroll is jurisdiction-specific enough that a generic
  implementation would be wrong everywhere.
- **No leave management.** `on_leave` is a status with no balance behind it.
- **No performance reviews.**
- **No org chart.** `manager_id` exists; nothing renders the tree, and nothing
  detects a cycle if two people manage each other.
- **No field-level encryption.** `national_id` and `bank_account` are protected
  by access control and by encryption at rest, not by a separate key. That is a
  deliberate, stated limit — see
  [encryption](../03-security/encryption.md) — and column-level encryption is the
  upgrade path if the data set grows or a regulator requires it.
