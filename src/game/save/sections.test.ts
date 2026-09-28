import { describe, expect, it } from 'vitest';
import { WORLD_SECTION_ID } from './format';
import { createGameSaveRegistry } from './sections';

describe('createGameSaveRegistry', () => {
  it('starts with the world section and returns an independent registry per call', () => {
    const a = createGameSaveRegistry();
    expect(a.sections.map((section) => section.id)).toEqual([WORLD_SECTION_ID]);
    expect(createGameSaveRegistry()).not.toBe(a);
  });
});
