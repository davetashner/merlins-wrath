// The creature spawner (mw-e12.4): puts any creature into the world by id, from level data, the debug
// console or a test. Pure sim: it builds the entity from a RuntimeCreature (a CreatureDef with its
// senses and locomotion resolved by the content layer, `compileCreatures`) and never reads content
// itself. Entity ids come from the world's entity store; nothing varies per spawn yet, and any future
// variance must draw from the world's seeded RNG (`world.random`), so two worlds with the same seed
// spawn identical creatures.
//
// A spawned creature is:
// - placed at its feet (`spatial.placement`, bounding radius = its nav agent radius), facing the
//   spawn's direction (`combat.facing`);
// - a combatant (health, poise, poise regen, resistances from its stats) with one body hurtbox, a
//   capsule the size of its nav agent (region hurtboxes arrive with each creature's rig), reacting
//   to hits with its `reactions` profile and mass (mw-e04.7);
// - an idle attacker when it has attacks and the world runs the attack executor (mw-e12.5);
// - a lock-on target when the world has lock-on (mw-e02.16), lock points up its body;
// - a member of its faction (or the spawn's override) with its disposition toward the player;
// - its creature state: origin (for respawn), behaviour profile, needs, senses and nav agent.
//
// AI (e11) decides what it does; until then it stands where it spawned. Spawning never throws for bad
// data: an unknown creature or faction comes back as a typed SpawnError and nothing is created.
//
// Register the components first (`registerCreatureComponents`) and install factions
// (`installFactions`). Spawning is structural: inside a step the entity exists from the end of the
// tick; between steps at once.

import type { CreatureTable, RuntimeCreature } from '@content/index';
import { giveAttacker, AttackerComponent } from '../combat/attacks/components';
import {
  combatantFromCreature,
  DAMAGE_COMPONENTS,
  giveCombatant,
} from '../combat/damage/components';
import { giveHurtboxes, HurtboxComponent } from '../combat/hits/components';
import { CombatFacingComponent, FORWARD_FACING, giveFacing } from '../combat/melee/components';
import {
  giveHitReactions,
  HitReactionComponent,
  reactionProfileFromCreature,
} from '../combat/reactions/components';
import { towardPlayer } from '../combat/sandbox/dummies';
import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Spawner } from '../debug/system';
import { joinFaction, membershipFromCreature } from '../factions/runtime';
import type { FactionTable } from '../factions/table';
import { cos, sin } from '../math';
import type { SceneSpawnPlacement } from '../scene/layout';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { giveTargetable, TargetableComponent } from '../targeting/components';
import {
  CREATURE_COMPONENTS,
  CreatureComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
  type Creature,
  type CreatureOrigin,
} from './components';

/** What to spawn, and where. */
export interface CreatureSpawnRequest {
  /** Creature id. */
  readonly creature: string;
  /** Its feet, metres. */
  readonly at: Vec3;
  /** Direction it faces (horizontal part); absent or without a horizontal part = +z. */
  readonly facing?: Vec3;
  /** The scene spawn point it comes from. */
  readonly point?: string;
  /** A faction it joins instead of its definition's. */
  readonly faction?: string;
  /** Its patrol route, metres. */
  readonly patrol?: readonly Vec3[];
}

/** What spawning needs: the creatures it can spawn and the world's faction table. */
export interface CreatureSpawnOptions {
  /** Runtime creatures by id (`compileCreatures`). */
  readonly creatures: CreatureTable;
  readonly factions: FactionTable;
}

/** Why a spawn did not happen. */
export type SpawnError =
  | { readonly kind: 'unknown-creature'; readonly creature: string }
  | { readonly kind: 'unknown-faction'; readonly creature: string; readonly faction: string }
  | { readonly kind: 'not-a-creature'; readonly entity: EntityId };

/** The spawned entity, or why there is none. */
export type SpawnResult =
  | { readonly ok: true; readonly entity: EntityId }
  | { readonly ok: false; readonly error: SpawnError };

/** A readable line for `error` (logs, the console). */
export function spawnErrorMessage(error: SpawnError): string {
  switch (error.kind) {
    case 'unknown-creature':
      return `unknown creature "${error.creature}"`;
    case 'unknown-faction':
      return `creature "${error.creature}": unknown faction "${error.faction}"`;
    case 'not-a-creature':
      return `entity ${String(error.entity)} is not a creature`;
  }
}

