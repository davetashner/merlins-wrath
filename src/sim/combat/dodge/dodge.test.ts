import type {
  CancelTarget,
  ControllerTuning,
  Frozen,
  MoveTable,
  MoveVerb,
  RuntimeMotion,
  RuntimeMove,
  TickRange,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../../character/fake-collision-world';
import { box } from '../../character/greybox';
import { CharacterController } from '../../character/system';
import { World } from '../../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { installPlayer, PlayerLook } from '../../player/player';
import type { SceneSpawnPlacement } from '../../scene/layout';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { ActionRejected, type ActionRejection } from '../actions';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf, PoiseComponent } from '../damage/components';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  openHitbox,
  type HitboxSpec,
} from '../hits/components';
import { DodgedHit, HitboxHit, type HitboxHitInfo } from '../hits/events';
import { hitPacket, hitVolumeSystem, noAllies } from '../hits/system';
import { giveStamina, StaminaComponent, staminaOf, staminaSystem } from '../stamina';
import { ACTION_TIMELINE_COMPONENTS, giveActionInput, giveActionTimeline } from '../timeline';
import { ActionStarted, type ActionStartInfo } from '../timeline/events';
import { actionOf, actionTimelineSystem, requestMove, setTimeScale } from '../timeline/timeline';
import { DodgeComponent, dodgeOf, giveDodge } from './components';
import {
  DEFAULT_FACING,
  dodgeInputSystem,
  dodgeMotionSystem,
  iframeRule,
  iframesOf,
  inputDirection,
  isInvulnerable,
  requestDodge,
  type DodgeFacing,
} from './dodge';

interface MoveSpec {
  readonly id: string;
  readonly verb?: MoveVerb;
  readonly frames: readonly [number, number, number];
  readonly cost?: number;
  readonly windows?: readonly (TickRange & { into: CancelTarget; move?: string })[];
  readonly iframes?: TickRange;
  readonly motion?: RuntimeMotion;
}

/** A RuntimeMove as compileMove builds it (sim tests may not load content, so by hand). */
function move(spec: MoveSpec): RuntimeMove {
  const { id, verb = 'dodge', frames, cost = 0, windows = [] } = spec;
  const [startup, active, recovery] = frames;
  return Object.freeze({
    id,
    verb,
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: cost,
    cancelWindows: windows.map((w) => ({ ...w, move: w.move ?? null })),
    damage: null,
    hitbox: null,
    parryable: false,
    blockable: false,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: spec.iframes ?? null,
    telegraphTick: 0,
    chainNext: null,
    charge: null,
    motion: spec.motion ?? null,
    presentation: { anim: `anim-${id}` },
  });
}

// The shipped knight numbers (src/content/data/move/dodge-roll.json, backstep.json, roll-attack.json;
// tests/integration/dodge-replay.test.ts checks the shipped files against the bead).
const ROLL = move({
  id: 'dodge-roll',
  frames: [2, 13, 21],
  cost: 20,
  windows: [{ into: 'attack', from: 28, to: 35, move: 'roll-attack' }],
  iframes: { from: 2, to: 14 },
  motion: { distance: 3, direction: 'input' },
});
const BACKSTEP = move({
  id: 'backstep',
  frames: [2, 6, 16],
  cost: 12,
  iframes: { from: 2, to: 7 },
  motion: { distance: 1.2, direction: 'backward' },
});
const LIGHT = move({ id: 'sword-light-1', verb: 'attack', frames: [12, 4, 18], cost: 12 });
const ROLL_ATTACK = move({ id: 'roll-attack', verb: 'attack', frames: [10, 4, 20], cost: 14 });
const MOVES: MoveTable = new Map(
  [ROLL, BACKSTEP, LIGHT, ROLL_ATTACK].map((m) => [m.id, m] as const),
);
const KNIGHT_DODGE = { roll: 'dodge-roll', backstep: 'backstep' };

