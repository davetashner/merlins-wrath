import { describe, expect, expectTypeOf, it } from 'vitest';
import { gameContentSources, loadGameContent } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { describeContent } from '../testing.ts';
import { worldPropertiesSchema } from '../world-properties.ts';
import {
  ARROW_PAYLOAD_OPS,
  ARROW_SCHEMA_VERSION,
  arrowSchema,
  isTargetSpecificKey,
  SURFACE_PENETRATION,
  type ArrowDefinition,
  type ArrowDefinitionInput,
  type ArrowEntry,
} from './arrow.ts';

const INITIAL_ARROWS = ['blunt', 'broadhead', 'fire', 'noise', 'rope', 'standard', 'water'];
const PROPERTY_KEYS: readonly string[] = Object.keys(worldPropertiesSchema.shape);

const content = loadGameContent();

/** A data file without its editor `$schema` pointer (the loader drops it too). */
const withoutSchemaKey = (text: string): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([k]) => k !== '$schema'),
  );

/** A minimal valid arrow. */
const minimal = {
  id: 'test-arrow',
  name: 'Test Arrow',
  massGrams: 25,
  dragK: 0.00005,
  damage: { amounts: { pierce: 10 } },
  penetration: 20,
  onImpact: 'stick',
  cues: { trailVfx: 'vfx-arrow-trail-test' },
} satisfies ArrowDefinitionInput;

