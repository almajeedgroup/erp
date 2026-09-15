# Inference infrastructure

Where model inference runs, what it costs, and when self-hosting starts to make
sense.

## The current position

Hosted inference, via the provider boundary in
[`apps/api/src/modules/ai/provider.ts`](../../apps/api/src/modules/ai/provider.ts).
Nothing self-hosted.

For a product at this stage that is almost certainly correct, and the reasons are
worth stating because "we should run our own model" is a recurring instinct.

## Hosted versus self-hosted

| | Hosted API | Self-hosted |
| --- | --- | --- |
| Time to working | Minutes | Weeks |
| Fixed cost | None | GPU instances, idle or not |
| Marginal cost | Per token | Near zero once running |
| Scaling | Theirs | Yours |
| Model quality | The frontier | What you can run |
| Data residency | Leaves your boundary | Stays |
| Latency | Network round trip | Local, if provisioned |
| Availability | Their uptime | Yours |

### When self-hosting wins

**Volume.** A GPU instance costs roughly £1–3/hour — £700–2,000/month running
continuously. Below that in API spend, self-hosting is more expensive *and* more
work.

**Data residency.** A customer contractually prohibited from sending data to a
third party. This is the argument that actually comes up in enterprise sales,
and it is why `AI_PROVIDER=mock` exists as a real deployment option today — a
degraded but coherent product.

**Latency floor.** A local model on a warm GPU can start responding in
milliseconds. Rarely the binding constraint for a conversational feature.

**A narrow task.** A fine-tuned small model for classification or tool routing
can run on modest hardware, cheaply, and beat a large general model at that one
job.

### When hosted wins

Everything else, at this stage. Frontier models are frontier models, no capacity
planning is needed, and the engineering effort goes into the product rather than
into GPU operations.

## Cost arithmetic

Roughly, for this workload:

```
Per conversation turn:  ~4,000 input tokens + ~300 output
100 turns/day          →  ~12M tokens/month
                       →  roughly £30–80/month depending on the model
```

Against £700–2,000/month for a GPU that is idle most of the time. The crossover
is at one to two orders of magnitude more usage than this product currently
expects.

The crossover moves if a smaller model is sufficient — a 7B or 8B model runs on
much cheaper hardware — which is why the realistic self-hosting path is
"a small model for a narrow task", not "replace the frontier model".

## What reduces hosted cost

| Technique | Effect | Status |
| --- | --- | --- |
| **Prompt caching** | Large reduction on the static prefix | **Not implemented. The best available win** |
| Fewer tools offered | Smaller tool block | Built, as a side effect of permission filtering |
| Shorter history | Fewer replayed turns | Built |
| Tighter retrieval | Fewer context tokens | Built |
| Smaller model for simple questions | Routing | Not implemented |
| Batching | Only helps offline work | Not applicable |

Prompt caching deserves the emphasis. The system prompt and tool definitions are
byte-identical on every call and are the largest input component. Providers that
support caching charge substantially less for a cached prefix.

## If self-hosting becomes the right answer

### Serving

| Server | Strength |
| --- | --- |
| **vLLM** | Continuous batching, high throughput. The usual default |
| TGI | Good production ergonomics |
| Ollama | Excellent for development, not for serving |
| llama.cpp | CPU and Apple Silicon; good for small models |

### The concepts that matter

**Continuous batching.** GPUs are throughput devices. Serving one request at a
time wastes most of the hardware. Continuous batching interleaves requests as
they arrive rather than waiting to fill a fixed batch, and it is the single
largest throughput difference between a naive server and a good one.

**KV cache.** Attention keys and values for the tokens generated so far are
cached; without it, generation is quadratic. It is also the dominant memory
consumer, and what limits concurrent sequences.

**Quantisation.** Storing weights at lower precision. 8-bit is usually
indistinguishable from 16-bit in quality and halves the memory; 4-bit is a
visible but often acceptable step down and halves it again. This is what makes a
useful model fit on affordable hardware.

**Time to first token versus throughput.** They trade against each other.
Interactive features care about the first; batch processing cares about the
second.

### Hardware, roughly

| Model size | Precision | GPU memory | Example |
| --- | --- | --- | --- |
| 7–8B | 4-bit | ~6 GB | Consumer card |
| 7–8B | 16-bit | ~16 GB | A10, L4 |
| 70B | 4-bit | ~40 GB | A100 40GB |
| 70B | 16-bit | ~140 GB | Multiple A100s |

## Embeddings are the more likely first step

If anything gets self-hosted here, it should be the embedding model rather than
the chat model.

Embedding models are small — a good one is 100–400 MB — and run acceptably on
CPU. They are called far more often than the chat model (once per chunk at index
time, once per query), and the current deterministic projection is the largest
quality constraint in retrieval.

Self-hosting a sentence-transformer would improve retrieval quality, remove a
per-token cost, keep document text inside the boundary, and need no GPU. That is
a materially better ratio than self-hosting the chat model.

See [RAG](rag.md) and [llm-integration](llm-integration.md#embeddings).

## Reliability

Whatever the deployment, the failure modes need answers:

| Failure | Response |
| --- | --- |
| Provider down | 502 via `dependencyFailed`; the rest of the product is unaffected |
| Rate limited | SDK retries twice, then 502 |
| Slow | Timeout, and a step ceiling bounding the whole turn |
| Degraded quality | Only detectable with [evaluation](evaluation.md) |

The important architectural property is already true: **the AI feature is
additive.** If it is entirely unavailable, clients, projects, invoices,
documents and reports all work. Nothing in the core product depends on a model
being reachable.
