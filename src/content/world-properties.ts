// Data-file schema for world properties (mw-e03.1). Any content type that places things in the world
// (props, materials, creatures…) embeds `worldPropertiesSchema` so designers set properties in JSON
// and the loader rejects unknown keys and out-of-range values with the file and JSON pointer. It
// mirrors the sim's spec (src/sim/properties/spec.ts), which content may only import as types: the
// key set and value types are checked at compile time (world-properties.test.ts) and every range and
// default at run time (tests/contracts/world-properties.test.ts). Omitted properties take the sim
// defaults, so data stays sparse.

import { z } from 'zod';
import { contentId } from './schema.ts';

const ABSOLUTE_ZERO = -273.15;
const MAX_TEMPERATURE = 10_000;

const celsius = (doc: string) =>
  z.number().min(ABSOLUTE_ZERO).max(MAX_TEMPERATURE).describe(`${doc} °C.`);
const fraction = (doc: string) => z.number().min(0).max(1).describe(`${doc} 0 … 1.`);
const flag = (doc: string) => z.boolean().describe(doc);

/** Every world property as a data-file field; see the sim spec for defaults and meaning. */
export const worldPropertiesSchema = z
  .strictObject({
    material: contentId.describe('Material preset id.'),
    temperature: celsius('Current temperature,'),
    flammable: flag('Fire can ignite it.'),
    ignitionPoint: celsius('Temperature at which it ignites,'),
    fuel: z.number().min(0).max(86_400).describe('Seconds of burning left.'),
    burning: flag('On fire right now.'),
    wetness: fraction('How soaked it is (dry … saturated),'),
    frozen: flag('Frozen solid.'),
    freezePoint: celsius('Temperature at or below which it freezes,'),
    conductive: flag('Conducts electric charge.'),
    charge: z.number().min(0).max(1_000_000).describe('Stored electric charge.'),
    weight: z.number().min(0).max(1_000_000).describe('Mass, kg.'),
    fragile: z.number().min(0).max(1_000_000_000).describe('Impact energy that breaks it, J.'),
    hp: z.number().min(0).max(1_000_000).describe('Structural hit points.'),
    density: z
      .number()
      .min(0.01)
      .max(100_000)
      .describe('Density, kg/m³; below 1000 it floats in water.'),
    climbable: z
      .number()
      .int()
      .min(1)
      .max(3)
      .describe('Climbing grade: 1 easy, 2 needs stamina, 3 needs skill or a tool.'),
    liftable: flag('Can be picked up and carried.'),
    pushable: flag('Can be pushed or dragged.'),
    hideable: flag('An actor can hide in or behind it.'),
    reflective: flag('Reflects light beams and bolts.'),
    transparent: flag('Light and sight pass through it.'),
    opaque: flag('Fully blocks light and sight.'),
    lightEmitter: z
      .strictObject({
        intensity: z.number().min(0).max(100_000).describe('Light output (a torch is about 100).'),
        radius: z.number().min(0).max(100).describe('Reach, m.'),
      })
      .describe('Emits light.'),
    soundDamping: fraction('Fraction of sound it absorbs,'),
    friction: z.number().min(0).max(2).describe('Surface friction coefficient.'),
    impactAbsorb: fraction('Fraction of impact energy it absorbs,'),
    owner: contentId.describe('Ownership tag (faction or owner id).'),
  })
  .partial()
  .describe('World properties (any subset); omitted ones take the sim defaults.');

/** World properties as written in a data file (any subset). */
export type WorldPropertiesData = z.output<typeof worldPropertiesSchema>;