/** Overwrites part of `entity`'s stamina pool. */
function setStamina(
  world: World<ActionFrame>,
  entity: number,
  changes: { current: number; regenResumesAt?: number },
): void {
  const pool = staminaOf(world, entity);
  if (pool === undefined) throw new Error('no pool');
  world.set(entity, StaminaComponent, { ...pool, ...changes });
}

function press(button: ButtonAction | null, move: readonly [number, number] = [0, 0]) {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === button, b === button, false),
  });
}

const FORWARD_HELD = [0, 1] as const;

// A sphere around the knight's torso, from an attacker 1 m behind it (at z = −1, facing +z): it
// overlaps the knight's hurtbox on every sweep.
const STRIKE: HitboxSpec = {
  id: 'strike',
  shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.6 },
  track: {
    id: 'still',
    keys: [{ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
  },
  activeTicks: 1,
  aim: { x: 0, y: 0, z: 1 },
  friendlyFire: false,
};
const TEMPLATE = {
  amounts: { slash: 15 },
  poiseDamage: 15,
  staminaDamage: 20,
  impulse: { x: 0, y: 0, z: 0 },
  impactForce: 0,
  tags: [],
};

interface ArenaOptions {
  readonly facing?: DodgeFacing;
  readonly player?: boolean;
  readonly bindings?: Readonly<Partial<Record<ButtonAction, string>>>;
  readonly difficulty?: { readonly dodgeWindow: number };
}

/** A knight (dodge, stamina, timeline, hurtbox, health and poise) and an attacker 1 m away. */
function arena(options: ArenaOptions = {}) {
  const world = new World<ActionFrame>({
    seed: 7,
    ...(options.difficulty !== undefined && { difficulty: options.difficulty }),
  }).register(
    StaminaComponent,
    ...ACTION_TIMELINE_COMPONENTS,
    DodgeComponent,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const facing = options.facing ?? ((): Vec3 => DEFAULT_FACING);
  world
    .addSystem(staminaSystem())
    .addSystem(dodgeInputSystem({ facing }))
    .addSystem(actionTimelineSystem({ moves: MOVES }))
    .addSystem(dodgeMotionSystem({ moves: MOVES, facing }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies, invulnerable: iframeRule(MOVES) }));
  const damage = new DamageModel();
  const hits: HitboxHitInfo[] = [];
  const dodged: HitboxHitInfo[] = [];
  const started: ActionStartInfo[] = [];
  const rejected: ActionRejection[] = [];
  world.events.on(HitboxHit, (hit) => {
    hits.push(hit);
    damage.apply(world, hit.target, hitPacket(hit, TEMPLATE));
  });
  world.events.on(DodgedHit, (hit) => dodged.push(hit));
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(ActionRejected, (e) => rejected.push(e));

  const knight = world.spawn();
  placeEntity(world, knight, { x: 0, y: 0, z: 0 }, 0.4);
  giveHurtboxes(world, knight, {
    boxes: [
      {
        id: 'torso',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: 0.4, z: 0 },
          to: { x: 0, y: 1.4, z: 0 },
          radius: 0.4,
        },
      },
    ],
  });
  giveCombatant(world, knight, { health: 100, poise: 50, player: options.player ?? false });
  giveStamina(world, knight);
  giveActionTimeline(world, knight);
  giveDodge(world, knight, KNIGHT_DODGE);
  giveActionInput(world, knight, options.bindings ?? {});

  const attacker = world.spawn();
  placeEntity(world, attacker, { x: 0, y: 0, z: -1 }, 0.4);
  giveHitboxes(world, attacker);

  /** Steps one tick with `frame`; with `strike`, the attacker's hitbox sweeps the knight on it. */
  const step = (frame: ActionFrame = IDLE_ACTION_FRAME, strike = false) => {
    if (strike) openHitbox(world, attacker, STRIKE);
    world.step([frame]);
  };
  /** Steps idle until the world is about to run `tick`. */
  const until = (tick: number) => {
    while (world.tick < tick) step();
  };
  return { world, knight, attacker, damage, hits, dodged, started, rejected, step, until };
}

