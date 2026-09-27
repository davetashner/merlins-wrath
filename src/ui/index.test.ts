import { describe, expect, it } from 'vitest';
import { layer } from '@ui/index';

describe('ui layer', () => {
  it('resolves through the @ui/* alias', () => {
    expect(layer).toBe('ui');
  });
});