/** Every component a creature is built from (see the file header), factions aside. */
const BODY_COMPONENTS: readonly ComponentType<unknown>[] = Object.freeze([
  ...CREATURE_COMPONENTS,
  PlacementComponent,
  CombatFacingComponent,
  ...DAMAGE_COMPONENTS,
  HurtboxComponent,
  HitReactionComponent,
]);

/**
 * Registers every component spawned creatures need that `world` does not have yet (factions come
 * from `installFactions`). Setup, once per world; returns `world`.
 */
export function registerCreatureComponents<W extends World<never>>(world: W): W {
  for (const type of BODY_COMPONENTS) if (!world.isRegistered(type)) world.register(type);
  return world;
}

/** Whether `world` can spawn creatures (`registerCreatureComponents` ran). */
export function creaturesInstalled(world: World<never>): boolean {
  return world.isRegistered(CreatureComponent);
}

/** Rounds to 1e-9 and folds -0, so equal facings encode (and hash) equal. */
const clean = (n: number): number => Math.round(n * 1e9) / 1e9 + 0;

/** The unit horizontal part of `facing`, or +z when it has none. */
function unitFacing(facing: Vec3 | undefined): Vec3 {
  const x = facing?.x ?? 0;
  const z = facing?.z ?? 0;
  const length = Math.sqrt(x * x + z * z);
  if (!(length > 0 && Number.isFinite(length))) return FORWARD_FACING;
  return Object.freeze({ x: clean(x / length), y: 0, z: clean(z / length) });
}

/** The facing of a scene yaw in degrees (0 faces +z; 90 turns +z into +x). */
export function facingFromYaw(yaw: number): Vec3 {
  const r = (yaw * Math.PI) / 180;
  return Object.freeze({ x: clean(sin(r)), y: 0, z: clean(cos(r)) });
}

/**
 * A creature's lock-on profile until creatures name their own (content `targetable`): its chest
 * (60 % of its height), then its head (90 %) and its base (25 %) where the chest is hidden.
 */
export function creatureLockProfile(height: number) {
  const up = (fraction: number) => [0, clean(height * fraction), 0] as const;
  return Object.freeze({
    points: Object.freeze([
      Object.freeze({ id: 'chest', at: up(0.6) }),
      Object.freeze({ id: 'head', at: up(0.9) }),
      Object.freeze({ id: 'base', at: up(0.25) }),
    ]),
    priority: 0,
  });
}

const vec = ({ x, y, z }: Vec3): Vec3 => Object.freeze({ x: x + 0, y: y + 0, z: z + 0 });

function originOf(request: CreatureSpawnRequest, facing: Vec3): CreatureOrigin {
  const { point, faction, patrol } = request;
  return Object.freeze({
    creature: request.creature,
    at: vec(request.at),
    facing,
    ...(point !== undefined && { point }),
    ...(faction !== undefined && { faction }),
    ...(patrol !== undefined && { patrol: Object.freeze(patrol.map(vec)) }),
  });
}

function creatureState(creature: RuntimeCreature, origin: CreatureOrigin): Creature {
  const { behaviour, needs } = creature.def;
  const needIds = Object.keys(needs).sort();
  return Object.freeze({
    origin,
    behaviour: behaviour.profile,
    tuning: Object.freeze({ ...behaviour.tuning }),
    needs: Object.freeze(Object.fromEntries(needIds.map((id) => [id, 0]))),
  });
}

const fail = (error: SpawnError): SpawnResult => ({ ok: false, error: Object.freeze(error) });

/** Spawns the creature `request` names (see the file header). Never throws for bad data. */
export function spawnCreature(
  world: World<never>,
  options: CreatureSpawnOptions,
  request: CreatureSpawnRequest,
): SpawnResult {
  const creature = options.creatures.get(request.creature);
  if (creature === undefined) {
    return fail({ kind: 'unknown-creature', creature: request.creature });
  }
  const membership = membershipFromCreature(creature.def);
  const faction = request.faction ?? membership.faction;
  if (!options.factions.has(faction)) {
    return fail({ kind: 'unknown-faction', creature: creature.id, faction });
  }
  const { def, nav } = creature;
  const facing = unitFacing(request.facing);
  const entity = world.spawn();
  placeEntity(world, entity, request.at, nav.radius);
  giveFacing(world, entity, facing);
  const top = Math.max(nav.height - nav.radius, nav.radius);
  giveHurtboxes(world, entity, {
    facing,
    boxes: [
      {
        id: 'body',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: nav.radius, z: 0 },
          to: { x: 0, y: top, z: 0 },
          radius: nav.radius,
        },
      },
    ],
  });
  giveCombatant(world, entity, combatantFromCreature(def));
  giveHitReactions(world, entity, reactionProfileFromCreature(def));
  if (def.attacks.length > 0 && world.isRegistered(AttackerComponent)) giveAttacker(world, entity);
  if (world.isRegistered(TargetableComponent)) {
    giveTargetable(world, entity, creatureLockProfile(nav.height));
  }
  joinFaction(world, options.factions, entity, faction, membership.toward);
  world.add(entity, CreatureComponent, creatureState(creature, originOf(request, facing)));
  world.add(entity, CreatureSensesComponent, creature.senses);
  world.add(entity, CreatureNavComponent, nav);
  return { ok: true, entity };
}

