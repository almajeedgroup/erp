# AI evaluation

How to know whether the assistant got better. Currently **not built**, and this
page is the plan rather than a description.

That gap is stated first because it is the most important thing on the page:
without evaluation, every prompt change, every retrieval tweak and every model
upgrade is guesswork dressed up as improvement.

## Why the ordinary test suite is not enough

The existing tests
([`apps/api/src/modules/ai/ai.test.ts`](../../apps/api/src/modules/ai/ai.test.ts))
cover the plumbing, deterministically: which tools are offered, what the tool
layer refuses, how retrieval is scoped, what happens when a tool fails, whether
an injected instruction widens access.

They say nothing about whether the answer is any good. That is a different kind
of measurement, and trying to do it with assertions on model output produces
brittle tests that break on a rephrasing.

**Keep them separate.** Deterministic tests for behaviour, an evaluation set for
quality.

## What to measure

### Retrieval

Measurable without a model, which makes it the cheapest place to start.

| Metric | Meaning |
| --- | --- |
| Recall@k | Of the chunks that should have been retrieved, how many were in the top k? |
| Precision@k | Of the top k, how many were relevant? |
| MRR | How high did the first relevant chunk rank? |

Build it from 50–100 questions with the chunk ids that should answer them. This
is a couple of days of work and it makes every subsequent retrieval change
measurable.

### Answers

Harder, because there is rarely one correct wording.

| Dimension | Question |
| --- | --- |
| **Faithfulness** | Is every claim supported by the retrieved context or a tool result? |
| **Relevance** | Does it answer what was asked? |
| **Completeness** | Does it cover the question, or only part of it? |
| **Citation** | Are claims attributed, and are the attributions correct? |
| **Refusal** | Does it say "I don't know" when the data does not support an answer? |

Faithfulness matters most. A confident, plausible, unsupported number in a
financial system is worse than no answer, because someone will act on it.

### Tool selection

Deterministically checkable, which makes it valuable:

- Did it call the right tool for the question?
- Did it call one when none was needed, or none when one was?
- Were the arguments sensible?

## The eval set

50–200 cases, each:

```json
{
  "id": "eval-023",
  "question": "What are the payment terms for Riyadh Metro?",
  "role": "manager",
  "fixture": "seeded-demo",
  "expect": {
    "citesDocuments": ["delivery-handbook.md"],
    "containsFacts": ["45 days"],
    "toolsCalled": [],
    "shouldRefuse": false
  }
}
```

Where the cases come from:

1. **Real questions.** The most valuable source. Log them (with consent) and
   sample.
2. **Each tool's intended use.** At least one question per tool.
3. **Known failure modes.** Every reported bad answer becomes a case, so it
   cannot regress.
4. **Adversarial cases.** Injection payloads, questions that should be refused,
   ambiguous questions, questions about another tenant's data.
5. **Role coverage.** The same question as each role, with different expected
   outcomes — a `member` asking about margin should be told it is not available,
   not given a number.

That last category is specific to this product and is the one a generic eval
harness would miss entirely.

## Grading

| Method | Cost | Use for |
| --- | --- | --- |
| Exact match | Free | Tool calls, refusals, citation ids |
| Substring / regex | Free | Known facts appearing in the answer |
| LLM as judge | Moderate | Faithfulness, relevance, completeness |
| Human | Expensive | Calibrating the judge; the final word |

**LLM as judge** is the practical middle: a second model receives the question,
the retrieved context and the answer, and scores whether every claim is
supported. It correlates well with human judgement when the rubric is specific,
and badly when the rubric is "is this good?".

It needs calibrating against human grades on a sample, or you are measuring the
judge's preferences rather than the product's quality.

## Running it

Not in the ordinary CI run — it costs money and it is not deterministic. A
separate workflow, triggered manually and on changes to the prompt, the tools or
the retrieval code, reporting a comparison against the last run.

**Report movement, not absolute scores.** "Faithfulness 0.87" means little on
its own; "faithfulness 0.87, down from 0.91" is actionable.

## Regression protection

The pattern that matters most in practice:

1. A user reports a bad answer
2. It becomes an eval case, with the expected behaviour
3. Fix it
4. The case now prevents that regression forever

This is the same discipline as a bug-reproducing test, and it is what stops an
AI feature oscillating between problems as prompts are tuned.

## Production signals

Cheaper than an eval set, and already partly built.

| Signal | Status |
| --- | --- |
| Thumbs up/down per message | **Built** — `ai_messages.feedback` |
| Token usage per message | **Built**, in the audit log |
| Tool call counts | Built, in the response |
| Truncation rate | Built — `truncated: true` |
| Citation rate | Derivable from stored citations |
| Retrieval-miss rate | Derivable — answers with zero citations |

The feedback column exists precisely to seed an eval set from real
dissatisfaction rather than from imagined questions.

## Cost and latency

Worth tracking alongside quality, because a change that improves answers and
triples cost is a trade someone should make deliberately:

- Tokens per conversation, input and output
- Steps per conversation
- Time to first token, and total
- Cost per conversation, and per organization

All of the underlying data is already recorded.

## What to build, in order

1. **A retrieval eval set.** 50 questions with expected chunk ids. Cheap, needs
   no model, makes every retrieval change measurable.
2. **A tool-selection eval set.** Deterministic, catches prompt regressions.
3. **An answer eval set with an LLM judge.** The expensive one, and the one that
   needs the other two first.
4. **A feedback-to-eval pipeline.** Turn thumbs-down messages into cases.

Step 1 alone would be a large improvement over the current position, which is
that nobody can tell whether a change helped.
