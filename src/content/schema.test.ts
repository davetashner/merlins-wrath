import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContentRef, contentId, ref, serializeContent } from './schema.ts';

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

describe('serializeContent', () => {
  it('writes refs back as plain ids, so the JSON parses to an equal entry', () => {
    const schema = z.object({ id: contentId, target: ref('creature') });
    const entry = schema.parse({ id: 'rat', target: 'goblin-archer' });
    const text = serializeContent(entry);
    expect(text).toBe('{\n  "id": "rat",\n  "target": "goblin-archer"\n}\n');
    expect(schema.parse(JSON.parse(text))).toEqual(entry);
  });

  it('marks refs in the JSON Schema with their target type', () => {
    expect(z.toJSONSchema(ref('attack'), { io: 'input' })).toMatchObject({
      type: 'string',
      'x-contentRef': 'attack',
    });
  });
});
