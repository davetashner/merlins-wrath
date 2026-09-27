import { describe, expect, it } from 'vitest';
import { layer } from '@sim/index';

describe('sim layer', () => {
  it('resolves through the @sim/* alias', () => {
    expect(layer).toBe('sim');
  });
});