const issues = (value: unknown) =>
  (arrowSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
const withPayload = (...payload: unknown[]) => ({ ...minimal, payload });

const loadError = (files: Record<string, unknown>): ContentLoadError => {
  try {
    loadContent(
      { arrow: arrowSchema },
      Object.entries(files).map(([path, json]): ContentSource => ({
        path,
        text: JSON.stringify(json),
      })),
    );
  } catch (error) {
    return error as ContentLoadError;
  }
  throw new Error('expected the arrows to fail to load');
};

describe('initial arrows (mw-e05.1)', () => {
  it('AC-1: all seven arrow files validate and every payload property is a world property', () => {
    const sources = gameContentSources().filter((s) => s.path.includes('/arrow/'));
    expect(sources).toHaveLength(7);
    for (const source of sources) {
      expect(
        arrowSchema.safeParse(withoutSchemaKey(source.text)).error?.issues ?? [],
        source.path,
      ).toEqual([]);
    }
    const arrows = content.all('arrow');
    expect(arrows.map((a) => a.id).sort()).toEqual(INITIAL_ARROWS);
    const named = arrows.flatMap((a) =>
      a.payload.flatMap((p) =>
        p.op === 'applyProperty' ? [p.property] : p.op === 'spawn' && p.anchor ? [p.anchor] : [],
      ),
    );
    expect(new Set(named)).toEqual(new Set(['burning', 'wetness', 'softAnchor']));
    for (const key of named) expect(PROPERTY_KEYS).toContain(key);
    const standard = content.get('arrow', 'standard');
    expectTypeOf(standard).toEqualTypeOf<ArrowEntry>();
    expect(standard).toMatchObject({
      schemaVersion: ARROW_SCHEMA_VERSION,
      retrievable: true,
      payload: [],
      cues: { flightSfx: 'sfx-arrow-flyby' },
    });
  });

  it('together use every payload op, and the standard arrow sticks in wood but not stone', () => {
    expect(new Set(content.all('arrow').flatMap((a) => a.payload.map((p) => p.op)))).toEqual(
      new Set(ARROW_PAYLOAD_OPS),
    );
    const { penetration } = content.get('arrow', 'standard');
    expect(penetration).toBeGreaterThanOrEqual(SURFACE_PENETRATION.medium);
    expect(penetration).toBeLessThan(SURFACE_PENETRATION.hard);
  });
});

describe('arrow schema (mw-e05.1)', () => {
  it('fills defaults for optional fields', () => {
    const arrow: ArrowDefinition = arrowSchema.parse(
      withPayload(
        { op: 'applyProperty', property: 'frozen' },
        { op: 'stimulus', element: 'cold', intensity: 50 },
        { op: 'noise', loudness: 10 },
      ),
    );
    expect(arrow).toMatchObject({
      schemaVersion: ARROW_SCHEMA_VERSION,
      retrievable: true,
      tags: [],
      cues: { trailVfx: 'vfx-arrow-trail-test', flightSfx: 'sfx-arrow-flyby' },
      damage: { poiseDamage: 0, impactForce: 0, impulse: { x: 0, y: 0, z: 0 } },
      payload: [
        { op: 'applyProperty', property: 'frozen', radius: 0 },
        { op: 'stimulus', element: 'cold', radius: 0, duration: 0, falloff: 'linear' },
        { op: 'noise', loudness: 10, duration: 0 },
      ],
    });
    expect(arrowSchema.parse(minimal).payload).toEqual([]);
  });

  it('AC-2: an unknown payload property fails naming the file and the JSON path', () => {
    const file = 'content/arrow/bad.json';
    const error = loadError({
      [file]: withPayload({ op: 'applyProperty', property: 'sparkly', radius: 1 }),
    });
    expect(error.issues).toEqual([
      {
        file,
        pointer: '/payload/0/property',
        message: 'unknown world property "sparkly" (at payload[0].property)',
      },
    ]);
    expect(error.message).toContain(`${file}#/payload/0/property`);
    expect(issues(withPayload({ op: 'applyProperty', property: 'wet' }))).toEqual([
      'payload.0.property: "wet" is not a world property; use the canonical key "wetness"',
    ]);
    expect(issues(withPayload({ op: 'spawn', entity: 'rope', anchor: 'soft_anchor' }))).toEqual([
      'payload.0.anchor: "soft_anchor" is not a world property; use the canonical key "softAnchor"',
    ]);
  });

  it('AC-2: an unknown or missing payload op is named with the known ops', () => {
    expect(issues(withPayload({ op: 'explode' }))).toEqual([
      `payload.0.op: unknown payload op "explode"; known: ${ARROW_PAYLOAD_OPS.join(', ')}`,
    ]);
    expect(issues(withPayload({ radius: 1 }))).toEqual([
      expect.stringMatching(/^payload\.0\.op: missing payload op; known: applyProperty/),
    ]);
    expect(issues(withPayload('burning'))).toEqual([
      'payload.0: Invalid input: expected object, received string',
    ]);
  });

  it('AC-3: a negative mass or dragK fails with a range error', () => {
    const result = arrowSchema.safeParse({ ...minimal, massGrams: -25, dragK: -0.1 });
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.code])).toEqual([
      ['massGrams', 'too_small'],
      ['dragK', 'too_small'],
    ]);
    expect(issues({ ...minimal, massGrams: 0 })).toEqual([
      expect.stringMatching(/^massGrams: Too small/),
    ]);
    expect(issues({ ...minimal, dragK: 0 })).toEqual([]);
    expect(issues({ ...minimal, penetration: -1 })).toEqual([
      expect.stringMatching(/^penetration: Too small/),
    ]);
  });

  it('AC-4: a payload key that targets a specific entity type is rejected as non-systemic', () => {
    expect(
      issues(withPayload({ op: 'applyProperty', property: 'burning', onlyAffects: 'rope' })),
    ).toEqual([
      'payload.0: "onlyAffects" is non-systemic: arrows never name what they affect; emit a ' +
        'property or stimulus and let the struck entity’s world properties decide',
    ]);
    expect(issues(withPayload({ op: 'noise', loudness: 5, targetType: 'guard' }))).toEqual([
      expect.stringMatching(/^payload\.0: "targetType" is non-systemic/),
    ]);
    expect(issues({ ...minimal, vsUndead: 2 })).toEqual([
      expect.stringMatching(/^: "vsUndead" is non-systemic/),
    ]);
    for (const key of ['affects', 'hitTargets', 'exceptPlayer', 'excludeTypes', 'against']) {
      expect(isTargetSpecificKey(key), key).toBe(true);
    }
    for (const key of ['radius', 'value', 'anchor', 'element', 'loudness']) {
      expect(isTargetSpecificKey(key), key).toBe(false);
    }
  });

  it('rejects other unknown keys without calling them non-systemic', () => {
    expect(issues(withPayload({ op: 'noise', loudness: 5, volume: 3 }))).toEqual([
      'payload.0: unknown key "volume"',
    ]);
    expect(
      issues({ ...minimal, cues: { ...minimal.cues, colour: 'red', onlyAffects: 'x' } }),
    ).toEqual([
      expect.stringMatching(/^cues: unknown key "colour"; "onlyAffects" is non-systemic/),
    ]);
  });

  it('checks an applied property’s value against that property’s own range', () => {
    const apply = (property: string, value?: unknown) =>
      issues(withPayload({ op: 'applyProperty', property, value, radius: 1 }));
    expect(apply('wetness', 0.5)).toEqual([]);
    expect(apply('burning', false)).toEqual([]);
    expect(apply('lightEmitter', { intensity: 50, radius: 2 })).toEqual([]);
    expect(apply('wetness', 2)).toEqual([
      expect.stringMatching(/^payload\.0\.value: arrow "test-arrow": Too big/),
    ]);
    expect(apply('burning', 1)).toEqual([
      expect.stringMatching(
        /^payload\.0\.value: arrow "test-arrow": Invalid input: expected boolean/,
      ),
    ]);
    expect(apply('lightEmitter', { intensity: -1, radius: 2 })).toEqual([
      expect.stringMatching(/^payload\.0\.value\.intensity: arrow "test-arrow": Too small/),
    ]);
    expect(apply('wetness')).toEqual([
      'payload.0.value: arrow "test-arrow": "wetness" is not a flag: give a value',
    ]);
    expect(apply('material', 'wood')).toEqual([
      'payload.0.property: arrow "test-arrow": "material" cannot be applied by a payload',
    ]);
    expect(apply('support', 3)).toEqual([
      'payload.0.property: arrow "test-arrow": "support" cannot be applied by a payload',
    ]);
  });

  it('requires a gas id exactly for gas stimuli', () => {
    expect(issues(withPayload({ op: 'stimulus', element: 'gas', intensity: 1 }))).toEqual([
      'payload.0.gas: arrow "test-arrow": a gas stimulus needs a gas type id',
    ]);
    expect(
      issues(withPayload({ op: 'stimulus', element: 'heat', intensity: 1, gas: 'smoke' })),
    ).toEqual([
      'payload.0.gas: arrow "test-arrow": only gas stimuli name a gas (element is "heat")',
    ]);
    expect(
      issues(withPayload({ op: 'stimulus', element: 'gas', intensity: 1, gas: 'smoke' })),
    ).toEqual([]);
    expect(issues(withPayload({ op: 'stimulus', element: 'lava', intensity: 1 }))).toEqual([
      expect.stringMatching(/^payload\.0\.element: Invalid option/),
    ]);
  });

  it('checks impact rules: shattering, sticking, anchoring and one force multiplier', () => {
    expect(issues({ ...minimal, onImpact: 'shatter' })).toEqual([
      'retrievable: arrow "test-arrow": a shattering arrow cannot be retrievable',
    ]);
    expect(issues({ ...minimal, onImpact: 'shatter', retrievable: false })).toEqual([]);
    expect(issues({ ...minimal, penetration: 0 })).toEqual([
      'penetration: arrow "test-arrow": a sticking arrow needs penetration above 0 (or onImpact "bounce")',
    ]);
    const anchored = { op: 'spawn', entity: 'rope', length: 8, anchor: 'softAnchor' };
    expect(issues(withPayload(anchored))).toEqual([]);
    expect(issues({ ...withPayload(anchored), onImpact: 'bounce' })).toEqual([
      'payload.0.anchor: arrow "test-arrow": an anchored spawn needs onImpact "stick"',
    ]);
    expect(issues(withPayload({ ...anchored, anchor: 'friction' }))).toEqual([
      'payload.0.anchor: arrow "test-arrow": anchor "friction" is not a flag property',
    ]);
    const force = { op: 'impactForceMul', factor: 2.5 };
    expect(issues(withPayload(force, force))).toEqual([
      'payload: arrow "test-arrow": lists impactForceMul twice',
    ]);
    expect(issues(withPayload({ ...force, factor: 0 }))).toEqual([
      expect.stringMatching(/^payload\.0\.factor: Too small/),
    ]);
    expect(issues({ ...minimal, tags: ['trick', 'trick'] })).toEqual([
      'tags: arrow "test-arrow": lists a tag twice',
    ]);
  });

  it('requires a trail VFX cue and checks every cue id’s pattern', () => {
    expect(issues({ ...minimal, cues: 'vfx-arrow-trail-test' })).toEqual([
      'cues: Invalid input: expected object, received string',
    ]);
    expect(issues({ ...minimal, cues: { trailVfx: 7 } })).toEqual([
      'cues.trailVfx: Invalid input: expected string, received number',
    ]);
    expect(issues({ ...minimal, cues: {} })).toEqual([
      'cues.trailVfx: required: name a cue (a placeholder is fine), e.g. "vfx-arrow-trail-standard"',
    ]);
    expect(issues({ ...minimal, cues: { trailVfx: 'sfx-arrow-flyby' } })).toEqual([
      'cues.trailVfx: must be a cue id, e.g. "vfx-arrow-trail-standard"',
    ]);
    const cues = {
      trailVfx: 'vfx-arrow-trail-test',
      impactVfx: 'splash',
      flightSfx: 'vfx-arrow-flyby',
      impactSfx: 'Thud',
    };
    expect(issues({ ...minimal, cues })).toEqual([
      'cues.impactVfx: must be a cue id, e.g. "vfx-arrow-impact-water"',
      'cues.flightSfx: must be a cue id, e.g. "sfx-arrow-flyby"',
      'cues.impactSfx: must be a cue id, e.g. "sfx-arrow-fire-ignite"',
    ]);
  });

  it('two arrow files with the same id fail to load with a duplicate-id error', () => {
    const error = loadError({ 'content/arrow/a.json': minimal, 'content/arrow/b.json': minimal });
    expect(error.issues).toEqual([
      {
        file: 'content/arrow/b.json',
        pointer: '/id',
        message: 'duplicate id arrow:test-arrow: already defined in content/arrow/a.json',
      },
    ]);
  });
});

describeContent(
  'arrow',
  'AC-1: validates, names its trail cue and only systemic payload keys',
  (arrow) => {
    expect(arrow.cues.trailVfx).toMatch(/^vfx-arrow-/);
    for (const op of arrow.payload) {
      for (const key of Object.keys(op)) expect(isTargetSpecificKey(key), key).toBe(false);
    }
    if (arrow.onImpact === 'shatter') expect(arrow.retrievable).toBe(false);
  },
);
