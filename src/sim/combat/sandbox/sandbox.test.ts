import type { MoveTable, RuntimeMove, RuntimeSandbox } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { NO_SPAWN_PARAMS, spawnCommand } from '../../debug/commands';
import { installDebugCommands } from '../../debug/system';
import type { SceneSpawnPlacement } from '../../scene/layout';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import { TargetableComponent } from '../../targeting/components';
import {
  DAMAGE_COMPONENTS,
  giveCombatant,
  HealthComponent,
  healthOf,
  poiseOf,
  ResistancesComponent,
  UndyingComponent,
} from '../damage/components';
import { Died } from '../damage/events';
import { DamageModel } from '../damage/model';
import { HIT_VOLUME_COMPONENTS, HitboxComponent, HurtboxComponent } from '../hits/components';
import { facingOf, MELEE_COMPONENTS } from '../melee/components';
import { HitReactionComponent } from '../reactions/components';
import { StaminaComponent } from '../stamina';
import { ACTION_TIMELINE_COMPONENTS } from '../timeline/components';
import { ActionStarted, type ActionStartInfo } from '../timeline/events';
import { actionOf, actionTimelineSystem, interruptAction } from '../timeline/timeline';
import {
  AttackerDummyComponent,
  SANDBOX_COMPONENTS,
  SandboxDummyComponent,
  type AttackerDummy,
} from './components';
import {
  ATTACKER_SPAWNABLE,
  attackerMoveId,
  checkSandboxCommand,
  checkSandboxSpawn,
  DUMMY_HURTBOXES,
  DUMMY_SPAWNABLE,
  installCombatSandbox,
  isSandboxCommand,
  SANDBOX_ATTACKER_TAG,
  SANDBOX_COMMAND,
  SANDBOX_DUMMY_TAG,
  sandboxCommand,
  sandboxSpawners,
  spawnAttackerDummy,
  spawnSandboxDummy,
  spawnSceneDummies,
  withAttackerVariants,
  type CombatSandboxOptions,
} from './dummies';
import {
  ATTACKER_OPTIONS,
  attackerFromTuning,
  attackerSpecFrom,
  DUMMY_OPTIONS,
  dummySpecFrom,
  type AttackerSpec,
} from './params';

const v = (x: number, y: number, z: number) => ({ x, y, z });

function move(id: string, frames: [number, number, number], hits = true): RuntimeMove {
  const [startup, active, recovery] = frames;
  return Object.freeze({
    id,
    verb: hits ? 'attack' : 'dodge',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: 0,
    cancelWindows: [],
    damage: hits
      ? {
          amounts: { slash: 15 },
          poiseDamage: 15,
          staminaDamage: 20,
          impulse: v(0, 0, 0),
          tags: [],
        }
      : null,
    hitbox: hits
      ? {
          track: 'arc',
          shape: { kind: 'capsule', from: v(0.3, 1.2, 0.3), to: v(0.3, 1.2, 1.3), radius: 0.1 },
          reach: 'medium',
          swing: 'horizontal',
        }
      : null,
    parryable: hits,
    blockable: hits,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: hits ? 'light' : null,
    chainNext: null,
    charge: null,
    motion: null,
    presentation: { anim: `anim-${id}` },
  } as RuntimeMove);
}

const SWING = move('swing', [18, 4, 20]);
const JAB = move('jab', [6, 2, 6]);
const ROLL = move('roll', [2, 10, 8], false);
const BASE: MoveTable = new Map([SWING, JAB, ROLL].map((m) => [m.id, m]));
const MOVES = withAttackerVariants(BASE);

const TUNING: RuntimeSandbox = Object.freeze({
  id: 'combat-sandbox',
  scene: 'arena',
  dummy: Object.freeze({
    health: 1000,
    poise: 40,
    infiniteHealth: true,
    resetAfterTicks: 180,
    resistances: Object.freeze({}),
    regions: Object.freeze(['head', 'torso', 'limb'] as const),
    regionMultipliers: Object.freeze({ weakpoint: 2, head: 1.5, torso: 1, limb: 0.75 }),
    radius: 0.35,
    reactions: Object.freeze({
      knockbackImpulse: 300,
      knockdownImpulse: 900,
      launchSpeed: 2,
      mass: 80,
    }),
  }),
  attacker: Object.freeze({ move: 'swing', periodTicks: 120, parryable: true, unblockable: false }),
  player: Object.freeze({ health: 100, poise: 30 }),
});

