// Tests for the behaviour lint (mw-e11.19).

import { describe, expect, it } from 'vitest';
import { checkBehaviours, lintBehaviour } from './behaviour-checks.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type LoadedEntry } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { loadFixtureContent } from './test-fixtures.ts';
import {
  BEHAVIOUR_INPUT_RANGES,
  BEHAVIOUR_INPUTS,
  behaviourInputRange,
  behaviourSchema,
  type BehaviourCurveDef,
  type BehaviourDef,
  type BehaviourDefInput,
} from './types/behaviour.ts';

/** A clean three-state behaviour: every state reachable, with an exit, every activity listed. */
const clean = {
  id: 'sentry',
  states: {
    unaware: {
      transitions: [{ to: 'suspicious', when: { input: 'awareness', gte: 0.3 } }],
      activities: ['stand'],
    },
    suspicious: {
      timeoutS: 5,
      onTimeout: 'unaware',
      transitions: [
        { to: 'combat', when: { input: 'targetVisible', gte: 1 } },
        { to: 'unaware', when: { done: 'peer' } },
      ],
      activities: ['peer'],
    },
    combat: {
      transitions: [{ to: 'suspicious', when: { input: 'targetLostS', gte: 5 } }],
      activities: ['fight'],
    },
  },
  activities: {
    stand: { steps: [{ do: 'wait', seconds: 1 }] },
    peer: { steps: [{ do: 'look-around', seconds: 2 }] },
    fight: { steps: [{ do: 'strike' }] },
  },
} satisfies BehaviourDefInput;

const parse = (input: BehaviourDefInput): BehaviourDef => behaviourSchema.parse(input);

/** `clean` with `states`/`activities` replaced or extended. */
function variant(patch: {
  states?: Record<string, unknown>;
  activities?: Record<string, unknown>;
}): BehaviourDef {
  return parse({
    ...clean,
    states: { ...clean.states, ...patch.states },
    activities: { ...clean.activities, ...patch.activities },
  });
}

/** An activity whose only consideration is `curve` on `input`. */
const gated = (input: string, curve: BehaviourCurveDef) => ({
  considerations: [{ input, curve }],
  steps: [{ do: 'wait', seconds: 1 }],
});

/** The lint messages of a behaviour whose `stand` activity is gated by one curve. */
const standing = (input: string, curve: BehaviourCurveDef): string[] =>
  lintBehaviour(variant({ activities: { stand: gated(input, curve) } })).map((p) => p.message);

