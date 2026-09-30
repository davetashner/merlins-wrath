import { describe, expect, it } from 'vitest';
import { CONDITION_USAGES, conditionProblems } from './condition-checks.ts';
import { factIndex } from './fact-checks.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import type { Condition } from './types/condition.ts';
import type { FactGroup } from './types/fact.ts';

const fact = { description: 'Test fact.', owner: 'quest', persistence: 'permanent' } as const;

const group: FactGroup = {
  id: 'test',
  name: 'Test',
  notes: 'Test.',
  facts: [
    { ...fact, key: 'minotaur.befriended', type: 'bool', default: false },
    { ...fact, key: 'cellar.sealed', type: 'bool', default: true },
    { ...fact, key: 'miller.stage', type: 'int', default: 0 },
    { ...fact, key: 'bell.rung-at', type: 'tick', default: null },
    { ...fact, key: 'bell.rung-by', type: 'id', default: null },
    { ...fact, key: 'horn.fate', type: 'enum', values: ['alive', 'dead'], default: 'alive' },
    { ...fact, key: 'entity:*.looted', type: 'bool', default: false },
    { ...fact, key: 'entity:*.charges', type: 'int', default: 0 },
  ],
};

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const registry = source('data/fact/test.json', group);

const named = (id: string, when: Condition): ContentSource =>
  source(`data/condition/${id}.json`, { id, name: 'Test', notes: 'Test.', when });

const issuesOf = (sources: readonly ContentSource[]) => {
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  return [];
};

const problemsOf = (condition: Condition) =>
  conditionProblems(condition, factIndex([group])).map((p) => `${p.pointer}: ${p.message}`);

describe('condition checks', () => {
  it('AC-3: a condition referencing an undeclared fact fails validation via the registry', () => {
    const when: Condition = {
      all: [{ fact: 'minotaur.befriended' }, { not: { fact: 'cellar.seald' } }],
    };
    expect(issuesOf([registry, named('cellar', when)])).toEqual([
      {
        file: 'data/condition/cellar.json',
        pointer: '/when/all/1/not/fact',
        message:
          'condition:cellar names undeclared fact "cellar.seald": declare it in src/content/data/fact/',
      },
    ]);
  });

  it('accepts declared facts, entity keys covered by a template and fitting operators', () => {
    const when: Condition = {
      any: [
        { fact: 'minotaur.befriended' },
        { fact: 'cellar.sealed', eq: false },
        { fact: 'miller.stage', gte: -1 },
        { fact: 'miller.stage', neq: -1 },
        { fact: 'bell.rung-at', lt: 100 },
        { fact: 'bell.rung-at', eq: 0 },
        { fact: 'bell.rung-by', eq: 'tansy' },
        { fact: 'bell.rung-by', has: false },
        { fact: 'horn.fate', eq: 'dead' },
        { fact: 'entity:mine/chest-1.looted' },
        { count: 'entity:mine/*.looted', gte: 3 },
      ],
    };
    expect(issuesOf([registry, named('ok', when)])).toEqual([]);
  });

  it('reports operators that do not suit the fact type', () => {
    expect(
      problemsOf({
        all: [
          { fact: 'miller.stage' },
          { fact: 'horn.fate', gte: 1 },
          { fact: 'minotaur.befriended', eq: 1 },
          { fact: 'miller.stage', eq: true },
          { fact: 'bell.rung-at', eq: -1 },
          { fact: 'horn.fate', neq: 'undead' },
          { fact: 'bell.rung-by', eq: 'Tansy Cole' },
          { fact: 'entity:mine/chest-1.opened' },
          { count: 'entity:mine/*.opened', gte: 1 },
          { count: 'entity:*/*.charges', gte: 1 },
        ],
      }),
    ).toEqual([
      '/all/0/fact: a bare fact test needs a bool fact; "miller.stage" is int: add an operator',
      '/all/1/fact: "gte" needs an int or tick fact; "horn.fate" is enum',
      '/all/2/fact: "minotaur.befriended" is bool: 1 is not a bool',
      '/all/3/fact: "miller.stage" is int: true is not a int',
      '/all/4/fact: "bell.rung-at" is tick: -1 is not a tick',
      '/all/5/fact: "horn.fate" is enum: "undead" is not one of alive, dead',
      '/all/6/fact: "bell.rung-by" is id: "Tansy Cole" is not a id',
      '/all/7/fact: names undeclared fact "entity:mine/chest-1.opened": declare it in src/content/data/fact/',
      '/all/8/count: counts undeclared fact template "entity:*.opened": declare it in src/content/data/fact/',
      '/all/9/count: counts "entity:*.charges", which is int, not bool',
    ]);
  });

  it('finds the conditions of the shipped named conditions', () => {
    const content = loadGameContent();
    const usages = content
      .all('condition')
      .flatMap((c) => CONDITION_USAGES['condition']?.(c as never) ?? []);
    expect(usages.length).toBe(content.all('condition').length);
    expect(usages.every((u) => u.pointer === '/when')).toBe(true);
  });
});
