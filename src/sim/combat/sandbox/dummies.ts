// The combat sandbox's dummies (mw-e04.9): something to hit and something that hits back, for tuning
// combat feel in seconds rather than by playing through levels.
//
// A training dummy is a combatant that stands still: health, poise and resistances, hurtboxes for
// the regions it was given (head, torso, limb, weakpoint; see DUMMY_HURTBOXES), hit reactions (so a
// poise break staggers it and a heavy blow knocks it down) and a facing. With infinite health it is
// undying — its health stops at UNDYING_FLOOR and it never emits Died — and its health refills once
// it has gone `resetAfterTicks` (3 s) without a hit, so the HUD shows every hit of a combo and then
// resets.
//
// An attacker dummy is a training dummy with an action timeline and hitboxes that performs a move on
// a metronome: on every world tick that is a multiple of its `periodTicks` (120 = every 2.0 s) it
// turns to face the player and starts its move, if it is free to (a swing still running, or a
// stagger, skips that beat — it never swings late). The metronome system must run before the action timeline, so the move starts on the
// beat itself; `installCombatSandbox` belongs with the debug commands, before the player's systems.
// Whether the swing can be parried or blocked is a per-dummy toggle: the move table carries a variant
// of every hitting move for each combination (`withAttackerVariants`), and the dummy performs the
// variant its toggles name (`attackerMoveId`), so hitboxes, damage and the shield rule read ordinary
// move data.
//
// Spawning. Scene spawns tagged SANDBOX_DUMMY_TAG / SANDBOX_ATTACKER_TAG become dummies facing the
// spawn's yaw; the debug console spawns them with `spawn dummy` / `spawn attacker-dummy` and options
// (params.ts), facing the player. The console's `attacker` and `dummies` commands reconfigure the
// dummies already there through SandboxCommand, applied inside the tick like every debug command.

import type { Frozen, MoveTable, RuntimeMove, RuntimeSandbox, TargetableDef } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import type { SpawnParams } from '../../debug/commands';
import type { Spawner } from '../../debug/system';
import type { LocalShape } from '../../geom';
import type { SceneSpawnPlacement } from '../../scene/layout';
import type { Vec3 } from '../../stimulus/shapes';
import { cos, sin } from '../../math';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import { giveTargetable, TargetableComponent } from '../../targeting/components';
import { horizontalAim } from '../attacks/frame';
import {
  giveCombatant,
  HealthComponent,
  PlayerCombatantComponent,
  UndyingComponent,
} from '../damage/components';
import { DamageApplied } from '../damage/events';
import { giveHitboxes, giveHurtboxes, HurtboxComponent, type HitRegion } from '../hits/components';
import { facingOf, FORWARD_FACING, giveFacing } from '../melee/components';
import { giveHitReactions, HitReactionComponent } from '../reactions/components';
import { giveActionTimeline } from '../timeline/components';
import { canActNow, requestMove } from '../timeline/timeline';
import {
  AttackerDummyComponent,
  SANDBOX_COMPONENTS,
  SandboxDummyComponent,
  type AttackerDummy,
} from './components';
import {
  attackerFromTuning,
  attackerSpecFrom,
  DUMMY_OPTIONS,
  dummySpecFrom,
  type AttackerSpec,
  type DummySpec,
} from './params';

/** Scene spawns with this tag become training dummies. */
export const SANDBOX_DUMMY_TAG = 'sandbox-dummy';

/** Scene spawns with this tag become attacker dummies. */
export const SANDBOX_ATTACKER_TAG = 'sandbox-attacker';

/** The console's spawnable ids. */
export const DUMMY_SPAWNABLE = 'dummy';
export const ATTACKER_SPAWNABLE = 'attacker-dummy';

/** How tall a dummy is, metres (its head's top). */
export const DUMMY_HEIGHT = 1.85;

/**
 * Each region's hurtbox in a dummy's frame (feet at the origin, facing +z, +x right), for a body of
 * `radius`: legs, a torso above them, a head on top and a weak point in the middle of its back.
 */