const OPTIONS = { tuning: TUNING, moves: MOVES };

function sandboxWorld(options: CombatSandboxOptions = OPTIONS, lockOn = false) {
  const world = new World<unknown>({ seed: 5 });
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, ...MELEE_COMPONENTS);
  world.register(...ACTION_TIMELINE_COMPONENTS, PlacementComponent, StaminaComponent);
  if (lockOn) world.register(TargetableComponent);
  installDebugCommands(world, { spawners: sandboxSpawners(options) });
  const uninstall = installCombatSandbox(world, options);
  world.addSystem(actionTimelineSystem({ moves: MOVES }));
  const started: ActionStartInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  const steps = (n: number, inputs: readonly unknown[] = []) => {
    for (let i = 0; i < n; i++) world.step(i === 0 ? inputs : []);
  };
  return { world, started, steps, uninstall };
}

const w = (world: World): World<never> => world;

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0] as T;
}

function sandboxEntities(world: World, attackers = false): EntityId[] {
  const ids: EntityId[] = [];
  world.query(attackers ? AttackerDummyComponent : SandboxDummyComponent).forEach((id) => {
    ids.push(id);
  });
  return ids;
}

describe('sandbox dummy options (mw-e04.9)', () => {
  it('AC-1: --poise 60 --resist slash=0.5 change only those numbers', () => {
    expect(dummySpecFrom(TUNING.dummy, { poise: '60', resist: 'slash=0.5' })).toEqual({
      health: 1000,
      poise: 60,
      infiniteHealth: true,
      resistances: { slash: 0.5 },
      regions: ['head', 'torso', 'limb'],
    });
  });

  it('parses every option, regions in priority order', () => {
    expect(
      dummySpecFrom(TUNING.dummy, {
        health: '250.5',
        poise: '0',
        resist: ' fire=2 , slash=0 ,',
        regions: 'torso,weakpoint',
        infinite: 'off',
      }),
    ).toEqual({
      health: 250.5,
      poise: 0,
      infiniteHealth: false,
      resistances: { fire: 2, slash: 0 },
      regions: ['weakpoint', 'torso'],
    });
    expect(Object.keys(DUMMY_OPTIONS)).toEqual([
      'health',
      'poise',
      'resist',
      'regions',
      'infinite',
    ]);
    expect(Object.keys(ATTACKER_OPTIONS)).toEqual([
      'move',
      'every',
      'parryable',
      'unblockable',
      'enabled',
    ]);
  });

  it('rejects unknown options and bad values with console-ready messages', () => {
    const bad = (params: Record<string, string>) => () => dummySpecFrom(TUNING.dummy, params);
    expect(bad({ size: 'big' })).toThrow(
      'unknown option --size; expected one of --health, --poise, --resist, --regions, --infinite',
    );
    expect(bad({ poise: 'lots' })).toThrow('--poise must be a number 0–');
    expect(bad({ poise: ' ' })).toThrow(RangeError);
    expect(bad({ health: '0' })).toThrow('--health must be a number 1–');
    expect(bad({ resist: 'ice=1' })).toThrow('--resist: "ice=1" is not type=multiplier');
    expect(bad({ resist: 'slash=1=2' })).toThrow(RangeError);
    expect(bad({ resist: 'slash=4' })).toThrow('--resist slash must be a number 0–3');
    expect(bad({ resist: ',' })).toThrow('--resist needs type=multiplier pairs');
    expect(bad({ regions: 'tail' })).toThrow('--regions: unknown region "tail"');
    expect(bad({ regions: ' , ' })).toThrow('--regions needs at least one region');
    expect(bad({ infinite: 'yes' })).toThrow('--infinite must be on or off, got "yes"');
  });

  it('parses the metronome: move, seconds to whole ticks, toggles', () => {
    const base: AttackerSpec = attackerFromTuning(TUNING.attacker);
    expect(base).toEqual({
      move: 'swing',
      periodTicks: 120,
      parryable: true,
      unblockable: false,
      enabled: true,
    });
    expect(
      attackerSpecFrom(
        base,
        MOVES,
        { move: 'jab', every: '0.5', parryable: 'off', unblockable: 'on', enabled: 'off' },
        60,
      ),
    ).toEqual({
      move: 'jab',
      periodTicks: 30,
      parryable: false,
      unblockable: true,
      enabled: false,
    });
    expect(attackerSpecFrom(base, MOVES, { every: '1.01' }, 60).periodTicks).toBe(61);
    expect(attackerSpecFrom(base, MOVES, {}, 60)).toEqual(base);
    expect(() => attackerSpecFrom(base, MOVES, { move: 'roll' }, 60)).toThrow(
      '--move: "roll" is not a move with a hitbox; try jab, swing',
    );
    expect(() => attackerSpecFrom(base, MOVES, { move: 'nope' }, 60)).toThrow(RangeError);
    expect(() => attackerSpecFrom(base, MOVES, { move: 'jab:parryable:unblockable' }, 60)).toThrow(
      RangeError,
    );
    expect(() => attackerSpecFrom(base, MOVES, { every: '0' }, 60)).toThrow('--every');
    expect(() => attackerSpecFrom(base, MOVES, { poise: '5' }, 60)).toThrow('--poise');
    expect(attackerSpecFrom(base, MOVES, { poise: '5' }, 60, ['poise'])).toEqual(base);
  });
});

