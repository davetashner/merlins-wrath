import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { WorldPropertyValues } from '../sim/properties/spec.ts';
import { ContentLoadError, loadContent, type ContentIssue } from './loader.ts';
import { ContentRef, contentId } from './schema.ts';
import {
  toPropertyInit,
  worldPropertiesSchema,
  type WorldPropertiesData,
  type WorldPropertiesInit,
} from './world-properties.ts';

/** A throwaway content type that embeds world properties, as props and creatures will. */
const schemas = {
  thing: z.strictObject({ id: contentId, properties: worldPropertiesSchema }),
  material: z.strictObject({ id: contentId }),
};

/** The one material the test catalogue defines. */
const dryWood = { path: 'data/material/dry-wood.json', text: '{"id":"dry-wood"}' };

function issuesOf(properties: unknown): readonly ContentIssue[] {
  const text = JSON.stringify({ id: 'crate', properties });
  try {
    loadContent(schemas, [dryWood, { path: 'data/thing/crate.json', text }]);
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
    expect(worldPropertiesSchema.parse(properties)).toEqual({
      ...properties,
      material: new ContentRef('material', 'dry-wood'),
    });
  });

  it('AC-3: an unknown material id fails, naming the id, file and path', () => {
    expect(issuesOf({ material: 'mithril' })).toEqual([
      {
        file: 'data/thing/crate.json',
        pointer: '/properties/material',
        message: 'thing:crate references missing material:mithril',
      },
    ]);
  });

  it('toPropertyInit turns the material ref into its id and keeps every other value', () => {
    const data = worldPropertiesSchema.parse({ material: 'dry-wood', weight: 3 });
    expect(toPropertyInit(data)).toEqual({ material: 'dry-wood', weight: 3 });
    expect(toPropertyInit({ wetness: 0.5 })).toEqual({ wetness: 0.5 });
  });

  it('has exactly the sim property keys and value types (material as a ref, then as its id)', () => {
    type Filled = {
      [K in keyof WorldPropertiesInit]-?: Exclude<WorldPropertiesInit[K], undefined>;
    };
    expectTypeOf<keyof WorldPropertiesData>().toEqualTypeOf<keyof WorldPropertyValues>();
    expectTypeOf<WorldPropertiesData['material']>().toEqualTypeOf<
      ContentRef<'material'> | undefined
    >();
    expectTypeOf<Filled>().toExtend<WorldPropertyValues>();
    expectTypeOf<WorldPropertyValues>().toExtend<Filled>();
  });
});
