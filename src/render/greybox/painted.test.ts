import { describe, expect, it } from 'vitest';
import { paintedKind } from './index';

describe('paintedKind (mw-va0)', () => {
  it('paints a kit pillar as stone, whatever its properties', () => {
    expect(paintedKind({ piece: 'pillar' }, undefined)).toBe('pillar');
    expect(paintedKind({ piece: 'pillar' }, { material: { id: 'ivy' } })).toBe('pillar');
  });

  it('paints a piece whose level material is ivy (a content reference, not a string)', () => {
    expect(paintedKind({ piece: 'platform' }, { material: { id: 'ivy' } })).toBe('ivy');
  });

  it('paints a piece with the ivy climb grade', () => {
    expect(paintedKind({ piece: 'wall' }, { climbable: 'ivy' })).toBe('ivy');
  });

  it('leaves every other part to the grid material', () => {
    expect(paintedKind({ piece: 'platform' }, undefined)).toBeUndefined();
    expect(paintedKind({ piece: 'platform' }, { material: { id: 'wood' } })).toBeUndefined();
    expect(paintedKind({ piece: 'wall' }, { climbable: 'ladder' })).toBeUndefined();
  });
});
