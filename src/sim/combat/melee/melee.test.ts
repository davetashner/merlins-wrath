import type { MoveTable, MoveVerb, RuntimeMove, RuntimeShield } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { atan2, cos, sin } from '../../math';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf, poiseOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import type { DamagePacketInput } from '../damage/packet';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  liveHitboxes,
  type Hurtbox,
  type SocketTrack,
} from '../hits/components';
import { HitboxHit } from '../hits/events';
import { hitVolumeSystem, noAllies } from '../hits/system';
import {
  DEFAULT_STAMINA_PROFILE,
  giveStamina,
  StaminaComponent,
  staminaOf,
  staminaSystem,
} from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionInput,
  giveActionTimeline,
} from '../timeline/components';
import { ActionStarted, type ActionStartInfo } from '../timeline/events';
import {
  actionOf,
  actionTimelineSystem,
  canActNow,
  interruptAction,
  requestMove,
} from '../timeline/timeline';
import {
  CombatFacingComponent,
  FORWARD_FACING,
  facingOf,
  giveFacing,
  giveGuard,
  guardOf,
  isBlocking,
  lowerGuard,
  MELEE_COMPONENTS,
  setBlockHeld,
} from './components';
import { GuardBroken, type GuardBreak } from './events';
import {
  ATTACK_TURN_DEGREES_PER_SECOND,
  faceTarget,
  facingSystem,
  firstFacing,
  keepFacing,
  turnToward,
  type FacingRule,
} from './facing';
import {
  blockSystem,
  DEFAULT_BLOCK_BUTTON,
  GUARD_BREAK_STAGGER_TICKS,
  inGuardArc,
  locomotionScale,
  shieldGuard,
} from './guard';
import { installMeleeStrikes } from './strikes';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// The wood shield (src/content/data/shield/wood-shield.json).
const WOOD: RuntimeShield = Object.freeze({
  id: 'wood-shield',
  absorption: Object.freeze({ slash: 85, pierce: 85, blunt: 85, fire: 30 }),
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
});

interface MoveSpec {
  readonly id: string;
  readonly verb?: MoveVerb;
  readonly frames: readonly [number, number, number];
  readonly cost?: number;
  readonly slash?: number;
  readonly poise?: number;
  readonly chainNext?: string;
  readonly unblockable?: boolean;
  readonly windows?: RuntimeMove['cancelWindows'];
  readonly impulse?: Vec3;
}

/** A RuntimeMove as compileMove builds it; a blade held still at chest height in front. */
function move(spec: MoveSpec): RuntimeMove {
  const { id, verb = 'attack', frames, cost = 0, slash = 0, poise = 0 } = spec;
  const [startup, active, recovery] = frames;
  const canHit = verb === 'attack';
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
    cancelWindows: spec.windows ?? [],
    damage: canHit
      ? {
          amounts: { slash },
          poiseDamage: poise,
          staminaDamage: 12,
          impulse: spec.impulse ?? { x: 0, y: 0, z: 0 },
          impactForce: 0,
          tags: [],
        }
      : null,
    hitbox: canHit
      ? {
          track: `${id}-track`,
          shape: {
            kind: 'capsule',
            from: v3(0.35, 1.2, 0.35),
            to: v3(0.35, 1.2, 1.45),
            radius: 0.08,
          },
          reach: 'medium',
          swing: 'horizontal',
        }
      : null,
    parryable: canHit,
    blockable: canHit && spec.unblockable !== true,
    unblockable: canHit && spec.unblockable === true,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    chainNext: spec.chainNext ?? null,
    charge: null,
    presentation: { anim: `anim-${id}` },
    motion: null,
  } satisfies RuntimeMove);
}

