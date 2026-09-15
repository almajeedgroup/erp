import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, assertId, idKind, isId, newId } from './ids.js';

describe('ids', () => {
  it('generates prefixed, correctly shaped ids for every entity kind', () => {
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const value = newId(kind);
      expect(value.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
      expect(isId(kind, value)).toBe(true);
      expect(idKind(value)).toBe(kind);
    }
  });

  it('does not accept an id of a different kind', () => {
    const client = newId('client');
    expect(isId('project', client)).toBe(false);
    expect(() => assertId('project', client)).toThrow(TypeError);
  });

  it('rejects malformed values', () => {
    expect(isId('client', 'cli_')).toBe(false);
    expect(isId('client', 'cli_not-hex')).toBe(false);
    expect(isId('client', 'cli_ABCDEF01234567890123456789012345')).toBe(false); // uppercase
    expect(isId('client', 42)).toBe(false);
    expect(isId('client', null)).toBe(false);
    expect(idKind('nope')).toBe(null);
    expect(idKind('zzz_00000000000000000000000000000000')).toBe(null);
  });

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => newId('task')));
    expect(ids.size).toBe(2_000);
  });
});
