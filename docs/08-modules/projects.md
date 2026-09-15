# Projects

Where work is organised and where time is recorded. The module exists to answer
one commercial question — *did this project make money?* — and every rule in it
follows from making that answer trustworthy.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/projects/routes.ts` |
| Service | `apps/api/src/modules/projects/service.ts` |
| Tables | `projects`, `project_members`, `time_entries` |
| UI | `/projects` |

## What it owns

A **project** is a unit of billable work for a client. It carries a billing type,
a currency, an optional budget and an optional hourly rate — the numbers
[analytics](analytics.md) uses to compute profitability.

A **project member** is someone assigned to it, with an allocation percentage and
optionally a rate that overrides the project's.

A **time entry** is minutes worked, on a date, by a person, on a project and
optionally a task. It is the raw material of both billing and cost.

### Billing types

| Type | Meaning |
| --- | --- |
| `fixed_price` | Agreed total. **Requires a budget** — the service refuses without one |
| `time_and_materials` | Billed from logged hours at a rate |
| `retainer` | Recurring fee |
| `internal` | Not billable; cost only |

### Status

```
draft ──▶ active ──▶ on_hold ──▶ completed
                 └──▶ cancelled
```

Time can only be logged against a project that is accepting work. Logging
against a `completed` or `cancelled` project returns **412**:

```
412 "Cannot log time against a completed project"
```

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/projects` | `project:read` |
| POST | `/api/v1/projects` | `project:create` |
| GET | `/api/v1/projects/:projectId` | `project:read` |
| PATCH | `/api/v1/projects/:projectId` | `project:update` |
| DELETE | `/api/v1/projects/:projectId` | `project:delete` |
| GET | `/api/v1/projects/:projectId/members` | `project:read` |
| POST | `/api/v1/projects/:projectId/members` | `project:assign` |
| DELETE | `/api/v1/projects/:projectId/members/:userId` | `project:assign` |
| GET | `/api/v1/time-entries` | `time_entry:read` |
| POST | `/api/v1/time-entries` | `time_entry:create` |
| POST | `/api/v1/time-entries/:timeEntryId/approve` | `time_entry:approve` |
| DELETE | `/api/v1/time-entries/:timeEntryId` | `time_entry:approve` |

Time entries are mounted at their own prefix rather than under a project,
because the common queries are "this week, for this person" and "unbilled, for
this client" — neither of which is project-scoped.

## Rules

**An invoiced time entry is immutable.** This is the rule that shapes the
module. Once minutes carry `invoiced_invoice_id`, editing or deleting them would
silently change what a client was billed and make the invoice unreconcilable
against the work behind it.

```
412 "This entry is already on an invoice and cannot be changed"
412 "This entry is already on an invoice and cannot be deleted"
```

The same reasoning propagates upward: a project with invoiced time cannot be
deleted at all, and says so with the count.

```
409 "This project has invoiced time and cannot be deleted"
```

**A fixed-price project requires a budget.** Enforced at create and at update —
switching an existing project to `fixed_price` without a budget is refused the
same way, because otherwise profitability has no denominator.

**Project codes are unique per organization.** Checked before insert, returning
409 with the offending code. Codes are optional; the constraint applies only
when one is supplied.

**Approval is separate from creation.** `time_entry:create` logs time;
`time_entry:approve` blesses it. A `member` can record their own hours and
cannot approve them — the segregation that makes approved hours mean something.
Deletion also requires `time_entry:approve`, because deleting an entry is
functionally a reversal of approval.

**Rate resolution has a defined order.** A member's `hourly_rate` overrides the
project's, which is what makes a senior contributor cost more than a junior on
the same project. `analytics` uses the same order, so the dashboard and the
invoice cannot disagree.

**Minutes are integers.** Not hours as a float. The same reasoning as money:
7.5 hours is 450 minutes, exactly, and no rounding accumulates across a month.

## Who can do what

| Role | Read | Create | Update | Delete | Assign | Log time | Approve time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| member | ✓ | — | — | — | — | ✓ | — |
| finance | ✓ | — | — | — | — | — | — |
| viewer | ✓ | — | — | — | — | — | — |

Finance reads projects but neither restructures them nor logs against them —
they need the numbers, not the delivery.

## Edges

- **← [Clients](clients.md)** — every project belongs to a client
- **→ [Finance](finance.md)** — billable time becomes invoice lines; invoicing
  sets `invoiced_invoice_id` and freezes the entry
- **→ [Tasks](tasks.md)** — tasks belong to a project; time can reference a task
- **→ [Analytics](analytics.md)** — project profitability is revenue minus labour
  cost minus expenses, and it depends on every rule above holding
- **→ [Employees](employees.md)** — cost rates come from employee records

## Not built

- **No task dependencies**, so no critical path and no Gantt. Adding them means
  adding cycle detection, which is the part people forget — see
  [DS&A](../06-engineering/data-structures-and-algorithms.md#the-ones-that-are-not-here).
- **No capacity planning.** `allocation_percent` is recorded but nothing warns
  when someone is allocated 250%.
- **No timers.** Time is entered, not tracked live.
- **No budget enforcement.** Exceeding a budget is visible in analytics and is
  not blocked — deliberately; work does not stop because a number was wrong.
- **No milestone billing** for fixed-price projects. Invoices are created
  manually against them.
