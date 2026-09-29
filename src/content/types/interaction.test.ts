import { describe, expect, it } from 'vitest';
import type { InteractableSpec } from '../../sim/interaction/affordance.ts';
import { AFFORDANCE_VERB_IDS, interactableSchema, type InteractableDef } from './interaction.ts';

const problems = (value: unknown) =>
  (interactableSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('interactable schema (mw-e02.5)', () => {
  it('lists every sim verb once', () => {
    expect(new Set(AFFORDANCE_VERB_IDS).size).toBe(AFFORDANCE_VERB_IDS.length);
    expect(AFFORDANCE_VERB_IDS).toContain('pick-lock');
  });

  it('parses a gated, held affordance into a valid sim spec', () => {
    const def: InteractableDef = interactableSchema.parse({
      affordances: [
        { verb: 'unlock', requires: [{ item: 'iron-key' }], reason: 'Locked — needs Iron Key' },
        { verb: 'pick-lock', hold: 1.5, requires: [{ capability: 'lockpicking' }] },
      ],
      range: 2,
      anchor: [0, 1.2, 0],
      radius: 0.5,
    });
    const spec: InteractableSpec = def; // parsed data is assignable to the sim's spec
    expect(spec.affordances.map((a) => a.verb)).toEqual(['unlock', 'pick-lock']);
  });

  it('rejects unknown verbs, bad holds, bad requirements and empty lists', () => {
    expect(problems({ affordances: [] })).toHaveLength(1);
    expect(problems({ affordances: [{ verb: 'dance' }] })[0]).toMatch(/^affordances\.0\.verb/);
    expect(problems({ affordances: [{ verb: 'pull', hold: 11 }] })[0]).toMatch(/hold/);
    expect(problems({ affordances: [{ verb: 'pull', requires: [{ key: 'x' }] }] })).not.toEqual([]);
    expect(problems({ affordances: [{ verb: 'pull' }], range: 0 })[0]).toMatch(/^range/);
  });
});
