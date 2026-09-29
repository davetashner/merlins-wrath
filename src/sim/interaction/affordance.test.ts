import { describe, expect, it } from 'vitest';
import {
  AFFORDANCE_LABELS,
  AFFORDANCE_VERBS,
  meets,
  normalizeAffordance,
  PROPERTY_AFFORDANCES,
  unavailableReason,
  type AffordanceSpec,
} from './affordance';

const kit = (capabilities: string[] = [], items: string[] = []) => ({ capabilities, items });

describe('affordances (mw-e02.5)', () => {
  it('labels every verb', () => {
    expect(Object.keys(AFFORDANCE_LABELS)).toEqual([...AFFORDANCE_VERBS]);
    expect(AFFORDANCE_LABELS['pick-lock']).toBe('Pick lock');
  });

  it('fills defaults and freezes', () => {
    const affordance = normalizeAffordance({ verb: 'pull' });
    expect(affordance).toEqual({ verb: 'pull', label: 'Pull', hold: 0, requires: [], reason: '' });
    expect(Object.isFrozen(affordance)).toBe(true);
    expect(
      normalizeAffordance({
        verb: 'unlock',
        label: 'Unlock door',
        hold: 1,
        requires: [{ item: 'iron-key' }, { capability: 'strength' }],
        reason: 'Locked',
      }),
    ).toEqual({
      verb: 'unlock',
      label: 'Unlock door',
      hold: 1,
      requires: [{ item: 'iron-key' }, { capability: 'strength' }],
      reason: 'Locked',
    });
  });

  it('rejects unknown verbs, bad holds and malformed requirements', () => {
    const bad = (spec: unknown) => () => normalizeAffordance(spec as AffordanceSpec);
    expect(bad({ verb: 'dance' })).toThrow(/unknown affordance verb "dance"/);
    expect(bad({ verb: 'pull', hold: -1 })).toThrow(/hold/);
    expect(bad({ verb: 'pull', hold: 10.5 })).toThrow(/hold/);
    expect(bad({ verb: 'pull', hold: Number.NaN })).toThrow(/hold/);
    expect(bad({ verb: 'pull', requires: [{}] })).toThrow(/exactly one/);
    expect(bad({ verb: 'pull', requires: [{ key: 'x' }] })).toThrow(/exactly one/);
    expect(bad({ verb: 'pull', requires: [{ item: 'a', capability: 'b' }] })).toThrow(
      /exactly one/,
    );
    expect(bad({ verb: 'pull', requires: [{ item: '' }] })).toThrow(/item requirement/);
    expect(bad({ verb: 'pull', requires: [{ capability: 3 }] })).toThrow(/capability requirement/);
  });

  it('derives pick up, search, hide and push from properties', () => {
    expect(PROPERTY_AFFORDANCES.map(([key, a]) => [key, a.verb])).toEqual([
      ['liftable', 'pick-up'],
      ['container', 'search'],
      ['hideable', 'hide'],
      ['pushable', 'push'],
    ]);
  });

  it('AC-4: an unmet requirement gives the reason: its own, or what it needs', () => {
    const unlock = normalizeAffordance({
      verb: 'unlock',
      requires: [{ item: 'iron-key' }],
      reason: 'Locked — needs Iron Key',
    });
    const pick = normalizeAffordance({
      verb: 'pick-lock',
      requires: [{ capability: 'lockpicking' }],
    });
    const both = normalizeAffordance({
      verb: 'open',
      requires: [{ capability: 'strength' }, { item: 'crowbar' }],
    });
    expect(unavailableReason(kit(), unlock)).toBe('Locked — needs Iron Key');
    expect(unavailableReason(kit([], ['iron-key']), unlock)).toBeUndefined();
    expect(unavailableReason(kit(), pick)).toBe('Needs Lockpicking');
    expect(unavailableReason(kit(['lockpicking']), pick)).toBeUndefined();
    expect(unavailableReason(kit(['strength']), both)).toBe('Needs Crowbar');
    expect(meets(kit(['a']), { capability: 'a' })).toBe(true);
    expect(meets(kit(['a']), { item: 'a' })).toBe(false);
  });
});
