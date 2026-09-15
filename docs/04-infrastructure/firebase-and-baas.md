# Firebase and backend-as-a-service

What BaaS is good at, and why this system is not built on one. Written because
"why didn't you just use Firebase?" is a reasonable question that deserves a
real answer rather than a reflex.

## What Firebase provides

| Service | What it does |
| --- | --- |
| Firestore | Document database with realtime sync and offline support |
| Realtime Database | The older JSON-tree store |
| Authentication | Social login, email, phone, MFA — genuinely excellent |
| Cloud Functions | Serverless functions, triggered by events or HTTP |
| Storage | Object storage with security rules |
| Hosting | Static hosting with a CDN |
| Analytics, Crashlytics, Messaging | The mobile toolkit |

The model is that clients talk to the database directly, and **security rules**
decide what each client may read and write.

## What it is genuinely excellent at

**Mobile and realtime applications.** Offline support with automatic conflict
resolution is hard, and Firestore does it well. A chat app, a collaborative
document, a delivery tracker — Firebase is a strong choice and will get you
there faster than anything else.

**Authentication.** Social providers, phone verification, MFA, account linking.
This is weeks of work, done well, for free. Worth considering even in a system
that uses nothing else from the platform.

**Getting to a working prototype.** Genuinely unmatched. A functioning product
in days rather than weeks.

**Scaling without thinking about it.** Firestore scales horizontally with no
capacity planning.

## Why this system is not built on it

### 1. The data is deeply relational

An invoice belongs to a client, optionally to a project, has many lines and many
payments. Project profitability joins projects, time entries, employees and
expenses. Receivables aging aggregates invoices and payments.

In Firestore, joins do not exist. The options are denormalisation — copying the
client's name onto every invoice, and updating them all when it changes — or
multiple round trips from the client.

The project profitability report joins four tables and aggregates. In SQL that
is one query. In Firestore it is a maintained aggregate document, updated by
Cloud Functions on every write, that can silently drift from the underlying
data. For a financial figure, "can silently drift" is disqualifying.

### 2. No transactions across the operations that need them

Issuing an invoice must, atomically: allocate a gapless number from a counter,
update the invoice, and write an audit row. Recording a payment must update the
payment, the invoice's paid amount and its status together.

Firestore has transactions, but they are limited in scope and cannot express
`SELECT ... FOR UPDATE` on a counter. Gapless sequential numbering under
concurrency is genuinely difficult in a document store — and tax authorities
generally want an unbroken series.

### 3. Security rules cannot express these rules

Firestore rules are good at ownership: "a user may read a document where
`userId == request.auth.uid`". They struggle with:

- "An issued invoice cannot be edited"
- "Totals must equal the sum of the lines"
- "An expense cannot be approved by the person who filed it"
- "Only an owner may create another owner"
- "Compensation is visible only with a specific permission"

You end up putting the logic in Cloud Functions and locking the database to
server-only access — at which point you have an API, written in a harder place
to test, and you are paying for a database designed for direct client access
that no client accesses.

### 4. Aggregation and reporting

Analytics here is sums, groupings and date bucketing across large sets. SQL is
built for it. Firestore's aggregation is limited, and the usual answer — export
to BigQuery and query there — means two datastores and a sync lag, for reports
that need to be current.

### 5. Cost at this shape

Firestore bills per document read. The project profitability report reads every
time entry, every invoice and every expense in the period. A dashboard that
refreshes reads thousands of documents per view. Postgres reads them from the
buffer cache for approximately nothing.

### 6. Vendor lock-in

Firestore's query model, security rules and SDKs have no equivalent elsewhere.
Migrating off is a rewrite. Postgres runs on every cloud, on a laptop, and in
CI — which is also why the test suite can run in-process.

## When BaaS is the right call

Reversing the argument honestly. Choose Firebase or similar when:

- The data is naturally document-shaped with shallow relationships
- Realtime sync or offline support is a core requirement
- Mobile is the primary client
- Speed to a working prototype matters more than long-term flexibility
- Authorization is mostly ownership-based
- The team is small and does not want to operate a backend
- Reporting is light, or can live in a separate system

A field-service app where technicians update job status offline is a much better
fit for Firebase than for this architecture.

## The middle ground

Using one part without the whole:

- **Firebase Authentication with a custom backend.** Genuinely attractive. You
  get social login, MFA and phone verification, and your API verifies the
  Firebase ID token instead of issuing its own. The cost is a dependency on
  Google's availability for sign-in, and a less direct mapping to the membership
  model here.
- **Firebase Hosting for static assets.** Fine, and interchangeable with any CDN.
- **Cloud Messaging for push notifications.** Reasonable if a mobile client is
  ever built.

## The decision, in one line

Firebase optimises for **getting a document-shaped, realtime, client-heavy
application working quickly**. This product is a **relational, transactional,
report-heavy system of record where the business rules are the product.** The
optimisation targets do not overlap.
