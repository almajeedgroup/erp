# Fine-tuning

When adapting a model to your data helps, when it is the wrong tool, and why
this system does not use it.

## What it is

Continuing to train an existing model on your own examples, so it adapts to a
task, a format or a style.

Not the same as training from scratch, which needs vastly more data and compute
and is not a realistic option for a product team.

## The variants

| Method | What changes | Cost |
| --- | --- | --- |
| Full fine-tuning | Every weight | Highest; needs the infrastructure to serve a custom model |
| LoRA | A small number of added low-rank matrices | Much cheaper, nearly as effective |
| QLoRA | LoRA on a quantised base | Cheapest; runs on a single GPU |
| Instruction tuning | Fine-tuning specifically on instruction/response pairs | A framing rather than a method |

LoRA and QLoRA have made fine-tuning accessible enough that the question is now
"should we?" rather than "can we?".

## What fine-tuning is good at

**Format and structure.** Making a model reliably emit a specific shape without
being asked every time.

**Domain vocabulary and style.** Writing the way your organization writes.

**A narrow, repetitive task.** Classifying support tickets into twelve
categories. A small fine-tuned model often beats a large general one here, at a
fraction of the cost.

**Compressing a long prompt.** If every call carries 2,000 tokens of
instructions, fine-tuning can bake them in — a real and underrated cost saving.

## What fine-tuning is bad at

**Teaching facts.** This is the important one, and the most common
misconception.

Fine-tuning on your invoices does not give the model a reliable database of your
invoices. It shifts the distribution of what it produces, so it becomes *more
likely* to produce invoice-shaped text with plausible-looking numbers. Which is
precisely the failure mode you least want in a financial system: confident,
well-formatted, wrong.

**Keeping current.** Facts change daily. Fine-tuning is a training run.

**Access control.** A fine-tuned model has absorbed its training data and cannot
selectively forget it for a user who should not see part of it.

That last point alone disqualifies it for this product. If the model were
fine-tuned on all tenants' data, it could leak between tenants in ways no
filter can prevent — the information is in the weights. A model per tenant
avoids that and is economically absurd.

## Why this system uses retrieval instead

| | RAG | Fine-tuning |
| --- | --- | --- |
| Update latency | Immediate | A training run |
| Citation | Natural | Impossible |
| Per-tenant isolation | A filter | A model per tenant |
| Access control | Filter before retrieving | Cannot unlearn |
| Cost model | Per query | Per training run |
| Debuggability | You can see what it read | Opaque |

The access-control and citation rows settle it for this product. Retrieval
filters the corpus **before** anything is scored, and every answer carries the
source it came from. Neither is achievable with fine-tuning.

## Where fine-tuning could genuinely help here

Being concrete rather than dismissive. Three plausible cases, none of which is
"teach it about our data":

### 1. Tool selection

The agent decides which of ten tools to call. A small model fine-tuned on
(question → correct tool call) pairs could do this well and cheaply, routing to
a larger model only for questions needing real reasoning.

**Would need:** a few thousand labelled examples, which the
[evaluation](evaluation.md) work would produce as a by-product.

**Value:** meaningful cost and latency reduction on the common path.

### 2. Document classification

Automatically categorising an uploaded document as a contract, invoice, receipt
or report. A narrow classification task — exactly what fine-tuning is good at,
and a small model is enough.

**Would need:** a few thousand labelled documents, which accumulate naturally
since users already set the category.

**Value:** modest. It saves one dropdown.

### 3. Structured extraction

Pulling payment terms, parties and dates out of a contract into fields. A
fine-tuned model would be more reliable than prompting at this.

**Would need:** several hundred contracts with hand-extracted fields.

**Value:** high, and it compounds — extracted terms become structured data the
rest of the system can use.

## The order of operations

Before fine-tuning anything, exhaust the cheaper options. In practice most
"we need to fine-tune" conclusions are reached before these are tried:

1. **Improve the prompt.** Usually the largest available gain.
2. **Improve the tool descriptions.** The model's only guide to when a tool
   applies.
3. **Improve retrieval.** Hybrid search, reranking, better chunking. See
   [RAG](rag.md).
4. **Add few-shot examples.** Often achieves most of what fine-tuning would, at
   the cost of tokens per call.
5. **Try a different model.** Frequently easier than fine-tuning a worse one.
6. *Then* consider fine-tuning.

And before any of them: **build the evaluation set**, or there is no way to tell
whether step 1 helped, let alone step 6.

## If you do it

| Step | Note |
| --- | --- |
| Data | Quality over quantity. 500 excellent examples beat 5,000 noisy ones |
| Split | Hold out a test set the model never sees |
| Baseline | Measure the un-tuned model first. Surprisingly often it is good enough |
| Method | Start with LoRA. Full fine-tuning is rarely worth the cost |
| Evaluate | On the held-out set, against the baseline, on the metrics that matter |
| Serve | A custom model needs hosting, versioning and a rollback path |
| Maintain | It decays as the domain shifts. Budget for periodic retraining |

That last row is the one people forget. A fine-tuned model is not a one-off
project; it is a component with a maintenance cost, and it needs an owner.
