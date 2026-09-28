// The decoder is the exact inverse of the sim's canonical encoder, and rejects anything else.
import { encodeCanonical, Rng, SNAPSHOT_ENCODING_VERSION } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { CanonicalDecodeError, DECODER_ENCODING_VERSION, decodeCanonical } from './codec';

/** A random plain value: every canonical kind, awkward numbers and strings, bounded depth. */
function randomValue(rng: Rng, depth = 0): unknown {
  const kind = rng.int(0, depth > 3 ? 4 : 6);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return rng.chance(0.5);
    case 2: {
      const special = [0, -0, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, 0.1];
      return rng.chance(0.3)
        ? special[rng.int(0, special.length - 1)]
        : (rng.float() - 0.5) * 2 ** rng.int(0, 60);
    }
    case 3:
      return rng.int(-1_000_000, 1_000_000);
    case 4:
      return Array.from({ length: rng.int(0, 6) }, () =>
        String.fromCharCode(rng.int(0, 0xffff)),
      ).join('');
    case 5:
      return Array.from({ length: rng.int(0, 4) }, () => randomValue(rng, depth + 1));
    default: {
      const out: Record<string, unknown> = {};
      for (let i = rng.int(0, 4); i > 0; i--) out[`k${String(rng.int(0, 20))}`] = randomValue(rng);
      return out;
    }
  }
}

/** Canonical bytes built by hand: an object with the given raw key bodies (each maps to null). */
function objectWithKeys(...keys: string[]): Uint8Array {
  const parts: number[] = [0x06, 0, 0, 0, keys.length];
  for (const key of keys) {
    parts.push(0, 0, 0, key.length);
    for (const ch of key) parts.push(0, ch.charCodeAt(0));
    parts.push(0x00);
  }
  return Uint8Array.from(parts);
}

describe('decodeCanonical', () => {
  it('reads the encoding version the sim writes', () => {
    expect(DECODER_ENCODING_VERSION).toBe(SNAPSHOT_ENCODING_VERSION);
  });

  it('inverts encodeCanonical for every value kind, bit-exact', () => {
    const value = {
      nothing: null,
      yes: true,
      no: false,
      numbers: [0, -0, NaN, Infinity, -Infinity, 1.5, -(2 ** 53)],
      text: ['', 'plain', 'é漢😀', '\ud800 lone surrogate'],
      nested: { b: [[], {}], a: { deep: [1, [2, [3]]] } },
    };
    const decoded = decodeCanonical(encodeCanonical(value));
    expect(decoded).toEqual(value);
    expect(Object.is((decoded as typeof value).numbers[1], -0)).toBe(true);
  });

  it('keeps a "__proto__" key as an own property, never a prototype', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    const decoded = decodeCanonical(encodeCanonical(value)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.keys(decoded)).toEqual(['__proto__', 'a']);
    expect(encodeCanonical(decoded)).toEqual(encodeCanonical(value));
  });

  it('decodes strings longer than one chunk', () => {
    const long = 'ab'.repeat(10_000);
    expect(decodeCanonical(encodeCanonical(long))).toBe(long);
  });

  it('round-trips 300 random values to identical bytes (property)', () => {
    const rng = Rng.create(0x5a7e);
    const failures: unknown[] = [];
    for (let i = 0; i < 300; i++) {
      const bytes = encodeCanonical(randomValue(rng));
      const again = encodeCanonical(decodeCanonical(bytes));
      if (again.length !== bytes.length || again.some((b, j) => b !== bytes[j])) failures.push(i);
    }
    expect(failures).toEqual([]);
  });

  it('reads from a view with a non-zero byte offset', () => {
    const bytes = encodeCanonical([1, 'x']);
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes, 3);
    expect(decodeCanonical(padded.subarray(3))).toEqual([1, 'x']);
  });

  it.each([
    ['empty input', new Uint8Array(0), 0, 'truncated'],
    ['truncated number', Uint8Array.from([0x03, 0, 0]), 1, 'truncated'],
    ['truncated string body', Uint8Array.from([0x04, 0, 0, 0, 2, 0, 0x41]), 5, 'truncated'],
    ['unknown tag', Uint8Array.from([0x07]), 0, 'unknown tag 0x7'],
    ['trailing bytes', Uint8Array.from([0x00, 0x00]), 1, 'trailing bytes'],
    ['keys out of order', objectWithKeys('b', 'a'), 12, 'not strictly ascending'],
    ['duplicate keys', objectWithKeys('a', 'a'), 12, 'not strictly ascending'],
  ])('rejects %s', (_, bytes, offset, reason) => {
    const error = (() => {
      try {
        decodeCanonical(bytes);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(CanonicalDecodeError);
    expect(error).toMatchObject({ name: 'CanonicalDecodeError', offset });
    expect((error as Error).message).toContain(reason);
  });

  it('accepts ascending keys built by hand', () => {
    expect(decodeCanonical(objectWithKeys('a', 'b'))).toEqual({ a: null, b: null });
  });
});
