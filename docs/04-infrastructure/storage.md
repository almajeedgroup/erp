# Storage

Where uploaded documents live, and the interface that keeps that decision
reversible.

## The interface

```ts
export interface StorageDriver {
  readonly name: 'local' | 's3';
  put: (key: string, body: Buffer, contentType: string) => Promise<StoredObject>;
  get: (key: string) => Promise<Buffer>;
  delete: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
}
```

Four methods, deliberately. A narrow interface is what makes the local driver
and an object-store driver genuinely interchangeable — no call site can come to
depend on filesystem semantics, because none are exposed.

Defined in
[`apps/api/src/lib/storage.ts`](../../apps/api/src/lib/storage.ts).

## Storage keys

Generated, never derived from user input:

```
org_3f1a8b2c.../2026/03/8c7d6e5f-4a3b-2c1d-0e9f-8a7b6c5d4e3f
```

| Part | Why |
| --- | --- |
| Organization id | Tenant isolation visible in the path; makes a per-tenant export trivial |
| Year and month | Keeps any single prefix from growing unboundedly; makes lifecycle rules easy |
| UUID | No collisions, no information in the name |

**The client's filename never touches the path.** It is stored as a display name
only. A key built from a filename is a path-traversal bug waiting for its first
`../`.

`resolveSafe` in the local driver is the second line of defence: it resolves the
path and refuses anything outside the root, rather than sanitising and
continuing. Refusing is better than repairing — a repaired path is a path
somebody constructed for a reason.

## The local driver

Used in development, in tests and in the demo profile. Writes to
`STORAGE_LOCAL_PATH`, files mode `0600`.

Not suitable for production with more than one replica: the file written by one
container is not visible to another. It works behind a shared network volume,
but that is usually more operational work than object storage.

## The S3 driver

**Not implemented.** `createStorage` throws at boot with a clear message when
`STORAGE_DRIVER=s3`:

```
STORAGE_DRIVER=s3 is not implemented yet. Use STORAGE_DRIVER=local, or see
docs/04-infrastructure/storage.md for the S3 driver contract.
```

Failing at boot rather than on the first upload is the deliberate part: a
misconfigured deployment fails immediately and visibly, rather than accepting
uploads that go nowhere.

What implementing it requires:

1. `@aws-sdk/client-s3` as a dependency
2. `put` → `PutObjectCommand` with server-side encryption
3. `get` → `GetObjectCommand`, streaming rather than buffering
4. `delete` → `DeleteObjectCommand`
5. `exists` → `HeadObjectCommand`, treating a 404 as `false`
6. Credentials from the instance role, never from static keys

The interface is S3-compatible by design, so the same driver serves
Cloudflare R2, Backblaze B2, MinIO and DigitalOcean Spaces — which also makes
local integration testing against MinIO straightforward.

## Bucket configuration

| Setting | Value | Why |
| --- | --- | --- |
| Public access | **Blocked at the account level** | A public bucket is the single most common cloud data breach, and account-level blocking means a future misconfiguration cannot override it |
| Encryption | Server-side, on | |
| Versioning | On | An accidental overwrite or delete is recoverable |
| Lifecycle | Infrequent-access after 90 days | Documents are written once and read rarely |
| Access | The application's IAM role only | |
| Logging | On, to a separate bucket | Access to documents is auditable |

## Serving a download

The browser cannot attach a bearer token — it is in an `httpOnly` cookie
precisely so scripts cannot read it — so downloads proxy through the web app's
route handler, which attaches the token server-side.

That handler re-asserts the response headers rather than trusting the upstream:

```
Content-Type: <the detected type, not the declared one>
Content-Disposition: attachment; filename*=UTF-8''<encoded>
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Cache-Control: private, no-store
```

Together these mean a stored file cannot execute in a user's browser even if
something slipped past the upload allow-list. The filename is RFC 5987-encoded
rather than interpolated raw, so a quote or a newline in a filename cannot break
out of the header.

### Presigned URLs, and why not yet

The efficient pattern is a short-lived presigned URL, so the file goes straight
from object storage to the browser without passing through the application.

Two reasons it is not used here. Every download is currently audited, and a
presigned URL is used out of band — so the audit row would record that a URL was
issued, not that a file was fetched. And the security headers above would come
from the bucket's configuration rather than from the application, which is a
weaker guarantee.

The right time to adopt it is when document sizes or volumes make proxying a
bottleneck, and the audit semantics should change deliberately at that point
rather than silently.

## Upload limits

| Limit | Default | Enforced |
| --- | --- | --- |
| File size | 25 MiB | **While reading**, not after buffering |
| Files per request | 1 | |
| Metadata fields | 20, 8 KiB each | An unbounded field count is a cheap memory-exhaustion vector |

Enforcing the size while reading is the difference between a limit and a
suggestion.

## Deletion and retention

Deleting a document soft-deletes the row and purges its retrieval chunks
immediately. The stored object is **left in place**.

That is deliberate: deleting bytes synchronously makes an accidental delete
unrecoverable, and "undo" is a feature people expect from a document store.

The consequence is that a retention job must eventually remove orphaned objects.
That job does not exist yet — it needs a job runner — and this document says so
rather than implying otherwise. See
[data privacy](../03-security/data-privacy.md#retention).

## Content types

Only the types on the allow-list in
[`packages/shared/src/domain/documents.ts`](../../packages/shared/src/domain/documents.ts)
are accepted, and the type is determined by sniffing the file's leading bytes —
not by what the request claimed.

A declared type that should carry a signature but does not is refused outright
rather than helpfully reclassified as text. Otherwise `invoice.pdf` containing
HTML gets stored, and later served, as something a browser might render.

SVG is deliberately excluded. It is XML, it can contain script, and there is no
reliable way to sanitise it that is worth the risk here.

## Backups

Object storage is durable but not backed up by default — a deletion is a
deletion. Versioning covers accidental overwrite; cross-region replication or a
periodic sync to a separate account covers deliberate deletion.

The restore story matters: a document referenced by a row that exists, whose
bytes are gone, is a broken record. The audit log records every upload and
delete, which is what makes reconciliation possible. See
[backups](backups.md).
