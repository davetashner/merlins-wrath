import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, decodePng, encodePng, samePng } from './png.ts';
import { renderTexture, ValueNoise } from './recipes.ts';

const image = (width: number, height: number, fill: (i: number) => number) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) => fill(i)),
});

/** Rewrites a PNG's IHDR byte at `offset` (within the chunk data) and fixes its CRC. */
function patchHeader(png: Uint8Array, offset: number, value: number): Uint8Array {
  const out = png.slice();
  out[16 + offset] = value;
  new DataView(out.buffer).setUint32(29, crc32(out.subarray(12, 29)));
  return out;
}

describe('png codec (mw-e29.2)', () => {
  it('round-trips RGBA pixels and computes the standard CRC-32', () => {
    const img = image(5, 3, (i) => (i * 37) % 256);
    const png = encodePng(img);
    expect(decodePng(png)).toEqual(img);
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    expect(() => encodePng({ width: 2, height: 2, pixels: new Uint8Array(3) })).toThrow(
      /expected 16 bytes/,
    );
  });

  it('rejects what it cannot read: not a PNG, another colour type, truncated or filtered data', () => {
    const png = encodePng(image(2, 2, () => 9));
    expect(() => decodePng(new Uint8Array(8))).toThrow('not a PNG');
    expect(() => decodePng(patchHeader(png, 9, 2))).toThrow(/8-bit RGBA/);
    expect(() => decodePng(patchHeader(png, 8, 16))).toThrow(/8-bit RGBA/);
    expect(() => decodePng(patchHeader(png, 12, 1))).toThrow(/8-bit RGBA/);
    // IHDR claims 3 rows, the data has 2.
    expect(() => decodePng(patchHeader(png, 7, 3))).toThrow('PNG data is truncated');
    // Same data with row filter 1 (sub).
    const filtered = encodePng(image(2, 2, () => 9));
    const raw = Uint8Array.from([1, 9, 9, 9, 9, 9, 9, 9, 9, 0, 9, 9, 9, 9, 9, 9, 9, 9]);
    const idat = new Uint8Array(deflateSync(raw));
    const chunk = new Uint8Array(12 + idat.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, idat.length);
    chunk.set(new TextEncoder().encode('IDAT'), 4);
    chunk.set(idat, 8);
    view.setUint32(8 + idat.length, crc32(chunk.subarray(4, 8 + idat.length)));
    const head = filtered.subarray(0, 33); // signature + IHDR
    const withFilter = new Uint8Array([...head, ...chunk]);
    expect(() => decodePng(withFilter)).toThrow('only unfiltered PNG rows are supported');
  });

  it('samePng tolerates ±1 per channel but not bigger changes, other sizes or broken files', () => {
    const a = encodePng(image(4, 4, () => 100));
    expect(samePng(a, encodePng(image(4, 4, (i) => (i % 2 ? 101 : 99))))).toBe(true);
    expect(samePng(a, encodePng(image(4, 4, (i) => (i === 5 ? 102 : 100))))).toBe(false);
    expect(samePng(a, encodePng(image(4, 2, () => 100)))).toBe(false);
    expect(samePng(a, encodePng(image(2, 4, () => 100)))).toBe(false);
    expect(samePng(a, new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('value noise is seeded, in [0, 1] and wraps its lattice', () => {
    const noise = new ValueNoise(1);
    for (const [x, y] of [
      [0.5, 0.5],
      [-3.2, 7.9],
      [70.1, -80.4],
    ] as const) {
      const n = noise.fbm(x, y);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
    expect(noise.sample(1, 2)).toBe(noise.sample(1 + ValueNoise.SIZE, 2 - ValueNoise.SIZE));
    expect(new ValueNoise(2).sample(1, 2)).not.toBe(noise.sample(1, 2));
    const pixels = renderTexture(
      { id: 'vfx-x-01', kind: 'soft-circle', cell: 4, cols: 2, rows: 1 },
      1,
    );
    expect(pixels).toHaveLength(4 * 8 * 4);
  });
});
