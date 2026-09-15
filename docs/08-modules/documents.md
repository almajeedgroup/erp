# Documents

File storage with metadata, an ownership link to the rest of the system, and
optional indexing for the [AI agent](ai-agent.md). Uploads are where untrusted
bytes enter the system, so most of this page is about not trusting them.

| | |
| --- | --- |
| Routes | `apps/api/src/modules/documents/routes.ts` |
| Service | `apps/api/src/modules/documents/service.ts` |
| Type detection | `apps/api/src/lib/filetype.ts` |
| Storage driver | `apps/api/src/lib/storage.ts` |
| Tables | `documents`, `document_chunks` |
| Tests | `documents.test.ts` — 18 |
| UI | `/documents` |

## What it owns

A **document** is a stored file plus metadata: title, filename, content type,
size, SHA-256 checksum, category, tags, and who uploaded it.

**Bytes live in object storage; metadata lives in Postgres.** The row holds a
`storage_key`. Keeping files out of the database keeps backups small and
restores fast, and it means the database and the file store can be sized and
scaled independently. [Storage](../04-infrastructure/storage.md) covers the
driver contract.

### Ownership

A document belongs to the organization and optionally to one other thing:

```
owner_type: organization | client | project | employee | invoice | expense | task
owner_id:   the id of that thing
```

Polymorphic by design. A receipt belongs to an expense, a contract to a client,
an ID scan to an employee — one table with a discriminator rather than seven
join tables. The trade-off is no foreign key on `owner_id`, which is why the
service validates the target exists and is in the same organization before
writing.

### Categories

`contract`, `proposal`, `invoice`, `receipt`, `report`, `policy`,
`identification`, `deliverable`, `other`.

## The upload path

This is the part to read carefully.

**1. Size is capped before anything is read.** `STORAGE_MAX_UPLOAD_BYTES`,
default 25 MiB, enforced by the multipart parser — so an oversized upload is
rejected as it streams, not after it has filled a disk.

**2. The declared content type is treated as a claim, not a fact.** A browser
sends whatever it likes, and uploaders include attackers. Renaming `shell.html`
to `invoice.pdf` and declaring `application/pdf` must not result in a file that
is later served as HTML — that is stored XSS with extra steps.

So the server reads the leading bytes and identifies the format from its
signature:

```
%PDF          → application/pdf
\x89PNG       → image/png
\xFF\xD8\xFF  → image/jpeg
PK\x03\x04    → application/zip … and every OOXML document, resolved by declaration
\xD0\xCF\x11\xE0 → legacy OLE: .doc, .xls, .ppt
```

**The sniffed type wins.** It is what gets stored, what is checked against the
allow-list, and what is echoed on download.

The declared type is consulted in exactly two places: to break ties between
container formats that share a signature (a `.docx` and a `.xlsx` are both ZIPs),
and to name formats that genuinely have no signature — `text/plain`, `text/csv`,
`text/markdown`, `application/json`.

**3. Unidentified means rejected, not guessed.** Anything the sniffer cannot
place resolves to `application/octet-stream`, which is **not** on the
allow-list — so "I could not tell what this is" is a 415.

This was a real bug. The fallback used to be `text/plain`, which *is* allowed, so
an HTML file declared as `application/pdf` was reclassified as text and accepted
with a 201. The fix introduced a `SIGNATURE_REQUIRED` set: a declared type that
must be backed by matching bytes cannot fall through to anything permissive.

**4. The allow-list is explicit.** PDF, PNG, JPEG, WebP, GIF, plain text, CSV,
Markdown, JSON, the Office formats (legacy and OOXML), and ZIP. Sixteen types.
Anything else is a 415 listing what is accepted.

**5. Filenames cannot traverse.** `busboy` applies `basename()` before the
service sees the name, so `../../etc/passwd` arrives as `passwd`. The test
asserts the invariant that matters — no path separator survives — rather than
asserting a specific rejection that the parser makes unreachable.

