import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContentRef, contentId, ref } from './schema.ts';

describe('contentId', () => {
  it('accepts lowercase kebab-case ids and rejects anything else', () => {
    for (const id of ['crate', 'forgotten-miner', 'arrow-2']) {
      expect(contentId.safeParse(id).success).toBe(true);
    }
    for (const id of ['', 'Crate', 'two  words', 'trailing-', '-leading', 'a--b', 'a_b', 'a:b']) {
      expect(contentId.safeParse(id).success).toBe(false);
    }
  });
});

describe('ref', () => {
  it('parses a plain id into a frozen ContentRef of the given type', () => {
    const target = ref('creature').parse('goblin-archer');
    expect(target).toBeInstanceOf(ContentRef);
    expect(target).toEqual(new ContentRef('creature', 'goblin-archer'));
    expect(target.type).toBe('creature');
    expect(target.id).toBe('goblin-archer');
    expect(String(target)).toBe('creature:goblin-archer');
    expect(Object.isFrozen(target)).toBe(true);
  });

  it('rejects ids that are not kebab-case, inside an object with the field path', () => {
    const result = z.object({ target: ref('creature') }).safeParse({ target: 'Goblin Archer' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['target']);
  });
});