describe('dodge roll and backstep (mw-e04.8)', () => {
  it('AC-1: a roll started on tick 0 dodges a hit on tick 14 (DodgedHit, no damage or poise)', () => {
    const { world, knight, hits, dodged, started, step, until } = arena();
    step(press('dodge', FORWARD_HELD));
    expect(started.map((e) => [e.tick, e.move])).toEqual([[0, 'dodge-roll']]);
    until(14);
    step(IDLE_ACTION_FRAME, true);
    expect(hits).toEqual([]);
    expect(dodged).toHaveLength(1);
    expect(dodged[0]).toMatchObject({
      tick: 14,
      target: knight,
      hitbox: 'strike',
      region: 'torso',
    });
    expect(healthOf(world, knight)?.current).toBe(100);
    expect(world.get(knight, PoiseComponent)?.current).toBe(50);
  });

  it('AC-1: a hit on tick 15, the first tick after the i-frames, applies normally', () => {
    const { world, knight, hits, dodged, step, until } = arena();
    step(press('dodge', FORWARD_HELD));
    until(15);
    step(IDLE_ACTION_FRAME, true);
    expect(dodged).toEqual([]);
    expect(hits.map((h) => [h.tick, h.target])).toEqual([[15, knight]]);
    expect(healthOf(world, knight)?.current).toBe(85);
    expect(world.get(knight, PoiseComponent)?.current).toBe(35);
  });

  it('AC-1: the roll is invulnerable on exactly ticks 2–14 and costs 20 stamina', () => {
    const { world, knight, step } = arena();
    const invulnerable: number[] = [];
    for (let tick = 0; tick < 40; tick++) {
      step(tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME);
      if (isInvulnerable(world, knight, MOVES)) invulnerable.push(tick);
      if (tick === 0) expect(staminaOf(world, knight)?.current).toBe(80);
    }
    expect(invulnerable).toEqual(Array.from({ length: 13 }, (_, i) => i + 2));
  });

  it('AC-2: with no direction held, dodge backsteps for 12 stamina with i-frames on ticks 2–7 only', () => {
    const { world, knight, started, step } = arena();
    const invulnerable: number[] = [];
    for (let tick = 0; tick < 30; tick++) {
      step(tick === 0 ? press('dodge') : IDLE_ACTION_FRAME);
      if (tick === 0) expect(staminaOf(world, knight)?.current).toBe(88);
      if (isInvulnerable(world, knight, MOVES)) invulnerable.push(tick);
    }
    expect(started.map((e) => e.move)).toEqual(['backstep']);
    expect(invulnerable).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('AC-2: a backstep dodges a hit on tick 7 but not on tick 8', () => {
    for (const [tick, dodges] of [
      [7, true],
      [8, false],
    ] as const) {
      const { world, knight, hits, dodged, step, until } = arena();
      step(press('dodge'));
      until(tick);
      step(IDLE_ACTION_FRAME, true);
      expect(dodged.length).toBe(dodges ? 1 : 0);
      expect(hits.length).toBe(dodges ? 0 : 1);
      expect(healthOf(world, knight)?.current).toBe(dodges ? 100 : 85);
    }
  });

  it('AC-4: attack pressed on roll tick 26 is buffered and starts the roll attack on tick 28', () => {
    const { started, step, until } = arena({ bindings: { primaryAttack: 'sword-light-1' } });
    step(press('dodge', FORWARD_HELD));
    until(26);
    step(press('primaryAttack'));
    until(29);
    expect(started.map((e) => [e.tick, e.move, e.cancelled, e.chained])).toEqual([
      [0, 'dodge-roll', null, false],
      [28, 'roll-attack', 'dodge-roll', false],
    ]);
  });

  it('AC-4: attack pressed after the roll has ended starts the ordinary attack', () => {
    const { started, step, until } = arena({ bindings: { primaryAttack: 'sword-light-1' } });
    step(press('dodge', FORWARD_HELD));
    until(36);
    step(press('primaryAttack'));
    expect(started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'dodge-roll'],
      [36, 'sword-light-1'],
    ]);
  });

  it('a swing dodged once cannot catch the dodger later in the same window', () => {
    const { knight, attacker, hits, dodged, world, step, until } = arena();
    step(press('dodge', FORWARD_HELD));
    until(13);
    openHitbox(world, attacker, { ...STRIKE, activeTicks: 4 });
    for (let i = 0; i < 4; i++) step();
    expect(dodged.map((h) => [h.tick, h.target])).toEqual([[13, knight]]);
    expect(hits).toEqual([]);
  });

  it('a dodge with no stamina left is refused and gives no i-frames', () => {
    const { world, knight, started, rejected, step } = arena();
    setStamina(world, knight, { current: 0, regenResumesAt: 1000 });
    step(press('dodge', FORWARD_HELD));
    step();
    step();
    expect(started).toEqual([]);
    expect(rejected.map((r) => [r.action, r.reason])).toEqual([['dodge', 'stamina']]);
    expect(isInvulnerable(world, knight, MOVES)).toBe(false);
  });

  it('the last-action rule: a roll on 5 stamina still happens and drains to 0', () => {
    const { world, knight, started, step } = arena();
    setStamina(world, knight, { current: 5 });
    step(press('dodge', FORWARD_HELD));
    expect(started.map((e) => e.move)).toEqual(['dodge-roll']);
    expect(staminaOf(world, knight)?.current).toBe(0);
  });
});