**6. Storage keys are generated, never derived from user input.** The uploaded
filename is metadata only; it never becomes part of a path.

**7. A SHA-256 checksum is computed and stored**, so corruption is detectable and
duplicate uploads are identifiable.

## The download path

Three headers, each doing a specific job:

```http
Content-Disposition: attachment; filename*=UTF-8''receipt%20march.pdf
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

`attachment` means the browser downloads rather than renders. `nosniff` stops it
second-guessing the content type. The CSP is belt and braces: even if something
does render, it can load nothing and run nothing.

The filename is RFC 5987-encoded, never interpolated raw — a filename containing
a quote or a newline would otherwise let an uploader inject a header.

Downloads are audited (`document.downloaded`). Who read which contract, and when,
is frequently the question that matters.

## AI indexing

Two independent booleans, and the interaction between them is the rule:

| Field | Meaning |
| --- | --- |
| `index_for_ai` | Chunk, embed and make retrievable by the assistant |
| `confidential` | Exclude from AI retrieval regardless |

```ts
const shouldIndex = input.indexForAi && !input.confidential;
```

**Confidential always wins.** Not as a filter at query time — the chunks are
never created, so there is nothing to leak even if retrieval were later changed.
Marking an already-indexed document confidential deletes its chunks.

Indexing is **opt-in**. A document is not retrievable by the assistant unless
someone said so. The alternative — index everything, filter on read — puts one
bug between a salary letter and a chat response.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/documents` | `document:read` |
| POST | `/api/v1/documents` | `document:upload` |
| GET | `/api/v1/documents/:documentId` | `document:read` |
| GET | `/api/v1/documents/:documentId/download` | `document:read` |
| PATCH | `/api/v1/documents/:documentId` | `document:upload` |
| DELETE | `/api/v1/documents/:documentId` | `document:delete` |

The web app proxies downloads through its own route
(`apps/web/src/app/api/documents/[documentId]/download/route.ts`) so the API
token stays server-side — the browser never holds a credential.

## Who can do what

| Role | Read | Upload | Delete |
| --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ |
| finance | ✓ | ✓ | — |
| member | ✓ | ✓ | — |
| viewer | ✓ | — | — |

Everyone who works reads and uploads. Deleting is narrower, because a deleted
contract is a missing contract — a manager has it for their own project
documents, finance and members do not.

Note that `document:read` does not distinguish confidential documents: anyone
who can read the module can read a confidential one. The `confidential` flag
controls **AI indexing**, not human access. If per-document access control is
needed, it is not built — see below.

## Rules

**Deletion is soft, and leaves the object in place.** `deleted_at` on the row;
the bytes stay. A mistaken delete is recoverable. Hard deletion — removing the
object too — exists only for data-subject requests and is a separate, deliberate
procedure.

**Chunks are deleted eagerly.** Soft-deleting a document removes its
`document_chunks` immediately, so the assistant cannot retrieve from a document
that no longer exists.

## Edges

- **→ [AI agent](ai-agent.md)** — indexed chunks are what RAG retrieves
- **← [Clients](clients.md), [Projects](projects.md), [Employees](employees.md),
  [Finance](finance.md), [Tasks](tasks.md)** — anything can own a document

## Not built

- **No virus scanning.** A real gap, and the most important item on this list.
  Files are validated for type and size, not for malice. The hook is the storage
  driver: scan on write, quarantine on detection.
- **No per-document permissions.** Access is module-level. `confidential`
  excludes from AI, not from people.
- **No versioning.** Uploading a replacement is a new document.
- **No text extraction from PDFs or images.** Only text-like formats are
  chunked for AI, so a scanned contract indexes as nothing. OCR is discussed in
  [vision and speech](../05-ai/vision-and-speech.md).
- **No preview.** Download only.
- **No signed direct-to-storage URLs.** Bytes pass through the API, which is
  simpler and keeps the audit complete, and which will not scale to large files.
