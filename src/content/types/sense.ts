// Sense profiles (mw-e12.2). Creatures perceive differently — a wolf smells the trail, a Hushling
// hunts by sound alone, the undead feel the warmth of the living — so stealth is a puzzle per
// creature rather than one global rule. A profile is pure data: sight (a primary cone inside a wider
// peripheral cone, a vertical limit, near/far ranges, dark vision and detection speed), hearing (a dB
// threshold at the listener and a range cap), smell (range, wind, scent trails) and special senses
// keyed by channel name, so perception (e11.5) registers one handler per channel without schema
// changes. Reusable profiles are the `sense` content type (`src/content/data/sense/<id>.json`); a
// creature either names one ("humanoid"), overrides one (`{ "base": "humanoid", "sight": {…} }`) or
// writes a complete profile inline. `resolveSenses` applies the merge rules below and re-validates
// the result, so a creature always hands perception one complete, consistent SenseProfile.
// Evaluating senses (cone tests, falloff, trig via simMath) is e11.5's job in src/sim, not this file's.
//
// Units: metres, degrees (half-angles measured from the facing direction), dB at the listener; all
// the 0–1 factors are unitless.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { ContentRef, contentId, ref } from '../schema.ts';

/**
 * Special-sense channels perception knows how to evaluate (e11.5 registers one handler per channel).
 * A new channel is one entry here plus its handler; the profile shape never changes.
 */
export const SPECIAL_SENSE_CHANNELS = ['tremor', 'life-sense', 'magic-sense'] as const;

/** A registered special-sense channel name. */
export type SpecialSenseChannel = (typeof SPECIAL_SENSE_CHANNELS)[number];

const metres = z.number().nonnegative();
const unit = z.number().min(0).max(1);

const sightSchema = z.strictObject({
  nearRange: metres.describe(
    'Metres within which a visible target is noticed at the full detection rate.',
  ),
  farRange: metres.describe('Metres beyond which it sees nothing; detection falls off from near.'),
  primaryHalfAngle: z
    .number()
    .min(0)
    .max(180)
    .describe('Half-angle of the focused (primary) cone, degrees from the facing direction.'),
  peripheralHalfAngle: z
    .number()
    .min(0)
    .max(180)
    .describe('Half-angle of the peripheral cone, degrees; at least primaryHalfAngle.'),
  verticalHalfAngle: z
    .number()
    .min(0)
    .max(90)
    .describe('Vertical half-angle above and below eye level, degrees.'),
  darkVision: unit.describe('How well it sees in darkness, 0–1: 0 = needs light, 1 = unaffected.'),
  detectionSpeed: z
    .number()
    .positive()
    .describe('Multiplier on how quickly sightings build awareness; 1 = baseline.'),
});

const hearingSchema = z.strictObject({
  thresholdDb: z
    .number()
    .min(0)
    .max(140)
    .describe('Quietest sound it hears, dB at the listener after propagation.'),
  range: metres.describe('Metres beyond which it hears nothing, however loud.'),
});

const smellSchema = z.strictObject({
  range: metres.describe('Metres it can smell a scent source in still air.'),
  windSensitive: z
    .boolean()
    .describe('Whether wind carries scent to it (downwind smells farther).'),
  tracksScentTrails: z
    .boolean()
    .describe(
      'Whether it follows scent trails left by moving targets (hook; post-MVP simulation).',
    ),
});

const specialSenseSchema = z.strictObject({
  range: metres.describe('Metres the sense reaches.'),
  minStrength: unit.describe('Weakest signal it registers, 0–1 (after range falloff).'),
  requiresLineOfSight: z
    .boolean()
    .describe('Whether walls block it (false = senses through walls and floors).'),
  requiresMovement: z.boolean().describe('Whether it only senses targets that are moving.'),
});

const channelList = SPECIAL_SENSE_CHANNELS.join(', ');

