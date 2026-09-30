// Knight combat in the greybox testbed (mw-e04.6): the wiring src/main.ts and the headless testbed
// world share, so the game and its replay run the same combat. In two halves, because the order of
// systems matters:
//
// 1. `prepareTestbedCombat` (before the player is installed): the knight's moves (with the combat
//    sandbox's attacker variants, mw-e04.9), socket tracks and wood shield from content, the damage
//    model with the shield rule in its guard stage, and the sandbox tuning. Its `moves` and `melee` go
//    to setupTestbedPlayer, its `spawners` to the debug commands.
// 1b. `installSandboxRules` (with the debug commands, before the player): the combat sandbox's
//    commands, attacker metronomes and infinite-health refills, which must run before the player's
//    action timeline so a metronome swing starts on its beat.
// 2. `startTestbedCombat` (after the player): the hit-volume system — after the player's action
//    timeline, so a swing sweeps on the tick its active phase starts, and honouring dodge and
//    wake-up i-frames (invulnerabilityRule, mw-e04.28) — the melee strikes, hit-stop (mw-e04.11: the
//    hit-stop table's freeze of attacker and victim on every hit), hit reactions (mw-e04.7: stagger, knockback, the guard
//    break's stagger, mw-e04.31) with pushes through the controller and physics, the player as a
//    combatant that can be struck and react, a training dummy at every spawn tagged
//    `training-dummy`, and the combat sandbox's dummies at spawns tagged `sandbox-dummy` /
//    `sandbox-attacker`. With lock-on installed (by setupTestbedPlayer, before this), every dummy —
//    the scene's and any the console spawns later — is a lock-on target (mw-e02.32).
//
// The caller registers the hit-volume, damage and placement components (src/main.ts does at world
// creation; installGamePhysics registers placement).

import {
  COMBAT_SANDBOX_ID,
  compileHitStop,
  compileMoves,
  compileSandbox,
  compileShield,
  compileSocketTracks,
  HIT_STOP_ID,
  KNIGHT_SHIELD_ID,
  TRAINING_DUMMY_TARGETABLE_ID,
  type GameContent,
  type HitStopTable,
  type MoveTable,
} from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  CharacterController,
  CombatFacingComponent,
  DamageModel,
  DEFAULT_REACTION_PROFILE,
  giveCombatant,
  giveHitReactions,
  giveHurtboxes,
  HealthComponent,
  HitReactionComponent,
  HitStopComponent,
  hitVolumeSystem,
  hurtboxFacing,
  invulnerabilityRule,
  installCombatSandbox,
  installHitReactions,
  installHitStop,
  installMeleeStrikes,
  MELEE_COMPONENTS,
  noAllies,
  PhysicsObjectComponent,
  PlacementComponent,
  pushCharacter,
  pushPhysicsObject,
  sandboxSpawners,
  shieldGuard,
  spawnSceneDummies,
  StaminaComponent,
  withAttackerVariants,
  type CombatSandboxOptions,
  type ComponentType,
  type DummyLockProfile,
  type EntityId,
  type FacingReader,
  type PlayerMeleeOptions,
  type Pusher,
  type SceneSpawnPlacement,
  type SocketTrackLookup,
  type Spawner,
  type World,
} from '@sim/index';
import { spawnTrainingDummy, trainingDummySpawns } from './training-dummy';

/** The first half of the testbed's combat wiring. */
export interface TestbedCombat {
  /** Every move in content plus the attacker variants (the action timeline's table). */
  readonly moves: MoveTable;
  readonly tracks: SocketTrackLookup;
  /** The knight's sword and shield, for setupTestbedPlayer. */
  readonly melee: PlayerMeleeOptions;
  /** The damage model every hit resolves through (the shield rule registered). */
  readonly damage: DamageModel;
  /** Hit-stop ticks per hit tier (mw-e04.11). */
  readonly hitStop: HitStopTable;
  /** The combat sandbox's tuning and move table (mw-e04.9). */
  readonly sandbox: CombatSandboxOptions;
  /** The debug console's spawners for the sandbox's dummies (`dummy`, `attacker-dummy`). */
  readonly spawners: ReadonlyMap<string, Spawner>;
  /** Every dummy's lock-on profile (content `targetable` `training-dummy`, mw-e02.32). */
  readonly targetable: DummyLockProfile;
}

