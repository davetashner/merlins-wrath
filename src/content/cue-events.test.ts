import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CUE_EVENT_NAMES,
  CUE_EVENTS,
  CUE_FACT_KINDS,
  checkCueRule,
  cueEventSpec,
  cuePlaceholders,
  cueRuleBaseFields,
} from './cue-events.ts';

const rule = z.strictObject(cueRuleBaseFields).superRefine((r, ctx) => {
  checkCueRule(r, ctx);
});

const problems = (value: unknown) =>
  (rule.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('cue event vocabulary', () => {
  it('lists every event with at least one anchor and only known fact kinds', () => {
    expect(CUE_EVENT_NAMES).toEqual(Object.keys(CUE_EVENTS));
    for (const name of CUE_EVENT_NAMES) {
      const spec = cueEventSpec(name);
      expect(spec.anchors.length, name).toBeGreaterThan(0);
      expect(Object.values(spec.facts).every((k) => CUE_FACT_KINDS.includes(k))).toBe(true);
    }
  });

  it('defaults match to {} and layer to "main"', () => {
    expect(rule.parse({ event: 'Died' })).toEqual({ event: 'Died', match: {}, layer: 'main' });
  });

  it('AC-5: an unknown sim event is rejected, listing the events a sheet can use', () => {
    const [problem] = problems({ event: 'Exploded' });
    expect(problem).toMatch(
      /^event: unknown sim event "Exploded"; cue sheets can use: DamageApplied,/,
    );
  });

  it('accepts string, list and boolean facts of the right kind', () => {
    expect(
      problems({
        event: 'DamageApplied',
        match: { weapon: 'metal', tags: 'critical', immune: false },
      }),
    ).toEqual([]);
  });

  it('rejects unknown facts, number facts and values of the wrong kind', () => {
    expect(
      problems({
        event: 'DamageApplied',
        match: { colour: 'red', total: 'big', died: 'yes', target: true },
      }),
    ).toEqual([
      expect.stringMatching(/^match.colour: DamageApplied has no fact "colour"; it has: weapon,/),
      'match.total: "total" is a number fact: scale by it with volumeBy, don\'t match it',
      'match.died: "died" is a boolean fact, so its match value must be a boolean',
      'match.target: "target" is a string fact, so its match value must be a string',
    ]);
    expect(problems({ event: 'StaminaExhausted', match: { x: 'y' } })).toEqual([
      'match.x: StaminaExhausted has no fact "x"; it has: none',
    ]);
  });

  it('AC-3: a physicsImpact rule may match material facts but not unknown or number facts', () => {
    expect(
      problems({ event: 'physicsImpact', match: { entity: 'wood', otherMaterial: 'stone' } }),
    ).toEqual([]);
    expect(problems({ event: 'physicsImpact', match: { mass: 'heavy', energy: 'big' } })).toEqual([
      expect.stringMatching(/^match.mass: physicsImpact has no fact "mass"; it has: entity,/),
      'match.energy: "energy" is a number fact: scale by it with volumeBy, don\'t match it',
    ]);
  });

  it('rejects a layer that is not kebab-case', () => {
    expect(problems({ event: 'Died', layer: 'Main' })).toEqual([
      'layer: must be lowercase kebab-case',
    ]);
  });

  it('finds {fact} placeholders in order', () => {
    expect(cuePlaceholders('sfx-{weapon}-on-{target}')).toEqual(['weapon', 'target']);
    expect(cuePlaceholders('sfx-plain')).toEqual([]);
  });
});