describe('dodge direction and motion (mw-e04.8)', () => {
  it('maps held input to world directions relative to the facing', () => {
    const north = { x: 0, y: 0, z: -1 };
    expect(inputDirection(actionVector(0, 0), north)).toBeNull();
    expect(inputDirection(actionVector(0, 1), north)).toEqual({ x: 0, y: 0, z: -1 });
    expect(inputDirection(actionVector(1, 0), north)).toEqual({ x: 1, y: 0, z: 0 });
    expect(inputDirection(actionVector(-1, 0), north)).toEqual({ x: -1, y: 0, z: 0 });
    expect(inputDirection(actionVector(0, -1), north)).toEqual({ x: 0, y: 0, z: 1 });
    // Facing +x, "right" is +z; partial deflection still rolls a full unit direction.
    const east = { x: 1, y: 0, z: 0 };
    expect(inputDirection(actionVector(0.5, 0), east)).toEqual({ x: 0, y: 0, z: 1 });
    const diagonal = inputDirection(actionVector(0.3, 0.3), north);
    expect(diagonal?.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(diagonal?.z).toBeCloseTo(-Math.SQRT1_2, 12);
    for (const d of [
      inputDirection(actionVector(0, 1), north),
      inputDirection(actionVector(1, 0), east),
    ]) {
      expect(Object.is(d?.x, -0) || Object.is(d?.z, -0)).toBe(false);
    }
  });

  it('a roll moves 3.0 m along the held direction over its 13 active ticks and stands still otherwise', () => {
    const { world, knight, step } = arena();
    const speeds: number[] = [];
    let travelled = 0;
    for (let tick = 0; tick < 36; tick++) {
      step(tick === 0 ? press('dodge', [1, 0]) : IDLE_ACTION_FRAME);
      const velocity = dodgeOf(world, knight)?.velocity;
      if (velocity == null) throw new Error('no motion while rolling');
      expect(velocity.z).toBe(0);
      speeds.push(velocity.x);
      travelled += velocity.x / 60;
    }
    expect(speeds.slice(0, 2)).toEqual([0, 0]);
    expect(speeds.slice(2, 15).every((s) => s === (3 / 13) * 60)).toBe(true);
    expect(speeds.slice(15).every((s) => s === 0)).toBe(true);
    expect(travelled).toBeCloseTo(3, 12);
    step();
    expect(dodgeOf(world, knight)).toMatchObject({ motion: null, velocity: null });
  });

  it('a backstep travels 1.2 m away from the facing, whatever direction was held before', () => {
    const facing: DodgeFacing = () => ({ x: 1, y: 0, z: 0 });
    const { world, knight, step } = arena({ facing });
    step(press('dodge'));
    expect(dodgeOf(world, knight)?.motion?.direction).toEqual({ x: -1, y: 0, z: 0 });
    let travelled = 0;
    for (let tick = 1; tick < 24; tick++) {
      step();
      travelled -= (dodgeOf(world, knight)?.velocity?.x ?? 0) / 60;
    }
    expect(travelled).toBeCloseTo(1.2, 12);
  });

  it('commits the direction on the first tick: a later press does not steer the roll in progress', () => {
    const { world, knight, started, step, until } = arena();
    step(press('dodge', [1, 0]));
    until(5);
    step(press('dodge', [-1, 0])); // buffered, then dropped: the roll has no dodge cancel window
    expect(dodgeOf(world, knight)?.motion?.direction).toEqual({ x: 1, y: 0, z: 0 });
    expect(dodgeOf(world, knight)?.velocity?.x).toBeGreaterThan(0);
    until(40);
    expect(started.map((e) => e.move)).toEqual(['dodge-roll']);
  });

  it('a buffered roll that starts after the last one commits its own direction', () => {
    const { world, knight, started, step, until } = arena();
    step(press('dodge', [1, 0]));
    until(30);
    step(press('dodge', [-1, 0])); // 6 ticks before the roll ends: starts on 36
    until(38);
    expect(started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'dodge-roll'],
      [36, 'dodge-roll'],
    ]);
    expect(dodgeOf(world, knight)?.motion).toEqual({
      move: 'dodge-roll',
      startedAt: 36,
      direction: { x: -1, y: 0, z: 0 },
      moveTick: 1,
    });
  });

  it('a roll requested without a direction (AI, scripts) travels along the facing', () => {
    const { world, knight, step } = arena({ facing: () => undefined });
    step();
    requestMove(world, knight, 'dodge-roll');
    step();
    expect(dodgeOf(world, knight)?.motion?.direction).toEqual(DEFAULT_FACING);
  });

  it('requestDodge picks roll or backstep and needs a dodge', () => {
    const { world, knight, attacker } = arena();
    expect(requestDodge(world, knight, actionVector(0, 1))).toBe('dodge-roll');
    expect(dodgeOf(world, knight)?.requested).toEqual({ x: 0, y: 0, z: -1 });
    expect(requestDodge(world, knight, actionVector(0, 0), { x: 1, y: 0, z: 0 })).toBe('backstep');
    expect(dodgeOf(world, knight)?.requested).toBeNull();
    expect(() => requestDodge(world, attacker, actionVector(0, 1))).toThrow(/has no dodge/);
  });

  it('hit-stop freezes a roll in place; it moves on when the freeze ends', () => {
    const { world, knight, step } = arena();
    step(press('dodge', FORWARD_HELD));
    step();
    step(); // tick 2: first active tick
    setTimeScale(world, knight, 0, 3);
    for (let i = 0; i < 3; i++) {
      step();
      expect(dodgeOf(world, knight)?.velocity).toEqual({ x: 0, y: 0, z: 0 });
      expect(actionOf(world, knight)?.tick).toBe(2);
    }
    step();
    expect(actionOf(world, knight)?.tick).toBe(3);
    expect(dodgeOf(world, knight)?.velocity?.z).toBe(-(3 / 13) * 60);
  });

  it('a roll at half or double local speed still covers exactly 3.0 m', () => {
    for (const scale of [0.5, 2]) {
      const { world, knight, step } = arena();
      setTimeScale(world, knight, scale);
      step(press('dodge', FORWARD_HELD));
      let travelled = 0;
      for (let i = 0; i < 80; i++) {
        travelled -= (dodgeOf(world, knight)?.velocity?.z ?? 0) / 60;
        step();
      }
      expect(travelled).toBeCloseTo(3, 12);
    }
  });

  it('throws for a running move missing from its table', () => {
    const { world, knight, step } = arena();
    world.set(knight, ACTION_TIMELINE_COMPONENTS[0], {
      current: { move: 'nope', tick: 0, startedAt: 0 },
      lockTicks: 0,
      buffer: null,
      chain: null,
      timeScale: 0,
      scaleTicks: null,
      timeCarry: 0,
    });
    expect(() => {
      step();
    }).toThrow(/move "nope" is not in the dodge's move table/);
  });
});

