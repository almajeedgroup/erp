# Data privacy

What personal data this system holds, why, and what a person can ask for.

Written against GDPR-shaped principles because they are the strictest widely
applicable ones. Saudi Arabia's PDPL, the UAE's PDPL and the UK's GDPR are
close enough that a system built this way satisfies all of them.

## What is held, and about whom

### Employees — the most sensitive

| Field | Lawful basis | Necessary because |
| --- | --- | --- |
| Name, job title, department | Contract | Identifying who did the work |
| Email, phone | Contract | Contact |
| Employment dates, type | Contract / legal obligation | Employment records |
| **Compensation** | Contract | Project margin is meaningless without labour cost |
| **National id** | Legal obligation | Payroll and statutory reporting |
| **Bank account** | Contract | Payment |
| Cost rate, billable rate | Legitimate interest | Profitability reporting |

The three bold fields are the ones that make this a serious privacy question
rather than a formality.

### Users — people who sign in

Email, name, password hash, last login, failed login count. Plus refresh tokens
with the user agent and IP of each session.

### Clients and contacts — people at other organizations

Name, title, email, phone. Personal data about someone who is not our customer
and has not interacted with us — the lawful basis is legitimate interest in
managing a business relationship, and it is worth being deliberate about
collecting no more than the relationship needs.

### Audit log — behavioural data

Who did what, when, from which IP, with which user agent. Personal data, and
retained longer than most of the rest.

## The principles, and how the system honours them

**Minimisation.** Employee records hold what payroll and margin need, and
nothing else. There is no date of birth, no home address, no emergency contact,
no photograph — not because they would be useless, but because each would be
another field to protect and to delete on request.

**Purpose limitation.** Compensation exists for margin calculation. It is
excluded from AI retrieval and redacted from audit snapshots, so it does not
leak into purposes it was not collected for.

**Accuracy.** Every record is editable by someone with the permission, and every
change is audited.

**Storage limitation.** See retention, below. Partly implemented.

**Integrity and confidentiality.** Access control, encryption in transit and at
rest, audit logging. See the rest of this section.

**Accountability.** The audit log is the mechanism. Every access to sensitive
data by a permitted role is not individually logged, which is a gap worth
naming — see below.

## Access control for personal data

Compensation, national id and bank details require `employee:read_sensitive`,
which is `finance` and above. A delivery manager sees a colleague's name, role
and availability, and not their salary.

The redaction happens in the single mapper every read path uses, so it cannot be
forgotten by a new endpoint. Writing one of these fields requires the permission
to read it — otherwise setting a salary you cannot see becomes an oracle.

## AI and personal data

Three rules, all enforced in code rather than policy:

1. **Indexing is opt-in per document.** Nothing is chunked or embedded unless
   someone set `indexForAi`.
2. **Confidential documents are never indexed**, regardless of that flag.
3. **Changing either flag purges the index immediately.** A flag that leaves
   stale chunks behind is decorative.

Employee records are not retrievable by the agent at all — the retrieval corpus
is documents, and compensation is excluded from the fields any tool returns to a
caller without the permission.

When `AI_PROVIDER=anthropic`, prompt content leaves the system. What is in a
prompt is: the user's question, retrieved excerpts from documents they opted in,
and tool results they were entitled to fetch. That is a processor relationship
and belongs in the record of processing activities.

## Retention

| Data | Retention | Basis |
| --- | --- | --- |
| Financial records | 7 years after the tax year | Statutory |
| Employee records | 7 years after termination | Employment law |
| Audit log | 2 years | Security investigation |
| Refresh tokens | 30 days after expiry | Housekeeping |
| AI conversations | 1 year | Product improvement |
| Soft-deleted rows | Until the statutory period ends | See above |

**Honest status:** the schema supports this (`deleted_at` everywhere, dated
rows throughout) and `pruneRefreshTokens` exists, but there is **no scheduled
retention job**. Implementing it needs a job runner, which the system does not
have yet. Until then, retention is a manual operational task, and this document
says so rather than implying otherwise.

## Subject requests

### Access — "what do you hold about me?"

Not automated. Today: a `SELECT` per table filtered by the person's id, run by
an operator. The tables to cover: `users`, `memberships`, `employees`,
`contacts`, `time_entries`, `tasks` (as assignee or author), `task_comments`,
`expenses`, `ai_conversations`, `ai_messages`, `audit_logs`, `refresh_tokens`.

Worth building as a real export before the first request arrives, not after.

### Rectification — "this is wrong"

Every field is editable through the ordinary UI, and the change is audited.

### Erasure — "delete me"

The genuinely hard one, because erasure conflicts with statutory retention and
with the integrity of financial records.

The position this system takes:

- **A user account** can be erased: the row is anonymised (email replaced with a
  non-routable placeholder, name replaced with "Deleted user"), memberships
  revoked, refresh tokens deleted.
- **An employee record within its retention period** cannot be erased, because
  employment law requires it. The sensitive fields — national id, bank account —
  *can* be nulled once they are no longer needed for payroll, which materially
  reduces the exposure.
- **Audit rows are not erased.** They are the record of what happened, and
  erasing them defeats the purpose of having them. The actor id may be
  pseudonymised after the retention period.
- **Financial records are not erased.** A client contact's name on an invoice
  from three years ago stays there.

This position should be stated in the privacy notice rather than discovered
during a request.

### Portability — "give me my data"

The organization's data is exportable through the API. A per-subject
machine-readable export is not built.

## Breach notification

GDPR requires notification to the supervisory authority within 72 hours of
becoming aware of a breach involving personal data, and to affected individuals
without undue delay where the risk is high.

That clock starts at *awareness*, which is why detection matters as much as
prevention. See [incident response](../07-operations/incident-response.md).

The audit log is the primary tool for scoping a breach: it answers what was
accessed, by whom and when, which determines whether notification is required
and who must be told.

## Sub-processors

| Processor | Data | Where |
| --- | --- | --- |
| Cloud provider | Everything | The chosen region |
| Model provider (if `AI_PROVIDER=anthropic`) | Prompt content | Per their terms |

Both belong in the record of processing activities and in the privacy notice. A
customer in a regulated sector may require the AI provider to be disabled, which
is one environment variable — `AI_PROVIDER=mock` — and a product decision about
what that degrades.

## Gaps

Named plainly:

1. **No scheduled retention job.** The largest gap. Needs a job runner.
2. **No automated subject-access export.** Manual today.
3. **No per-access logging of sensitive fields.** The audit log records changes,
   not reads. Logging every read of a salary would answer "who looked at my pay?"
   — a reasonable question with no answer today.
4. **No consent management for AI.** `indexForAi` is set by the uploader, not by
   the data subject. Fine for company documents; not sufficient if a document
   contains third-party personal data.
5. **No data-protection impact assessment.** The employee module, holding
   national ids and bank details, warrants one.
