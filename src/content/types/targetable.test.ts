import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { targetableSchema } from './targetable.ts';

const problems = (value: unknown) =>
  (targetableSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('targetable schema (mw-e02.16)', () => {
  const chest = { id: 'chest', at: [0, 1.3, 0] };

  it('defaults priority to 0 and needs at least one lock point', () => {
    expect(targetableSchema.parse({ id: 'a', name: 'A', points: [chest] }).priority).toBe(0);
    expect(problems({ id: 'a', name: 'A', points: [] })).toEqual([
      'points: Too small: expected array to have >=1 items',
    ]);
  });

  it('rejects a lock point named twice and a fractional priority', () => {
    expect(problems({ id: 'a', name: 'A', points: [chest, chest], priority: 0.5 })).toEqual([
      'priority: Invalid input: expected int, received number',
    ]);
    expect(problems({ id: 'a', name: 'A', points: [chest, chest] })).toEqual([
      'points.1.id: lock point "chest" is named twice',
    ]);
  });
});

describeContent('targetable', 'is valid, round-trips and is deeply frozen', (entry) => {
  expect(targetableSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(Object.isFrozen(entry.points[0]?.at)).toBe(true);
});

describe('targetable content', () => {
  it('AC-6: the testbed arena has three training dummies to lock on to (named as seen walking in)', () => {
    const content = loadGameContent();
    const dummies = content
      .get('scene', 'testbed')
      .spawns.filter((spawn) => spawn.targetable?.id === 'training-dummy');
    expect(dummies.map((spawn) => spawn.id)).toEqual(['dummy-left', 'dummy-centre', 'dummy-right']);
  });
});
