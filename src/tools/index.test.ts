import { describe, expect, it } from 'vitest';
import { layer } from '@tools/index';

describe('tools layer', () => {
  it('resolves through the @tools/* alias', () => {
    expect(layer).toBe('tools');
  });
});