export const DUMMY_HURTBOXES: Readonly<Record<HitRegion, (radius: number) => LocalShape>> =
  Object.freeze({
    weakpoint: (radius: number): LocalShape => ({
      kind: 'sphere',
      center: { x: 0, y: 1.2, z: -radius },
      radius: 0.12,
    }),
    head: (): LocalShape => ({ kind: 'sphere', center: { x: 0, y: 1.67, z: 0 }, radius: 0.18 }),
    torso: (radius: number): LocalShape => ({
      kind: 'capsule',
      from: { x: 0, y: 0.95, z: 0 },
      to: { x: 0, y: 1.3, z: 0 },
      radius,
    }),
    limb: (radius: number): LocalShape => ({
      kind: 'capsule',
      from: { x: 0, y: 0.15, z: 0 },
      to: { x: 0, y: 0.7, z: 0 },
      radius: radius * 0.6,
    }),
  });

/**
 * The id of `base` as an attacker performs it with these toggles: `base` itself when they match the
 * move, else its variant (see `withAttackerVariants`).
 */
export function attackerMoveId(
  move: RuntimeMove,
  parryable: boolean,
  unblockable: boolean,
): string {
  if (move.parryable === parryable && move.unblockable === unblockable) return move.id;
  return `${move.id}:${parryable ? 'parryable' : 'unparryable'}:${unblockable ? 'unblockable' : 'blockable'}`;
}

/**
 * `moves` plus, for every move with a hitbox, a variant for each parryable/unblockable combination
 * it does not already have (same frames, hitbox and damage; ids from `attackerMoveId`).
 */
export function withAttackerVariants(moves: MoveTable): MoveTable {
  const out = new Map(moves);
  for (const move of moves.values()) {
    if (move.hitbox === null || move.id.includes(':')) continue; // content ids have no ':'
    for (const parryable of [true, false]) {
      for (const unblockable of [false, true]) {
        const id = attackerMoveId(move, parryable, unblockable);
        if (out.has(id)) continue;
        out.set(
          id,
          Object.freeze({ ...move, id, parryable, unblockable, blockable: !unblockable }),
        );
      }
    }
  }
  return out;
}

/** A lock-on profile (content `targetable`): lock points and pick priority. */
export type DummyLockProfile = Frozen<Pick<TargetableDef, 'points' | 'priority'>>;

/** What spawning a dummy needs besides its spec: the sandbox tuning. */
export interface DummyBodyOptions {
  readonly tuning: RuntimeSandbox;
  /**
   * Makes the dummy a lock-on target with this profile (mw-e02.32) where the world has lock-on
   * (TargetableComponent registered); absent = not lockable.
   */
  readonly targetable?: DummyLockProfile;
  /** Direction it faces (horizontal part; default +z). */
  readonly facing?: Vec3;
}

/**
 * Spawns a training dummy at `at` (its feet). Register the sandbox, damage, hit-volume, hit-reaction,
 * melee and placement components first; structural, so it exists from the end of the tick.
 */
export function spawnSandboxDummy(
  world: World<never>,
  at: Vec3,
  spec: DummySpec,
  options: DummyBodyOptions,
): EntityId {
  const { dummy } = options.tuning;
  const { radius } = dummy;
  const facing = horizontalAim(options.facing ?? FORWARD_FACING);
  const entity = world.spawn();
  placeEntity(world, entity, at, radius);
  giveFacing(world, entity, facing);
  giveHurtboxes(world, entity, {
    facing,
    boxes: spec.regions.map((region) => ({
      id: region,
      socket: 'root',
      region,
      armored: false,
      multiplier: dummy.regionMultipliers[region],
      shape: DUMMY_HURTBOXES[region](radius),
    })),
  });
  giveCombatant(world, entity, {
    health: spec.health,
    poise: spec.poise,
    resistances: spec.resistances,
  });
  giveHitReactions(world, entity, { ...dummy.reactions, replace: {} });
  world.add(
    entity,
    SandboxDummyComponent,
    Object.freeze({
      infiniteHealth: spec.infiniteHealth,
      resetAfterTicks: dummy.resetAfterTicks,
      lastHitAt: null,
    }),
  );
  if (spec.infiniteHealth) world.add(entity, UndyingComponent, true);
  if (options.targetable !== undefined && world.isRegistered(TargetableComponent)) {
    giveTargetable(world, entity, options.targetable);
  }
  return entity;
}

