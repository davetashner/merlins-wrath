import { describe, expect, it } from 'vitest';
import { layer } from '@content/index';

describe('content layer', () => {
  it('resolves through the @content/* alias', () => {
    expect(layer).toBe('content');
  });
});