/** Compiles the knight's combat from `content` (see the file header, step 1). */
export function prepareTestbedCombat(content: GameContent): TestbedCombat {
  const damage = new DamageModel();
  damage.register(shieldGuard());
  const moves = withAttackerVariants(compileMoves(content.all('move')));
  const targetable = content.get('targetable', TRAINING_DUMMY_TARGETABLE_ID);
  const sandbox = {
    tuning: compileSandbox(content.get('sandbox', COMBAT_SANDBOX_ID)),
    moves,
    targetable,
  };
  return {
    moves,
    tracks: compileSocketTracks(content.all('socket-track')),
    melee: { shield: compileShield(content.get('shield', KNIGHT_SHIELD_ID)) },
    damage,
    hitStop: compileHitStop(content.get('hit-stop', HIT_STOP_ID)),
    sandbox,
    spawners: sandboxSpawners(sandbox),
    targetable,
  };
}

/** The combat sandbox's rules (see the file header, step 1b). Once per world. */
export function installSandboxRules<TInput>(world: World<TInput>, combat: TestbedCombat): void {
  installCombatSandbox(world, combat.sandbox);
}

/**
 * The player's hurtbox (mw-e04.31): one torso capsule the height of the knight's capsule, feet at
 * the origin. Geometry, not tuning; region hurtboxes arrive with the knight's rig.
 */
export const PLAYER_HURTBOX = Object.freeze({ bottom: 0.3, top: 1.5, radius: 0.35 });

/**
 * A fighter's facing for hit reactions: its body facing (melee), else its hurtbox frame's.
 * startTestbedCombat registers the melee components, so the facing is always readable.
 */
const bodyFacing: FacingReader = (world, entity) =>
  world.get(entity, CombatFacingComponent)?.facing ?? hurtboxFacing(world, entity);

/** Registers whichever of `types` `world` does not have yet (a scene without a player). */
function ensureRegistered<TInput>(world: World<TInput>, types: readonly ComponentType<unknown>[]) {
  for (const type of types) if (!world.isRegistered(type)) world.register(type);
}

/** Makes the player a combatant that can be struck and reacts to hits (mw-e04.31). */
function arm<TInput>(world: World<TInput>, combat: TestbedCombat, player: EntityId): void {
  const w: World<never> = world;
  if (w.has(player, HealthComponent)) return; // another rule made it a combatant already
  const { health, poise } = combat.sandbox.tuning.player;
  giveCombatant(w, player, { health, poise, player: true });
  const { bottom, top, radius } = PLAYER_HURTBOX;
  giveHurtboxes(w, player, {
    boxes: [
      {
        id: 'torso',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: bottom, z: 0 },
          to: { x: 0, y: top, z: 0 },
          radius,
        },
      },
    ],
  });
  giveHitReactions(w, player, DEFAULT_REACTION_PROFILE);
}

/** What `startTestbedCombat` spawned. */
export interface TestbedCombatants {
  /** The testbed's training dummies (spawns tagged `training-dummy`), in spawn order. */
  readonly dummies: readonly EntityId[];
  /** The combat sandbox's dummies (spawns tagged `sandbox-dummy` / `sandbox-attacker`). */
  readonly sandboxDummies: readonly EntityId[];
}

/**
 * Adds the hit-volume system, the melee strikes and hit reactions to `world`, arms `player` (when
 * given) and spawns the scene's dummies (see the file header, step 2). Call `installSandboxRules`
 * first.
 */
export function startTestbedCombat<TInput>(
  world: World<TInput>,
  combat: TestbedCombat,
  spawns: readonly SceneSpawnPlacement[],
  player?: EntityId,
): TestbedCombatants {
  // A scene without a player has no timeline, stamina or melee yet; console-spawned dummies need them.
  ensureRegistered(world, [...ACTION_TIMELINE_COMPONENTS, ...MELEE_COMPONENTS, StaminaComponent]);
  ensureRegistered(world, [PlacementComponent, HitReactionComponent, HitStopComponent]);
  world.addSystem(
    hitVolumeSystem({ isAlly: noAllies, invulnerable: invulnerabilityRule(combat.moves) }),
  );
  installMeleeStrikes(world, combat);
  installHitStop(world, { moves: combat.moves, table: combat.hitStop });
  const pushers: Pusher[] = [];
  if (world.isRegistered(CharacterController)) pushers.push(pushCharacter);
  if (world.isRegistered(PhysicsObjectComponent)) pushers.push(pushPhysicsObject);
  installHitReactions(world, {
    moves: combat.moves,
    damage: combat.damage,
    pushers,
    facing: bodyFacing,
  });
  if (player !== undefined) arm(world, combat, player);
  return {
    dummies: trainingDummySpawns(spawns).map((spawn) =>
      spawnTrainingDummy(world, spawn, combat.targetable),
    ),
    sandboxDummies: spawnSceneDummies(world, spawns, combat.sandbox),
  };
}
