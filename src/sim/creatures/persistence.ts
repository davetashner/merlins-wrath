// Creature persistence (mw-e12.14): what a save carries of every creature's runtime state, as one
// plain record per entity in entity order. The game's `creatures` save section
// (src/game/save/creatures.ts) wraps it with a schema, a version and migrations; this file holds the
// rules, so they stay deterministic.
//
// A record holds, by component name, each creature component the entity has: its creature state
// (origin, behaviour, needs), senses, nav agent and condition (morale, knocked out until), its AI
// brain (alert state and when it was entered, so every state timer; awareness; the blackboard with
// its last-known position; the running activity and step), and its perception bookkeeping (noises
// heard but not yet evaluated). Every value goes through its component's own snapshot hooks and is
// otherwise opaque here, so a field a system adds to its component (a brain's new memory) is saved
// and loaded without this file knowing it. Position, facing, health, faction disposition and
// inventory belong to components other creatures and actors share, saved with the world and the
// inventory section.

import { BrainComponent } from '../ai/components';
import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import { PerceptionAgentComponent } from '../perception/system';
import { CREATURE_COMPONENTS, CreatureComponent } from './components';
import { CreatureConditionComponent, FRESH_CONDITION } from './condition';

/** One entity's saved creature state: component name → its snapshot data. */
export interface CreatureSaveRecord {
  readonly entity: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

/** Every creature's saved state, in ascending entity order. */
export interface CreatureSaveData {
  readonly creatures: readonly CreatureSaveRecord[];
}

/** The components creature persistence saves (the world snapshot leaves them out). */
export const CREATURE_SAVE_COMPONENTS: readonly ComponentType<unknown>[] = Object.freeze([
  ...CREATURE_COMPONENTS,
  BrainComponent,
  PerceptionAgentComponent,
] as readonly ComponentType<unknown>[]);

const BY_NAME: ReadonlyMap<string, ComponentType<unknown>> = new Map(
  CREATURE_SAVE_COMPONENTS.map((type) => [type.name, type]),
);

/** Reads every creature's saved components out of `world` (detached copies). */
export function captureCreatures(world: World<never>): CreatureSaveData {
  const byEntity = new Map<EntityId, Record<string, unknown>>();
  for (const type of CREATURE_SAVE_COMPONENTS) {
    if (!world.isRegistered(type)) continue;
    world.query(type).forEach((entity, value) => {
      const components = byEntity.get(entity) ?? {};
      components[type.name] = type.serialize(value);
      byEntity.set(entity, components);
    });
  }
  const creatures = [...byEntity.entries()]
    .sort(([a], [b]) => a - b)
    .map(([entity, components]) => ({ entity, components }));
  return { creatures };
}

/**
 * Writes saved creature state into `world`, registering a component type the world lacks. Call on a
 * world whose entities exist and hold none of these components (as a save load leaves it).
 * @throws RangeError for a component name creature persistence does not save.
 */
export function applyCreatures(world: World<never>, data: CreatureSaveData): void {
  for (const { entity, components } of data.creatures) {
    for (const [name, value] of Object.entries(components)) {
      const type = BY_NAME.get(name);
      if (type === undefined) {
        throw new RangeError(`entity ${String(entity)}: "${name}" is not a creature component`);
      }
      if (!world.isRegistered(type)) world.register(type);
      world.add(entity, type, type.deserialize(value));
    }
  }
}

/**
 * Gives every creature without a condition a fresh one (full morale, awake), for worlds loaded from
 * saves made before creatures had one. Returns how many it gave.
 */
export function giveMissingConditions(world: World<never>): number {
  if (!world.isRegistered(CreatureComponent)) return 0;
  if (!world.isRegistered(CreatureConditionComponent)) world.register(CreatureConditionComponent);
  const missing = world
    .query(CreatureComponent)
    .ids()
    .filter((entity) => !world.has(entity, CreatureConditionComponent));
  for (const entity of missing) world.add(entity, CreatureConditionComponent, FRESH_CONDITION);
  return missing.length;
}
