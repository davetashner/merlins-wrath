// The `creatures` save section (mw-e12.14): every creature's runtime state — creature state, senses,
// nav agent, condition (morale, knocked out until), AI brain (alert state and its timers, awareness,
// last-known position, running activity) and perception bookkeeping (src/sim/creatures/persistence.ts)
// — versioned and migrated on their own, so creature changes never touch the world section. A save
// taken at tick N and loaded continues exactly as a run that never saved (resume determinism).
//
// Each component's data is opaque here except the condition this section introduced, so fields a
// system adds to its component (a brain's new memory) round-trip unchanged. A shape change that old
// saves cannot simply carry bumps the version and adds a migration below.

import {
  applyCreatures,
  captureCreatures,
  CREATURE_SAVE_COMPONENTS,
  FRESH_CONDITION,
  FULL_MORALE,
  giveMissingConditions,
  type CreatureSaveData,
} from '@sim/index';
import { z } from 'zod';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the creatures section (never renamed). */
export const CREATURES_SECTION_ID = 'creatures';

/**
 * Data version of the creatures section. v1: each creature's components as saves held them before
 * creatures had a condition (mw-e12.4's creature state and mw-e11's brain). v2 (mw-e12.14) adds
 * `creature.condition`: morale and the tick a knocked-out creature wakes.
 */
export const CREATURES_SECTION_VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * v1 → v2: every creature without a condition gets a fresh one (morale 100, awake). Data that is not
 * the v1 shape passes through untouched, for the schema to report.
 */
export function addCreatureConditions(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data['creatures'])) return data;
  const creatures = data['creatures'].map((record: unknown) => {
    if (!isRecord(record) || !isRecord(record['components'])) return record;
    const components = record['components'];
    if (!('creature.creature' in components) || 'creature.condition' in components) return record;
    return { ...record, components: { ...components, 'creature.condition': FRESH_CONDITION } };
  });
  return { ...data, creatures };
}

/** `CREATURES_MIGRATIONS[n]` upgrades creatures data from v`n` to v`n + 1`. */
export const CREATURES_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({
  1: addCreatureConditions,
});

const conditionSchema = z.strictObject({
  morale: z.number().min(0).max(FULL_MORALE),
  unconsciousUntil: z.int().min(-1),
});

/** Every saved component by name; only the condition has a shape known here. */
const componentsSchema = z.strictObject(
  Object.fromEntries(
    CREATURE_SAVE_COMPONENTS.map(({ name }) => [
      name,
      (name === 'creature.condition' ? conditionSchema : z.unknown()).exactOptional(),
    ]),
  ),
);

const creaturesDataSchema = z.strictObject({
  creatures: z.array(z.strictObject({ entity: z.int().positive(), components: componentsSchema })),
}) satisfies z.ZodType<CreatureSaveData>;

/** The creatures save section; register it after the world section. */
export function creaturesSaveSection(): SaveSection<CreatureSaveData> {
  return defineSaveSection<CreatureSaveData>({
    id: CREATURES_SECTION_ID,
    version: CREATURES_SECTION_VERSION,
    schema: creaturesDataSchema,
    components: CREATURE_SAVE_COMPONENTS,
    migrations: CREATURES_MIGRATIONS,
    serialize: (world) => captureCreatures(world),
    deserialize: (world, data) => {
      applyCreatures(world, data);
    },
    // A save from before this section kept creatures in the world section, which restored them;
    // they had no condition yet (the v1 → v2 step, applied to the world).
    missing: (world) => {
      giveMissingConditions(world);
    },
  });
}