// The knight's light chain (bead mw-e04.6), a roll, a slam that passes shields, and a guarded stance.
const L1 = move({
  id: 'light-1',
  frames: [12, 4, 18],
  cost: 12,
  slash: 20,
  poise: 15,
  chainNext: 'light-2',
});
const L2 = move({
  id: 'light-2',
  frames: [10, 4, 20],
  cost: 14,
  slash: 22,
  poise: 15,
  chainNext: 'light-3',
});
const L3 = move({ id: 'light-3', frames: [16, 5, 26], cost: 18, slash: 30, poise: 30 });
const ROLL = move({ id: 'roll', verb: 'dodge', frames: [2, 13, 21], cost: 20 });
const SLAM = move({
  id: 'slam',
  frames: [4, 2, 4],
  slash: 10,
  unblockable: true,
  impulse: v3(0, 0, 100),
});
const POKE = move({
  id: 'poke',
  frames: [2, 2, 10],
  slash: 1,
  windows: [{ into: 'block', from: 6, to: 13, move: null }],
});
const MOVES: MoveTable = new Map([L1, L2, L3, ROLL, SLAM, POKE].map((m) => [m.id, m]));
const TRACKS = new Map<string, SocketTrack>(
  [...MOVES.values()].map((m) => [`${m.id}-track`, { id: `${m.id}-track`, keys: [IDENTITY_POSE] }]),
);

const torso: Hurtbox = {
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.4 },
};

const frame = (pressed: readonly ButtonAction[], held: readonly ButtonAction[] = []) =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });

interface Options {
  readonly desired?: FacingRule;
  readonly stamina?: boolean;
  readonly regen?: boolean;
}