describe('attacker move variants', () => {
  it('adds a variant for each parry/block combination of every hitting move', () => {
    expect([...MOVES.keys()].sort()).toEqual([
      'jab',
      'jab:parryable:unblockable',
      'jab:unparryable:blockable',
      'jab:unparryable:unblockable',
      'roll',
      'swing',
      'swing:parryable:unblockable',
      'swing:unparryable:blockable',
      'swing:unparryable:unblockable',
    ]);
    expect(attackerMoveId(SWING, true, false)).toBe('swing');
    const variant = MOVES.get(attackerMoveId(SWING, false, true));
    expect(variant).toMatchObject({
      id: 'swing:unparryable:unblockable',
      parryable: false,
      unblockable: true,
      blockable: false,
      startup: 18,
      hitbox: SWING.hitbox,
    });
    expect(Object.isFrozen(variant)).toBe(true);
    // Variants of a table that already has them change nothing.
    expect([...withAttackerVariants(MOVES).keys()]).toEqual([...MOVES.keys()]);
  });
});

describe('sandbox dummies', () => {
  it('AC-1: spawn dummy --poise 60 --resist slash=0.5 puts that dummy in sim state next tick', () => {
    const s = sandboxWorld();
    s.steps(1, [
      spawnCommand(DUMMY_SPAWNABLE, 1, v(1, 0, 2), { poise: '60', resist: 'slash=0.5' }),
    ]);
    const dummy = only(sandboxEntities(s.world));
    expect(poiseOf(w(s.world), dummy)?.max).toBe(60);
    expect(s.world.get(dummy, ResistancesComponent)?.multipliers).toEqual({ slash: 0.5 });
    expect(healthOf(w(s.world), dummy)).toEqual({ max: 1000, current: 1000 });
    expect(s.world.get(dummy, PlacementComponent)).toEqual({ x: 1, y: 0, z: 2, radius: 0.35 });
    expect(s.world.get(dummy, SandboxDummyComponent)).toEqual({
      infiniteHealth: true,
      resetAfterTicks: 180,
      lastHitAt: null,
    });
    expect(s.world.has(dummy, UndyingComponent)).toBe(true);
    expect(s.world.has(dummy, HitReactionComponent)).toBe(true);
    expect(
      s.world.get(dummy, HurtboxComponent)?.boxes.map((b) => [b.region, b.multiplier]),
    ).toEqual([
      ['head', 1.5],
      ['torso', 1],
      ['limb', 0.75],
    ]);
    expect(s.world.get(dummy, HitReactionComponent)?.profile).toEqual({
      ...TUNING.dummy.reactions,
      replace: {},
    });
  });

  it('a spawned dummy faces the player combatant; without one it faces +z', () => {
    const s = sandboxWorld();
    s.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 0))]);
    expect(facingOf(w(s.world), only(sandboxEntities(s.world)))).toEqual(v(0, 0, 1));
    const standing = s.world.spawn(); // a player combatant on the very spot is ignored
    giveCombatant(w(s.world), standing, { health: 10, player: true });
    placeEntity(w(s.world), standing, v(0, 0, 5), 0.3);
    const player = s.world.spawn();
    giveCombatant(w(s.world), player, { health: 10, player: true });
    placeEntity(w(s.world), player, v(3, 0, 5), 0.3);
    s.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 5))]);
    const [, faced] = sandboxEntities(s.world);
    expect(facingOf(w(s.world), faced ?? 0)).toEqual(v(1, 0, 0));
  });

  it('spawns attacker dummies with a timeline, hitboxes and a metronome from options', () => {
    const s = sandboxWorld();
    s.steps(1, [
      spawnCommand(ATTACKER_SPAWNABLE, 1, v(0, 0, 0), {
        move: 'jab',
        every: '1',
        unblockable: 'on',
        regions: 'weakpoint',
        infinite: 'off',
      }),
    ]);
    const attacker = only(sandboxEntities(s.world, true));
    expect(s.world.get(attacker, AttackerDummyComponent)).toEqual({
      move: 'jab',
      periodTicks: 60,
      parryable: true,
      unblockable: true,
      enabled: true,
    });
    expect(s.world.has(attacker, HitboxComponent)).toBe(true);
    expect(s.world.has(attacker, UndyingComponent)).toBe(false);
    expect(s.world.get(attacker, HurtboxComponent)?.boxes).toEqual([
      {
        id: 'weakpoint',
        socket: 'root',
        region: 'weakpoint',
        armored: false,
        multiplier: 2,
        shape: DUMMY_HURTBOXES.weakpoint(0.35),
      },
    ]);
  });

  it('bad options skip the spawn; the console checks them up front', () => {
    const s = sandboxWorld();
    const before = hashWorld(s.world);
    const other = sandboxWorld();
    s.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 2, v(0, 0, 0), { poise: '-1' })]);
    other.steps(1);
    expect(hashWorld(s.world)).toBe(hashWorld(other.world));
    expect(before).not.toBe(hashWorld(s.world)); // the tick ran
    expect(checkSandboxSpawn(OPTIONS, DUMMY_SPAWNABLE, { poise: '-1' }, 60)).toMatch(/--poise/);
    expect(checkSandboxSpawn(OPTIONS, ATTACKER_SPAWNABLE, { move: 'roll' }, 60)).toMatch(/--move/);
    expect(checkSandboxSpawn(OPTIONS, ATTACKER_SPAWNABLE, { poise: '5', every: '3' }, 60)).toBe(
      undefined,
    );
    expect(checkSandboxSpawn(OPTIONS, DUMMY_SPAWNABLE, { every: '3' }, 60)).toMatch(/--every/);
  });

  it('scene spawns tagged sandbox-dummy / sandbox-attacker become dummies facing the spawn yaw', () => {
    const s = sandboxWorld();
    const spawn = (id: string, tags: string[], yaw: 0 | 90 | 180 | 270): SceneSpawnPlacement => ({
      id,
      position: v(1, 0, 1),
      yaw,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      prop: undefined,
      tags,
    });
    const ids = spawnSceneDummies(
      w(s.world),
      [
        spawn('a', [SANDBOX_DUMMY_TAG], 180),
        spawn('b', ['player-start'], 0),
        spawn('c', [SANDBOX_ATTACKER_TAG], 90),
      ],
      OPTIONS,
    );
    s.steps(1);
    expect(ids).toHaveLength(2);
    const [dummy, attacker] = ids as [EntityId, EntityId];
    expect(facingOf(w(s.world), dummy)).toEqual(v(0, 0, -1));
    expect(facingOf(w(s.world), attacker)).toEqual(v(1, 0, 0));
    expect(s.world.has(dummy, AttackerDummyComponent)).toBe(false);
    expect(s.world.get(attacker, AttackerDummyComponent)?.move).toBe('swing');
  });
});

