// Creature repopulation (mw-ju8.29): a scene spawn that opts in (`repopulate: { afterDays }`) brings
// its creature back after the player killed it, once `afterDays` world days have passed since the
// kill (resting at an inn is what passes days, so `afterDays: 1` is "after the player sleeps").
// Bosses and gatekeepers never opt in (content check src/content/repopulation-checks.ts).
//
// A kill is two things: the creature's entry in its level's saved deltas (`creature:<spawn id>`,
// dead or destroyed) and the world day it died on (the `entity:<level>/<spawn>.killed-day` fact,
// written by installSlainFacts and saved with the world facts). Repopulating clears both, so the
// creature is spawned fresh at its origin: full health, unaware, carrying its authored items again.
//
// - `repopulateStored` runs when a level that is not loaded is about to be entered (a crossing
//   reloads the page; the scene is rebuilt from its authored spawns before the stored deltas are
//   applied): it drops the dead entries that are due, and the spawn then simply stays as authored.
// - `repopulateLive` runs for the loaded level (on `rest.completed`): a due creature is spawned
//   again only when its spawn point is farther than `minDistance` from the player and out of the
//   player's sight; otherwise it waits for the next rest or arrival.
//
// What the first life dropped is not touched: world items persist as their own deltas (`spawned`
// records) and stay where they lie, whether or not the creature returns. The new life carries its
// authored items again, so a returning skeleton is a fresh source of loot, never a duplicate or a
// removal of what the player already left on the ground.
//
// Everything is a function of the deltas, the facts and the day: no wall clock, no Math.random.

import type { LevelDeltas } from '../deltas/persistence';
import type { World } from '../core/world';
import type { EntityId } from '../core/component';
import { isDead } from '../combat/damage/components';
import type { FactStore } from '../facts/store';
import type { SceneSpawnPlacement } from '../scene/layout';
import { hypot } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import { CreatureComponent } from './components';
import { killedDayFact, slainFact } from './slain';
import { originOfSpawn, spawnCreature, type CreatureSpawnOptions } from './spawn';

/** Tags that keep a creature from ever coming back (checked on the creature and on its spawn). */
export const NO_REPOPULATION_TAGS: readonly string[] = Object.freeze([
  'boss',
  'gatekeeper',
  'brute',
]);

/** A creature never returns closer than this (metres) to a player who is loaded in with it. */
export const REPOPULATION_MIN_DISTANCE = 25;

type Facts = Pick<FactStore, 'get' | 'set'>;
type RepopulatingSpawn = Pick<SceneSpawnPlacement, 'id' | 'creature' | 'repopulate'>;

/** The day a placed creature was killed, or undefined when no kill is recorded. */
export function killedDayOf(facts: Facts, level: string, point: string): number | undefined {
  if (facts.get(slainFact(level, point)) !== true) return undefined;
  // A kill from before the day was recorded counts as the first day: it is long past.
  return Math.max(1, Number(facts.get(killedDayFact(level, point)) ?? 0));
}

/** Whether a kill on `killedDay` is old enough to return on `today`. */
export function repopulationDue(afterDays: number, killedDay: number, today: number): boolean {
  return today - killedDay >= afterDays;
}

/** Forgets the kill of the creature placed at `point`: it is alive again as far as facts go. */
export function clearKill(facts: Facts, level: string, point: string): void {
  facts.set(slainFact(level, point), false);
  facts.set(killedDayFact(level, point), 0);
}

/** What `repopulateStored` did. */
export interface StoredRepopulation {
  /** The level's deltas without the entries of the creatures that returned. */
  readonly deltas: LevelDeltas;
  /** Spawn point ids of the creatures that returned, in spawn order. */
  readonly returned: readonly string[];
}

const isDeadEntry = (entry: LevelDeltas['entities'][number]): boolean => {
  if (entry.destroyed === true) return true;
  const life = entry.aspects?.['actor.life'] as { readonly current?: unknown } | undefined;
  return life?.current === 0;
};

/**
 * Drops from `deltas` (a level about to be entered) the dead entries of the opted-in spawns whose
 * kill is old enough on `today`, and clears their kill facts. The world state is unchanged
 * otherwise; equal inputs give an equal result.
 */
export function repopulateStored(
  deltas: LevelDeltas,
  spawns: readonly RepopulatingSpawn[],
  facts: Facts,
  today: number,
): StoredRepopulation {
  const returning = new Map<string, string>();
  for (const spawn of spawns) {
    if (spawn.creature === undefined || spawn.repopulate === undefined) continue;
    const killed = killedDayOf(facts, deltas.level, spawn.id);
    if (killed === undefined || !repopulationDue(spawn.repopulate.afterDays, killed, today)) {
      continue;
    }
    const entry = deltas.entities.find(({ id }) => id === `creature:${spawn.id}`);
    if (entry !== undefined && isDeadEntry(entry)) returning.set(entry.id, spawn.id);
  }
  if (returning.size === 0) return { deltas, returned: [] };
  const returned = spawns.filter(({ id }) => [...returning.values()].includes(id)).map((s) => s.id);
  for (const point of returned) clearKill(facts, deltas.level, point);
  return {
    deltas: { ...deltas, entities: deltas.entities.filter(({ id }) => !returning.has(id)) },
    returned,
  };
}

/** What the live case needs besides the world. */
export interface LiveRepopulationOptions {
  readonly level: string;
  /** The loaded level's spawns. */
  readonly spawns: readonly SceneSpawnPlacement[];
  readonly today: number;
  readonly spawnOptions: CreatureSpawnOptions;
  /** Where the player stands; undefined: nobody to be seen by. */
  readonly player: Vec3 | undefined;
  /** A creature never returns this close (metres, horizontal) to the player. */
  readonly minDistance: number;
  /** Whether the player can see `point` (a spawn position); line of sight in the game. */
  readonly canSee: (point: Vec3) => boolean;
}

/** The dead creature placed at `point` (its corpse), if any; creatures are registered by now. */
function corpseAt(world: World<never>, point: string): EntityId | undefined {
  return world
    .query(CreatureComponent)
    .ids()
    .find(
      (entity) =>
        world.get(entity, CreatureComponent)?.origin.point === point && isDead(world, entity),
    );
}

/**
 * Spawns again, fresh, every opted-in creature of the loaded level that is dead and due, unless its
 * spawn point is within `minDistance` of the player or in the player's sight (then it waits for the
 * next call). Returns the spawn point ids that returned, in spawn order.
 */
export function repopulateLive(
  world: World<never>,
  facts: Facts,
  options: LiveRepopulationOptions,
): string[] {
  const returned: string[] = [];
  for (const spawn of options.spawns) {
    if (spawn.creature === undefined || spawn.repopulate === undefined) continue;
    const killed = killedDayOf(facts, options.level, spawn.id);
    if (killed === undefined) continue;
    if (!repopulationDue(spawn.repopulate.afterDays, killed, options.today)) continue;
    const { player } = options;
    if (player !== undefined) {
      const near =
        hypot(player.x - spawn.position.x, player.z - spawn.position.z) < options.minDistance;
      if (near || options.canSee(spawn.position)) continue;
    }
    const result = spawnCreature(world, options.spawnOptions, originOfSpawn(spawn, spawn.creature));
    if (!result.ok) continue;
    const corpse = corpseAt(world, spawn.id);
    if (corpse !== undefined) world.destroy(corpse);
    clearKill(facts, options.level, spawn.id);
    returned.push(spawn.id);
  }
  return returned;
}