/** Adds an issue for every key of `record` that is not a registered special-sense channel. */
function checkChannels(record: Readonly<Record<string, unknown>>, ctx: z.RefinementCtx): void {
  for (const key of Object.keys(record)) {
    if (!(SPECIAL_SENSE_CHANNELS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `unknown special sense channel "${key}"; registered channels: ${channelList}`,
      });
    }
  }
}

const specialDescription = `Special senses by channel (${channelList}); absent = none.`;

/** The senses of one profile (no id): what a resolved creature hands to perception. */
const profileShape = {
  sight: sightSchema.optional().describe('Sight; absent = blind.'),
  hearing: hearingSchema.optional().describe('Hearing; absent = deaf.'),
  smell: smellSchema.optional().describe('Smell; absent = no sense of smell.'),
  special: z
    .record(z.string(), specialSenseSchema)
    .superRefine(checkChannels)
    .optional()
    .describe(specialDescription),
};

/**
 * Runs a cross-field check only once every field passed its own bounds, so one bad value is reported
 * once (zod otherwise runs refinements after recoverable issues such as a negative range).
 */
const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

type ProfileFields = z.output<z.ZodObject<typeof profileShape>>;

/** Adds an issue for every cross-field inconsistency, naming both fields involved. */
function checkProfile(p: ProfileFields, ctx: z.RefinementCtx): void {
  const sight = p.sight;
  if (sight === undefined) return;
  if (sight.primaryHalfAngle > sight.peripheralHalfAngle) {
    ctx.addIssue({
      code: 'custom',
      path: ['sight', 'primaryHalfAngle'],
      message: `sight.primaryHalfAngle (${String(sight.primaryHalfAngle)}°) must not exceed sight.peripheralHalfAngle (${String(sight.peripheralHalfAngle)}°)`,
    });
  }
  if (sight.nearRange > sight.farRange) {
    ctx.addIssue({
      code: 'custom',
      path: ['sight', 'nearRange'],
      message: `sight.nearRange (${String(sight.nearRange)} m) must not exceed sight.farRange (${String(sight.farRange)} m)`,
    });
  }
}

/** A complete sense profile: every sense it has is fully specified and consistent. */
export const senseProfileSchema = z.strictObject(profileShape).superRefine(checkProfile, whenValid);

/** A complete, validated sense profile (what perception reads). */
export type SenseProfile = z.output<typeof senseProfileSchema>;

/** One reusable sense profile: `src/content/data/sense/<id>.json`. */
export const senseSchema = z
  .strictObject({
    id: contentId.describe('Profile id creatures refer to, e.g. "humanoid".'),
    name: z.string().min(1).describe('Display name (editor and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (tuning band, canon, intended users), for owner review.'),
    ...profileShape,
  })
  .superRefine(checkProfile, whenValid);

/** A sense profile as written in a data file. */
export type SenseDefInput = z.input<typeof senseSchema>;
/** A loaded sense profile. */
export type SenseDef = z.output<typeof senseSchema>;

const PROFILE_KEYS = ['sight', 'hearing', 'smell', 'special'] as const;

/** Keeps only the sense keys that hold a value (drops `null` removals and `base`). */
function presentSenses(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    PROFILE_KEYS.flatMap((key) =>
      value[key] === undefined || value[key] === null ? [] : [[key, value[key]]],
    ),
  );
}