function setup(options: Options = {}) {
  const world = new World<ActionFrame>({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const damage = new DamageModel();
  damage.register(shieldGuard());
  world
    .addSystem(staminaSystem())
    .addSystem(blockSystem({ moves: MOVES }))
    .addSystem(actionTimelineSystem({ moves: MOVES }))
    .addSystem(facingSystem({ moves: MOVES, desired: options.desired ?? keepFacing }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies }));
  const uninstall = installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  const knight = world.spawn();
  placeEntity(world, knight, v3(0, 0, 0), 0.35);
  giveActionTimeline(world, knight);
  if (options.stamina ?? true) {
    const profile =
      options.regen === false ? { ...DEFAULT_STAMINA_PROFILE, regenPerSecond: 0 } : undefined;
    giveStamina(world, knight, profile);
  }
  giveFacing(world, knight);
  giveGuard(world, knight, WOOD);
  giveHitboxes(world, knight);
  giveCombatant(world, knight, { health: 100, poise: 50 });
  giveActionInput(world, knight, { primaryAttack: 'light-1', ability1: 'roll', ability2: 'slam' });
  const dummy = world.spawn();
  placeEntity(world, dummy, v3(0, 0, 1), 0.4);
  giveHurtboxes(world, dummy, { boxes: [torso] });
  giveCombatant(world, dummy, { health: 500 });

  const started: ActionStartInfo[] = [];
  const applied: DamageResult[] = [];
  const breaks: GuardBreak[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(DamageApplied, (e) => applied.push(e));
  world.events.on(GuardBroken, (e) => breaks.push(e));
  /** Steps until `tick` is the next tick to simulate, feeding `input` every tick. */
  const stepTo = (tick: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    while (world.tick < tick) world.step([input]);
  };
  /** Presses `button` on world tick `tick` (after stepping idle up to it). */
  const pressAt = (tick: number, button: ButtonAction) => {
    stepTo(tick);
    world.step([frame([button])]);
  };
  /** Holds block until `tick`. */
  const blockTo = (tick: number) => {
    stepTo(tick, frame([], [DEFAULT_BLOCK_BUTTON]));
  };
  /** A hit on the knight travelling along `direction`, applied between ticks. */
  const hitKnight = (input: Partial<DamagePacketInput>) => {
    const result = damage.apply(world, knight, {
      instigator: dummy,
      amounts: { slash: 30 },
      staminaDamage: 20,
      poiseDamage: 20,
      direction: v3(0, 0, -1),
      ...input,
    });
    world.events.flush();
    return result;
  };
  return {
    world,
    damage,
    knight,
    dummy,
    started,
    applied,
    breaks,
    stepTo,
    pressAt,
    blockTo,
    hitKnight,
    uninstall,
  };
}

const stamina = (s: ReturnType<typeof setup>) => staminaOf(s.world, s.knight)?.current;
const health = (world: World<never>, e: EntityId) => healthOf(world, e)?.current;

describe('knight light chain (mw-e04.6)', () => {
  it('AC-1: three presses inside each buffer window run L1→L2→L3 for 44 stamina; the next press is L1', () => {
    const s = setup({ regen: false });
    s.pressAt(0, 'primaryAttack'); // L1 0–33
    s.pressAt(30, 'primaryAttack'); // buffered: L2 on 34, ends 68
    s.pressAt(65, 'primaryAttack'); // buffered: L3 on 68, ends 115
    s.stepTo(115);
    expect(stamina(s)).toBe(100 - 44);
    s.pressAt(115, 'primaryAttack');
    expect(s.started.map((e) => [e.tick, e.move, e.chained])).toEqual([
      [0, 'light-1', false],
      [34, 'light-2', true],
      [68, 'light-3', true],
      [115, 'light-1', false],
    ]);
    expect(stamina(s)).toBe(100 - 44 - 12);
  });

  it('the chain resets to L1 after 30 idle ticks past recovery', () => {
    const s = setup();
    s.pressAt(0, 'primaryAttack'); // ends 34
    s.pressAt(34 + 29, 'primaryAttack'); // L2
    s.stepTo(63 + 34 + 30);
    s.pressAt(63 + 34 + 30, 'primaryAttack'); // 30 idle ticks after L2: L1 again
    expect(s.started.map((e) => e.move)).toEqual(['light-1', 'light-2', 'light-1']);
  });

  it('AC-6 (unit): L1 strikes the dummy on its first active tick, 12, for 20 slash and 15 poise', () => {
    const s = setup();
    s.pressAt(0, 'primaryAttack');
    s.stepTo(40);
    expect(s.applied).toHaveLength(1);
    const [hit] = s.applied;
    expect(hit).toMatchObject({ tick: 12, target: s.dummy, total: 20, poiseDamage: 15 });
    expect(hit?.packet).toMatchObject({
      instigator: s.knight,
      source: s.knight,
      direction: { x: 0, y: 0, z: 1 },
      region: 'torso',
      tags: [],
    });
    expect(health(s.world, s.dummy)).toBe(480);
  });

  it('the three hits deal 20 + 22 + 30 = 72 to the dummy', () => {
    const s = setup();
    s.pressAt(0, 'primaryAttack');
    s.pressAt(30, 'primaryAttack');
    s.pressAt(65, 'primaryAttack');
    s.stepTo(120);
    expect(s.applied.map((r) => [r.tick, r.total])).toEqual([
      [12, 20],
      [34 + 10, 22],
      [68 + 16, 30],
    ]);
    expect(health(s.world, s.dummy)).toBe(500 - 72);
  });

  it('an interrupted swing closes its hitbox; a cancelled or completed one leaves nothing open', () => {
    const s = setup();
    s.stepTo(1);
    placeEntity(s.world, s.dummy, v3(0, 0, 30)); // out of reach: the hitbox stays open all window
    s.pressAt(1, 'primaryAttack');
    s.stepTo(14); // active since 13
    expect(liveHitboxes(s.world, s.knight).map((h) => h.id)).toEqual(['light-1']);
    interruptAction(s.world, s.knight, 0);
    s.world.events.flush();
    expect(liveHitboxes(s.world, s.knight)).toEqual([]);
    s.pressAt(20, 'ability1'); // a roll has no hitbox
    s.stepTo(60);
    expect(liveHitboxes(s.world, s.knight)).toEqual([]);
  });

  it('an unblockable move is tagged so; its impulse turns into the world with the facing', () => {
    const s = setup();
    giveFacing(s.world, s.knight, v3(1, 0, 0));
    placeEntity(s.world, s.dummy, v3(1, 0, 0));
    s.pressAt(0, 'ability2');
    s.stepTo(10);
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]?.packet.tags).toEqual(['unblockable']);
    expect(s.applied[0]?.packet.impulse).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('fighters without hitboxes open none, foreign hitboxes deal no move damage, and uninstall stops it', () => {
    const s = setup();
    const other = s.world.spawn();
    giveActionTimeline(s.world, other);
    s.stepTo(1);
    requestMove(s.world, other, 'light-1');
    s.stepTo(20);
    expect(liveHitboxes(s.world, other)).toEqual([]);
    s.world.events.emit(HitboxHit, {
      tick: 20,
      attacker: other,
      hitbox: 'not-a-move',
      activeTick: 1,
      target: s.dummy,
      hurtbox: 'torso',
      region: 'torso',
      multiplier: 1,
      armored: false,
      direction: v3(0, 0, 1),
    });
    s.world.events.emit(HitboxHit, {
      tick: 20,
      attacker: other,
      hitbox: 'roll',
      activeTick: 1,
      target: s.dummy,
      hurtbox: 'torso',
      region: 'torso',
      multiplier: 1,
      armored: false,
      direction: v3(0, 0, 1),
    });
    s.world.events.flush();
    expect(s.applied).toEqual([]);
    s.uninstall();
    s.pressAt(20, 'primaryAttack');
    s.stepTo(60);
    expect(s.applied).toEqual([]);
  });
});

describe('knight block (mw-e04.6)', () => {
  it('AC-2: a frontal 30-slash hit with staminaDamage 20 on a shield up ≥ 6 ticks costs 4.5 health and 8 stamina', () => {
    const s = setup();
    s.blockTo(6);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(0);
    const result = s.hitKnight({});
    expect(health(s.world, s.knight)).toBe(95.5);
    expect(stamina(s)).toBe(92);
    expect(result).toMatchObject({ total: 4.5, poiseDamage: 0, tags: ['blocked'] });
    expect(poiseOf(s.world, s.knight)?.current).toBe(50);
    expect(s.breaks).toEqual([]);
  });

  it('AC-3: a hit from outside the frontal 120° arc lands in full and drains nothing', () => {
    for (const direction of [v3(0, 0, 1), v3(1, 0, 0), v3(-1, 0, -0.5)]) {
      const s = setup();
      s.blockTo(10);
      const result = s.hitKnight({ direction });
      expect(health(s.world, s.knight)).toBe(70);
      expect(stamina(s)).toBe(100);
      expect(result?.tags).toEqual([]);
    }
  });

  it('AC-3: the arc is 60° either side of the facing, edges included', () => {
    const edge = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      return v3(-sin(a), 0, -cos(a)); // travelling toward the knight from `degrees` off its facing
    };
    const guard = { shield: WOOD, held: true, raisedAt: 0 };
    expect(inGuardArc(guard, FORWARD_FACING, edge(0))).toBe(true);
    expect(inGuardArc(guard, FORWARD_FACING, edge(60))).toBe(true);
    expect(inGuardArc(guard, FORWARD_FACING, edge(-60))).toBe(true);
    expect(inGuardArc(guard, FORWARD_FACING, edge(61))).toBe(false);
    expect(inGuardArc(guard, FORWARD_FACING, v3(0, -1, 0))).toBe(false); // straight down
  });

  it('AC-4: a shield raised only 3 ticks does not block yet', () => {
    const s = setup();
    s.blockTo(3);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(0);
    s.hitKnight({});
    expect(health(s.world, s.knight)).toBe(70);
    expect(stamina(s)).toBe(100);
    const guard = guardOf(s.world, s.knight);
    if (guard === undefined) throw new Error('no guard');
    expect([5, 6].map((t) => isBlocking(guard, t))).toEqual([false, true]);
  });

  it('AC-5: at 8 stamina a 20-staminaDamage block empties it, breaks the guard and staggers 60 ticks', () => {
    const s = setup();
    s.blockTo(10);
    const pool = staminaOf(s.world, s.knight);
    if (pool === undefined) throw new Error('no pool');
    s.world.set(s.knight, StaminaComponent, { ...pool, current: 8 });
    const result = s.hitKnight({});
    expect(stamina(s)).toBe(0);
    expect(s.breaks).toEqual([
      {
        tick: 10,
        entity: s.knight,
        instigator: s.dummy,
        source: null,
        staggerTicks: GUARD_BREAK_STAGGER_TICKS,
      },
    ]);
    expect(GUARD_BREAK_STAGGER_TICKS).toBe(60);
    // Stamina covered the whole drain, so the unabsorbed remainder is the shield's 15%.
    expect(result).toMatchObject({ total: 4.5, tags: ['blocked', 'guard-break'] });
    expect(health(s.world, s.knight)).toBe(95.5);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBeNull();
    // Staggered: nothing starts and the shield stays down for 60 ticks, block held throughout.
    s.world.step([frame(['primaryAttack'], [DEFAULT_BLOCK_BUTTON])]);
    s.blockTo(10 + 59);
    expect(canActNow(s.world, s.knight, MOVES, 'block')).toBe(false);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBeNull();
    s.blockTo(10 + 60);
    expect(canActNow(s.world, s.knight, MOVES, 'block')).toBe(true);
    expect(s.started).toEqual([]);
    s.blockTo(10 + 61);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(70);
  });

  it('AC-5: a drain stamina cannot cover lets the unpaid share of the hit through', () => {
    const s = setup();
    s.blockTo(10);
    const pool = staminaOf(s.world, s.knight);
    if (pool === undefined) throw new Error('no pool');
    s.world.set(s.knight, StaminaComponent, { ...pool, current: 4 });
    const result = s.hitKnight({});
    // Half the drain paid: half the 85% absorbed → 30 × (1 − 0.425) = 17.25.
    expect(result?.total).toBe(17.25);
    expect(s.breaks).toHaveLength(1);
  });

  it('the guard break interrupts a move in a block window and drops its buffered request', () => {
    const poke = setup();
    poke.world.step([frame([])]);
    requestMove(poke.world, poke.knight, 'poke');
    poke.stepTo(9, frame([], [DEFAULT_BLOCK_BUTTON])); // from poke tick 6: its block window
    expect(guardOf(poke.world, poke.knight)?.raisedAt).toBe(8);
    poke.stepTo(14, frame([], [DEFAULT_BLOCK_BUTTON]));
    const pool = staminaOf(poke.world, poke.knight);
    if (pool === undefined) throw new Error('no pool');
    poke.world.set(poke.knight, StaminaComponent, { ...pool, current: 1 });
    poke.hitKnight({});
    expect(actionOf(poke.world, poke.knight)).toBeUndefined();
    expect(poke.world.get(poke.knight, ActionTimelineComponent)?.lockTicks).toBe(60);
  });

  it('fire is 30% absorbed, unlisted types pass; no drain means full absorption and no break', () => {
    const s = setup();
    s.blockTo(10);
    const result = s.hitKnight({ amounts: { fire: 10, frost: 10, slash: 10 }, staminaDamage: 0 });
    expect(result?.amounts).toEqual({ slash: 1.5, fire: 7, frost: 10 });
    expect(stamina(s)).toBe(100);
    const pool = staminaOf(s.world, s.knight);
    if (pool === undefined) throw new Error('no pool');
    s.world.set(s.knight, StaminaComponent, { ...pool, current: 0 });
    s.hitKnight({ staminaDamage: 0 });
    expect(s.breaks).toEqual([]);
  });

  it('unblockable, directionless and unguarded hits pass the shield', () => {
    const s = setup();
    s.blockTo(10);
    expect(s.hitKnight({ tags: ['unblockable'] })?.total).toBe(30);
    expect(
      s.damage.apply(s.world, s.knight, { amounts: { slash: 30 }, staminaDamage: 20 })?.total,
    ).toBe(30);
    const bare = s.world.spawn();
    giveCombatant(s.world, bare, { health: 50 });
    expect(
      s.damage.apply(s.world, bare, { amounts: { slash: 5 }, direction: v3(0, 0, -1) })?.total,
    ).toBe(5);
    expect(stamina(s)).toBe(100);
  });

  it('a blocker without a stamina pool absorbs every hit and never breaks', () => {
    const s = setup({ stamina: false });
    s.blockTo(10);
    expect(s.hitKnight({ staminaDamage: 500 })?.total).toBe(4.5);
    expect(s.breaks).toEqual([]);
  });

  it('the shield is up only while held and free to block; a move lowers it; blocking slows regen', () => {
    const s = setup();
    s.blockTo(2);
    expect(staminaOf(s.world, s.knight)?.blocking).toBe(true);
    s.world.step([frame(['primaryAttack'], [DEFAULT_BLOCK_BUTTON])]); // the swing starts…
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(0);
    s.world.step([frame([], [DEFAULT_BLOCK_BUTTON])]); // …and lowers the shield on the next tick
    expect(guardOf(s.world, s.knight)).toMatchObject({ held: true, raisedAt: null });
    expect(staminaOf(s.world, s.knight)?.blocking).toBe(false);
    s.stepTo(40); // released
    expect(guardOf(s.world, s.knight)).toMatchObject({ held: false, raisedAt: null });
    s.blockTo(41);
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(40);
  });

  it('a move’s cancel window into block lets the shield up mid-move', () => {
    const s = setup();
    s.world.step([IDLE_ACTION_FRAME]);
    requestMove(s.world, s.knight, 'poke');
    // The block system runs before the timeline, so on world tick t it sees poke tick t − 2.
    s.stepTo(8, frame([], [DEFAULT_BLOCK_BUTTON])); // poke ticks 0–5: no window yet
    expect(guardOf(s.world, s.knight)?.raisedAt).toBeNull();
    s.stepTo(9, frame([], [DEFAULT_BLOCK_BUTTON])); // poke tick 6
    expect(guardOf(s.world, s.knight)?.raisedAt).toBe(8);
  });

  it('AI holds the block with setBlockHeld; frames drive only fighters with bindings', () => {
    const s = setup();
    const ai = s.world.spawn();
    giveActionTimeline(s.world, ai);
    giveGuard(s.world, ai, WOOD);
    s.stepTo(1, frame([], [DEFAULT_BLOCK_BUTTON]));
    expect(guardOf(s.world, ai)?.raisedAt).toBeNull();
    setBlockHeld(s.world, ai, true);
    setBlockHeld(s.world, ai, true);
    s.stepTo(2);
    expect(guardOf(s.world, ai)).toMatchObject({ held: true, raisedAt: 1 });
    s.world.step([]); // no frame: the knight keeps what it held
    expect(guardOf(s.world, ai)?.raisedAt).toBe(1);
    lowerGuard(s.world, ai);
    lowerGuard(s.world, ai);
    expect(guardOf(s.world, ai)?.raisedAt).toBeNull();
    expect(() => {
      setBlockHeld(s.world, s.dummy, true);
    }).toThrow('has no guard');
    expect(() => {
      lowerGuard(s.world, s.dummy);
    }).toThrow('has no guard');
  });

  it('locomotion: planted while attacking, the shield’s speed while it is up, else full', () => {
    const s = setup();
    expect(locomotionScale(s.world, s.knight, MOVES)).toBe(1);
    s.blockTo(1);
    expect(locomotionScale(s.world, s.knight, MOVES)).toBe(0.5);
    s.pressAt(5, 'primaryAttack');
    expect(locomotionScale(s.world, s.knight, MOVES)).toBe(0);
    s.stepTo(40);
    s.pressAt(40, 'ability1');
    expect(locomotionScale(s.world, s.knight, MOVES)).toBe(1);
    expect(locomotionScale(s.world, s.dummy, MOVES)).toBe(1);
  });
});

describe('knight facing (mw-e04.6)', () => {
  const east = v3(1, 0, 0);
  const toward =
    (d: Vec3): FacingRule =>
    () =>
      d;
  const angleOf = (f: Vec3) => (atan2(f.x, f.z) * 180) / Math.PI;

  it('idle fighters face where they want at once', () => {
    const s = setup({ desired: toward(v3(2, 0, 0)) });
    s.stepTo(1);
    expect(facingOf(s.world, s.knight)).toEqual(east);
  });

  it('during startup the fighter turns at most 6° a tick (360°/s); from the active tick it is locked', () => {
    let want = FORWARD_FACING;
    const s = setup({ desired: () => want });
    s.pressAt(0, 'primaryAttack'); // startup 0–11
    want = east;
    s.stepTo(5); // ticks 1–4 turned
    expect(angleOf(facingOf(s.world, s.knight))).toBeCloseTo(24, 9);
    s.stepTo(12); // ticks 5–11 turned: 66°
    expect(angleOf(facingOf(s.world, s.knight))).toBeCloseTo(66, 9);
    s.stepTo(34); // active and recovery: locked
    expect(angleOf(facingOf(s.world, s.knight))).toBeCloseTo(66, 9);
    expect(liveHitboxes(s.world, s.knight)).toEqual([]);
    s.stepTo(35); // idle again
    expect(facingOf(s.world, s.knight)).toEqual(east);
    expect(ATTACK_TURN_DEGREES_PER_SECOND).toBe(360);
  });

  it('the hitbox commits to the facing startup ended on', () => {
    let want = FORWARD_FACING;
    const s = setup({ desired: () => want });
    s.pressAt(0, 'primaryAttack');
    want = east;
    s.stepTo(13);
    const aim = liveHitboxes(s.world, s.knight)[0]?.aim;
    expect(angleOf(aim ?? FORWARD_FACING)).toBeCloseTo(66, 9);
  });

  it('keepFacing, faceTarget and firstFacing', () => {
    const s = setup();
    s.stepTo(1);
    expect(facingOf(s.world, s.knight)).toEqual(FORWARD_FACING);
    const lock = faceTarget((_w, e) => (e === s.knight ? s.dummy : undefined));
    expect(lock(s.world, s.knight)).toEqual({ x: 0, y: 0, z: 1 });
    expect(lock(s.world, s.dummy)).toBeUndefined();
    const unplaced = s.world.spawn();
    expect(faceTarget(() => unplaced)(s.world, s.knight)).toBeUndefined();
    expect(faceTarget(() => s.knight)(s.world, unplaced)).toBeUndefined();
    expect(faceTarget(() => s.knight)(s.world, s.knight)).toBeUndefined(); // same spot
    const rule = firstFacing(keepFacing, lock, toward(east));
    expect(rule(s.world, s.knight)).toEqual({ x: 0, y: 0, z: 1 });
    expect(rule(s.world, s.dummy)).toEqual(east);
    expect(firstFacing(keepFacing)(s.world, s.knight)).toBeUndefined();
  });

  it('turnToward turns the short way and lands exactly on the target', () => {
    const step = Math.PI / 30;
    const left = turnToward(FORWARD_FACING, v3(-1, 0, 0), step);
    expect(angleOf(left)).toBeCloseTo(-6, 9);
    expect(turnToward(FORWARD_FACING, east, Math.PI)).toEqual(east);
  });

  it('rejects a bad turn rate and moves missing from the table', () => {
    for (const bad of [-1, Number.NaN]) {
      expect(() =>
        facingSystem({ moves: MOVES, desired: keepFacing, turnDegreesPerSecond: bad }),
      ).toThrow(RangeError);
    }
    // A facing system on its own (no timeline system to object first) meets a move it does not know.
    const world = new World<never>({ seed: 1 }).register(
      ...ACTION_TIMELINE_COMPONENTS,
      ...MELEE_COMPONENTS,
    );
    world.addSystem(facingSystem({ moves: MOVES, desired: toward(east) }));
    const fighter = world.spawn();
    giveActionTimeline(world, fighter);
    giveFacing(world, fighter);
    world.step();
    const timeline = world.get(fighter, ActionTimelineComponent);
    if (timeline === undefined) throw new Error('no timeline');
    world.set(fighter, ActionTimelineComponent, {
      ...timeline,
      current: { move: 'gone', tick: 0, startedAt: 0 },
    });
    expect(() => {
      world.step();
    }).toThrow('move "gone" is not in the move table');
  });

  it('giveFacing replaces a facing; a fighter without one faces +z', () => {
    const s = setup();
    giveFacing(s.world, s.knight, v3(0, 5, -3));
    expect(s.world.get(s.knight, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: -1 });
    expect(facingOf(s.world, s.dummy)).toBe(FORWARD_FACING);
  });
});
