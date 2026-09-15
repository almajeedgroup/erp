import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Small cryptographic helpers.
 *
 * All of them are thin wrappers over `node:crypto`. Writing them out here
 * rather than inline at call sites means there is exactly one place that
 * decides how a token is generated and how two secrets are compared.
 */

/** 256 bits of CSPRNG output, base64url — the format for refresh tokens and API keys. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256, hex. Used to store token *hashes*, never the tokens themselves. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value: Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Constant-time string comparison.
 *
 * `a === b` leaks the length of the matching prefix through timing. For secret
 * comparison that is a real (if fiddly) attack, so both sides are hashed to a
 * fixed 32 bytes first — which also removes the length side channel that
 * `timingSafeEqual` would otherwise expose by throwing on a length mismatch.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}
