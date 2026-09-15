import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Password hashing.
 *
 * Argon2id at the OWASP baseline: 19 MiB of memory, 2 iterations,
 * parallelism 1. Memory-hardness is the point — it is what makes GPU and ASIC
 * cracking expensive in a way that raising an iteration count alone does not.
 * Argon2id is this library's default algorithm; `password.test.ts` parses a
 * produced hash and asserts the `$argon2id$v=19$m=19456,t=2,p=1$` prefix, so
 * a silent parameter change fails the build rather than weakening every
 * account quietly.
 *
 * A server-side **pepper** is passed as Argon2's `secret` parameter. It lives
 * in the secret manager, not the database, so a stolen dump on its own does
 * not let an attacker start cracking — they need the application secret too.
 * Rotating it invalidates every password, which is a deliberate break-glass
 * control. See docs/03-security/authn.md.
 */

const BASE_OPTIONS = {
  memoryCost: 19_456, // KiB — 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

/** A value no real password can equal, used only to burn CPU. */
const DECOY_SECRET = '::timing-equalisation-decoy::';

export interface PasswordHasher {
  hash: (plaintext: string) => Promise<string>;
  verify: (plaintext: string, encoded: string) => Promise<boolean>;
  /**
   * Burn the same amount of CPU a real verification would.
   *
   * Login must take the same time whether or not the email exists. Without
   * this, a missing account answers in microseconds and an existing one takes
   * ~50ms, which turns the login endpoint into a user-enumeration oracle.
   */
  equalizeTiming: () => Promise<void>;
}

export function createPasswordHasher(pepper: string): PasswordHasher {
  const options: Options = { ...BASE_OPTIONS, secret: Buffer.from(pepper, 'utf8') };

  // Built once, lazily, from a value no account can ever hold.
  let decoy: Promise<string> | null = null;
  const decoyHash = (): Promise<string> => (decoy ??= hash(DECOY_SECRET, options));

  return {
    hash: (plaintext) => hash(plaintext, options),

    verify: async (plaintext, encoded) => {
      try {
        return await verify(encoded, plaintext, options);
      } catch {
        // A malformed or truncated stored hash must read as "wrong password",
        // not as a 500 that tells an attacker this account is special.
        return false;
      }
    },

    equalizeTiming: async () => {
      try {
        await verify(await decoyHash(), 'not-the-password', options);
      } catch {
        // Nothing to report: the call exists only for its cost.
      }
    },
  };
}
