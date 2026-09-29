import { describe, expect, it } from 'vitest';
import { CueRuleSet, interpolateCue, matchesFacts, type MatchableRule } from './matcher.ts';

interface Rule extends MatchableRule {
  readonly name: string;
}

const rule = (
  name: string,
  match: Rule['match'] = {},
  layer = 'main',
  event = 'DamageApplied',
) => ({
  name,
  event,
  layer,
  match,
});

describe('cue rule matcher', () => {
  it('AC-1: a metal-on-bone hit picks the specific rule over the generic one', () => {
    const rules = new CueRuleSet<Rule>([
      rule('generic'),
      rule('metal-on-bone', { weapon: 'metal', target: 'bone' }),
      rule('metal', { weapon: 'metal' }),
    ]);
    const names = (facts: Record<string, string>) =>
      rules.resolve('DamageApplied', facts).map((r) => r.name);
    expect(names({ weapon: 'metal', target: 'bone' })).toEqual(['metal-on-bone']);
    expect(names({ weapon: 'metal', target: 'flesh' })).toEqual(['metal']);
    expect(names({ weapon: 'wood', target: 'bone' })).toEqual(['generic']);
  });

  it('equal specificity keeps authoring order; each layer has its own winner', () => {
    const rules = new CueRuleSet<Rule>([
      rule('bone', { target: 'bone' }),
      rule('metal', { weapon: 'metal' }),
      rule('accent', { tags: 'critical' }, 'accent'),
      rule('other-event', {}, 'main', 'Died'),
    ]);
    expect(
      rules
        .resolve('DamageApplied', { weapon: 'metal', target: 'bone', tags: ['critical', 'x'] })
        .map((r) => r.name),
    ).toEqual(['bone', 'accent']);
    expect(rules.resolve('PoiseBroken', {})).toEqual([]);
    expect(rules.events()).toEqual(['DamageApplied', 'Died']);
  });

  it('matches strings and booleans by equality, lists by membership; absent facts never match', () => {
    expect(matchesFacts({ died: true, tags: 'critical' }, { died: true, tags: ['critical'] })).toBe(
      true,
    );
    expect(matchesFacts({ died: true }, { died: false })).toBe(false);
    expect(matchesFacts({ tags: 'backstab' }, { tags: ['critical'] })).toBe(false);
    expect(matchesFacts({ target: 'bone' }, {})).toBe(false);
    expect(matchesFacts({}, {})).toBe(true);
  });

  it('fills {fact} placeholders from string facts, or gives undefined when one is missing', () => {
    expect(interpolateCue('sfx-impact-{target}', { target: 'bone' })).toBe('sfx-impact-bone');
    expect(interpolateCue('{telegraph}', { telegraph: 'sfx-x' })).toBe('sfx-x');
    expect(interpolateCue('sfx-plain', {})).toBe('sfx-plain');
    expect(interpolateCue('sfx-impact-{target}', {})).toBeUndefined();
    expect(interpolateCue('sfx-impact-{total}', { total: 3 })).toBeUndefined();
  });
});
