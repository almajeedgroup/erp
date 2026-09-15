# Clients

The commercial root of the graph. Projects, invoices and most documents hang off
a client, which is why this module's rules are mostly about **refusing to break
those references**.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/clients/routes.ts` |
| Service | `apps/api/src/modules/clients/service.ts` |
| Tables | `clients`, `contacts` |
| Tests | `clients.test.ts` — 25 |
| UI | `/clients` |

## What it owns

A **client** is a company you sell to. It carries the commercial terms that
downstream modules read rather than re-ask for: billing currency, payment terms
in days, tax number, and the acquisition channel that
[analytics](analytics.md) groups the pipeline by.

A **contact** is a person at that client. Contacts belong to exactly one client
and are soft-deleted with it.

### Lifecycle

```
lead ──▶ prospect ──▶ active ──▶ dormant ──▶ churned
```

The status is descriptive, not a state machine: any transition is allowed,
because real commercial relationships do not move in one direction and a system
that refuses to mark a churned client active again is a system people work
around.

### Fields worth knowing

| Field | Why it exists |
| --- | --- |
| `billing_currency` | Invoices for this client default to it — and `finance` refuses to mix currencies on one invoice |
| `payment_terms_days` | Default 30. Drives the invoice due date at issue time |
| `acquisition_channel` | `referral`, `outbound`, `inbound`, `partner`, `event`, `marketplace`, `other`. The only field that connects this module to CAC |
| `owner_id` | The account owner. Informational; it does **not** restrict access |
| `tax_number` | Appears on issued invoices; jurisdictions require it |
| `address` | JSONB. Formats vary by country enough that columns would be wrong |

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/clients` | `client:read` |
| POST | `/api/v1/clients` | `client:create` |
| GET | `/api/v1/clients/:clientId` | `client:read` |
| PATCH | `/api/v1/clients/:clientId` | `client:update` |
| DELETE | `/api/v1/clients/:clientId` | `client:delete` |
| GET | `/api/v1/clients/:clientId/contacts` | `client:read` |
| POST | `/api/v1/clients/:clientId/contacts` | `client:update` |
| DELETE | `/api/v1/clients/:clientId/contacts/:contactId` | `client:update` |

Listing supports keyset pagination, a status filter and a `q` search across name
and email (`ILIKE`, with the pattern escaped in `lib/query.ts` so a `%` in user
input does not become a wildcard).

## Rules

**Deletion is refused while the client is referenced.** `deleteClient` counts
active projects and unpaid invoices first, and returns **409 Conflict** with the
count if either is non-zero:

```
409 { "code": "conflict", "message": "This client still has active projects",
      "details": { "activeProjects": 3 } }
409 { "code": "conflict", "message": "This client still has unpaid invoices",
      "details": { "openInvoices": 2 } }
```

An ERP that lets you delete the counterparty on an outstanding invoice is not a
system of record. The count is returned because "it failed" without "because of
these three" is a support ticket.

**Deletion is soft.** `deleted_at` is set, and `scope()` filters the row out of
every subsequent read. Contacts are soft-deleted in the same transaction. The
data survives for audit and for recovery from a mistaken delete — see
[disaster recovery](../07-operations/disaster-recovery.md#1-bad-data-write--a-wrong-update-or-delete).

**One primary contact.** A partial unique index —
`is_primary = true AND deleted_at IS NULL` — enforces it in the database rather
than in application code, so two concurrent requests cannot both win.

**Every change is audited.** `client.created`, `client.updated`,
`client.deleted`, `contact.created`, `contact.deleted`, each with `before` and
`after` snapshots of the changed fields only (`diffSnapshot` in `lib/audit.ts`),
so the audit log answers "who changed the payment terms" without storing the
whole row every time.

## Who can do what

| Role | Read | Create | Update | Delete |
| --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | — |
| finance | ✓ | — | — | — |
| member | ✓ | — | — | — |
| viewer | ✓ | — | — | — |

A manager runs the relationship but cannot remove it. Deletion is the
irreversible-looking operation, so it stays with admin and owner.

## Edges

- **→ [Projects](projects.md)** — every project belongs to a client
- **→ [Finance](finance.md)** — invoices take currency and payment terms from here
- **→ [Documents](documents.md)** — a document can be owned by a client
- **→ [Analytics](analytics.md)** — pipeline by status and by acquisition channel
- **→ [AI agent](ai-agent.md)** — the `search_clients` tool reads this module
  through the same service, with the same permission check

## Not built

- **No deduplication.** Two clients with the same name or tax number are allowed.
  A unique index on `(organization_id, tax_number)` would be the first step, but
  tax numbers are optional and duplicates in the wild are real.
- **No CRM activity timeline.** No calls, emails or meetings. `audit_logs` shows
  what the *system* recorded, not what happened commercially.
- **No hierarchy.** No parent/subsidiary relationship.
- **No credit limit.** Nothing stops issuing a tenth invoice to a client who has
  not paid the first nine, beyond the receivables aging report making it visible.
