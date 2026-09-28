import { describe, expect, it } from 'vitest';
import {
  improveStance,
  isAggressiveStance,
  isFriendlyStance,
  isStance,
  mirrorStance,
  STANCES,
  worsenStance,
} from './stance';

describe('stances', () => {
  it('recognises stance names only', () => {
    expect(STANCES.every(isStance)).toBe(true);
    expect([isStance('angry'), isStance(3), isStance(undefined)]).toEqual([false, false, false]);
  });

  it('worsens one step down the ladder; hunters turn hostile, the hunted stay fearful', () => {
    expect(STANCES.map(worsenStance)).toEqual([
      'friendly',
      'neutral',
      'wary',
      'hostile',
      'hostile',
      'hostile',
      'predator',
    ]);
  });

  it('improves one step up the ladder; hunters and the hunted calm to wary', () => {
    expect(STANCES.map(improveStance)).toEqual([
      'ally',
      'ally',
      'friendly',
      'neutral',
      'wary',
      'wary',
      'wary',
    ]);
  });

  it('mirrors prey and predator; every other stance is its own mirror', () => {
    expect(STANCES.map(mirrorStance)).toEqual([
      'ally',
      'friendly',
      'neutral',
      'wary',
      'hostile',
      'predator',
      'prey',
    ]);
  });

  it('classifies friendly (shares alerts) and aggressive (attacks on sight) stances', () => {
    expect(STANCES.filter(isFriendlyStance)).toEqual(['ally', 'friendly']);
    expect(STANCES.filter(isAggressiveStance)).toEqual(['hostile', 'prey']);
  });
});