/** Whether `entity` is a living creature. */
export function isCreature(world: World<never>, entity: EntityId): boolean {
  return creaturesInstalled(world) && world.isAlive(entity) && world.has(entity, CreatureComponent);
}

/** Removes `entity` if it is a creature; false when it is not (or is gone). */
export function despawnCreature(world: World<never>, entity: EntityId): boolean {
  if (!isCreature(world, entity)) return false;
  world.destroy(entity);
  return true;
}

/** Every creature, ascending (none when creatures are not installed); a copy, safe to destroy by. */
export function creatureEntities(world: World<never>): EntityId[] {
  if (!creaturesInstalled(world)) return [];
  return [...world.query(CreatureComponent).ids()];
}

/** Removes every creature; returns how many. */
export function despawnAllCreatures(world: World<never>): number {
  const all = creatureEntities(world);
  for (const entity of all) world.destroy(entity);
  return all.length;
}

/**
 * Removes creature `entity` and spawns it again, fresh, from its origin (same creature, place,
 * facing, spawn point, faction override and patrol) under a new entity id.
 */
export function respawnCreature(
  world: World<never>,
  options: CreatureSpawnOptions,
  entity: EntityId,
): SpawnResult {
  const state = isCreature(world, entity) ? world.get(entity, CreatureComponent) : undefined;
  if (state === undefined) return fail({ kind: 'not-a-creature', entity });
  world.destroy(entity);
  return spawnCreature(world, options, state.origin);
}

/** What `spawnSceneCreatures` did. */
export interface SceneCreatures {
  /** The creatures spawned, in spawn order. */
  readonly entities: readonly EntityId[];
  /** Spawns that failed, with the spawn point's id. */
  readonly errors: readonly { readonly point: string; readonly error: SpawnError }[];
}

/**
 * Spawns the creature of every scene spawn that names one, facing the spawn's yaw, with its faction
 * override and patrol route. A failed spawn is reported, not thrown; the rest still spawn.
 */
export function spawnSceneCreatures(
  world: World<never>,
  options: CreatureSpawnOptions,
  spawns: readonly SceneSpawnPlacement[],
): SceneCreatures {
  const entities: EntityId[] = [];
  const errors: { point: string; error: SpawnError }[] = [];
  for (const spawn of spawns) {
    if (spawn.creature === undefined) continue;
    const result = spawnCreature(world, options, {
      creature: spawn.creature,
      at: spawn.position,
      facing: facingFromYaw(spawn.yaw),
      point: spawn.id,
      ...(spawn.faction !== undefined && { faction: spawn.faction }),
      ...(spawn.patrol !== undefined && { patrol: spawn.patrol }),
    });
    if (result.ok) entities.push(result.entity);
    else errors.push({ point: spawn.id, error: result.error });
  }
  return { entities, errors };
}

/**
 * The debug console's spawners, one per creature id (`spawn fixture-hound 3`): each creature faces
 * the player when there is one. They take no options. A spawner throws a RangeError (the command is
 * skipped) when the world has no creatures installed.
 */
export function creatureSpawners(options: CreatureSpawnOptions): Map<string, Spawner> {
  const spawner =
    (creature: string): Spawner =>
    (world, at) => {
      const w: World<never> = world;
      if (!creaturesInstalled(w)) throw new RangeError('creatures are not installed');
      const facing = towardPlayer(w, at);
      const result = spawnCreature(w, options, {
        creature,
        at,
        ...(facing !== undefined && { facing }),
      });
      if (!result.ok) throw new RangeError(spawnErrorMessage(result.error));
      return result.entity;
    };
  return new Map([...options.creatures.keys()].map((id) => [id, spawner(id)]));
}
