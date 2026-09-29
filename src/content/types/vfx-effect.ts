// VFX effect definitions as content (mw-e29.1): `src/content/data/vfx-effect/<id>.json`. An effect is
// a list of particle emitters plus how long it runs, how important it is when the particle budget is
// full, and which quality tier each emitter needs. Emitters say what they emit (rate and bursts,
// lifetime, speed inside a cone, gravity and drag) and how it looks over a particle's life (size,
// colour and alpha curves; a texture or flipbook asset id and a blend mode, style bible §8). The
// renderer-agnostic runtime and the budget manager are src/game/vfx; the Three.js drawing is
// src/render/vfx. Which sim event spawns which effect is VFX cue sheets' job (e29.3), not this file's.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Blend modes (style bible §8): magic cores are additive, smoke, dust and debris alpha-blended. */
export const VFX_BLEND_MODES = ['additive', 'alpha'] as const;
export type VfxBlendMode = (typeof VFX_BLEND_MODES)[number];

/** Quality tiers, lowest first (the hardware baseline's Low and High presets). */
export const VFX_QUALITY_TIERS = ['low', 'high'] as const;
export type VfxQualityTier = (typeof VFX_QUALITY_TIERS)[number];

/** A VFX texture or flipbook asset id (style bible §15 naming), e.g. `vfx-fire-flame-loop-8x8-01`. */
export const VFX_TEXTURE_PATTERN = /^vfx-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A colour as `#RRGGBB` (style bible palette values). */
export const HEX_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Keys must be in time order, so a curve reads left to right. */
function inTimeOrder(keys: readonly { readonly t: number }[], ctx: z.RefinementCtx): void {
  keys.forEach((key, index) => {
    const previous = keys[index - 1];
    if (previous !== undefined && key.t < previous.t) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 't'],
        message: 'keys must be in time order (t never decreases)',
      });
    }
  });
}

const curveTime = z
  .number()
  .min(0)
  .max(1)
  .describe('Point in the particle’s life, 0 = born, 1 = dies.');

/** A number over a particle's life: a constant, or keys interpolated linearly. */
function scalarCurve(value: z.ZodNumber) {
  return z.union([
    value,
    z
      .array(z.strictObject({ t: curveTime, v: value.describe('Value at t.') }))
      .min(1)
      .superRefine(inTimeOrder),
  ]);
}

const colour = z.string().regex(HEX_COLOUR_PATTERN, 'must be a colour like "#FF7A1A"');

/** A colour over a particle's life: a constant, or keys interpolated linearly in sRGB. */
const colourCurve = z.union([
  colour,
  z
    .array(z.strictObject({ t: curveTime, color: colour.describe('Colour at t.') }))
    .min(1)
    .superRefine(inTimeOrder),
]);

/** A random range; `max` defaults to `min`. */
function range(value: z.ZodNumber, what: string) {
  return z
    .strictObject({
      min: value.describe(`Smallest ${what}.`),
      max: value.optional().describe(`Largest ${what}; default: min.`),
    })
    .refine((r) => r.max === undefined || r.max >= r.min, {
      message: 'max must not be less than min',
      path: ['max'],
    })
    .transform((r) => ({ min: r.min, max: r.max ?? r.min }));
}

const flipbookSchema = z.strictObject({
  cols: z
    .number()
    .int()
    .min(1)
    .max(16)
    .describe('Frame columns in the sheet (style bible: 4 or 8).'),
  rows: z.number().int().min(1).max(16).describe('Frame rows in the sheet.'),
  fps: z
    .number()
    .positive()
    .optional()
    .describe('Frames per second, looping; default: play the sheet once over the particle’s life.'),
});

const burstSchema = z.strictObject({
  at: z.number().min(0).describe('Seconds after the effect starts.'),
  count: z.number().int().positive().describe('Particles emitted at once.'),
});

