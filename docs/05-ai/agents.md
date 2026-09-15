# Agents

The tool-calling loop, and the constraints that make it safe to point at a
system holding payroll.

Implemented in
[`apps/api/src/modules/ai/agent.ts`](../../apps/api/src/modules/ai/agent.ts) and
[`tools.ts`](../../apps/api/src/modules/ai/tools.ts).

## What "agent" means here

A model that can call functions, see the results, and decide what to do next —
rather than producing a single response from a single prompt.

The loop:

```
build the system prompt
offer the tools this caller may use
  ↓
model responds
  ├─ text        → done
  └─ tool_use    → execute → feed the result back → repeat
  ↓
step ceiling reached → truncated: true
```

Deliberately boring. The interesting engineering is in the constraints around
it, not the loop itself.

## The security model

The whole argument, stated once: **every tool is a caller of the same service
function an HTTP request uses, with the same `RequestContext`.**

```ts
// The tool:
execute: async (ctx, input) => listInvoices(ctx, { limit, status, clientId })

// The HTTP route:
async (request) => listInvoices(request.ctx(), request.query)
```

Identical function, identical context. The tool therefore inherits, without
doing anything special:

- the organization scope, taken from the verified token
- the tenant-scoped query helpers
- the soft-delete filter
- the sensitive-field redaction in the employee mapper

There is no privileged path, no service-role credential, no "internal" bypass.
[ADR-0008](../02-architecture/adr/0008-agent-tools-as-api-callers.md) has the
alternatives that were rejected.

### Tools the caller cannot use are never offered

```ts
export function availableTools(ctx: RequestContext, allowWrites: boolean): ToolSpec[] {
  return TOOLS.filter((tool) => {
    if (!ctx.auth.permissions.has(tool.permission)) return false;
    if (isWriteTool(tool.name) && !allowWrites) return false;
    return true;
  });
}
```

A model cannot be tempted by a capability it has not been told about. The
permission is re-checked at dispatch anyway — defence in depth costs one set
lookup, and the offer list and the executor could drift.

Filtering the *list* rather than the *results* matters. If the model were told
it could call a tool and then got an empty result, it would report "there is no
data" to the user as fact.

### Write tools do not write

`create_task` and `draft_invoice` return a structured proposal:

```json
{
  "proposal": "create_task",
  "confirmWith": "POST /api/v1/tasks",
  "payload": { "title": "Survey the site", "priority": "high" },
  "note": "Nothing has been created."
}
```

The user confirms through the ordinary endpoint. A model talked into drafting an
invoice still cannot create one.

They are also off by default — `allowWrites` is a per-request choice, and the
web UI surfaces it as an explicit checkbox.

### The step ceiling

`AI_MAX_AGENT_STEPS`, default 8.

An agent that can loop forever is an unbounded bill and a denial-of-service
against your own API. Hitting the ceiling returns `truncated: true` rather than
presenting a partial answer as complete.

## The tools

| Tool | Permission | Kind |
| --- | --- | --- |
| `search_clients` | `client:read` | read |
| `search_projects` | `project:read` | read |
| `search_tasks` | `task:read` | read |
| `search_invoices` | `invoice:read` | read |
| `search_documents` | `document:read` | read |
| `get_analytics_overview` | `analytics:read` | read |
| `get_project_profitability` | `analytics:read` | read |
| `get_receivables_aging` | `analytics:read` | read |
| `create_task` | `task:create` | **proposal** |
| `draft_invoice` | `invoice:create` | **proposal** |

### Designing a tool

What makes one work well, learned from these:

**Narrow and named after the question.** `search_invoices` with a status filter
beats a generic `query_database`. The model chooses correctly far more often
when the tool name matches the intent.

**Return computed values, not raw rows.** `get_analytics_overview` returns the
margin percentage; it does not return invoices for the model to add up. Models
are unreliable at arithmetic and reliable at reading a number, so do the
arithmetic in code.

**Describe it for the model, not for a developer.** The description is the
prompt. "Find invoices by status, client or date, including which are overdue
and by how much" tells the model when to reach for it; "Lists invoices" does not.

**Bound the output.** Every read tool is capped at 20 rows. An unbounded tool
result becomes an unbounded prompt.

**Coerce input defensively.** Models produce plausible-looking arguments that
are occasionally the wrong type. `asString` and `asLimit` clamp rather than
reject, because a hard failure on a near-miss wastes a step.

## Failures are returned, not thrown

```ts
try {
  const output = await dispatchTool(ctx, call.name, call.input, allowWrites);
  results.push({ toolUseId: call.id, content: JSON.stringify(output) });
} catch (error) {
  results.push({
    toolUseId: call.id,
    content: JSON.stringify({ error: error.message }),
    isError: true,
  });
}
```

The model can then explain the limitation — "I don't have permission to see
analytics" — which is far more useful than a 500.

The consequence is that error phrasing matters, because the model paraphrases
it. `forbidden('This action requires the "analytics:read" permission')` produces
a useful sentence; a generic message produces a useless one.

## Prompt injection

The realistic attack: someone emails an invoice PDF containing instructions
aimed at the model. It gets uploaded, indexed, and retrieved.

Three layers:

1. **The fence.** Retrieved text is delivered inside a block that states its
   contents must not be followed as commands.
2. **The system prompt.** States the same rule, and that the agent never writes.
3. **RBAC in the tools.** The layer that actually holds.

The first two raise the bar. The third is why it does not matter much if they
are bypassed: a `member` has no `analytics:read`, so the tool is not offered and
would refuse if it were. The model's beliefs are not an input to `can()`.

There is a test that feeds exactly this payload to a `member` account and
asserts no analytics tool is called.

## Conversations

Stored per user, not per organization. A colleague's chat history is not
organizational data the way an invoice is, so reads filter on `user_id` as well
as `organization_id` — and a test asserts that an admin in the same organization
gets a 404.

Only the recent turns are replayed on each request. An unbounded history is an
unbounded prompt, and the oldest turns are rarely what the current question
needs.

Token usage is recorded per message and written to the audit log, so cost
attribution per organization is possible and a spike is visible.

## What is not built

**No multi-agent orchestration.** A planner delegating to specialists is
fashionable and, for this workload, unnecessary. One model with ten good tools
answers these questions; a hierarchy would add latency, cost and failure modes.

**No memory across conversations.** Each starts fresh. Useful memory would need
a policy on what is remembered and how a user forgets it, which is a product
question before it is a technical one.

**No self-correction loop.** The agent does not verify its own answer. Citations
let the *user* verify, which is the more honest design.

**No streaming.** The answer appears all at once. See
[llm-integration](llm-integration.md#latency).

## Testing an agent

The insight that makes it tractable: **test the plumbing deterministically, and
evaluate the quality separately.**

With the mock provider, ordinary tests cover which tools are offered, what the
tool layer refuses, how retrieval is scoped, what happens when a tool fails, and
whether an injected instruction widens access. All offline, all free, all fast.

Answer quality is not testable this way, and pretending otherwise produces
brittle tests that assert on model output. That is what
[evaluation](evaluation.md) is for.