/**
 * Spawns an attacker dummy: a training dummy (`spec`) with an action timeline, hitboxes and the
 * metronome `attacker`. Register the action timeline components too.
 */
export function spawnAttackerDummy(
  world: World<never>,
  at: Vec3,
  spec: DummySpec,
  attacker: AttackerSpec,
  options: DummyBodyOptions,
): EntityId {
  const entity = spawnSandboxDummy(world, at, spec, options);
  giveActionTimeline(world, entity);
  giveHitboxes(world, entity);
  world.add(entity, AttackerDummyComponent, Object.freeze({ ...attacker }));
  return entity;
}

/** The yaw of a scene spawn as a facing (yaw 0 faces +z; 90 turns +z into +x). */
function spawnFacing(spawn: SceneSpawnPlacement): Vec3 {
  const r = (spawn.yaw * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 1e9) / 1e9 + 0;
  return { x: round(sin(r)), y: 0, z: round(cos(r)) };
}

/** What the sandbox rules need. */
export interface CombatSandboxOptions {
  /** The sandbox tuning (content `sandbox`, compiled). */
  readonly tuning: RuntimeSandbox;
  /** The action timeline's move table, with the attacker variants (`withAttackerVariants`). */
  readonly moves: MoveTable;
  /** The dummies' lock-on profile (see DummyBodyOptions.targetable); absent = not lockable. */
  readonly targetable?: DummyLockProfile;
}

/** Spawns a dummy at every spawn tagged SANDBOX_DUMMY_TAG or SANDBOX_ATTACKER_TAG, in spawn order. */
export function spawnSceneDummies(
  world: World<never>,
  spawns: readonly SceneSpawnPlacement[],
  options: CombatSandboxOptions,
): readonly EntityId[] {
  const { tuning, targetable } = options;
  const spec = dummySpecFrom(tuning.dummy, {});
  const out: EntityId[] = [];
  for (const spawn of spawns) {
    const body = {
      tuning,
      facing: spawnFacing(spawn),
      ...(targetable !== undefined && { targetable }),
    };
    if (spawn.tags.includes(SANDBOX_ATTACKER_TAG)) {
      const attacker = attackerFromTuning(tuning.attacker);
      out.push(spawnAttackerDummy(world, spawn.position, spec, attacker, body));
    } else if (spawn.tags.includes(SANDBOX_DUMMY_TAG)) {
      out.push(spawnSandboxDummy(world, spawn.position, spec, body));
    }
  }
  return out;
}

/** The direction from `at` towards the player combatant, horizontally; undefined without one. */
function towardPlayer(world: World<never>, at: Vec3): Vec3 | undefined {
  let toward: Vec3 | undefined;
  world.query(PlayerCombatantComponent, PlacementComponent).forEach((_entity, _marker, placed) => {
    const x = placed.x - at.x;
    const z = placed.z - at.z;
    if (toward === undefined && (x !== 0 || z !== 0)) toward = { x, y: 0, z };
  });
  return toward;
}

/** Turns `entity` (body and hurtboxes) to face the player combatant, when there is one. */
function faceThePlayer(world: World<never>, entity: EntityId): void {
  const at = world.get(entity, PlacementComponent);
  const toward = at === undefined ? undefined : towardPlayer(world, at);
  if (toward === undefined) return;
  giveFacing(world, entity, toward);
  const hurtboxes = world.get(entity, HurtboxComponent);
  if (hurtboxes !== undefined) {
    world.set(
      entity,
      HurtboxComponent,
      Object.freeze({ ...hurtboxes, facing: facingOf(world, entity) }),
    );
  }
}

/**
 * Checks `params` for spawnable `content` without spawning (the console's up-front check): the
 * problem as a message, or undefined when they are fine or `content` is not a sandbox spawnable.
 */
