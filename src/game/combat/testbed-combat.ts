// Knight combat in the greybox testbed (mw-e04.6): the wiring src/main.ts and the headless testbed
// world share, so the game and its replay run the same combat. In two halves, because the order of
// systems matters:
//
// 1. `prepareTestbedCombat` (before the player is installed): the knight's moves, socket tracks and
//    wood shield from content, and the damage model with the shield rule in its guard stage. Its
//    `moves` and `melee` go to setupTestbedPlayer.
// 2. `startTestbedCombat` (after the player): the hit-volume system — after the player's action
//    timeline, so a swing sweeps on the tick its active phase starts, and honouring the dodge's
//    i-frames (mw-e04.8) — the melee strikes, and a training dummy at every spawn tagged
//    `training-dummy`.
//
// The caller registers the hit-volume, damage and placement components (src/main.ts does at world
// creation; installGamePhysics registers placement).

import {
  compileMoves,
  compileShield,
  compileSocketTracks,
  KNIGHT_SHIELD_ID,
  type GameContent,
  type MoveTable,
} from '@content/index';
import {
  DamageModel,
  hitVolumeSystem,
  iframeRule,
  installMeleeStrikes,
  noAllies,
  shieldGuard,
  type EntityId,
  type PlayerMeleeOptions,
  type SceneSpawnPlacement,
  type SocketTrackLookup,
  type World,
} from '@sim/index';
import { spawnTrainingDummy, trainingDummySpawns } from './training-dummy';

/** The first half of the testbed's combat wiring. */
export interface TestbedCombat {
  /** Every move in content (the player's action timeline table). */
  readonly moves: MoveTable;
  readonly tracks: SocketTrackLookup;
  /** The knight's sword and shield, for setupTestbedPlayer. */
  readonly melee: PlayerMeleeOptions;
  /** The damage model every hit resolves through (the shield rule registered). */
  readonly damage: DamageModel;
}

/** Compiles the knight's combat from `content` (see the file header, step 1). */
export function prepareTestbedCombat(content: GameContent): TestbedCombat {
  const damage = new DamageModel();
  damage.register(shieldGuard());
  return {
    moves: compileMoves(content.all('move')),
    tracks: compileSocketTracks(content.all('socket-track')),
    melee: { shield: compileShield(content.get('shield', KNIGHT_SHIELD_ID)) },
    damage,
  };
}

/**
 * Adds the hit-volume system and the melee strikes to `world` and spawns the scene's training
 * dummies (see the file header, step 2). Returns the dummies, in spawn order.
 */
export function startTestbedCombat<TInput>(
  world: World<TInput>,
  combat: TestbedCombat,
  spawns: readonly SceneSpawnPlacement[],
): readonly EntityId[] {
  world.addSystem(hitVolumeSystem({ isAlly: noAllies, invulnerable: iframeRule(combat.moves) }));
  installMeleeStrikes(world, combat);
  return trainingDummySpawns(spawns).map((spawn) => spawnTrainingDummy(world, spawn));
}
