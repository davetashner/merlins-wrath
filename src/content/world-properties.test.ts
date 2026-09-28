import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { WorldPropertyValues } from '../sim/properties/spec.ts';
import { ContentLoadError, loadContent, type ContentIssue } from './loader.ts';
import { contentId } from './schema.ts';
import { worldPropertiesSchema, type WorldPropertiesData } from './world-properties.ts';

/** A throwaway content type that embeds world properties, as props and creatures will. */
const schemas = {
  thing: z.strictObject({ id: contentId, properties: worldPropertiesSchema }),
};

function issuesOf(properties: unknown): readonly ContentIssue[] {
  const text = JSON.stringify({ id: 'crate', properties });
  try {
    loadContent(schemas, [{ path: 'data/thing/crate.json', text }]);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  return [];
}

describe('world properties data schema', () => {
  it('AC-3: an out-of-range value (wetness 1.4) fails, naming the file and path', () => {
    expect(issuesOf({ wetness: 1.4 })).toEqual([
      {
        file: 'data/thing/crate.json',
        pointer: '/properties/wetness',
        message: expect.stringMatching(/<=1/) as string,
      },
    ]);
  });

  it('AC-3: an unknown property key fails, naming the key and path', () => {
    expect(issuesOf({ wet: 0.5 })).toEqual([
      {
        file: 'data/thing/crate.json',
        pointer: '/properties',
        message: expect.stringMatching(/"wet"/) as string,
      },
    ]);
    expect(issuesOf({ lightEmitter: { intensity: 1, radius: 2, hue: 3 } })).toEqual([
      {
        file: 'data/thing/crate.json',
        pointer: '/properties/lightEmitter',
        message: expect.stringMatching(/"hue"/) as string,
      },
    ]);
  });

  it('accepts any valid subset, including none', () => {
    const properties = {
      material: 'dry-wood',
      flammable: true,
      wetness: 0.2,
      climbable: 2,
      lightEmitter: { intensity: 100, radius: 8 },
    };
    expect(issuesOf(properties)).toEqual([]);
    expect(issuesOf({})).toEqual([]);
    expect(worldPropertiesSchema.parse(properties)).toEqual(properties);
  });

  it('has exactly the sim property keys and value types', () => {
    type Filled = {
      [K in keyof WorldPropertiesData]-?: Exclude<WorldPropertiesData[K], undefined>;
    };
    expectTypeOf<keyof WorldPropertiesData>().toEqualTypeOf<keyof WorldPropertyValues>();
    expectTypeOf<Filled>().toExtend<WorldPropertyValues>();
    expectTypeOf<WorldPropertyValues>().toExtend<Filled>();
  });
});
