import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  CONDITION_MAX_DEPTH,
  conditionSchema,
  namedConditionSchema,
  type Condition,
  type NamedConditionInput,
} from './condition.ts';

const problems = (value: unknown) =>
  (conditionSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** A leaf wrapped in `depth - 1` nots, so `depth` levels deep. */
const nested = (depth: number): unknown => {
  let condition: unknown = { fact: 'a' };
  for (let i = 1; i < depth; i++) condition = { not: condition };
  return condition;
};

describe('condition schema', () => {
  it('accepts every node kind and round-trips', () => {
    const condition = {
      all: [
        { fact: 'minotaur.befriended' },
        { not: { fact: 'cellar.sealed' } },
        {
          any: [
            { fact: 'horn.fate', eq: 'alive' },
            { fact: 'horn.rescues', gte: 3 },
          ],
        },
        { fact: 'bell.rung-by', has: true },
        { fact: 'entity:mine/vault.opened', neq: false },
        { count: 'entity:mine/*.looted', gte: 3 },
        { count: 'entity:*/*.opened', lt: 10 },
      ],
    } satisfies Condition;
    expect(problems(condition)).toEqual([]);
    const named = {
      id: 'test',
      name: 'Test',
      notes: 'Test.',
      when: condition,
    } satisfies NamedConditionInput;
    const parsed = namedConditionSchema.parse(named);
    expect(parsed.when).toEqual(condition);
    expect(namedConditionSchema.parse(JSON.parse(serializeContent(parsed)))).toEqual(parsed);
  });

  it('reports every malformed node with its path', () => {
    expect(
      problems({
        all: [
          7,
          { fact: 'a', any: [] },
          { fact: 'Bad Key', gte: 1.5 },
          { fact: 'a', gte: 1, lte: 2 },
          { fact: 'a', above: 1 },
          { count: 'entity:mine/chest.looted', gte: 1 },
          { count: 'entity:mine/*.looted' },
          { any: [] },
          { not: { fact: 'a' }, why: 'x' },
          { any: 'a' },
        ],
      }),
    ).toEqual(
      [
        'all.0: a condition is an object with exactly one of: fact, count, all, any, not',
        'all.1: a condition is an object with exactly one of: fact, count, all, any, not',
        'all.2.fact: must be a fact key',
        'all.2.gte: Invalid input: expected int, received number',
        'all.3: a fact condition takes one operator, got gte, lte',
        'all.4: Unrecognized key: "above"',
        'all.5.count: must be a count pattern',
        'all.6: a count condition needs an operator (eq, gte…)',
        'all.7.any: must be a non-empty list of conditions',
        'all.8: a not condition has no other fields (why)',
        'all.9.any: must be a non-empty list of conditions',
      ].filter((line) => !line.endsWith('ok')),
    );
  });

  it(`AC-4: nesting ${String(CONDITION_MAX_DEPTH)} deep is accepted; deeper is rejected clearly`, () => {
    expect(problems(nested(CONDITION_MAX_DEPTH))).toEqual([]);
    const path = Array.from({ length: CONDITION_MAX_DEPTH }, () => 'not').join('.');
    expect(problems(nested(CONDITION_MAX_DEPTH + 1))).toEqual([
      `${path}: condition nests more than 64 levels deep; split it into smaller conditions`,
    ]);
    // The shape walk never recurses, so an absurd depth fails cleanly instead of overflowing.
    expect(problems(nested(100_000))).toHaveLength(1);
  });
});

describe('the shipped named conditions', () => {
  describeContent('condition', 'parses and round-trips', (entry) => {
    expect(namedConditionSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});