/** One particle emitter of an effect. */
export const vfxEmitterSchema = z
  .strictObject({
    id: contentId.describe('Emitter id, unique within the effect, e.g. "core".'),
    texture: z
      .string()
      .regex(VFX_TEXTURE_PATTERN, 'must be a VFX asset id like "vfx-spark-01"')
      .describe('Texture or flipbook asset id; placeholders are generated until the asset lands.'),
    flipbook: flipbookSchema.optional().describe('The texture is a grid of animation frames.'),
    blend: z
      .enum(VFX_BLEND_MODES)
      .describe('additive for glowing magic cores, alpha for smoke, dust and debris.'),
    rate: z.number().min(0).default(0).describe('Particles per second while the effect emits.'),
    bursts: z.array(burstSchema).default([]).describe('One-off emissions at fixed times.'),
    lifetime: range(z.number().positive(), 'particle lifetime, seconds (> 0)').describe(
      'Particle lifetime range, seconds.',
    ),
    speed: range(z.number().min(0), 'launch speed, m/s')
      .default({ min: 0, max: 0 })
      .describe('Launch speed range, m/s.'),
    coneDeg: z
      .number()
      .min(0)
      .max(180)
      .default(0)
      .describe('Half-angle of the launch cone around the effect’s up axis; 180 = any direction.'),
    spawnRadius: z
      .number()
      .min(0)
      .default(0)
      .describe('Particles start anywhere within this many metres of the effect’s origin.'),
    gravity: z
      .number()
      .default(0)
      .describe('Downward acceleration, m/s² (negative rises, like smoke).'),
    drag: z.number().min(0).default(0).describe('Velocity lost per second, as a fraction.'),
    size: scalarCurve(z.number().min(0))
      .default(0.2)
      .describe('Particle size in metres over its life.'),
    color: colourCurve.describe(
      'Particle colour over its life (`#FFFFFF` only in emissive cores).',
    ),
    alpha: scalarCurve(z.number().min(0).max(1))
      .default([
        { t: 0, v: 1 },
        { t: 1, v: 0 },
      ])
      .describe('Opacity over the particle’s life (default fades out).'),
    minTier: z
      .enum(VFX_QUALITY_TIERS)
      .default('low')
      .describe('Lowest quality tier the emitter runs on; "high" drops it on Low.'),
  })
  .refine((e) => e.rate > 0 || e.bursts.length > 0, {
    message: 'an emitter needs a rate or at least one burst',
    path: ['rate'],
  });

/** One VFX effect: `src/content/data/vfx-effect/<id>.json`. */
export const vfxEffectSchema = z
  .strictObject({
    id: contentId.describe('Effect id, e.g. "impact-sparks".'),
    notes: z.string().min(1).describe('What the effect shows and where it is used, for review.'),
    priority: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(50)
      .describe(
        '0–100: when the particle budget is full, lower-priority effects are culled first.',
      ),
    duration: z
      .number()
      .positive()
      .describe('Seconds the effect emits for; a looping effect repeats its bursts each period.'),
    loop: z.boolean().default(false).describe('Emit until stopped instead of once.'),
    socket: contentId
      .optional()
      .describe('Default socket when spawned on an entity (e.g. "hand-r"); default: its origin.'),
    lowRateScale: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe('Emission multiplier on the Low tier (rate and burst counts).'),
    emitters: z.array(vfxEmitterSchema).min(1).describe('The particle emitters.'),
  })
  .superRefine((effect, ctx) => {
    const seen = new Set<string>();
    effect.emitters.forEach((emitter, index) => {
      if (seen.has(emitter.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['emitters', index, 'id'],
          message: `duplicate emitter id "${emitter.id}"`,
        });
      }
      seen.add(emitter.id);
      emitter.bursts.forEach((burst, b) => {
        if (burst.at > effect.duration) {
          ctx.addIssue({
            code: 'custom',
            path: ['emitters', index, 'bursts', b, 'at'],
            message: `burst at ${String(burst.at)} s is after the effect's ${String(effect.duration)} s duration`,
          });
        }
      });
    });
  });

/** An effect as written in a data file. */
export type VfxEffectDefInput = z.input<typeof vfxEffectSchema>;
/** A loaded effect. */
export type VfxEffectDef = z.output<typeof vfxEffectSchema>;
/** A loaded emitter. */
export type VfxEmitterDef = z.output<typeof vfxEmitterSchema>;
/** A loaded number curve: a constant or time-ordered keys. */
export type VfxScalarCurve = VfxEmitterDef['size'];
/** A loaded colour curve: a constant or time-ordered keys. */
export type VfxColourCurve = VfxEmitterDef['color'];
