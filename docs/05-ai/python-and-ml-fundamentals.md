# Python and machine learning fundamentals

The concepts behind the vocabulary, and an honest answer to why this codebase is
TypeScript.

## Why there is no Python here

Python dominates machine learning for good reasons: NumPy, PyTorch, scikit-learn
and the surrounding ecosystem have no equivalent elsewhere.

None of that is needed here. The AI work in this product is **orchestration**:
call a model, manage a tool loop, chunk some text, rank some vectors. That is
API plumbing, and API plumbing in the same language as the rest of the system is
worth more than access to a library nobody is importing.

Splitting the stack would mean two languages, two toolchains, two deployment
pipelines and a duplicated domain model — for a feature whose numerical
computing is one cosine similarity function.

**When Python would earn its place here:**

- Training a model on this data — churn prediction, project overrun forecasting
- Serious time-series forecasting for cash flow
- Document layout analysis or OCR beyond a hosted API
- Any real data-science work on the accumulated history

The right shape then is a separate Python service behind HTTP, not Python inside
this repository. The boundary is already there: the API is the interface.

## The concepts, briefly

Worth knowing because the vocabulary appears throughout this documentation.

### Supervised learning

Learn a mapping from labelled examples. Given past projects labelled "over
budget" or "on budget", predict the label for a new one.

Needs labels, which is usually the hard part. This product accumulates them
naturally — every completed project is a labelled example — which is what makes
overrun prediction a realistic future feature rather than a fantasy.

### Unsupervised learning

Find structure without labels. Clustering clients by behaviour, for instance.
Useful for exploration; rarely directly actionable.

### Classification versus regression

Classification predicts a category ("will this invoice be paid late?").
Regression predicts a number ("how many days late?"). The same data often
supports both, and the choice depends on what decision the answer feeds.

### Features

The inputs. For predicting late payment: the client's history, invoice size,
payment terms, days since issue, time of year.

**Feature engineering is usually where the accuracy is**, not model choice. A
simple model on good features beats a sophisticated one on poor features, almost
always.

### Training, validation and test

Split the data three ways. Train on one part, tune on the second, and measure
once on the third.

The cardinal sin is measuring on data the model trained on, which produces a
number that is both excellent and meaningless.

### Overfitting

Learning the training data rather than the pattern. A model that scores 99% on
training data and 60% on held-out data has memorised, not learned.

The signal is a large gap between training and validation performance. The cures
are more data, a simpler model, or regularisation.

### Evaluation metrics

Accuracy is usually the wrong one. If 5% of invoices are paid late, a model that
always says "on time" is 95% accurate and completely useless.

| Metric | Answers |
| --- | --- |
| Precision | Of those flagged, how many really were? |
| Recall | Of those that really were, how many did we catch? |
| F1 | Harmonic mean of the two |
| AUC-ROC | How well does it separate the classes across all thresholds? |

Which matters depends on the cost of each error. For flagging a project at risk,
recall matters more — missing a real problem is worse than one false alarm.

## Concepts that apply directly to this system

### Embeddings

A fixed-width vector representing text, such that similar text has a similar
vector. The basis of retrieval — see [RAG](rag.md).

The deterministic embedder used here (`hashEmbedding`) is **not** semantic. It
is a stable hash projection that produces similar vectors for text sharing
tokens, which is enough to test ranking and enough for keyword-ish retrieval,
but it does not know that "payment terms" and "net 45 days" are related.

That limitation is stated plainly because it is the single biggest constraint on
retrieval quality today, and the fix is a real embedding service rather than a
better prompt.

### Cosine similarity

The angle between two vectors, ignoring magnitude:

```
cos(a, b) = (a · b) / (|a| × |b|)
```

1 is identical direction, 0 unrelated, −1 opposite. Used because direction
carries the meaning and magnitude mostly carries length.

Implemented in
[`apps/api/src/modules/ai/retrieval.ts`](../../apps/api/src/modules/ai/retrieval.ts),
including the edge cases that matter in practice: a dimension mismatch returns 0
rather than throwing, because a corpus mid-reindex can hold vectors from two
models.

### Tokens

Models process tokens, not characters. Roughly 4 characters or 0.75 words in
English; more for other scripts, which matters for Arabic content.

Tokens are the billing unit and the context limit. The estimate used here
(`length / 4`) is deliberately rough — it is for budgeting a prompt, not for
billing, and the provider reports actual usage.

## What this product could learn from its own data

Grounded in what the schema actually captures:

| Prediction | Features available today | Value |
| --- | --- | --- |
| Invoice paid late | Client history, amount, terms, issue timing | Better cash forecasting |
| Project over budget | Burn rate vs elapsed, scope changes, historical patterns | Early warning — the highest-value one |
| Time entry anomaly | Hours vs the person's pattern | Data quality |
| Client churn risk | Activity trend, invoice frequency, payment behaviour | Retention |

None are built. The honest reason: they need history. A model trained on twenty
projects predicts nothing useful, and shipping a prediction nobody should trust
is worse than shipping none.

The sensible sequence is to accumulate the data first — which the system already
does — then start with the simplest possible model and only add complexity if it
measurably beats it. A logistic regression on five good features is a legitimate
answer, and it is explainable, which matters when the output is "this project is
at risk".

## Further reading

- *An Introduction to Statistical Learning* — the best free starting point
- *Designing Machine Learning Systems*, Chip Huyen — the systems view, which is
  what most ML failures are actually about
- scikit-learn's user guide — genuinely good documentation that teaches concepts
  rather than just the API
