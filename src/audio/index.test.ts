import { describe, expect, it } from 'vitest';
import { layer } from '@audio/index';

describe('audio layer', () => {
  it('resolves through the @audio/* alias', () => {
    expect(layer).toBe('audio');
  });
});