describe('behaviour lint (mw-e11.19)', () => {
  it('a clean behaviour reports nothing', () => {
    expect(lintBehaviour(parse(clean))).toEqual([]);
  });

  it('AC-1: a state no transition or timeout leads to is unreachable, naming it', () => {
    const def = variant({
      states: { searching: { timeoutS: 5, onTimeout: 'unaware', activities: ['peer'] } },
    });
    expect(lintBehaviour(def)).toEqual([
      {
        pointer: '/states/searching',
        message: 'state "searching" is unreachable from initial state "unaware"',
      },
    ]);
  });

  it('AC-1: the content check names the behaviour id and the state, and fails the load', () => {
    const bad = {
      ...clean,
      states: {
        ...clean.states,
        searching: { timeoutS: 5, onTimeout: 'unaware', activities: ['peer'] },
      },
    };
    const load = () =>
      loadContent(
        contentTypes,
        [{ path: 'data/behaviour/sentry.json', text: JSON.stringify(bad) }],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    try {
      load();
    } catch (error) {
      expect((error as ContentLoadError).issues).toEqual([
        {
          file: 'data/behaviour/sentry.json',
          pointer: '/states/searching',
          message:
            'behaviour "sentry": state "searching" is unreachable from initial state "unaware"',
        },
      ]);
    }
  });

  it('AC-1: a state reached only through another state, or a timeout fallback, is reachable', () => {
    const def = variant({
      states: {
        suspicious: {
          timeoutS: 5,
          onTimeout: 'searching',
          activities: ['peer'],
        },
        searching: {
          transitions: [{ to: 'unaware', when: { done: 'stand' } }],
          activities: ['stand'],
        },
      },
    });
    expect(lintBehaviour(def).filter((p) => p.message.includes('unreachable'))).toEqual([
      expect.objectContaining({ pointer: '/states/combat' }),
    ]);
  });

  it('AC-1: a transition to a state the behaviour lacks (the schema refuses it) is not followed', () => {
    const base = parse(clean);
    const def = { ...base, initial: 'searching' } as BehaviourDef;
    expect(lintBehaviour(def).map((p) => p.pointer)).toEqual([
      '/states/unaware',
      '/states/suspicious',
      '/states/combat',
    ]);
  });

  it('AC-2: a non-Combat state with no timeout and no transitions has no exit', () => {
    const def = variant({ states: { searching: { activities: ['peer'] } } });
    expect(lintBehaviour(def).map((p) => p.message)).toContain(
      'state "searching" has no exit (no timeout and no transitions)',
    );
  });

  it('AC-2: a timeout alone, or a transition alone, is an exit', () => {
    const def = variant({
      states: {
        suspicious: { timeoutS: 5, onTimeout: 'combat', activities: ['peer'] },
        combat: {
          transitions: [{ to: 'suspicious', when: { input: 'targetLostS', gte: 5 } }],
          activities: ['fight'],
        },
      },
    });
    expect(lintBehaviour(def)).toEqual([]);
  });

  it('AC-2: Combat needs a lost-target exit, not just any exit', () => {
    const noLostExit = (transitions: unknown[]) =>
      lintBehaviour(variant({ states: { combat: { transitions, activities: ['fight'] } } })).map(
        (p) => p.message,
      );
    const message = 'state "combat" has no lost-target exit (a transition on targetLostS)';
    expect(noLostExit([])).toEqual([message]);
    expect(noLostExit([{ to: 'suspicious', when: { event: 'ally-alarm' } }])).toEqual([message]);
    expect(noLostExit([{ to: 'suspicious', when: { input: 'targetVisible', gte: 1 } }])).toEqual([
      message,
    ]);
    expect(noLostExit([{ to: 'suspicious', when: { input: 'targetLostS', gte: 5 } }])).toEqual([]);
    expect(noLostExit([{ to: 'suspicious', when: { input: 'targetVisible', lt: 1 } }])).toEqual([]);
  });

  it('AC-3: an activity listed by no state is reported by name', () => {
    const def = variant({ activities: { nap: { steps: [{ do: 'wait', seconds: 9 }] } } });
    expect(lintBehaviour(def)).toEqual([
      { pointer: '/activities/nap', message: 'activity "nap" is listed by no state' },
    ]);
  });

  it('AC-4: a step curve returning 0 across the input range is never selectable', () => {
    // awareness spans 0-1: below 2 is 0, and above 2 is unreachable.
    const never = standing('awareness', { kind: 'step', at: 2, below: 0, above: 1 });
    expect(never).toEqual([
      'activity "stand" is never selectable: its step curve on "awareness" is 0 over the whole input range',
    ]);
    // 0 on both sides of the threshold, wherever it sits.
    expect(standing('awareness', { kind: 'step', at: 0.5, below: 0, above: 0 })).toHaveLength(1);
    // Reachable above: fine; reachable below: fine.
    expect(standing('awareness', { kind: 'step', at: 0.5, below: 0, above: 1 })).toEqual([]);
    expect(standing('awareness', { kind: 'step', at: 0.5, below: 1, above: 0 })).toEqual([]);
    // Everything is at or above `at` (min 0): `below` never applies.
    expect(standing('awareness', { kind: 'step', at: 0, below: 1, above: 0 })).toHaveLength(1);
  });

  it('AC-4: a linear curve that is 0 over the range is never selectable', () => {
    expect(standing('awareness', { kind: 'linear', slope: 1, intercept: -2 })).toHaveLength(1);
    expect(standing('awareness', { kind: 'linear', slope: 0, intercept: 0 })).toHaveLength(1);
    expect(standing('awareness', { kind: 'linear', slope: -1, intercept: -0.1 })).toHaveLength(1);
    expect(standing('awareness', { kind: 'linear', slope: 1, intercept: 0 })).toEqual([]);
    expect(standing('awareness', { kind: 'linear', slope: -1, intercept: 1 })).toEqual([]);
    // Unbounded input: any positive slope gets there eventually.
    expect(standing('timeInState', { kind: 'linear', slope: 0.01, intercept: -5 })).toEqual([]);
  });

  it('AC-4: a power curve is 0 only when the input never leaves 0', () => {
    expect(standing('awareness', { kind: 'power', exponent: 2 })).toEqual([]);
    expect(standing('awareness', { kind: 'power', exponent: 8 })).toEqual([]);
  });

  it('AC-4: any consideration at 0 zeroes the product; a zero weight is never selectable', () => {
    const def = variant({
      activities: {
        stand: {
          considerations: [
            { input: 'awareness', curve: { kind: 'linear', slope: 1, intercept: 0 } },
            { input: 'hasStimulus', curve: { kind: 'step', at: 5, below: 0, above: 1 } },
          ],
          steps: [{ do: 'wait', seconds: 1 }],
        },
        peer: { weight: 0, steps: [{ do: 'wait', seconds: 1 }] },
      },
    });
    expect(lintBehaviour(def)).toEqual([
      {
        pointer: '/activities/stand/considerations/1',
        message:
          'activity "stand" is never selectable: its step curve on "hasStimulus" is 0 over the whole input range',
      },
      {
        pointer: '/activities/peer/weight',
        message: 'activity "peer" is never selectable: its weight is 0',
      },
    ]);
  });

  it('AC-4: ranges come from the input registry, with 0-1 for traits and needs', () => {
    expect(Object.keys(BEHAVIOUR_INPUT_RANGES).sort()).toEqual([...BEHAVIOUR_INPUTS].sort());
    expect(behaviourInputRange('targetDistance')).toEqual({ min: 0, max: 1000 });
    expect(behaviourInputRange('trait.curiosity')).toEqual({ min: 0, max: 1 });
    expect(behaviourInputRange('need.hunger')).toEqual({ min: 0, max: 1 });
    // targetDistance tops out at 1000 m, so a step above 2000 can never fire.
    expect(standing('targetDistance', { kind: 'step', at: 2000, below: 0, above: 1 })).toHaveLength(
      1,
    );
    expect(standing('trait.curiosity', { kind: 'step', at: 2, below: 0, above: 1 })).toHaveLength(
      1,
    );
  });

  it('AC-5: a done or failed condition naming an activity the state does not list names both', () => {
    const state = (when: object) => ({
      timeoutS: 5,
      onTimeout: 'unaware',
      transitions: [{ to: 'combat', when }],
      activities: ['peer'],
    });
    // The schema rejects these on load, so the lint is exercised on the parsed shape directly.
    const base = parse(clean);
    const withWhen = (when: object): BehaviourDef =>
      ({
        ...base,
        states: { ...base.states, suspicious: { ...base.states.suspicious, ...state(when) } },
      }) as BehaviourDef;
    const done = lintBehaviour(withWhen({ done: 'investigate' }));
    expect(done).toEqual([
      {
        pointer: '/states/suspicious/transitions/0/when',
        message: 'state "suspicious" waits on activity "investigate", which it does not list',
      },
    ]);
    expect(lintBehaviour(withWhen({ failed: 'investigate' }))).toEqual(done);
    expect(lintBehaviour(withWhen({ failed: 'peer' }))).toEqual([]);
  });

  it('AC-5: the schema already refuses such a behaviour at load', () => {
    const result = behaviourSchema.safeParse({
      ...clean,
      states: {
        ...clean.states,
        suspicious: {
          ...clean.states.suspicious,
          transitions: [{ to: 'unaware', when: { done: 'investigate' } }],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('AC-6: every shipped and fixture behaviour definition reports no error', () => {
    for (const content of [loadGameContent(), loadFixtureContent()]) {
      const behaviours = content.all('behaviour');
      expect(behaviours.length).toBeGreaterThan(0);
      for (const def of behaviours) expect(lintBehaviour(def)).toEqual([]);
    }
  });

  it('only behaviour entries are checked', () => {
    const entry = (type: string): LoadedEntry => ({
      type,
      file: `data/${type}/x.json`,
      value: { id: 'x' },
    });
    expect(checkBehaviours([entry('item'), entry('creature')])).toEqual([]);
  });
});
