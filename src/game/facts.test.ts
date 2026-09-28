import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '@content/index';
import { UndeclaredFactError, World } from '@sim/index';
import { installFactRegistry, undeclaredFactPolicy } from './facts';

const content = loadGameContent();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fact registry in the game', () => {
  it('AC-3: dev and test builds throw on an undeclared write', () => {
    const world = new World({ seed: 1 });
    installFactRegistry(world.facts, content);
    expect(world.facts.get('horn.fate')).toBe('alive');
    expect(() => world.facts.set('horn.fait', 'dead')).toThrow(UndeclaredFactError);
    expect(undeclaredFactPolicy(true)).toEqual({ mode: 'throw' });
  });

  it('AC-3 (edge): production builds log a warning and ignore the write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const world = new World({ seed: 1 });
    installFactRegistry(world.facts, content, false);
    expect(world.facts.set('horn.fait', 'dead')).toBe(false);
    expect(world.facts.has('horn.fait')).toBe(false);
    expect(warn).toHaveBeenCalledWith(new UndeclaredFactError('horn.fait').message);
    expect(world.facts.set('horn.fate', 'dead')).toBe(true);
  });
});