describe('lockable sandbox dummies (mw-e02.32)', () => {
  const PROFILE = Object.freeze({
    points: Object.freeze([Object.freeze({ id: 'chest', at: [0, 1.3, 0] as const })]),
    priority: 0,
  });
  const LOCKABLE = { ...OPTIONS, targetable: PROFILE };
  const scene = (tags: string[]): SceneSpawnPlacement => ({
    id: tags[0] ?? 'spawn',
    position: v(1, 0, 1),
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags,
  });

  it('with a profile and lock-on, every dummy — console-spawned or from the scene — is targetable', () => {
    const s = sandboxWorld(LOCKABLE, true);
    s.steps(1, [
      spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 2)),
      spawnCommand(ATTACKER_SPAWNABLE, 1, v(0, 0, 4)),
    ]);
    spawnSceneDummies(
      w(s.world),
      [scene([SANDBOX_DUMMY_TAG]), scene([SANDBOX_ATTACKER_TAG])],
      LOCKABLE,
    );
    s.steps(1);
    const ids = sandboxEntities(s.world); // every dummy, attackers included
    expect(ids).toHaveLength(4);
    for (const id of ids) {
      expect(s.world.get(id, TargetableComponent)).toEqual({
        points: [v(0, 1.3, 0)],
        priority: 0,
      });
    }
  });

  it('without a profile, or in a world without lock-on, dummies are not targetable', () => {
    const plain = sandboxWorld(OPTIONS, true);
    plain.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 2))]);
    const [a] = spawnSceneDummies(w(plain.world), [scene([SANDBOX_DUMMY_TAG])], OPTIONS);
    plain.steps(1);
    for (const id of [...sandboxEntities(plain.world), a ?? 0]) {
      expect(plain.world.has(id, TargetableComponent)).toBe(false);
    }
    const unlocked = sandboxWorld(LOCKABLE);
    unlocked.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 2))]);
    expect(sandboxEntities(unlocked.world)).toHaveLength(1);
    expect(unlocked.world.isRegistered(TargetableComponent)).toBe(false);
  });
});