export function checkSandboxSpawn(
  options: CombatSandboxOptions,
  content: string,
  params: SpawnParams,
  hz: number,
): string | undefined {
  try {
    specsFor(options, content, params, hz);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

function specsFor(
  options: CombatSandboxOptions,
  content: string,
  params: SpawnParams,
  hz: number,
): { readonly dummy: DummySpec; readonly attacker?: AttackerSpec } {
  const { tuning, moves } = options;
  if (content !== ATTACKER_SPAWNABLE) return { dummy: dummySpecFrom(tuning.dummy, params) };
  const dummyParams = Object.fromEntries(
    Object.entries(params).filter(([name]) => name in DUMMY_OPTIONS),
  );
  const attackerParams = Object.fromEntries(
    Object.entries(params).filter(([name]) => !(name in DUMMY_OPTIONS)),
  );
  const base = attackerFromTuning(tuning.attacker);
  return {
    dummy: dummySpecFrom(tuning.dummy, dummyParams),
    attacker: attackerSpecFrom(base, moves, attackerParams, hz),
  };
}

/** The debug console's spawners for the sandbox's dummies (DUMMY_SPAWNABLE, ATTACKER_SPAWNABLE). */
export function sandboxSpawners(options: CombatSandboxOptions): Map<string, Spawner> {
  const spawner =
    (content: string): Spawner =>
    (world, at, params) => {
      const w: World<never> = world;
      const { dummy, attacker } = specsFor(options, content, params, w.clock.hz);
      const body = {
        tuning: options.tuning,
        facing: towardPlayer(w, at) ?? FORWARD_FACING,
        ...(options.targetable !== undefined && { targetable: options.targetable }),
      };
      return attacker === undefined
        ? spawnSandboxDummy(w, at, dummy, body)
        : spawnAttackerDummy(w, at, dummy, attacker, body);
    };
  return new Map([
    [DUMMY_SPAWNABLE, spawner(DUMMY_SPAWNABLE)],
    [ATTACKER_SPAWNABLE, spawner(ATTACKER_SPAWNABLE)],
  ]);
}

/** The `kind` tag of a sandbox command. */
export const SANDBOX_COMMAND = 'sim.sandbox' as const;

/**
 * Reconfigures every dummy of a kind: `attackers` takes ATTACKER_OPTIONS, `dummies` the `infinite`
 * option. Fed to `World.step` among the tick's inputs like a debug command (recorded in replays).
 */
export interface SandboxCommand {
  readonly kind: typeof SANDBOX_COMMAND;
  readonly op: 'attackers' | 'dummies';
  readonly params: SpawnParams;
}

/** A sandbox command (options are checked when it is applied). */
export function sandboxCommand(op: SandboxCommand['op'], params: SpawnParams): SandboxCommand {
  return { kind: SANDBOX_COMMAND, op, params: Object.freeze({ ...params }) };
}

/** True for a SandboxCommand among arbitrary step inputs. */
export function isSandboxCommand(input: unknown): input is SandboxCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === SANDBOX_COMMAND
  );
}

/** Options the `dummies` command takes. */
export const DUMMIES_COMMAND_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  infinite: '<on|off>',
});

/**
 * What `command` would change, as a message when its options are wrong (the console's up-front
 * check), else undefined.
 */
