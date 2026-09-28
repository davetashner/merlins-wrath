// Material presets (mw-e03.2). A designer marks a crate "wood" and gets sensible flammability,
// density, friction, sound and fragility for free; the object's own values override the preset, and
// anything neither sets takes the global property default (src/sim/properties/spec.ts). Presets hold
// only what belongs to the material itself: object-level facts (weight, liftable, owner…) and
// transient state (burning, charge) stay on the object. Because a preset is the complete description
// of a material, it is checked for physically inconsistent combinations that a sparse per-object
// override can't be (a flammable material with no ignition point, a frozen one above its freezing
// point). Every value is explained in the entry's `notes` so the owner can review the numbers;
// docs/design/materials.md is generated from the data (`pnpm content:docs`).

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { worldPropertiesSchema, type Present } from '../world-properties.ts';

/** Footstep loudness offset range, dB relative to stone (matches e09 surface acoustics). */
export const FOOTSTEP_LOUDNESS_RANGE = { min: -20, max: 20 } as const;

/** Impact sound set ids: `sfx-impact-<material>` (audio bible §6, §7.2); variants picked at runtime. */
export const IMPACT_SOUND_PATTERN = /^sfx-impact-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** World properties a preset may set: everything except the id itself, ownership and live state. */
const presetFields = worldPropertiesSchema.omit({
  material: true,
  owner: true,
  burning: true,
  charge: true,
});

type PresetFields = z.output<typeof presetFields>;

/** Adds an issue for every physically inconsistent combination in a preset's properties. */
function checkConsistency(p: PresetFields, ctx: z.RefinementCtx): void {
  const issue = (path: keyof PresetFields, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (p.flammable === true) {
    if (p.ignitionPoint === undefined) {
      issue('ignitionPoint', 'a flammable material needs an ignitionPoint');
    }
    if (p.fuel === undefined || p.fuel === 0) {
      issue('fuel', 'a flammable material needs fuel > 0');
    }
  } else if (p.ignitionPoint !== undefined || p.fuel !== undefined) {
    issue('flammable', 'ignitionPoint and fuel only apply to a flammable material');
  }
  if (p.transparent === true && p.opaque === true) {
    issue('opaque', 'a material cannot be both transparent and opaque');
  }
  if (
    p.frozen === true &&
    (p.temperature === undefined || p.freezePoint === undefined || p.temperature > p.freezePoint)
  ) {
    issue('temperature', 'a frozen material needs a temperature at or below its freezePoint');
  }
}

/** A preset's world-property values (any consistent subset). */
export const materialPropertiesSchema = presetFields
  .superRefine(checkConsistency)
  .describe(
    'World-property defaults for objects of this material; omitted ones take the global default.',
  );

/** One material preset: `src/content/data/material/<id>.json`. */
export const materialSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name (editor and docs).'),
  notes: z
    .string()
    .min(1)
    .describe('Why these values (sources, units, design intent), for owner review.'),
  footstepLoudness: z
    .number()
    .min(FOOTSTEP_LOUDNESS_RANGE.min)
    .max(FOOTSTEP_LOUDNESS_RANGE.max)
    .describe('Footstep loudness offset relative to stone, dB.'),
  impactSound: z
    .string()
    .regex(IMPACT_SOUND_PATTERN, 'must be an impact sound set id, e.g. "sfx-impact-wood"')
    .describe('Impact sound set id (audio bible §7.2), e.g. "sfx-impact-wood".'),
  properties: materialPropertiesSchema,
});

/** A material preset as written in a data file. */
export type MaterialDefInput = z.input<typeof materialSchema>;
/** A loaded material preset. */
export type MaterialDef = z.output<typeof materialSchema>;
/** A preset's world-property values (absent keys, never `undefined` ones). */
export type MaterialProperties = Present<z.output<typeof materialPropertiesSchema>>;

/**
 * Material id → preset property values, the lookup the sim's `applyMaterial` takes. Pass the loaded
 * entries, e.g. `materialPresets(content.all('material'))`.
 */
export function materialPresets(
  materials: readonly Pick<MaterialDef, 'id' | 'properties'>[],
): ReadonlyMap<string, MaterialProperties> {
  // Parsed JSON never holds an explicit undefined, so the properties are already `Present`.
  return new Map(materials.map((m) => [m.id, m.properties as MaterialProperties]));
}
