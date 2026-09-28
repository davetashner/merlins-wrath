// World properties as sim components (mw-e03.1). Each property is its own component so a system
// queries exactly the entities it cares about ("everything with a temperature") in ascending entity
// id order, and an entity only stores the properties it has (absent = the spec default). Values are
// plain numbers, booleans, id strings or frozen flat records: snapshot-safe for the canonical encoder
// and never aliased with a caller's object. Value writes go through `setProperty`, which validates
// the value and emits exactly one `propertyChanged` event per real change, so fire, AI, quests and
// the debug overlay can react to any change without polling.

import { defineComponent, type ComponentType, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import {
  assertProperty,
  isWorldPropertyKey,
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type WorldPropertyKey,
  type WorldPropertyValues,
} from './spec';

/** The component type of each world property. */
export type WorldPropertyComponents = {
  readonly [K in WorldPropertyKey]: ComponentType<WorldPropertyValues[K]>;
};

/** Stored values are immutable: records are copied and frozen, primitives are values already. */
function detach<T>(value: T): T {
  return typeof value === 'object' ? Object.freeze({ ...value }) : value;
}

function propertyComponent<K extends WorldPropertyKey>(key: K) {
  return defineComponent<WorldPropertyValues[K]>(`property.${key}`, {
    deserialize: (data) => {
      assertProperty(key, data);
      return detach(data);
    },
  });
}

/**
 * Component type per property, e.g. `WorldProperties.temperature`. Component names are
 * `property.<key>`; they are snapshot and save keys, so they never change.
 */
export const WorldProperties: WorldPropertyComponents = Object.freeze(
  Object.fromEntries(WORLD_PROPERTY_KEYS.map((key) => [key, propertyComponent(key)])),
) as WorldPropertyComponents; // one entry per key, each typed by its own key

/** Registers every world-property component with `world` (once per world). */
export function registerWorldProperties<W extends World<never>>(world: W): W {
  world.register(
    ...WORLD_PROPERTY_KEYS.map((key) => WorldProperties[key] as ComponentType<unknown>),
  );
  return world;
}

/** One property value change, delivered by the world's event bus at the next phase boundary. */
export type PropertyChange = {
  readonly [K in WorldPropertyKey]: {
    readonly entity: EntityId;
    readonly key: K;
    readonly old: WorldPropertyValues[K];
    readonly new: WorldPropertyValues[K];
    /** Entity whose action caused the change (a stimulus's source), or null. */
    readonly source: EntityId | null;
  };
}[WorldPropertyKey];

/** Fired once for every `setProperty` that changes a stored value. */
export const propertyChanged = defineEvent<PropertyChange>('propertyChanged');

/** Options for `setProperty`. */
export interface PropertyWriteOptions {
  /** Entity to attribute the change to (quests, crime, telemetry). */
  readonly source?: EntityId;
}

/** Initial or added properties of an entity (any subset). */
export type WorldPropertyInit = Partial<WorldPropertyValues>;

/**
 * Gives `entity` the listed properties (replacing values it already has). This is a structural
 * change, deferred to the end of the tick during a step like `World.add`, and fires no events: use it
 * when spawning from data or when an entity gains a property. Every value is validated first, so a
 * bad value throws a RangeError and adds nothing.
 */
export function addProperties(
  world: World<never>,
  entity: EntityId,
  init: WorldPropertyInit,
): void {
  const entries = Object.entries(init);
  for (const [key, value] of entries) {
    if (!isWorldPropertyKey(key)) throw new RangeError(`unknown world property "${key}"`);
    assertProperty(key, value);
  }
  for (const [key, value] of entries) {
    const type = WorldProperties[key as WorldPropertyKey] as ComponentType<unknown>;
    world.add(entity, type, detach(value));
  }
}

/** Removes a property (deferred during a step); the entity then reads the property's default. */
export function removeProperty(world: World<never>, entity: EntityId, key: WorldPropertyKey): void {
  world.remove(entity, WorldProperties[key]);
}

/** Whether `entity` has property `key` (stored, not defaulted). */
export function hasProperty(world: World<never>, entity: EntityId, key: WorldPropertyKey): boolean {
  return world.has(entity, WorldProperties[key]);
}

/** The stored value of property `key`, or undefined when `entity` doesn't have it. */
export function getProperty<K extends WorldPropertyKey>(
  world: World<never>,
  entity: EntityId,
  key: K,
): WorldPropertyValues[K] | undefined {
  return world.get(entity, WorldProperties[key]);
}

/** The value of property `key`: the stored value, or the property's default when absent. */
export function readProperty<K extends WorldPropertyKey>(
  world: World<never>,
  entity: EntityId,
  key: K,
): WorldPropertyValues[K] {
  // The spec table is keyed by the same K, so its default has the property's value type.
  return (
    getProperty(world, entity, key) ?? (WORLD_PROPERTY_SPECS[key].default as WorldPropertyValues[K])
  );
}

/** Equality of two valid values of one property (so both are primitives or both flat records). */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object') return Object.is(a, b);
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  return Object.keys(left).every((field) => Object.is(left[field], right[field]));
}

/**
 * Writes an existing property's value immediately (not a structural change). Throws a RangeError for
 * an invalid value and an Error when `entity` lacks the property (add it with `addProperties`).
 * When the value changes, queues exactly one `propertyChanged` event and returns true; writing the
 * value it already has does nothing and returns false.
 */
export function setProperty<K extends WorldPropertyKey>(
  world: World<never>,
  entity: EntityId,
  key: K,
  value: WorldPropertyValues[K],
  options: PropertyWriteOptions = {},
): boolean {
  assertProperty(key, value);
  const old = getProperty(world, entity, key);
  if (old === undefined) {
    throw new Error(`entity ${String(entity)} has no "${key}" property to set`);
  }
  if (sameValue(old, value)) return false;
  const stored = detach(value);
  world.set(entity, WorldProperties[key], stored);
  const change = { entity, key, old, new: stored, source: options.source ?? null };
  world.events.emit(propertyChanged, change as PropertyChange); // key, old and new share one K
  return true;
}

/** Entities that have property `key`, in ascending id order (valid until the next structural change). */
export function entitiesWithProperty(
  world: World<never>,
  key: WorldPropertyKey,
): readonly EntityId[] {
  return world.query(WorldProperties[key]).ids();
}

/** Calls `fn(entity, value)` for every entity that has property `key`, in ascending id order. */
export function forEachWithProperty<K extends WorldPropertyKey>(
  world: World<never>,
  key: K,
  fn: (entity: EntityId, value: WorldPropertyValues[K]) => void,
): void {
  const type: ComponentType<WorldPropertyValues[K]> = WorldProperties[key];
  world.query(type).forEach(fn);
}
