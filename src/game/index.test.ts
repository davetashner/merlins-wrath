import { describe, expect, it } from 'vitest';
import { layer, layers } from '@game/index';

describe('game layer', () => {
  it('resolves through the @game/* alias', () => {
    expect(layer).toBe('game');
  });

  it('binds every layer from the contract §2 layout', () => {
    expect(layers).toEqual(['sim', 'content', 'game', 'render', 'audio', 'ui', 'tools']);
  });
});
