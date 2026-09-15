# LLM integration

The provider boundary, and what crossing it costs.

## The interface

Everything the agent needs from a model provider:

```ts
export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  readonly model: string;
  complete: (request: AiCompletionRequest) => Promise<AiCompletionResponse>;
  embed: (texts: string[]) => Promise<number[][]>;
}
```

Two methods. Nothing above this file imports the Anthropic SDK.

Defined in
[`apps/api/src/modules/ai/provider.ts`](../../apps/api/src/modules/ai/provider.ts).

## Why the abstraction earns its place

Abstractions over third-party SDKs are often premature. This one is not, for two
specific reasons:

**The test suite never calls a paid API.** `createMockProvider` returns
deterministic output, so agent behaviour, tool dispatch and retrieval ranking are
covered by ordinary unit tests that run offline and free in CI. Without it, the
agent would be the least-tested part of the system, which is the wrong part.

**`AI_PROVIDER=mock` is a real deployment option.** A customer who will not send
data to a third party gets a product that degrades to search plus analytics —
coherent, sellable, and one environment variable away.

Provider portability is a third benefit and the least important one. It is real,
but it is not why the interface exists.

## The mock provider

Not a stub. It does two things deliberately:

**Completions** echo the question and, if a tool's name appears in it, request
that tool. That is enough to exercise the entire dispatch path — offer the
tools, receive a `tool_use`, execute it, feed the result back, produce an answer
— without a model.

**Embeddings** are a seeded hash projection: stable, unit-length, and similar for
text sharing tokens. Not semantic, but enough to assert that ranking works and
that a relevant chunk outranks an irrelevant one.

```ts
const query = hashEmbedding('metro contract completion date', 256);
const related = hashEmbedding('The metro contract completion date is December 2027.', 256);
const unrelated = hashEmbedding('Office coffee machine maintenance schedule.', 256);
expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
```

## The Anthropic provider

Wraps `@anthropic-ai/sdk`, translating between this system's message types and
the SDK's.

```ts
const response = await client.messages.create({
  model: config.ai.model,
  max_tokens: request.maxOutputTokens,
  system: request.system,
  tools: request.tools.map(/* ... */),
  messages: request.messages.map(toAnthropicMessage),
});
```

Failures are wrapped as `dependencyFailed('anthropic', error)` — a 502, which is
correct: an upstream dependency failed, and it is not the caller's fault.

### Embeddings

Anthropic does not serve an embeddings endpoint, so `embed` falls back to the
same deterministic projection the mock uses.

**This is the largest quality limitation in the retrieval pipeline**, and it is
stated plainly rather than buried. Real semantic retrieval needs a real embedding
service — Voyage, Cohere, OpenAI, or a self-hosted sentence-transformer. Swapping
it in means implementing one method; the chunking, storage, ranking and citation
around it do not change.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `mock` keeps development and CI deterministic and free |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic`; validated at boot |
| `AI_MODEL` | `claude-sonnet-5` | |
| `AI_MAX_OUTPUT_TOKENS` | 2048 | Cost ceiling per response |
| `AI_EMBEDDING_DIMENSIONS` | 1536 | |
| `AI_MAX_AGENT_STEPS` | 8 | Hard ceiling on the tool loop |

Defaulting to `mock` is deliberate. A developer who clones this repository gets a
working assistant without an API key, and nobody accidentally spends money in
CI.

## Cost

The only component that scales with usage rather than customer count, so it is
worth understanding the shape.

Billing is per token, input and output, with output typically costing several
times input. A single agent turn here consumes:

| Component | Rough tokens |
| --- | --- |
| System prompt | ~400 |
| Tool definitions | ~1,200 for ten tools |
| Conversation history | up to ~2,000 |
| Retrieved chunks | ~500 (5 × ~400 characters) |
| The question | ~50 |
| **Input subtotal** | **~4,000** |
| Answer | ~300 |

A multi-step turn repeats the input on each step, which is why the step ceiling
matters more than the output cap.

### What reduces it

| Technique | Effect | Status |
| --- | --- | --- |
| Prompt caching | Large reduction on the static prefix — system prompt and tool definitions | Not implemented. The highest-value improvement available |
| Fewer tools offered | Tools are already filtered by permission, so a `member` sees fewer | Built, as a side effect of the security model |
| Shorter history | Only recent turns are replayed | Built |
| A smaller model for simple questions | Routing by complexity | Not implemented |
| Tighter retrieval | Top 5, ~400 characters each | Built |

Prompt caching is the obvious next step: the system prompt and tool definitions
are identical on every call, and they are the largest input component.

## Latency

A conversational feature lives or dies on this.

| Path | Typical |
| --- | --- |
| Retrieval | 20–100 ms |
| One model call | 1–3 s |
| One tool round trip | +1–3 s |
| A three-step turn | 5–10 s |

Five to ten seconds is a long time to stare at a spinner. Two things would
help, neither built:

**Streaming.** The SDK supports it. The answer appears token by token, which
makes the same total latency feel dramatically shorter. The reason it is not
built is that it requires server-sent events through the Next.js server action
boundary, which is more plumbing than it sounds.

**Showing tool progress.** "Searching invoices…" while a tool runs. Cheap, and
most of the perceived benefit of streaming.

## Failure modes

| Failure | Handling |
| --- | --- |
| Provider unavailable | 502 via `dependencyFailed` |
| Rate limited by the provider | The SDK retries twice, then 502 |
| Timeout | SDK default |
| Malformed tool input | The tool coerces and ignores unknown keys |
| Tool throws | Returned to the model as a tool result, not thrown |
| Step ceiling reached | `truncated: true` in the response |

The tool-failure choice is worth noting: returning the error to the model lets
it explain the limitation to the user, which is far more useful than the whole
request failing. It does mean error phrasing matters, because the model
paraphrases it.

## Data leaving the system

When `AI_PROVIDER=anthropic`, what goes to the provider is: the system prompt,
the tool definitions, the conversation history, retrieved document excerpts, and
tool results.

All of it is data the caller was already entitled to see. But it does leave the
system, which makes the provider a sub-processor and belongs in the record of
processing activities and in the privacy notice. See
[data privacy](../03-security/data-privacy.md#sub-processors).

For a customer who cannot accept that, `AI_PROVIDER=mock` disables it entirely.

## Model selection

`claude-sonnet-5` by default: the balance of capability, latency and cost for a
tool-calling workload over business data.

A smaller model would be cheaper and faster, and worse at deciding which tool to
call — which is the actual difficulty in this workload. A larger one would be
better at nuanced questions and slower on every simple one.

The right answer is probably routing: a small model for the many simple
questions, a larger one for the few hard ones. That needs a classifier, and it
needs [evaluation](evaluation.md) first, because without measurement there is no
way to tell whether the routing helped.