/** Object form of a creature's senses: a base profile plus overrides, or a complete inline profile. */
const senseOverrideSchema = z
  .strictObject({
    base: ref('sense')
      .optional()
      .describe(
        'Sense profile to start from; the other fields override it. Absent = the object is a ' +
          'complete inline profile.',
      ),
    sight: sightSchema
      .partial()
      .nullable()
      .optional()
      .describe('Sight fields to override; null = blind.'),
    hearing: hearingSchema
      .partial()
      .nullable()
      .optional()
      .describe('Hearing fields to override; null = deaf.'),
    smell: smellSchema
      .partial()
      .nullable()
      .optional()
      .describe('Smell fields to override; null = no sense of smell.'),
    special: z
      .record(z.string(), specialSenseSchema.partial().nullable())
      .superRefine(checkChannels)
      .optional()
      .describe(`Special senses to override or add by channel (${channelList}); null removes one.`),
  })
  .superRefine((value, ctx) => {
    // Without a base the object must stand alone: validate it as a complete profile. Field bounds
    // were already checked above (whenValid), so each issue here is new.
    if (value.base !== undefined) return;
    const result = senseProfileSchema.safeParse(presentSenses(value));
    for (const issue of result.error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  }, whenValid);

/**
 * A creature's `senses` field: a `sense` profile id, a base profile plus per-field overrides, or a
 * complete inline profile. Merge rules (see `resolveSenses`): an override object replaces only the
 * fields it names within that sense; `null` removes the sense (or special channel) entirely; a sense
 * or channel the base lacks must be given in full; `special` merges channel by channel.
 */
export const creatureSensesSchema = z
  .union([ref('sense'), senseOverrideSchema])
  .describe(
    'A `sense` profile id; or `{ base, …overrides }` (named fields replace the base’s, null removes ' +
      'a sense or channel); or a complete inline profile (no base).',
  );

/** A creature's parsed `senses` field. */
export type CreatureSenses = z.output<typeof creatureSensesSchema>;

/** Where `resolveSenses` looks up referenced profiles; a loaded `GameContent` is one. */
export interface SenseProfileLookup {
  resolve(target: ContentRef<'sense'>): Frozen<SenseDef>;
}

/** Thrown by `resolveSenses` when a creature's merged senses are not a valid profile. */
export class SenseResolutionError extends Error {
  override readonly name = 'SenseResolutionError';
}

type Mergeable = Readonly<Record<string, unknown>>;

/** One sense after an override: unchanged, removed (null) or merged field by field. */
function mergeSense(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (override === null) return undefined;
  return { ...(base as Mergeable | undefined), ...(override as Mergeable) };
}

/** Special senses after overrides, channel by channel. */
function mergeSpecial(base: Mergeable | undefined, override: Mergeable | undefined): unknown {
  if (override === undefined) return base;
  const channels = new Set([...Object.keys(base ?? {}), ...Object.keys(override)]);
  return Object.fromEntries(
    [...channels].flatMap((channel) => {
      const next = mergeSense(base?.[channel], override[channel]);
      return next === undefined ? [] : [[channel, next]];
    }),
  );
}

/** The base profile's senses with `override` applied (see creatureSensesSchema). */
function applyOverrides(base: Mergeable, override: Mergeable): Record<string, unknown> {
  return presentSenses({
    sight: mergeSense(base['sight'], override['sight']),
    hearing: mergeSense(base['hearing'], override['hearing']),
    smell: mergeSense(base['smell'], override['smell']),
    special: mergeSpecial(
      base['special'] as Mergeable | undefined,
      override['special'] as Mergeable | undefined,
    ),
  });
}

/**
 * A creature's complete sense profile: its referenced profile, or the base with its overrides
 * applied, or its inline profile. The result is validated again (a valid base plus valid overrides
 * can still be inconsistent, e.g. a primary cone wider than the base's peripheral one) and throws a
 * SenseResolutionError naming every problem. Returns a fresh, unfrozen object.
 */
export function resolveSenses(
  senses: Frozen<CreatureSenses>,
  profiles: SenseProfileLookup,
): SenseProfile {
  const baseRef = senses instanceof ContentRef ? senses : senses.base;
  const override: Mergeable = senses instanceof ContentRef ? {} : senses;
  const merged =
    baseRef === undefined
      ? presentSenses(override)
      : applyOverrides(profiles.resolve(baseRef), override);
  const label =
    baseRef === undefined ? 'inline sense profile' : `senses based on ${String(baseRef)}`;
  const result = senseProfileSchema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new SenseResolutionError(`invalid ${label}: ${problems.join('; ')}`);
  }
  return result.data;
}
