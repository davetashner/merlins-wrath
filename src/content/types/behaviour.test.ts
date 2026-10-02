import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef, serializeContent } from '../schema.ts';
import { loadFixtureContent } from '../test-fixtures.ts';
import { behaviourSchema, isBehaviourInput, type BehaviourDefInput } from './behaviour.ts';

const watcher = {
  id: 'watcher',
  states: {
    unaware: {
      transitions: [{ to: 'suspicious', when: { input: 'awareness', gte: { tuning: 'alarmAt' } } }],
      activities: ['stand'],
    },
    suspicious: {
      timeoutS: 5,
      onTimeout: 'unaware',
      transitions: [{ to: 'unaware', when: { done: 'peer' } }],
      activities: ['peer'],
    },
  },
  tuning: { alarmAt: 0.4 },
  activities: {
    stand: { steps: [{ do: 'wait', seconds: 1 }] },
    peer: {
      considerations: [
        { input: 'trait.curiosity', curve: { kind: 'linear', slope: 1, intercept: 0 } },
      ],
      steps: [
        { do: 'move-to', target: 'stimulus' },
        { do: 'look-around', seconds: 2 },
      ],
    },
  },
} satisfies BehaviourDefInput;

const problems = (value: unknown) =>
  (behaviourSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** A mutable view of a behaviour file, for breaking it in tests. */
interface Draft {
  initial?: string;
  tuning: Record<string, number>;
  states: Record<
    string,
    { onTimeout?: string; transitions: { to: string; when: object }[]; activities: string[] }
  >;
  activities: Record<string, { steps: object[]; considerations: { input: string }[] }>;
}

/** `watcher` after `edit` changed a deep copy of it. */
function edited(edit: (copy: Draft) => void): unknown {
  const copy = structuredClone(watcher) as unknown as Draft;
  edit(copy);
  return copy;
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

describe('behaviour schema', () => {
  it('fills defaults: 10 Hz, inertia 0.1, Unaware first; activities weigh 1, interruptible, retry after 2 s', () => {
    const def = behaviourSchema.parse(watcher);
    expect(def).toMatchObject({ schemaVersion: 1, thinkHz: 10, inertia: 0.1, initial: 'unaware' });
    expect(def.activities['stand']).toEqual({
      weight: 1,
      interruptible: true,
      retryAfterS: 2,
      considerations: [],
      steps: [{ do: 'wait', seconds: 1 }],
    });
    expect(def.activities['peer']?.steps[0]).toEqual({
      do: 'move-to',
      target: 'stimulus',
      within: 0.5,
      gait: 'walk',
    });
    expect(behaviourSchema.parse(JSON.parse(serializeContent(def)))).toEqual(def);
  });

  it('AC-2: a step with an unknown primitive fails loading, naming the behaviour file and the primitive', () => {
    const source: ContentSource = {
      path: 'data/behaviour/watcher.json',
      text: JSON.stringify(
        edited((b) => {
          must(b.activities['stand']).steps.push({ do: 'levitate', height: 2 });
        }),
      ),
    };
    let error: unknown;
    try {
      loadContent(contentTypes, [source], contentChecks);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentLoadError);
    const issues = (error as ContentLoadError).issues;
    expect(issues.map((i) => [i.file, i.pointer])).toEqual([
      ['data/behaviour/watcher.json', '/activities/stand/steps/1/do'],
    ]);
    expect(issues[0]?.message).toMatch(/^unknown primitive "levitate"; primitives: move-to, /);
    expect(problems(edited((b) => must(b.activities['stand']).steps.push({})))).toEqual([
      expect.stringMatching(/^activities\.stand\.steps\.1\.do: unknown primitive undefined;/),
    ]);
  });

  it('rejects unknown inputs, naming them', () => {
    const consider = (input: string) =>
      problems(
        edited((b) => {
          must(must(b.activities['peer']).considerations[0]).input = input;
        }),
      );
    expect(consider('mood')).toEqual([
      expect.stringMatching(/^activities\.peer\.considerations\.0\.input: unknown input "mood"/),
    ]);
    expect(consider('trait.vanity')).toHaveLength(1);
    expect(consider('need.Sleep')).toHaveLength(1);
    expect(consider('need.sleep')).toEqual([]);
    expect(isBehaviourInput('offRoute')).toBe(true);
    expect(isBehaviourInput('trait.greed')).toBe(true);
    expect(isBehaviourInput('greed')).toBe(false);
  });

  it('rejects references to states, activities and tuning keys it lacks, and malformed transitions', () => {
    expect(
      problems(
        edited((b) => {
          b.initial = 'combat';
          must(b.states['unaware']).activities.push('nap');
          must(b.states['unaware']).transitions.push(
            { to: 'alerted', when: { event: 'ally-alarm' } },
            { to: 'unaware', when: { input: 'awareness', lt: 0.1 } },
            { to: 'suspicious', when: { failed: 'peer' } },
          );
          must(b.states['suspicious']).onTimeout = 'searching';
          b.tuning = {};
        }),
      ),
    ).toEqual([
      'initial: unknown state "combat"',
      'states.unaware.activities.1: unknown activity "nap"',
      'states.unaware.transitions.1.to: unknown state "alerted"',
      'states.unaware.transitions.2.to: transition to its own state "unaware"',
      'states.unaware.transitions.3.when: unknown activity "peer" (not listed in state "unaware")',
      'states.suspicious.onTimeout: unknown state "searching"',
      'states.unaware.transitions.0.when.gte.tuning: unknown tuning key "alarmAt"',
    ]);
    expect(
      problems(
        edited((b) => {
          delete must(b.states['suspicious']).onTimeout;
          must(must(b.states['suspicious']).transitions[0]).when = { input: 'awareness' };
        }),
      ),
    ).toEqual([
      'states.suspicious.transitions.0.when: needs gte, lt or both',
      // the refinement after a failed field is skipped (one problem reported once)
    ]);
    expect(
      problems(
        edited((b) => {
          delete must(b.states['suspicious']).onTimeout;
        }),
      ),
    ).toEqual(['states.suspicious: timeoutS and onTimeout go together']);
    expect(
      problems(
        edited((b) => {
          must(b.states['unaware']).transitions.push({ to: 'unaware', when: { event: 'sneeze' } });
        }),
      ),
    ).toHaveLength(1);
  });

  it('the fixture guard behaviour loads with the fixtures and names a real attack', () => {
    const content = loadFixtureContent();
    const guard = content.get('behaviour', 'fixture-guard');
    expect(Object.keys(guard.states)).toEqual(['unaware', 'suspicious', 'investigating', 'combat']);
    const strike = guard.activities['engage']?.steps[2];
    expect(strike).toEqual({
      do: 'attack',
      attack: new ContentRef('attack', 'fixture-guard-strike'),
    });
    expect(content.get('creature', 'fixture-guard').behaviour.profile).toBe(guard.id);
  });
});
