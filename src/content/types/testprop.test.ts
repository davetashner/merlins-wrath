import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { describeContent } from '../testing.ts';

describeContent('testprop', 'AC-6: validates and is deeply frozen', (entry, content) => {
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.tags)).toBe(true);
  expect(entry.mass).toBeGreaterThan(0);
  if (entry.breaksInto !== undefined) {
    expect(Object.isFrozen(entry.breaksInto)).toBe(true);
    expect(content.resolve(entry.breaksInto).mass).toBeLessThan(entry.mass);
  }
});

describe('testprop content', () => {
  it('AC-6: the example has two entries, one breaking into the other', () => {
    const content = loadGameContent();
    expect(Object.isFrozen(content)).toBe(true);
    expect(content.all('testprop').map((p) => p.id)).toEqual(['crate', 'plank']);
    expect(content.get('testprop', 'crate').breaksInto?.toString()).toBe('testprop:plank');
    expect(content.get('testprop', 'plank').tags).toEqual([]);
  });
});
