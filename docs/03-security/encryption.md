# Encryption

What is encrypted, with what, and — as importantly — what hashing is not.

## Hashing is not encryption

A recurring confusion worth stating once. Encryption is reversible with a key;
hashing is not reversible at all.

| | Encryption | Hashing |
| --- | --- | --- |
| Reversible | Yes, with the key | No |
| Used here for | Data at rest, data in transit | Passwords, tokens, file checksums |
| Failure mode | Key compromise exposes everything | A weak algorithm makes brute force cheap |

Passwords are hashed because nobody — including us — should ever be able to
recover them. Refresh tokens are hashed for the same reason: a database read
should not hand an attacker live sessions.

## In transit

TLS 1.2 or better, terminated at the edge (load balancer or CDN). TLS 1.0 and
1.1 are disabled; so are the cipher suites without forward secrecy.

Three hops to think about:

| Hop | Requirement |
| --- | --- |
| Browser → web app | TLS, HSTS with `includeSubDomains` and `preload` in production |
| Web app → API | TLS if they cross a network boundary. Same host or private network is acceptable within a VPC |
| API → database | **Required** in every non-local environment. `DATABASE_SSL=true`, and the config refuses to start in production without it |

The database hop is the one people forget. Unencrypted Postgres traffic inside a
VPC is still plaintext to anyone who reaches the network, and a misconfigured
peering or a compromised neighbour is not a hypothetical.

HSTS is production-only. Sending it in development pins `localhost` to HTTPS in
the browser and produces a confusing afternoon.

## At rest

| What | How |
| --- | --- |
| Database | Volume encryption from the managed provider (AES-256), keys managed by the platform |
| Backups | Encrypted with the same key material; encrypted in transit to their destination |
| Object storage | Server-side encryption, enabled on the bucket |
| Local storage driver | The filesystem's encryption. Files written `0600` |

Volume encryption defends against a stolen disk or a decommissioned volume. It
does **not** defend against an attacker with database credentials, because the
database decrypts transparently for anyone who can connect. That is what least
privilege and secret rotation are for.

### What is not encrypted at the column level

National ids, bank details and compensation are stored in plaintext columns,
protected by access control rather than encryption.

This is a deliberate trade, and worth being honest about. Column-level
encryption would protect against an attacker who reaches the database but not
the application secrets. It would also break every query — you cannot `ORDER BY`
or `ILIKE` an encrypted column — and add key rotation as a hard operational
problem.

The alternative controls are: `employee:read_sensitive` gating every read,
redaction in the mapper every read path goes through, exclusion from audit
snapshots and AI retrieval, and least-privilege database grants.

The trigger to revisit: a regulatory requirement, or storing something whose
exposure is catastrophic rather than serious — full payment card data, say,
which this system deliberately does not hold.

## Passwords

Argon2id with a server-side pepper. Full detail in
[authentication](authn.md#passwords); the short version is 19 MiB of memory,
2 iterations, and a secret that lives outside the database so a stolen dump is
not crackable on its own.

## Tokens and keys

| Secret | Storage | Comparison |
| --- | --- | --- |
| Refresh token | SHA-256 hex, unique index | By hash lookup |
| API key | SHA-256 hex, plus a non-secret display prefix | By hash lookup |
| Access token | Not stored — verified by signature | N/A |

Hashing with SHA-256 rather than Argon2 is correct here, and the reason matters:
these are 256-bit random values, not user-chosen passwords. There is no
dictionary to attack, so the slow-hash property buys nothing, and a fast hash
keeps the lookup cheap.

## Constant-time comparison

Where two secrets are compared directly, `safeEqual` hashes both sides to a
fixed 32 bytes and uses `timingSafeEqual`:

```ts
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}
```

`a === b` short-circuits at the first differing byte, leaking the length of the
matching prefix through timing. Hashing first also removes the length side
channel that `timingSafeEqual` would otherwise expose by throwing on a length
mismatch.

## Randomness

Every secret is generated with `node:crypto`, which is a CSPRNG:

```ts
randomBytes(32).toString('base64url')   // refresh tokens, API keys
randomUUID()                            // identifiers
```

`Math.random()` is never used for anything security-relevant. It is seeded
predictably and is not a CSPRNG.

## Checksums

Uploaded files record a SHA-256 of the stored bytes. This is an integrity check
and a cheap duplicate-detection mechanism, not a security control — an attacker
who can replace the bytes can replace the checksum.

## Key rotation

| Key | Rotation | Effect |
| --- | --- | --- |
| `JWT_SECRET` | Quarterly, or on suspicion | Every access token becomes invalid; refresh tokens still work, so users recover automatically on their next refresh |
| `PASSWORD_PEPPER` | Only on compromise | **Invalidates every password.** A break-glass control, requiring a forced reset for everyone |
| TLS certificates | Automated (ACME), 90 days | None if automation works |
| Database credentials | Quarterly | Requires a rolling restart |

Rotating `JWT_SECRET` without downtime needs the verifier to accept both the old
and new key for one access-token lifetime. Not implemented; today a rotation
logs everyone out of their current access token, which recovers silently via
refresh. See [secrets management](secrets-management.md).

## What would change at a higher assurance level

If this system took payment card data or health records:

- Column-level encryption for the regulated fields, with envelope encryption and
  a managed KMS
- A hardware security module or KMS for the JWT signing key, so it is never in
  application memory
- Asymmetric signing (RS256/EdDSA) so verifiers never hold a key that can sign
- Certificate pinning between services
- Encrypted, access-logged, separately-keyed backups

None of that is warranted for the data this system actually holds, and each
piece has a real operational cost. Adding it "to be safe" without the
requirement is how systems become unmaintainable.