describe('attacker metronome', () => {
  it('AC-2: at a 2.0 s metronome, 10 s run exactly 5 swings, each on a tick multiple of 120', () => {
    const s = sandboxWorld();
    const attacker = spawnAttackerDummy(
      w(s.world),
      v(0, 0, 0),
      dummySpecFrom(TUNING.dummy, NO_SPAWN_PARAMS),
      attackerFromTuning(TUNING.attacker),
      { tuning: TUNING },
    );
    s.steps(600);
    const swings = s.started.filter((e) => e.entity === attacker);
    expect(swings.map((e) => e.tick)).toEqual([0, 120, 240, 360, 480]);
    expect(swings.every((e) => e.tick % 120 === 0 && e.move === 'swing')).toBe(true);
  });

  it('turns to face the player on the beat', () => {
    const s = sandboxWorld();
    const attacker = spawnAttackerDummy(
      w(s.world),
      v(0, 0, 0),
      dummySpecFrom(TUNING.dummy, NO_SPAWN_PARAMS),
      attackerFromTuning(TUNING.attacker),
      { tuning: TUNING },
    );
    const player = s.world.spawn();
    giveCombatant(w(s.world), player, { health: 10, player: true });
    placeEntity(w(s.world), player, v(-2, 0, 0), 0.3);
    s.steps(1);
    expect(facingOf(w(s.world), attacker)).toEqual(v(-1, 0, 0));
    expect(s.world.get(attacker, HurtboxComponent)?.facing).toEqual(v(-1, 0, 0));
    // An attacker without hurtboxes or a placement still swings.
    s.world.remove(attacker, HurtboxComponent);
    s.steps(120);
    s.world.remove(attacker, PlacementComponent);
    s.steps(120);
    expect(s.started.map((e) => e.tick)).toEqual([0, 120, 240]);
  });

  it('skips a beat it cannot take (still busy, locked) rather than swinging late', () => {
    const s = sandboxWorld();
    const attacker = spawnAttackerDummy(
      w(s.world),
      v(0, 0, 0),
      dummySpecFrom(TUNING.dummy, NO_SPAWN_PARAMS),
      { ...attackerFromTuning(TUNING.attacker), periodTicks: 30 },
      { tuning: TUNING },
    );
    s.steps(1); // tick 0: swing starts (42 ticks long)
    s.steps(59); // tick 30 is skipped (busy); tick 60… ready
    expect(s.started.map((e) => e.tick)).toEqual([0]);
    s.steps(1); // tick 60
    expect(s.started.map((e) => e.tick)).toEqual([0, 60]);
    interruptAction(w(s.world), attacker, 50); // locked through tick 110
    s.steps(60); // ticks 61…120: 90 is locked
    expect(s.started.map((e) => e.tick)).toEqual([0, 60, 120]);
  });

  it('performs the variant its toggles name, and a disabled one stands still', () => {
    const s = sandboxWorld();
    const attacker = spawnAttackerDummy(
      w(s.world),
      v(0, 0, 0),
      dummySpecFrom(TUNING.dummy, NO_SPAWN_PARAMS),
      { ...attackerFromTuning(TUNING.attacker), parryable: false, unblockable: true },
      { tuning: TUNING },
    );
    s.steps(1);
    expect(actionOf(w(s.world), attacker)?.move).toBe('swing:unparryable:unblockable');
    s.steps(120, [sandboxCommand('attackers', { enabled: 'off' })]);
    expect(s.started).toHaveLength(1);
    const unknown: AttackerDummy = { ...attackerFromTuning(TUNING.attacker), move: 'gone' };
    s.world.set(attacker, AttackerDummyComponent, unknown);
    s.steps(120);
    expect(s.started).toHaveLength(1);
  });
});