export function checkSandboxCommand(
  options: CombatSandboxOptions,
  command: SandboxCommand,
  hz: number,
): string | undefined {
  try {
    settingsFor(options, command, hz);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** How `command` changes each attacker (undefined for `dummies`); throws for bad options. */
function settingsFor(
  options: CombatSandboxOptions,
  command: SandboxCommand,
  hz: number,
): ((current: AttackerDummy) => AttackerDummy) | undefined {
  if (command.op === 'dummies') {
    const unknown = Object.keys(command.params).find((name) => name !== 'infinite');
    if (unknown !== undefined) {
      throw new RangeError(`unknown option --${unknown}; expected --infinite`);
    }
    dummySpecFrom(options.tuning.dummy, command.params);
    return undefined;
  }
  attackerSpecFrom(attackerFromTuning(options.tuning.attacker), options.moves, command.params, hz);
  return (current) => attackerSpecFrom(current, options.moves, command.params, hz);
}

function applySandboxCommand(
  world: World<never>,
  options: CombatSandboxOptions,
  command: SandboxCommand,
): void {
  let change: ((current: AttackerDummy) => AttackerDummy) | undefined;
  try {
    change = settingsFor(options, command, world.clock.hz);
  } catch (error) {
    if (error instanceof RangeError) return; // a replay's bad options: skipped, as debug commands are
    throw error;
  }
  if (change !== undefined) {
    const next = change;
    world.query(AttackerDummyComponent).forEach((entity, current) => {
      world.set(entity, AttackerDummyComponent, next(current));
    });
    return;
  }
  const infinite = command.params['infinite'];
  if (infinite === undefined) return;
  const on = infinite === 'on';
  world.query(SandboxDummyComponent).forEach((entity, dummy) => {
    world.set(entity, SandboxDummyComponent, Object.freeze({ ...dummy, infiniteHealth: on }));
    if (on && !world.has(entity, UndyingComponent)) world.add(entity, UndyingComponent, true);
    if (!on && world.has(entity, UndyingComponent)) world.remove(entity, UndyingComponent);
  });
}

/**
 * Applies the tick's sandbox commands, then starts each attacker dummy's move on its beat (see the
 * file header). Run it before the action timeline.
 */
export function sandboxSystem<TInput>(options: CombatSandboxOptions): System<TInput> {
  const { moves } = options;
  return {
    name: 'combat-sandbox',
    run: ({ world, inputs, tick }) => {
      const w: World<never> = world;
      for (const command of (inputs as readonly unknown[]).filter(isSandboxCommand)) {
        applySandboxCommand(w, options, command);
      }
      w.query(AttackerDummyComponent).forEach((entity, attacker) => {
        if (!attacker.enabled || tick % attacker.periodTicks !== 0) return;
        const move = moves.get(attacker.move);
        if (move === undefined || !canActNow(w, entity, moves, 'attack')) return;
        faceThePlayer(w, entity);
        requestMove(w, entity, attackerMoveId(move, attacker.parryable, attacker.unblockable));
      });
    },
  };
}

/** Refills infinite dummies that have gone `resetAfterTicks` without a hit (full health, full poise). */
export function sandboxDummySystem<TInput>(): System<TInput> {
  return {
    name: 'sandbox-dummies',
    run: ({ world, tick }) => {
      const w: World<never> = world;
      w.query(SandboxDummyComponent, HealthComponent).forEach((entity, dummy, health) => {
        if (!dummy.infiniteHealth || dummy.lastHitAt === null) return;
        if (tick < dummy.lastHitAt + dummy.resetAfterTicks || health.current === health.max) return;
        w.set(entity, HealthComponent, Object.freeze({ ...health, current: health.max }));
      });
    },
  };
}

/**
 * Wires the sandbox into `world`: registers SANDBOX_COMPONENTS (and the hit-reaction component),
 * adds the sandbox system (commands and metronomes) and the infinite-health refill, and remembers
 * every dummy's latest hit. Install it with the debug commands, before the player's action timeline;
 * register the damage, hit-volume, melee, timeline and placement components too. Returns a function
 * that removes the subscription.
 */
export function installCombatSandbox<TInput>(
  world: World<TInput>,
  options: CombatSandboxOptions,
): () => void {
  world.register(...SANDBOX_COMPONENTS);
  if (!world.isRegistered(HitReactionComponent)) world.register(HitReactionComponent);
  world.addSystem(sandboxSystem<TInput>(options)).addSystem(sandboxDummySystem<TInput>());
  const w: World<never> = world;
  return world.events.on(DamageApplied, ({ target, tick }) => {
    const dummy = w.get(target, SandboxDummyComponent);
    if (dummy !== undefined) {
      w.set(target, SandboxDummyComponent, Object.freeze({ ...dummy, lastHitAt: tick }));
    }
  });
}
