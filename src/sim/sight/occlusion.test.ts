import { describe, expect, it } from 'vitest';
import { OPAQUE, parseOcclusion, partial, TRANSPARENT, transmittance } from './occlusion';

describe('occlusion (mw-e09.1)', () => {
  it('opaque lets nothing through, transparent everything, partial its factor', () => {
    expect(transmittance(OPAQUE)).toBe(0);
    expect(transmittance(TRANSPARENT)).toBe(1);
    expect(transmittance(partial(0.3))).toBe(0.3);
  });

  it('rejects partial factors outside [0, 1]', () => {
    expect(partial(0).factor).toBe(0);
    expect(partial(1).factor).toBe(1);
    for (const bad of [-0.1, 1.1, Number.NaN]) expect(() => partial(bad)).toThrow(RangeError);
  });

  it('parses the authored forms opaque, transparent and partial:<factor>', () => {
    expect(parseOcclusion('opaque')).toBe(OPAQUE);
    expect(parseOcclusion('transparent')).toBe(TRANSPARENT);
    expect(parseOcclusion('partial:0.5')).toEqual({ kind: 'partial', factor: 0.5 });
    expect(parseOcclusion('partial:1')).toEqual({ kind: 'partial', factor: 1 });
    for (const bad of ['glass', 'partial', 'partial:', 'partial:-1', 'partial:x']) {
      expect(() => parseOcclusion(bad)).toThrow(/opaque, transparent or partial/);
    }
    expect(() => parseOcclusion('partial:2')).toThrow(/\[0, 1\]/);
  });
});
