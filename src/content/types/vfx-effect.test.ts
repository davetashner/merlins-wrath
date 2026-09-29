import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import {
  VFX_BLEND_MODES,
  vfxEffectSchema,
  vfxEmitterSchema,
  type VfxEffectDefInput,
} from './vfx-effect.ts';

type EmitterInput = VfxEffectDefInput['emitters'][number];

const emitter = (overrides: Partial<EmitterInput> = {}): EmitterInput => ({
  id: 'core',
  texture: 'vfx-spark-01',
  blend: 'additive',
  rate: 10,
  lifetime: { min: 0.5, max: 1 },
  color: '#FF7A1A',
  ...overrides,
});

const effect = (overrides: Partial<VfxEffectDefInput> = {}): VfxEffectDefInput => ({
  id: 'vfx-test',
  notes: 'Test effect.',
  duration: 1,
  emitters: [emitter()],
  ...overrides,
});

const problems = (value: unknown) =>
  (vfxEffectSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** Loads one effect file through the real loader and returns its issues. */
function loadIssues(value: unknown) {
  try {
    loadContent(contentTypes, [
      { path: 'data/vfx-effect/vfx-test.json', text: JSON.stringify(value) },
    ]);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentLoadError);
    return (error as ContentLoadError).issues;
  }
  return [];
}

describeContent('vfx-effect', 'uses only style-bible blend modes and VFX texture ids', (entry) => {
  for (const e of entry.emitters) {
    expect(VFX_BLEND_MODES).toContain(e.blend);
    expect(e.texture).toMatch(/^vfx-/);
    expect(e.lifetime.min).toBeGreaterThan(0);
  }
});

describe('vfx-effect schema', () => {
  it('AC-1: a negative lifetime fails at load with the path', () => {
    const issues = loadIssues(
      effect({ emitters: [emitter(), emitter({ id: 'bad', lifetime: { min: -1 } })] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'data/vfx-effect/vfx-test.json',
      pointer: '/emitters/1/lifetime/min',
    });
  });

  it('AC-1: an unknown blend mode fails at load with the path', () => {
    const issues = loadIssues(effect({ emitters: [emitter({ blend: 'screen' as 'alpha' })] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'data/vfx-effect/vfx-test.json',
      pointer: '/emitters/0/blend',
    });
    expect(issues[0]?.message).toMatch(/additive|alpha/);
  });

  it('effect ids are VFX cue ids, so moves and spells can name them', () => {
    expect(problems(effect({ id: 'impact-sparks' }))).toEqual([
      'id: must be a VFX cue id like "vfx-sword-trail-light"',
    ]);
  });

  it('fills defaults and normalises ranges', () => {
    const parsed = vfxEffectSchema.parse(effect());
    expect(parsed).toMatchObject({ priority: 50, loop: false, lowRateScale: 0.5 });
    expect(parsed.emitters[0]).toMatchObject({
      bursts: [],
      lifetime: { min: 0.5, max: 1 },
      speed: { min: 0, max: 0 },
      coneDeg: 0,
      spawnRadius: 0,
      gravity: 0,
      drag: 0,
      size: 0.2,
      alpha: [
        { t: 0, v: 1 },
        { t: 1, v: 0 },
      ],
      minTier: 'low',
    });
    expect(vfxEmitterSchema.parse(emitter({ lifetime: { min: 2 } })).lifetime).toEqual({
      min: 2,
      max: 2,
    });
  });

  it('rejects inverted ranges, out-of-order curve keys and bad colours or textures', () => {
    expect(
      problems(
        effect({
          emitters: [
            emitter({
              lifetime: { min: 1, max: 0.5 },
              size: [
                { t: 0.5, v: 1 },
                { t: 0.2, v: 2 },
              ],
              color: [{ t: 0, color: 'orange' }],
              texture: 'spark',
            }),
          ],
        }),
      ),
    ).toEqual([
      'emitters.0.texture: must be a VFX asset id like "vfx-spark-01"',
      'emitters.0.lifetime.max: max must not be less than min',
      'emitters.0.size.1.t: keys must be in time order (t never decreases)',
      'emitters.0.color.0.color: must be a colour like "#FF7A1A"',
    ]);
  });

  it('needs something to emit, unique emitter ids and bursts within the duration', () => {
    expect(
      problems(
        effect({
          emitters: [
            emitter({ rate: 0 }),
            emitter({ id: 'b', bursts: [{ at: 2, count: 3 }] }),
            emitter({ id: 'b' }),
          ],
        }),
      ),
    ).toEqual([
      'emitters.0.rate: an emitter needs a rate or at least one burst',
      "emitters.1.bursts.0.at: burst at 2 s is after the effect's 1 s duration",
      'emitters.2.id: duplicate emitter id "b"',
    ]);
  });
});
