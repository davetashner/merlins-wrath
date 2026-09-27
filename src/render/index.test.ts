import { describe, expect, it } from 'vitest';
import { layer } from '@render/index';

describe('render layer', () => {
  it('resolves through the @render/* alias', () => {
    expect(layer).toBe('render');
  });
});
