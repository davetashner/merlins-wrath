import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { KIT_PURPOSES, kitSchema, type KitDefInput } from './kit.ts';

const crate = {
  id: 'crate',
  name: 'Crate',
  purpose: 'interactive',
  parts: [{ size: [1, 1, 1], offset: [0, 0.5, 0] }],
} satisfies KitDefInput;

const problems = (value: unknown) =>
  (kitSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('kit schema (mw-e00.21)', () => {
  it('fills defaults: a solid box at the origin', () => {
    expect(kitSchema.parse({ ...crate, parts: [{ size: [1, 2, 3] }] }).parts).toEqual([
      { shape: 'box', size: [1, 2, 3], offset: [0, 0, 0], collider: true },
    ]);
  });

  it('rejects a piece without parts, a non-positive size, an unknown shape or purpose', () => {
    expect(problems({ ...crate, parts: [] })).toEqual([expect.stringMatching(/^parts: Too small/)]);
    expect(problems({ ...crate, parts: [{ size: [1, 0, 1] }] })).toEqual([
      expect.stringMatching(/^parts\.0\.size\.1: Too small/),
    ]);
    expect(problems({ ...crate, parts: [{ shape: 'sphere', size: [1, 1, 1] }] })).toHaveLength(1);
    expect(problems({ ...crate, purpose: 'decorative' })).toHaveLength(1);
  });
});

describeContent('kit', 'AC-3: has a known purpose and solid, positive-size parts', (piece) => {
  expect(KIT_PURPOSES).toContain(piece.purpose);
  expect(piece.parts.length).toBeGreaterThan(0);
  for (const part of piece.parts) {
    for (const n of part.size) expect(n).toBeGreaterThan(0);
  }
});

describeContent('kit', 'is shown in the kit gallery scene', (piece, content) => {
  const gallery = content.get('scene', 'kit-gallery');
  expect(gallery.placements.map((p) => p.piece.id)).toContain(piece.id);
});
