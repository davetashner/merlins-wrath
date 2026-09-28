// Contract between layers (mw-e03.1): the sim's world-property spec and the content data schema must
// agree on every key, range and default. Content may import the sim only as types, so this runtime
// comparison lives outside src/: it probes both validators with values at and around every bound
// and requires the same verdict.

import { describe, expect, it } from 'vitest';
import { worldPropertiesSchema } from '@content/index';
import {
  validateProperty,
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type NumberRange,
  type WorldPropertyKey,
} from '@sim/index';

const fieldSchemas = worldPropertiesSchema.shape as Record<
  WorldPropertyKey,
  { safeParse(value: unknown): { success: boolean } }
>;

/** Values at, just inside and just outside a numeric range, plus non-numbers. */
function numberProbes(range: NumberRange): unknown[] {
  const { min, max } = range;
  const nudge = (x: number) => Math.max(Math.abs(x) * 1e-6, 1e-9);
  const outside = [min - nudge(min), max + nudge(max), min - 1, max + 1, min - 0.5, max + 0.5];
  return [min, max, (min + max) / 2, min + 0.5, ...outside, Number.NaN, Infinity, '1'];
}

function probes(key: WorldPropertyKey): unknown[] {
  const spec = WORLD_PROPERTY_SPECS[key];
  switch (spec.type) {
    case 'number':
      return numberProbes(spec);
    case 'boolean':
      return [true, false, 0, 'true', null];
    case 'id':
      return ['dry-wood', 'a', 'Dry Wood', 'dry_wood', '', 7];
    case 'record': {
      const fields = Object.entries(spec.fields);
      const base = Object.fromEntries(fields.map(([name, range]) => [name, range.min]));
      return [
        base,
        { ...base, extra: 1 },
        null,
        [],
        ...fields.flatMap(([name, range]) =>
          numberProbes(range).map((value) => ({ ...base, [name]: value })),
        ),
      ];
    }
  }
}

describe('world properties: sim spec ⇄ content schema', () => {
  it('have the same keys', () => {
    expect(Object.keys(fieldSchemas).sort()).toEqual([...WORLD_PROPERTY_KEYS]);
  });

  it('agree on every range, type and default', () => {
    const disagreements = WORLD_PROPERTY_KEYS.flatMap((key) =>
      [WORLD_PROPERTY_SPECS[key].default, ...probes(key)].flatMap((value) => {
        const sim = validateProperty(key, value) === undefined;
        const content = fieldSchemas[key].safeParse(value).success;
        return sim === content ? [] : [`${key} = ${JSON.stringify(value)}: sim ${String(sim)}`];
      }),
    );
    expect(disagreements).toEqual([]);
  });
});