describe('i-frames and difficulty (mw-e04.8)', () => {
  it('iframesOf scales the window length by dodgeWindow, never past the move', () => {
    expect(iframesOf(ROLL)).toEqual({ from: 2, to: 14 });
    expect(iframesOf(ROLL, 1)).toBe(ROLL.iframes);
    expect(iframesOf(ROLL, 2)).toEqual({ from: 2, to: 27 });
    expect(iframesOf(ROLL, 3)).toEqual({ from: 2, to: 35 });
    expect(iframesOf(ROLL, 0.5)).toEqual({ from: 2, to: 8 });
    expect(
      iframesOf(move({ id: 'x', frames: [0, 1, 0], iframes: { from: 0, to: 0 } }), 0.5),
    ).toEqual({
      from: 0,
      to: 0,
    });
    expect(iframesOf(LIGHT, 2)).toBeNull();
  });

  it('the player’s i-frames follow the dodgeWindow multiplier; other entities keep the authored window', () => {
    const count = (options: ArenaOptions) => {
      const { world, knight, step } = arena(options);
      let n = 0;
      for (let tick = 0; tick < 36; tick++) {
        step(tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME);
        if (isInvulnerable(world, knight, MOVES)) n++;
      }
      return n;
    };
    expect(count({ player: true })).toBe(13);
    expect(count({ player: true, difficulty: { dodgeWindow: 1.5 } })).toBe(20);
    expect(count({ player: false, difficulty: { dodgeWindow: 1.5 } })).toBe(13);
  });

  it('nothing is invulnerable while idle or during a move without i-frames', () => {
    const { world, knight, step } = arena({ bindings: { primaryAttack: 'sword-light-1' } });
    expect(isInvulnerable(world, knight, MOVES)).toBe(false);
    step(press('primaryAttack'));
    expect(actionOf(world, knight)?.move).toBe('sword-light-1');
    expect(isInvulnerable(world, knight, MOVES)).toBe(false);
  });
});

