# AI strategy

What AI is for in this product, what it must never do, and how to tell whether
it is earning its place.

## The problem it solves

Not "add AI". The specific problem is that the useful questions in this data are
cross-cutting, and the UI can only anticipate so many of them.

A manager wants to know "which projects are at risk of going over budget?" or
"what are the payment terms for the Metro contract?" or "how much unbilled time
is sitting on Phase 2?". Each has an answer in the data. Building a screen for
each is a losing race, and a generic report builder asks the user to learn a
query language.

A conversational interface over the same data, with the same permissions, is a
reasonable answer to that.

## The three rules

Everything about the implementation follows from these. They are enforced in
code, not in a prompt.

### 1. The agent is a caller of the API, not a second path to the data

Every tool calls the same service function an HTTP request calls, with the same
`RequestContext` — the same organization scope, the same permission checks, the
same redaction.

The agent can never see more than the person it is acting for. That is not a
policy; it is a consequence of the wiring.
[ADR-0008](../02-architecture/adr/0008-agent-tools-as-api-callers.md) has the
full argument.

### 2. Retrieved text is data, never instruction

Document excerpts arrive inside an explicit fence that states their contents
must not be followed as commands.

But the fence is the weak layer. The layer that actually holds is rule 1: a
model persuaded by an injected instruction still cannot reach anything, because
the tool enforces RBAC independently of what the model believes.

### 3. The agent proposes; a person disposes

Write tools return a structured proposal. The user confirms it through the
ordinary endpoint. A model talked into drafting an invoice still cannot create
one.

"The model created an invoice and it was wrong" is a category of incident with
no good recovery story. The confirmation step costs one click.

## What it does today

| Capability | Status |
| --- | --- |
| Answer questions about clients, projects, tasks and invoices | Built |
| Retrieve and cite text from indexed documents | Built |
| Report analytics figures | Built |
| Propose a task or a draft invoice | Built, as a proposal only |
| Show the user which tools it can and cannot use, and why | Built |
| Record token usage per message for cost attribution | Built |

## What it deliberately does not do

**It does not write.** See rule 3.

**It does not summarise without citing.** An answer drawn from a document
carries the document id, title, chunk position and score. A claim with no
citation is visibly a claim with no citation.

**It does not see employee compensation.** The retrieval corpus is documents,
and the tools inherit the redaction in the employee mapper.

**It does not index anything without consent.** `indexForAi` is per document and
off by default; confidential documents are excluded regardless; changing either
flag purges the index immediately.

**It does not make decisions.** It answers questions. "Should we take this
project?" is not a question this system should answer, and presenting a model's
opinion as an analysis is how people stop checking.

## Where it is genuinely useful, and where it is not

Being specific about this is how you avoid building an expensive novelty.

**Genuinely useful:**

- Finding a fact buried in a contract nobody remembers the details of
- Cross-cutting questions the UI does not have a screen for
- Onboarding, where someone does not yet know where things live
- Summarising a situation across modules — "what is the state of the Metro
  account?"

**Not useful, and worth refusing:**

- Anything a filter and a sort already answers. "Show me overdue invoices" is a
  button, and a button is faster, cheaper and always correct
- Precise arithmetic. The analytics endpoints compute exact figures; a model
  restating them adds a chance of error to no benefit. This is why the tools
  return computed values rather than raw rows for the model to add up
- Anything where being wrong is expensive and being right is unverifiable

## The build-versus-buy line

**Not built:** the model. Training a model is not a reasonable use of this
team's time, and a general-purpose model with good tools outperforms a small
specialised one for this workload.

**Built:** everything around it — retrieval, tools, the permission integration,
citation, the evaluation harness. That is where the product value is, and it is
also where a vendor's generic "chat with your data" offering cannot go, because
it does not know what a permission means in this system.

## Cost control

The only component whose cost scales with usage rather than with customer count.
The controls, all already in the code:

| Control | Mechanism |
| --- | --- |
| Rate limit | 30 requests per minute on `/ai/chat` |
| Step ceiling | `AI_MAX_AGENT_STEPS`, default 8 |
| Output cap | `AI_MAX_OUTPUT_TOKENS` |
| History window | Only the recent turns are replayed |
| Retrieval budget | Top 5 chunks, ~400 characters each |
| Accounting | Token counts per message, in the audit log |

The last one is what makes the others adjustable on evidence rather than
guesswork.

## The provider boundary

Everything the agent needs from a model is behind one interface:

```ts
interface AiProvider {
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
  embed(texts: string[]): Promise<number[][]>;
}
```

Two implementations: Anthropic, and a deterministic mock.

The mock is not a stub for convenience — it is what makes agent behaviour, tool
dispatch and retrieval ranking testable by ordinary unit tests that run offline
and free in CI. Without it, the agent would be the one part of the system with
no test coverage, which is the wrong part to leave untested.

It also means `AI_PROVIDER=mock` is a real deployment option for a customer who
will not send data to a third party. The product degrades to search plus
analytics, which is a coherent thing to sell.

## Honest assessment

**What is good.** The security model is the strongest part. Tools inheriting
RBAC means the feature cannot become a privilege-escalation surface, and it is
tested with an actual injection payload. Citations make answers checkable.

**What is weak.** Retrieval is a single embedding lookup with no reranking and
no keyword fallback, so it misses documents that use different vocabulary from
the question. The deterministic embedder is a hash projection, not a semantic
model — real semantic retrieval needs a real embedding service.

**What is missing.** No evaluation set, so there is no measurement of whether a
prompt change helps. No conversation memory beyond the recent turns. No
streaming, so a long answer appears all at once.

**The honest summary:** the plumbing is right and the quality is unproven. The
next meaningful work is [evaluation](evaluation.md), because without it every
subsequent improvement is guesswork.
