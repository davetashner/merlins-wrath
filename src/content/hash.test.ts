import { describe, expect, it } from 'vitest';
import { canonicalJson, fnv1a64 } from './hash.ts';
import { ContentRef } from './schema.ts';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
    expect(canonicalJson({ a: { c: 'x', d: [3, 1] }, b: 1 })).toBe(
      canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } }),
    );
  });

  it('drops undefined properties and serialises primitives like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: null, c: true, d: 'q"' })).toBe(
      '{"b":null,"c":true,"d":"q\\""}',
    );
  });

  it('serialises a ContentRef as its fields', () => {
    expect(canonicalJson(new ContentRef('creature', 'rat'))).toBe('{"id":"rat","type":"creature"}');
  });
});

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64-bit test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('hashes UTF-8 bytes, so non-ASCII text is stable', () => {
    expect(fnv1a64('é')).toBe(fnv1a64('é'));
    expect(fnv1a64('é')).not.toBe(fnv1a64('e'));
    expect(fnv1a64('é')).toMatch(/^[0-9a-f]{16}$/);
  });
});
