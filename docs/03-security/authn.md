# Authentication

Proving who someone is. Implemented in
[`apps/api/src/modules/auth/`](../../apps/api/src/modules/auth/),
[`lib/password.ts`](../../apps/api/src/lib/password.ts) and
[`lib/tokens.ts`](../../apps/api/src/lib/tokens.ts).

## Passwords

### Hashing

Argon2id, at the OWASP baseline:

| Parameter | Value | Why |
| --- | --- | --- |
| Memory | 19 MiB | Memory-hardness is what makes GPU and ASIC cracking expensive. Raising iterations alone does not |
| Iterations | 2 | Balanced against memory for ~50 ms on server hardware |
| Parallelism | 1 | Predictable cost under concurrency |
| Output | 32 bytes | |

Argon2id is the hybrid: Argon2i's side-channel resistance on the first pass,
Argon2d's GPU resistance afterwards. It is the current recommendation.

A test parses a produced hash and asserts the
`$argon2id$v=19$m=19456,t=2,p=1$` prefix, so changing the work factor without
meaning to fails the build rather than quietly weakening every account.

### The pepper

A server-side secret, passed as Argon2's `secret` parameter, mixed into every
hash. It lives in the secret manager — **not** in the database.

A salt and a pepper solve different problems:

| | Salt | Pepper |
| --- | --- | --- |
| Unique per | Password | Application |
| Stored | With the hash | In the secret manager |
| Defeats | Rainbow tables, identical-password correlation | Offline cracking of a stolen database |

A stolen database dump alone is not crackable: the attacker needs the
application secret too. Rotating the pepper invalidates every password, which is
a deliberate break-glass control.

### Policy

Minimum 12 characters, maximum 128. **No composition rules.**

Requiring an uppercase letter, a digit and a symbol produces `Password1!` —
measurably *less* entropy than a passphrase, and a predictable pattern for a
cracker. Length is the control that matters. The maximum exists to bound hashing
cost, not entropy.

The login endpoint does not apply the strength policy — only registration and
change-password do. Applying it at login would lock out anyone whose existing
password predates a policy change.

The gap worth closing: screening against a breached-password corpus
(k-anonymity against Have I Been Pwned, or a local Bloom filter). Far more
valuable than any composition rule.

## Login

```
POST /api/v1/auth/login  { email, password }
  → { user, tokens: { accessToken, refreshToken, expiresIn, tokenType } }
```

### Not enumerating users

An unknown email and a wrong password return the **same code, the same message
and comparable time**.

The timing half is the part usually missed. A missing account returns in
microseconds; an existing one takes ~50 ms of Argon2. That difference is enough
to enumerate addresses. So when the email does not exist, the code performs a
decoy verification against a hash of a value no account can hold:

```ts
if (!account) {
  await deps.services.passwords.equalizeTiming();
  throw invalidCredentials();
}
```

A locked account is also indistinguishable from a wrong password. Saying "this
account is locked" tells an attacker the address is real *and* that their
guessing is landing.

### Lockout

Eight consecutive failures locks the account. The window starts at 30 seconds
and doubles per additional failure, capped at 15 minutes. A success resets the
counter.

Growing backoff rather than a fixed lock is a deliberate trade against
denial-of-service: an attacker who knows a colleague's email should not be able
to lock them out for the day with eight wrong guesses.

## Tokens

### Access tokens — JWT

Short-lived (15 minutes by default), HS256, carrying the three facts every
request needs: user, organization, membership.

Verification pins the algorithm and checks issuer and audience:

```ts
await jwtVerify(token, key, {
  algorithms: ['HS256'],   // never trust the token's own `alg` header
  issuer, audience,
  clockTolerance: 5,
});
```

Accepting whatever `alg` the token declares is the classic JWT confusion bug —
`alg: none`, or an RS256 public key used as an HMAC secret. Pinning it costs one
line.

**The role is read from the database, not the token.** The token says which
membership; authorization re-reads that row on every request. One indexed query
buys revocation: removing someone, suspending them or demoting them takes effect
on their next request rather than whenever their token expires.

### Refresh tokens — deliberately not JWTs

Opaque 256-bit random strings, base64url, stored as SHA-256 hashes.

A JWT cannot be revoked without a blocklist, which is a database lookup — at
which point the statelessness that motivated the JWT is gone. An opaque token
that is looked up anyway is simpler and strictly more controllable.

Storing the hash means a database read does not hand an attacker live sessions.

### Rotation and replay detection

Every refresh issues a new token and retires the presented one. Presenting an
already-retired token is a **replay**, and revokes the entire family:

```
login          → token A (family F)
refresh with A → token B, A marked replaced
refresh with A → REPLAY: revoke family F entirely, audit with succeeded: false
```

Revoking the family logs out both the attacker and the legitimate client. That
is the correct outcome: one of them is holding a stolen token and we cannot tell
which, so the safe move is to end both and make the real user sign in again.

The replay is audited, so it is visible after the fact.

### Lifetimes

| Token | Default | Rationale |
| --- | --- | --- |
| Access | 15 minutes | Short enough that a leaked one has little value; long enough to avoid constant refresh |
| Refresh | 30 days | A user signing in monthly stays signed in. Rotation means a leaked one is detectable |

## Sessions in the browser

Tokens live in `httpOnly`, `sameSite=lax`, `secure` cookies set by the Next.js
app. JavaScript cannot read them —
[ADR-0007](../02-architecture/adr/0007-bff-session-cookies.md) has the full
argument, and it is verified in a real browser rather than assumed.

## Password change

Requires the current password, and **revokes every other session**. If the
change was prompted by a suspected compromise, leaving old refresh tokens live
defeats the point.

## Member provisioning

An administrator sets an initial password directly, which the member changes on
first login. Role assignment is subject to the escalation rules in
[authorization](authz-rbac.md).

This is the pragmatic path without a mail transport. The intended flow — a
single-use, time-limited invitation token emailed to the address, with the
password set by the invitee — needs email, and is the natural follow-up.

## Machine credentials

The `api_keys` table exists: hashed key, non-secret display prefix, a role, an
expiry and a revocation timestamp. The verification path is not wired into the
auth plugin yet, because no integration needs it. When it is, it should follow
the same shape as bearer verification: look up by hash, check expiry and
revocation, resolve to a role, and record `last_used_at`.

## Known gaps

1. **No MFA.** The largest gap. TOTP for `owner` and `admin` first, then
   optional for everyone, with recovery codes.
2. **No email verification.** Registration accepts an address without proving
   control of it.
3. **No password reset flow.** Needs email.
4. **No breached-password screening.** The highest-value password improvement
   available.
5. **No device or session list.** `refresh_tokens` records the user agent and
   IP, so "your active sessions" with individual revocation is mostly a UI away.