describe('sandbox commands', () => {
  it('reconfigure every attacker and every dummy inside the tick', () => {
    const s = sandboxWorld();
    s.steps(1, [
      spawnCommand(ATTACKER_SPAWNABLE, 2, v(0, 0, 0)),
      spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 3)),
    ]);
    s.steps(1, [sandboxCommand('attackers', { every: '0.5', unblockable: 'on' })]);
    for (const id of sandboxEntities(s.world, true)) {
      expect(s.world.get(id, AttackerDummyComponent)).toMatchObject({
        periodTicks: 30,
        unblockable: true,
      });
    }
    s.steps(1, [sandboxCommand('dummies', { infinite: 'off' })]);
    for (const id of sandboxEntities(s.world)) {
      expect(s.world.get(id, SandboxDummyComponent)?.infiniteHealth).toBe(false);
      expect(s.world.has(id, UndyingComponent)).toBe(false);
    }
    s.steps(1, [sandboxCommand('dummies', { infinite: 'on' })]);
    s.steps(1, [sandboxCommand('dummies', { infinite: 'on' }), sandboxCommand('dummies', {})]);
    for (const id of sandboxEntities(s.world)) {
      expect(s.world.get(id, SandboxDummyComponent)?.infiniteHealth).toBe(true);
      expect(s.world.has(id, UndyingComponent)).toBe(true);
    }
    s.steps(2, [sandboxCommand('dummies', { infinite: 'off' })]);
    s.steps(1, [sandboxCommand('dummies', { infinite: 'off' })]);
  });

  it('skip commands with bad options; the console checks them up front', () => {
    const s = sandboxWorld();
    s.steps(1, [spawnCommand(ATTACKER_SPAWNABLE, 1, v(0, 0, 0))]);
    const other = sandboxWorld();
    other.steps(1, [spawnCommand(ATTACKER_SPAWNABLE, 1, v(0, 0, 0))]);
    const bad = [
      sandboxCommand('attackers', { every: 'soon' }),
      sandboxCommand('dummies', { infinite: 'maybe' }),
      sandboxCommand('dummies', { poise: '4' }),
    ];
    s.steps(1, bad);
    other.steps(1);
    expect(hashWorld(s.world)).toBe(hashWorld(other.world));
    expect(bad.map((c) => checkSandboxCommand(OPTIONS, c, 60))).toEqual([
      '--every must be a number 0.016666666666666666–3600, got "soon"',
      '--infinite must be on or off, got "maybe"',
      'unknown option --poise; expected --infinite',
    ]);
    expect(checkSandboxCommand(OPTIONS, sandboxCommand('attackers', { move: 'jab' }), 60)).toBe(
      undefined,
    );
    expect(isSandboxCommand(sandboxCommand('dummies', {}))).toBe(true);
    expect(isSandboxCommand({ kind: SANDBOX_COMMAND })).toBe(true);
    expect(isSandboxCommand({ kind: 'sim.debug' })).toBe(false);
    expect(isSandboxCommand(null)).toBe(false);
    expect(isSandboxCommand('sim.sandbox')).toBe(false);
  });

  it('a spawner or command that fails for another reason is a bug and throws', () => {
    const s = sandboxWorld();
    s.steps(1, [spawnCommand(ATTACKER_SPAWNABLE, 1, v(0, 0, 0))]);
    const broken = { ...sandboxCommand('attackers', {}), params: null };
    expect(() => {
      s.world.step([broken]);
    }).toThrow(TypeError);
  });
});