// AC-3 through the player controller: installPlayer with combat and an in-memory wall.
const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

/** A player start at the origin facing −z (scene yaw 180). */
const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

function walled(shapes: Parameters<typeof box>[] = []) {
  const collision = new FakeCollisionWorld([
    box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }), // floor, top at y = 0
    ...shapes.map((s) => box(...s)),
  ]);
  const world = new World<ActionFrame>({ seed: 5 }).register(...DAMAGE_COMPONENTS);
  const player = installPlayer(world, {
    spawns: [START],
    collision,
    tuning: TUNING,
    combat: { moves: MOVES },
  });
  world.step([IDLE_ACTION_FRAME]); // settle onto the floor
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  return { world, player, state };
}

describe('dodge through the player controller (mw-e04.8)', () => {
  it('AC-3: a roll towards a wall 1 m away stops at the wall and the i-frames still run through tick 14', () => {
    // The wall's face is 1 m in front of the player (along −z); it is taller than a step.
    const { world, player, state } = walled([
      [
        { x: -5, y: 0, z: -3 },
        { x: 5, y: 3, z: -1 },
      ],
    ]);
    const start = world.tick;
    const invulnerable: number[] = [];
    const z: number[] = [];
    for (let tick = 0; tick < 36; tick++) {
      world.step([tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME]);
      z.push(state().position.z);
      if (isInvulnerable(world, player, MOVES)) invulnerable.push(world.tick - 1 - start);
    }
    expect(invulnerable).toEqual(Array.from({ length: 13 }, (_, i) => i + 2));
    // Stopped by the wall: the capsule (radius 0.35) rests a skin short of its face, 0.64 m on.
    const final = z.at(-1) ?? 0;
    expect(final).toBeCloseTo(-1 + 0.35 + 0.01, 3);
    expect(Math.min(...z)).toBeGreaterThanOrEqual(final - 1e-9);
    expect(state().grounded).toBe(true);
  });

  it('AC-3: in the open the same roll travels the full 3.0 m and then stands still', () => {
    const { world, state } = walled();
    const from = state().position;
    for (let tick = 0; tick < 36; tick++) {
      world.step([tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME]);
    }
    const to = state().position;
    expect(Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2)).toBeCloseTo(3, 9);
    expect(state().velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a roll is relative to the camera: facing +x, input forward rolls along +x', () => {
    const { world, player, state } = walled();
    world.set(player, PlayerLook, { yaw: -Math.PI / 2, pitch: 0 });
    const from = state().position;
    for (let tick = 0; tick < 20; tick++) {
      world.step([tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME]);
    }
    expect(state().position.x - from.x).toBeCloseTo(3, 6);
    expect(state().position.z - from.z).toBeCloseTo(0, 6);
  });

  it('another entity with a dodge in the player’s world ignores the frame, and without a look faces −z', () => {
    const { world } = walled();
    const other = world.spawn();
    giveActionTimeline(world, other);
    giveDodge(world, other, KNIGHT_DODGE);
    world.step([IDLE_ACTION_FRAME]);
    // The frame drives the player only: without an ActionInput the other entity ignores the press.
    world.step([press('dodge', [1, 0])]);
    expect(actionOf(world, other)).toBeUndefined();
    requestMove(world, other, 'dodge-roll');
    world.step([IDLE_ACTION_FRAME]);
    expect(dodgeOf(world, other)?.motion?.direction).toEqual(DEFAULT_FACING);
  });

  it('rolling off a ledge is allowed: the roll carries over the edge and falls', () => {
    // A 1 m-high platform whose edge is 1 m ahead of the player standing on it.
    const collision = new FakeCollisionWorld([
      box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }),
      box({ x: -5, y: 0, z: -1 }, { x: 5, y: 1, z: 5 }),
    ]);
    const world = new World<ActionFrame>({ seed: 5 }).register(...DAMAGE_COMPONENTS);
    const player = installPlayer(world, {
      spawns: [{ ...START, position: { x: 0, y: 1, z: 0 } }],
      collision,
      tuning: TUNING,
      combat: { moves: MOVES },
    });
    world.step([IDLE_ACTION_FRAME]);
    const states = [];
    for (let tick = 0; tick < 60; tick++) {
      world.step([tick === 0 ? press('dodge', FORWARD_HELD) : IDLE_ACTION_FRAME]);
      states.push(world.get(player, CharacterController));
    }
    expect(states.some((s) => s?.grounded === false)).toBe(true);
    const last = states.at(-1);
    expect(last?.grounded).toBe(true);
    expect(last?.position.y).toBeCloseTo(0.01, 6);
    expect(last?.position.z).toBeLessThan(-1.5);
  });

  it('replays deterministically: the same frames give the same state hash', () => {
    const run = () => {
      const { world } = walled([
        [
          { x: -5, y: 0, z: -3 },
          { x: 5, y: 3, z: -1 },
        ],
      ]);
      for (let tick = 0; tick < 50; tick++) {
        const frame =
          tick === 0
            ? press('dodge', FORWARD_HELD)
            : tick === 40
              ? press('dodge')
              : IDLE_ACTION_FRAME;
        world.step([frame]);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
