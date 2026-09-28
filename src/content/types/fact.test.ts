import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  FACT_KEY_PATTERN,
  FACT_TEMPLATE_PATTERN,
  factSchema,
  factTemplateOf,
  type FactGroupInput,
} from './fact.ts';

const fact = { description: 'Test fact.', owner: 'quest' } as const;

const group = (facts: unknown[]): unknown => ({ id: 'test', name: 'Test', notes: 'Test.', facts });

const problems = (value: unknown) =>
  (factSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('fact schema', () => {
  it('accepts every type and fills the persistence default', () => {
    const input = {
      id: 'test',
      name: 'Test',
      notes: 'Test.',
      facts: [
        { ...fact, key: 'a.flag', type: 'bool', default: false },
        { ...fact, key: 'a.count', type: 'int', default: -2 },
        { ...fact, key: 'a.fate', type: 'enum', values: ['alive', 'dead'], default: 'dead' },
        { ...fact, key: 'a.who', type: 'id', default: null },
        { ...fact, key: 'a.when', type: 'tick', default: 0 },
        { ...fact, key: 'entity:*.looted', type: 'bool', default: false },
        { ...fact, key: 'entity:mine/vault.opened', type: 'bool', default: false },
      ],
    } satisfies FactGroupInput;
    const parsed = factSchema.parse(input);
    expect(new Set(parsed.facts.map((f) => f.persistence))).toEqual(new Set(['permanent']));
    expect(factSchema.parse(JSON.parse(serializeContent(parsed)))).toEqual(parsed);
  });

  it('AC-1: every fact needs a type, a default and a description', () => {
    expect(problems(group([{ key: 'a.b', owner: 'quest', default: true }]))).toEqual([
      "facts.0.type: Invalid discriminator value. Expected 'bool' | 'int' | 'enum' | 'id' | 'tick'",
    ]);
    expect(problems(group([{ key: 'a.b', owner: 'quest', type: 'bool' }]))).toEqual([
      'facts.0.description: Invalid input: expected string, received undefined',
      'facts.0.default: Invalid input: expected boolean, received undefined',
    ]);
    expect(problems(group([{ ...fact, key: 'a.b', type: 'bool', default: null }]))).toEqual([
      'facts.0.default: Invalid input: expected boolean, received null',
    ]);
    expect(
      problems(group([{ ...fact, key: 'a.b', type: 'bool', default: true, description: '' }])),
    ).toEqual(['facts.0.description: Too small: expected string to have >=1 characters']);
    expect(problems(group([]))).toEqual(['facts: Too small: expected array to have >=1 items']);
  });

  it('AC-1: keys are well formed and unique within a file', () => {
    expect(
      problems(
        group([
          { ...fact, key: 'horn.fate', type: 'bool', default: false },
          { ...fact, key: 'horn.fate', type: 'bool', default: false },
          { ...fact, key: 'Horn Fate', type: 'bool', default: false },
          { ...fact, key: 'entity:*', type: 'bool', default: false },
        ]),
      ),
    ).toEqual([
      'facts.2.key: must be a fact key ("horn.befriended", "entity:<level>/<entity>.opened") or an entity template ("entity:*.looted")',
      'facts.3.key: must be a fact key ("horn.befriended", "entity:<level>/<entity>.opened") or an entity template ("entity:*.looted")',
      'facts.1.key: "horn.fate" is declared twice in this file',
    ]);
  });

  it('enum values are unique and include the default', () => {
    expect(
      problems(
        group([{ ...fact, key: 'a.b', type: 'enum', values: ['x', 'y', 'x'], default: 'z' }]),
      ),
    ).toEqual([
      'facts.0.values.2: duplicate value "x"',
      'facts.0.default: "z" is not one of the values',
    ]);
  });

  it('maps entity keys to their template', () => {
    expect(factTemplateOf('entity:mine/chest-3.looted')).toBe('entity:*.looted');
    expect(factTemplateOf('horn.fate')).toBeUndefined();
    expect(FACT_KEY_PATTERN.test('entity:mine/chest-3.looted')).toBe(true);
    expect(FACT_TEMPLATE_PATTERN.test('entity:*.looted')).toBe(true);
  });
});

describe('the shipped fact registry', () => {
  it('AC-1: keys are unique across every registry file', () => {
    const keys = loadGameContent()
      .all('fact')
      .flatMap((g) => g.facts.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  describeContent(
    'fact',
    'AC-1: every fact has a well-formed key, a type, a default and a description',
    (entry) => {
      expect(entry.facts.length).toBeGreaterThan(0);
      for (const f of entry.facts) {
        expect(FACT_KEY_PATTERN.test(f.key) || FACT_TEMPLATE_PATTERN.test(f.key)).toBe(true);
        expect(f.type).toBeTypeOf('string');
        expect(f.default).not.toBeUndefined();
        expect(f.description.length).toBeGreaterThan(0);
      }
    },
  );
});
