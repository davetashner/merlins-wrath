import { describe, expect, it } from 'vitest';
import { interactPromptModel } from './interact-prompt';

describe('interactPromptModel (mw-e02.5)', () => {
  it('is null with nothing in focus', () => {
    expect(interactPromptModel(undefined, 'E')).toBeNull();
  });

  it('adds the glyph to the sim prompt and flags holds', () => {
    const prompt = {
      target: 4,
      verb: 'pick-lock',
      label: 'Pick lock',
      available: false,
      reason: 'Needs Lockpicking',
      hold: 2,
      progress: 0,
      options: [],
    } as const;
    expect(interactPromptModel(prompt, 'X')).toEqual({
      glyph: 'X',
      label: 'Pick lock',
      available: false,
      reason: 'Needs Lockpicking',
      hold: true,
      progress: 0,
    });
    expect(interactPromptModel({ ...prompt, hold: 0 }, 'E')?.hold).toBe(false);
  });
});
