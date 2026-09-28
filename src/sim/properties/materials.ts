// Material presets applied to world properties (mw-e03.2). Content defines each material's property
// defaults (src/content/data/material/*.json); the sim receives them as a plain id → values lookup,
// since it may not import content at run time. One merge rule everywhere: the object's own value >
// its material preset > the property's global default. Spawning stores the object's values plus its
// preset's (never the global defaults, which absent properties read anyway), so snapshots stay sparse
// and a preset change reaches every object that doesn't override it.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { addProperties, type WorldPropertyInit } from './components';
import {
  assertProperty,
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type WorldPropertyValues,
} from './spec';

/** Material id → that material's property values (any subset). */
export type MaterialPresets = ReadonlyMap<string, WorldPropertyInit>;

/**
 * The properties an object with `init` gets: its material's preset values overridden by its own.
 * An object without a `material` gets only its own values. Throws a RangeError naming the id when
 * `init.material` is not in `presets`.
 */
export function applyMaterial(
  presets: MaterialPresets,
  init: WorldPropertyInit,
): WorldPropertyInit {
  const id = init.material;
  if (id === undefined) return { ...init };
  const preset = presets.get(id);
  if (preset === undefined) {
    const known = [...presets.keys()].sort().join(', ');
    throw new RangeError(`unknown material "${id}"; known materials: ${known}`);
  }
  return { ...preset, ...init };
}

/**
 * Every property's effective value for an object with `init`: its own value, else its material's,
 * else the global default. Throws a RangeError for an unknown material or an invalid value.
 */
export function resolveProperties(
  presets: MaterialPresets,
  init: WorldPropertyInit,
): WorldPropertyValues {
  const merged: Record<string, unknown> = { ...applyMaterial(presets, init) };
  const resolved = Object.fromEntries(
    WORLD_PROPERTY_KEYS.map((key) => {
      const value = Object.hasOwn(merged, key) ? merged[key] : WORLD_PROPERTY_SPECS[key].default;
      assertProperty(key, value);
      return [key, value];
    }),
  );
  return resolved as unknown as WorldPropertyValues; // one validated value per key
}

/**
 * Gives `entity` its material's preset properties overridden by `init` (see `applyMaterial`), like
 * `addProperties`: deferred during a step, validated first, no events.
 */
export function addMaterialProperties(
  world: World<never>,
  entity: EntityId,
  presets: MaterialPresets,
  init: WorldPropertyInit,
): void {
  addProperties(world, entity, applyMaterial(presets, init));
}
