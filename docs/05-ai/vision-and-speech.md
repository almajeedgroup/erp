# Vision and speech

Two capabilities that would fit this product well, what they would cost, and why
neither is built.

## Computer vision: receipt and invoice OCR

### The use case

An employee photographs a receipt. The system reads the vendor, the amount, the
date and the tax, and pre-fills the expense.

This is the most valuable AI feature this product does not have. Expense entry
is universally resented, and the resentment produces exactly the outcome that
breaks the reports: people stop filing expenses promptly, or at all.

### How it would work

```
Photo uploaded
  ↓
Preprocess        deskew, crop, enhance contrast
  ↓
Extract           OCR, or a vision model
  ↓
Parse             vendor, amount, currency, date, tax
  ↓
Match             against existing vendors and projects
  ↓
Present           a pre-filled form the user confirms
```

**The user confirms.** Same principle as the agent's write tools: extraction is
a proposal, not a fact. An OCR error that silently becomes an approved expense
is a financial error with a plausible paper trail, which is worse than no
automation.

### The options

| Approach | Accuracy | Cost | Notes |
| --- | --- | --- | --- |
| Tesseract (self-hosted) | Moderate | Compute only | Good on clean scans, poor on a phone photo of a crumpled receipt |
| Cloud OCR (Textract, Document AI, Form Recognizer) | High | ~£0.01–0.05/page | Purpose-built for receipts; returns structured fields |
| A vision-capable LLM | High | ~£0.005–0.02/image | Handles messy layouts well; can be asked for a specific JSON shape |
| Fine-tuned document model | Highest | Training + hosting | Only worth it at very high volume |

For this product, a vision-capable model is the natural first attempt: it is one
API call, it handles the variety of real receipts, and the output shape is
specified in the prompt rather than mapped from a vendor's schema.

### What makes it hard

The difficulty is not the model. It is everything around it:

- **Confidence.** An extraction with no confidence signal is either trusted
  blindly or reviewed entirely, and both defeat the purpose. Field-level
  confidence is what allows "these three fields are certain, check this one".
- **Currency and locale.** `1.234,56` is one thousand in much of Europe and one
  and a bit elsewhere. Getting this wrong is a financial error.
- **Tax.** VAT presentation varies by jurisdiction and by vendor. Extracting it
  correctly is the difference between useful and merely impressive.
- **Duplicates.** The same receipt photographed twice must not become two
  expenses. The checksum on the stored file catches identical bytes; two photos
  of the same receipt are not identical bytes.
- **Storage and privacy.** Receipt images contain card details, addresses and
  purchase history. They need the same handling as any other document, including
  a retention policy.

### Why it is not built

The extraction is a day's work. The confidence model, the currency and tax
handling, the duplicate detection and the review interface are several weeks.
Shipping the day's work alone produces a feature that is wrong often enough that
people stop using it — and a feature people have stopped trusting is harder to
reintroduce than one that never shipped.

## Speech: meeting notes into tasks

### The use case

A project meeting is recorded. The system transcribes it, extracts decisions and
action items, and proposes tasks with assignees and due dates.

Genuinely useful, and a good fit for the existing agent pattern: it would be a
write tool, producing proposals a person confirms.

### How it would work

```
Audio
  ↓
Transcribe         Whisper, or a hosted equivalent
  ↓
Diarise            who said what
  ↓
Extract            decisions, action items, owners, dates
  ↓
Match              names to organization members
  ↓
Propose            tasks, confirmed by a person
```

### The options

| Approach | Quality | Cost |
| --- | --- | --- |
| Whisper, self-hosted | Very good | GPU, or slow on CPU |
| Hosted transcription | Very good | ~£0.005/minute |
| Browser speech recognition | Poor for meetings | Free |

Whisper is genuinely good, including on accented English and code-switching —
which matters for a business operating in Arabic and English.

### What makes it hard

- **Consent.** Recording a meeting has legal requirements that vary by
  jurisdiction, and they are not optional. Everyone present must know.
- **Accuracy on names.** "Assign it to Omar" is useless if there are two Omars,
  and worse if it picks the wrong one.
- **Distinguishing a decision from discussion.** "We could move the deadline" is
  not "we are moving the deadline", and a model that conflates them creates
  fictional commitments.
- **Retention.** A meeting recording is a sensitive artefact with an unclear
  retention policy.

### Why it is not built

Consent management and a review interface are the bulk of the work, and neither
is AI. The transcription is the easy part.

## The pattern

Both features share a shape, and it is the same shape as the agent's write
tools: **the model proposes, a person confirms.**

For receipts, the confirmation is a pre-filled form. For meetings, a list of
proposed tasks with checkboxes. In both cases the extraction is a draft.

Anything that writes a financial or commitment record without a human step is a
system that creates plausible fiction at scale. The confirmation is not friction
to be optimised away; it is the thing that makes the automation acceptable.

## If either is built

The sequence that keeps it honest:

1. Extraction behind the existing `AiProvider` boundary, so it is mockable and
   testable offline
2. Field-level confidence surfaced in the interface
3. Always a review step
4. Measure correction rate — how often does a user change an extracted field?
   That is the real accuracy metric, and it is available for free
5. Only then consider raising the confidence threshold at which a field is
   pre-accepted
