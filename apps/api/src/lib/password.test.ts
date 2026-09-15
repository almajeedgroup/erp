import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from './password.js';

const PEPPER = 'test-pepper-at-least-32-characters-long!!';

describe('password hashing', () => {
  it('produces argon2id hashes at the documented parameters', async () => {
    const hasher = createPasswordHasher(PEPPER);
    const encoded = await hasher.hash('correct horse battery staple');
    // Pinning this prefix is how a silent downgrade of the work factor gets
    // caught: any change to memory, time or parallelism fails here.
    expect(encoded.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hasher = createPasswordHasher(PEPPER);
    const encoded = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify('correct horse battery staple', encoded)).toBe(true);
    expect(await hasher.verify('Correct horse battery staple', encoded)).toBe(false);
    expect(await hasher.verify('', encoded)).toBe(false);
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const hasher = createPasswordHasher(PEPPER);
    const [a, b] = await Promise.all([hasher.hash('same password'), hasher.hash('same password')]);
    expect(a).not.toBe(b);
    expect(await hasher.verify('same password', a)).toBe(true);
    expect(await hasher.verify('same password', b)).toBe(true);
  });

  it('makes a stolen hash useless without the pepper', async () => {
    const encoded = await createPasswordHasher(PEPPER).hash('correct horse battery staple');
    const attacker = createPasswordHasher('a-different-pepper-32-characters-long!!!');
    expect(await attacker.verify('correct horse battery staple', encoded)).toBe(false);
  });

  it('treats a corrupt stored hash as a failed login, not an error', async () => {
    const hasher = createPasswordHasher(PEPPER);
    expect(await hasher.verify('anything', 'not-a-hash')).toBe(false);
    expect(await hasher.verify('anything', '')).toBe(false);
    expect(await hasher.verify('anything', '$argon2id$truncated')).toBe(false);
  });

  it('spends comparable time on a decoy as on a real verification', async () => {
    const hasher = createPasswordHasher(PEPPER);
    const encoded = await hasher.hash('correct horse battery staple');

    const realStart = process.hrtime.bigint();
    await hasher.verify('wrong password', encoded);
    const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;

    await hasher.equalizeTiming(); // warm the lazily built decoy
    const decoyStart = process.hrtime.bigint();
    await hasher.equalizeTiming();
    const decoyMs = Number(process.hrtime.bigint() - decoyStart) / 1e6;

    // Same order of magnitude is the property that matters; exact parity is
    // neither achievable nor required.
    expect(decoyMs).toBeGreaterThan(realMs / 5);
  });
});