describe('infinite health', () => {
  it('AC-5: 10,000 damage never kills an infinite dummy; its health refills 180 ticks after the last hit', () => {
    const s = sandboxWorld();
    const damage = new DamageModel();
    const died: unknown[] = [];
    s.world.events.on(Died, (e) => died.push(e));
    s.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 0))]);
    const dummy = only(sandboxEntities(s.world));
    let dealt = 0;
    const hitters = s.world.spawn();
    s.world.addSystem({
      name: 'test-hits',
      run: ({ world, tick }) => {
        if (tick > 20 || dealt >= 10_000) return;
        dealt +=
          damage.apply(w(world), dummy, { amounts: { slash: 1000 }, instigator: hitters })?.total ??
          0;
      },
    });
    s.steps(20);
    expect(dealt).toBe(10_000);
    const lastHit = s.world.get(dummy, SandboxDummyComponent)?.lastHitAt ?? -1;
    expect(lastHit).toBe(10);
    expect(healthOf(w(s.world), dummy)?.current).toBe(1);
    expect(died).toEqual([]);
    s.steps(lastHit + 180 - s.world.tick);
    expect(healthOf(w(s.world), dummy)?.current).toBe(1); // tick lastHit + 179: not yet
    s.steps(1);
    expect(healthOf(w(s.world), dummy)).toEqual({ max: 1000, current: 1000 });
    s.steps(200);
    expect(s.world.get(dummy, HealthComponent)?.current).toBe(1000);
  });

  it('a mortal dummy dies; hits on other combatants are not tracked', () => {
    const s = sandboxWorld();
    s.steps(1, [spawnCommand(DUMMY_SPAWNABLE, 1, v(0, 0, 0), { infinite: 'off', health: '5' })]);
    const dummy = only(sandboxEntities(s.world));
    const bystander = s.world.spawn();
    giveCombatant(w(s.world), bystander, { health: 50 });
    const damage = new DamageModel();
    s.world.addSystem({
      name: 'test-hits',
      run: ({ world, tick }) => {
        if (tick !== 3) return;
        damage.apply(w(world), dummy, { amounts: { slash: 10 } });
        damage.apply(w(world), bystander, { amounts: { slash: 10 } });
      },
    });
    s.steps(400);
    expect(healthOf(w(s.world), dummy)?.current).toBe(0);
    expect(healthOf(w(s.world), bystander)?.current).toBe(40);
  });

  it('uninstalling stops tracking hits; the components are registered once', () => {
    const s = sandboxWorld();
    s.uninstall();
    const dummy = spawnSandboxDummy(
      w(s.world),
      v(0, 0, 0),
      dummySpecFrom(TUNING.dummy, NO_SPAWN_PARAMS),
      { tuning: TUNING, facing: v(0, 0, -2) },
    );
    s.steps(1);
    new DamageModel().apply(w(s.world), dummy, { amounts: { slash: 1 } });
    s.steps(1);
    expect(s.world.get(dummy, SandboxDummyComponent)?.lastHitAt).toBeNull();
    expect(facingOf(w(s.world), dummy)).toEqual(v(0, 0, -1));
    const again = new World<unknown>({ seed: 1 }).register(HitReactionComponent);
    installCombatSandbox(again, OPTIONS);
    expect(SANDBOX_COMPONENTS.every((type) => again.isRegistered(type))).toBe(true);
  });
});
