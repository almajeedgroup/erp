# Tasks

Work items, on a board. The lightest module in the system, and deliberately so —
an ERP that grows a second-rate issue tracker inside it ends up with neither a
good ERP nor a good tracker.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/tasks/routes.ts` |
| Service | `apps/api/src/modules/tasks/service.ts` |
| Tables | `tasks`, `task_comments` |
| Tests | `tasks.test.ts` — 14 |
| UI | `/tasks` |

## What it owns

A **task** is a unit of work. It can belong to a project, to a client, to both,
or to neither — a task with no project is an internal to-do, and forcing one
would be an invitation to create a "General" project.

A **task comment** is a note on a task, by a user, with a timestamp.

### Status and priority

```
todo ──▶ in_progress ──▶ in_review ──▶ done
           │                             
           └──▶ blocked ──▶ cancelled    
```

`done` and `cancelled` are `TERMINAL_TASK_STATUSES`. Like the client lifecycle,
this is descriptive rather than a state machine — any transition is permitted,
because real work moves backwards and a tool that forbids it gets worked around.

Priority is `low`, `medium`, `high`, `urgent`.

## Two details worth copying

### Sparse positions

Board order uses `position`, assigned in steps of **1,000**: 1000, 2000, 3000.

Dragging a card between two others writes **one row** — the midpoint, 1500 —
instead of renumbering every sibling. That is the difference between a board with
a few thousand cards feeling instant and feeling like a form submission.

```
before:  [1000]  [2000]  [3000]
drop between the first two → 1500
after:   [1000]  [1500]  [2000]  [3000]
```

New tasks are appended: `nextPosition` takes `max(position) + 1000` scoped by
`project_id`, treating "no project" as its own list, so reordering one board
never touches another. Reordering is the client sending the computed midpoint as
`position` in a `PATCH` — the server stores what it is given rather than owning
the layout, because only the client knows where the card was dropped.

`completed_at` is the counter-example, and the comment in the code says why: it
is a consequence of the status and is never accepted from a client, because a
client-supplied completion timestamp is how burn-down charts start lying.

The known limit: repeated insertion between the same two cards eventually
exhausts the integer gap. The standard fix is renumbering that list when the gap
closes; it is not implemented, and at a step of 1,000 it takes about ten
consecutive drops into the same slot to matter.

### `overdue` is derived, never stored

```ts
overdue: !isTerminal && row.dueDate !== null && row.dueDate < today
```

Computed at read time from `ctx.now`, which is injected. A stored flag would need
a nightly job to maintain, would be wrong between runs, and would be wrong
forever if the job failed silently. A completed task is never overdue, however
late it was.

The same reasoning applies to the invoice module's overdue flag, and the pinned
clock in the test harness is what makes both testable.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/tasks` | `task:read` |
| POST | `/api/v1/tasks` | `task:create` |
| GET | `/api/v1/tasks/:taskId` | `task:read` |
| PATCH | `/api/v1/tasks/:taskId` | `task:update` |
| DELETE | `/api/v1/tasks/:taskId` | `task:delete` |
| GET | `/api/v1/tasks/:taskId/comments` | `task:read` |
| POST | `/api/v1/tasks/:taskId/comments` | `task:update` |
| DELETE | `/api/v1/tasks/:taskId/comments/:commentId` | `task:update` |

Listing filters by status, priority, project and assignee.

Commenting requires `task:update` rather than a separate permission. A comment
changes the task's state in the sense that matters — it is how work gets
discussed — and a `task:comment` permission nobody would ever grant separately is
a permission that only adds surface.

## Who can do what

| Role | Read | Create | Update / comment | Delete |
| --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | ✓ |
| member | ✓ | ✓ | ✓ | — |
| finance | ✓ | — | — | — |
| viewer | ✓ | — | — | — |

A member does the work: creates tasks, moves them, comments. They cannot delete,
because deleting someone else's task destroys the record of what was asked for.
A manager can.

## Rules

**Deletion is soft**, and cascades to comments in the same transaction.

**`completed_at` is set when a task enters a terminal status** and cleared when
it leaves one, so reopening a task does not leave a stale completion date behind
it.

**Logged minutes come from time entries**, not from the task. `loggedMinutes` on
a task response is a sum over `time_entries` that reference it, so the estimate
and the actual are directly comparable and neither is duplicated.

## Edges

- **← [Projects](projects.md)** — a task can belong to a project
- **← [Clients](clients.md)** — and/or directly to a client
- **→ [Projects](projects.md)** — time entries can reference a task, which is how
  `loggedMinutes` is computed
- **→ [Documents](documents.md)** — a document can be owned by a task
- **→ [AI agent](ai-agent.md)** — `create_task` is one of two write tools, and it
  requires the caller to hold `task:create`

## Not built

This list is longer than the module, which is the point: the boundary is
deliberate.

- **No dependencies between tasks.** No blockers, no critical path, no Gantt.
  Adding them means adding cycle detection at write time, which is the part
  people forget until two tasks block each other.
- **No subtask rollup.** `parent_task_id` exists and nothing aggregates progress
  up the tree.
- **No recurring tasks.**
- **No notifications.** Assigning a task tells nobody. This is the gap users
  notice first, and it needs an email or webhook layer that does not exist yet.
- **No watchers, mentions or reactions.**
- **No custom fields or workflows.** The status set is fixed in the schema.
- **No attachments on comments** — documents attach to the task, not to a
  comment.
- **No sprints or iterations.**

If a team needs those, they need an issue tracker, and this module should
integrate with one rather than grow into one.
