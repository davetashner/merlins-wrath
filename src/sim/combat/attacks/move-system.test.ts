// Creature attacks on the move system (mw-e04.20): a creature with an action timeline performs its
// melee attacks as moves, so the hit-volume system, the melee strikes, parry and hit reactions treat
// its swings exactly like the player's and the sandbox dummy's. Also the AI query API.

import type { MoveTable, RuntimeAttack, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent, healthOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  HitboxComponent,
  HurtboxComponent,
  type Hurtbox,
  type SocketTrack,
} from '../hits/components';
import { hitVolumeSystem, noAllies } from '../hits/system';
import { facingOf, giveFacing, MELEE_COMPONENTS } from '../melee/components';
import { MoveStruck } from '../melee/events';
import { installMeleeStrikes } from '../melee/strikes';
import { isParried, PARRY_COMPONENTS, parriedOf } from '../parry/components';
import { HitParried } from '../parry/events';
import { installParry, PARRIED_TICKS } from '../parry/parry';
import { StaminaComponent } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionTimeline,
} from '../timeline/components';
import { actionOf, actionTimelineSystem, interruptAction, requestMove } from '../timeline/timeline';
import { ATTACK_COMPONENTS, AttackerComponent, currentAttack, giveAttacker } from './components';
import {
  AttackActive,
  AttackEnded,
  AttackHit,
  TelegraphStarted,
  type AttackEndInfo,
  type AttackHitInfo,
  type TelegraphInfo,
} from './events';
import {
  attackChain,
  attacksOnTimeline,
  cancelAttack,
  canStartAttack,
  installAttacks,
  startAttack,
} from './executor';
import {
  canUseMove,
  cooldownLeft,
  cooldowns,
  distanceBetween,
  inRange,
  rangeFor,
  usableAttacks,
} from './queries';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const FORWARD = v3(0, 0, 1);

interface MoveSpec {
  readonly id: string;
  readonly frames: readonly [number, number, number];
  readonly verb?: RuntimeMove['verb'];
  readonly telegraphTick?: number;
  readonly chainNext?: string;
  readonly attackWindow?: readonly [number, number];
  readonly parryable?: boolean;
  readonly unblockable?: boolean;
  readonly telegraph?: { readonly audioCue: string; readonly vfxCue: string };
}

/** `value`, which the test knows is there. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test value');
  return value;
}

/** A RuntimeMove as compileMove builds it: a hitting move thrusts a blade along +z at chest height. */
function move(spec: MoveSpec): RuntimeMove {
  const { id, frames, verb = 'attack', telegraphTick = 0 } = spec;
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
    staminaCost: 0,
    cancelWindows: [
      { into: 'dodge', from: 0, to: 0, move: null },
      ...(spec.attackWindow === undefined
        ? []
        : [{ into: 'attack', from: spec.attackWindow[0], to: spec.attackWindow[1], move: null }]),
    ] as RuntimeMove['cancelWindows'],
    damage: canHit
      ? {
          amounts: { slash: 20 },
          poiseDamage: 5,
          staminaDamage: 10,
          impulse: v3(0, 0, 0),
          impactForce: 0,
          tags: [],
        }
      : null,
    hitbox: canHit
      ? {
          track: 'track',
          shape: {
            kind: 'capsule',
            from: v3(0, 1.1, 0.3),
            to: v3(0, 1.1, 1.8),
            radius: 0.12,
          },
          reach: 'medium',
          swing: 'vertical',
        }
      : null,
    parryable: canHit && spec.parryable !== false,
    blockable: canHit && spec.unblockable !== true,
    unblockable: canHit && spec.unblockable === true,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick,
    chainNext: spec.chainNext ?? null,
    charge: null,
    motion: null,
    hitStop: canHit ? 'light' : null,
    presentation: {
      anim: `anim-${id}`,
      ...(spec.telegraph !== undefined && { telegraph: spec.telegraph }),
    },
  } satisfies RuntimeMove);
}

const extra = {
  amounts: { blunt: 4 },
  poiseDamage: 0,
  staminaDamage: 0,
  impulse: v3(0, 0, 1),
  impactForce: 0,
  tags: [],
};

/** A melee attack performing `chain` (its first move, then the rest). */
function attack(
  id: string,
  chain: readonly RuntimeMove[],
  overrides: Partial<RuntimeAttack> = {},
): RuntimeAttack {
  const [first] = chain as [RuntimeMove];
  return {
    id,
    kind: 'melee',
    move: first,
    chain,
    hitbox: must(first.hitbox),
    telegraph: `${id}-windup`,
    rangeMin: 0,
    rangeMax: 2,
    packets: [must(first.damage), extra],
    cooldownMs: 0,
    weight: 1,
    targetStances: null,
    healthMin: 0,
    healthMax: 1,
    projectile: null,
    ...overrides,
  };
}

// The moves: the chop (telegraph on tick 4, declared cues), a two-move slash (the first opens an
// attack cancel window), a thrust whose chain continues from its last tick, the parry, and a step.
const CHOP = move({
  id: 'chop',
  frames: [18, 4, 10],
  telegraphTick: 4,
  telegraph: { audioCue: 'sfx-telegraph-chop', vfxCue: 'vfx-telegraph-chop' },
});
const SLASH_1 = move({
  id: 'slash-1',
  frames: [18, 4, 14],
  chainNext: 'slash-2',
  attackWindow: [24, 35],
});
const SLASH_2 = move({ id: 'slash-2', frames: [18, 4, 12] });
const JAB_1 = move({ id: 'jab-1', frames: [18, 2, 4], chainNext: 'jab-2' });
const JAB_2 = move({ id: 'jab-2', frames: [18, 2, 4] });
const CRUSH = move({ id: 'crush', frames: [30, 4, 10], unblockable: true, parryable: false });
const PARRY = move({ id: 'parry', verb: 'parry', frames: [4, 10, 16] });
const STEP = move({ id: 'step', verb: 'dodge', frames: [0, 6, 4] });
const MOVES: MoveTable = new Map(
  [CHOP, CRUSH, SLASH_1, SLASH_2, JAB_1, JAB_2, PARRY, STEP].map((m) => [m.id, m]),
);
const TRACKS = new Map<string, SocketTrack>([['track', { id: 'track', keys: [IDENTITY_POSE] }]]);

const ATTACKS = [
  attack('chop', [CHOP], { cooldownMs: 2000 }),
  attack('crush', [CRUSH]),
  attack('slash', [SLASH_1, SLASH_2]),
  attack('jab', [JAB_1, JAB_2]),
  attack('far', [CHOP], { rangeMin: 3, rangeMax: 6 }),
];
const TABLE = new Map(ATTACKS.map((a) => [a.id, a]));
const get = (id: string) => must(TABLE.get(id));

const torso: Hurtbox = {
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.4 },
};

/** A world wired as the game does: timeline, hit volumes, melee strikes, parry, then attacks. */
function setup() {
  const world = new World<never>({ seed: 9 }).register(
    PlacementComponent,
    ...DAMAGE_COMPONENTS,
    ...ATTACK_COMPONENTS,
    ...ACTION_TIMELINE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...MELEE_COMPONENTS,
    ...PARRY_COMPONENTS,
    StaminaComponent,
  );
  const damage = new DamageModel();
  world.addSystem(actionTimelineSystem({ moves: MOVES }));
  world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  installParry(world, { moves: MOVES, damage });
  installAttacks(world, { attacks: TABLE, damage });
  const log = {
    telegraph: [] as TelegraphInfo[],
    hit: [] as AttackHitInfo[],
    ended: [] as AttackEndInfo[],
    applied: [] as DamageResult[],
    active: 0,
  };
  world.events.on(TelegraphStarted, (e) => log.telegraph.push(e));
  world.events.on(AttackHit, (e) => log.hit.push(e));
  world.events.on(AttackEnded, (e) => log.ended.push(e));
  world.events.on(DamageApplied, (e) => log.applied.push(e));
  world.events.on(AttackActive, () => (log.active += 1));

  /** A creature at the origin facing −x (startAttack turns it), on the move system. */
  const creature = (attacks?: readonly string[]): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, v3(0, 0, 0), 0.4);
    giveFacing(world, e, v3(-1, 0, 0));
    giveHurtboxes(world, e, { facing: v3(-1, 0, 0), boxes: [torso] });
    giveCombatant(world, e, { health: 100, poise: 50 });
    giveAttacker(world, e, attacks);
    giveActionTimeline(world, e);
    giveHitboxes(world, e);
    return e;
  };
  /** A fighter 1.2 m ahead of the creature (+z), facing it, with a timeline (it can parry). */
  const knight = (at = v3(0, 0, 1.2)): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, at, 0.4);
    giveFacing(world, e, v3(0, 0, -1));
    giveHurtboxes(world, e, { facing: v3(0, 0, -1), boxes: [torso] });
    giveCombatant(world, e, { health: 200, poise: 100 });
    giveActionTimeline(world, e);
    return e;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, damage, log, creature, knight, steps };
}

describe('creature attacks on the move system (mw-e04.20)', () => {
  it('AC-3: a creature executing a move with telegraphTick 4 emits exactly one TelegraphStarted on tick 4, with the move’s cue ids', () => {
    const { world, log, creature, steps } = setup();
    const skeleton = creature();
    startAttack(world, skeleton, get('chop'), FORWARD);
    steps(4);
    expect(log.telegraph).toEqual([]);
    steps(1);
    expect(log.telegraph).toEqual([
      {
        tick: 4,
        attacker: skeleton,
        attack: 'chop',
        move: 'chop',
        cue: 'chop-windup',
        audioCue: 'sfx-telegraph-chop',
        vfxCue: 'vfx-telegraph-chop',
        parryable: true,
        unblockable: false,
      },
    ]);
    steps(40);
    expect(log.telegraph).toHaveLength(1);
  });

  it('performs the move on its timeline facing the aim; the hit, its extra packet and AttackHit follow the move system', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    const target = knight();
    expect(attacksOnTimeline(world, skeleton, get('chop'))).toBe(true);
    startAttack(world, skeleton, get('chop'), v3(0, 0, 5));
    expect(facingOf(world, skeleton)).toEqual(FORWARD);
    expect(world.get(skeleton, HurtboxComponent)?.facing).toEqual(FORWARD);
    expect(canStartAttack(world, skeleton, get('slash'), { distance: 1 })).toEqual({
      ok: false,
      reason: 'busy',
    });
    steps(1);
    expect(actionOf(world, skeleton)).toEqual({ move: 'chop', tick: 0, startedAt: 0 });
    steps(18); // the chop's first active tick (18)
    expect(log.applied.map((r) => [r.tick, r.target, r.amounts, r.tags])).toEqual([
      [18, target, { slash: 20 }, ['parryable']],
      [18, target, { blunt: 4 }, []],
    ]);
    expect(log.hit).toEqual([
      {
        tick: 18,
        attacker: skeleton,
        attack: 'chop',
        target,
        source: skeleton,
        results: log.applied,
      },
    ]);
    expect(currentAttack(world, skeleton)?.hit).toEqual([target]);
    expect(healthOf(world, target)?.current).toBe(176);
    steps(13); // ticks 19–31: the chop's last tick is 31
    expect(log.ended).toEqual([]);
    steps(1);
    expect(log.ended).toEqual([
      { tick: 32, attacker: skeleton, attack: 'chop', reason: 'completed', elapsed: 32 },
    ]);
    expect(log.active).toBe(0); // the hit-volume system draws its volume, not AttackActive
    expect(currentAttack(world, skeleton)).toBeUndefined();
  });

  it('a chain plays every move: each telegraphs, the next is requested in the attack cancel window', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    knight();
    startAttack(world, skeleton, get('slash'), FORWARD);
    steps(25); // slash-1's attack window opens on its tick 24; slash-2 starts on 25
    expect(actionOf(world, skeleton)?.move).toBe('slash-1');
    steps(1);
    expect(actionOf(world, skeleton)).toEqual({ move: 'slash-2', tick: 0, startedAt: 25 });
    expect(log.telegraph.map((e) => [e.move, e.tick])).toEqual([
      ['slash-1', 0],
      ['slash-2', 25],
    ]);
    expect(log.hit.map((e) => e.tick)).toEqual([18]);
    steps(19);
    // slash-2 hits the same target again (each move strikes once), but it is listed once.
    expect(log.hit.map((e) => e.tick)).toEqual([18, 43]);
    expect(currentAttack(world, skeleton)?.hit).toHaveLength(1);
    steps(15);
    expect(log.ended).toEqual([
      { tick: 59, attacker: skeleton, attack: 'slash', reason: 'completed', elapsed: 59 },
    ]);
  });

  it('a chain without a cancel window continues on its first move’s last tick', () => {
    const { world, log, creature, steps } = setup();
    const skeleton = creature();
    startAttack(world, skeleton, get('jab'), FORWARD);
    steps(25); // jab-1 lasts 24 ticks (0–23); jab-2 starts on 24
    expect(actionOf(world, skeleton)).toEqual({ move: 'jab-2', tick: 0, startedAt: 24 });
    steps(24);
    expect(log.telegraph.map((e) => e.move)).toEqual(['jab-1', 'jab-2']);
    expect(log.ended.map((e) => [e.tick, e.reason])).toEqual([[48, 'completed']]);
  });

  it('a parry in the window deflects it: Parried as the dummy is, no extra packet, AttackEnded parried', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    const target = knight();
    startAttack(world, skeleton, get('chop'), FORWARD);
    steps(10);
    requestMove(world, target, 'parry'); // the parry starts on tick 10: window ticks 14–23
    steps(9);
    expect(log.applied.map((r) => [r.target, r.total, r.tags])).toEqual([
      [target, 0, ['parried', 'parryable']],
    ]);
    expect(isParried(world, skeleton)).toBe(true);
    expect(parriedOf(world, skeleton)).toMatchObject({ by: target, startedAt: 18 });
    expect(world.get(skeleton, ActionTimelineComponent)?.lockTicks).toBe(PARRIED_TICKS);
    // The parry ends the attack at once: a parried swing lands no AttackHit.
    expect(log.hit).toEqual([]);
    expect(log.ended).toEqual([
      { tick: 18, attacker: skeleton, attack: 'chop', reason: 'parried', elapsed: 18 },
    ]);
    // Parried and locked: busy for anything else until the stun runs out.
    expect(canUseMove(world, skeleton, get('slash')).ok).toBe(false);
  });

  it('a hit reaction’s interrupt staggers it; something else taking the timeline cancels it', () => {
    const { world, log, creature, steps } = setup();
    const staggered = creature();
    startAttack(world, staggered, get('chop'), FORWARD);
    steps(5);
    interruptAction(world, staggered, 20);
    steps(1);
    expect(log.ended.map((e) => [e.attacker, e.reason])).toEqual([[staggered, 'staggered']]);

    const dodger = creature();
    startAttack(world, dodger, get('chop'), FORWARD);
    requestMove(world, dodger, 'step'); // replaces the buffered chop: the step starts instead
    steps(1);
    expect(actionOf(world, dodger)?.move).toBe('step');
    expect(log.ended.map((e) => [e.attacker, e.reason])).toEqual([
      [staggered, 'staggered'],
      [dodger, 'cancelled'],
    ]);
  });

  it('a request that never starts, or a timeline taken away, ends it cancelled', () => {
    const { world, log, creature, steps } = setup();
    const dropped = creature();
    startAttack(world, dropped, get('chop'), FORWARD);
    const timeline = world.get(dropped, ActionTimelineComponent);
    world.set(dropped, ActionTimelineComponent, { ...must(timeline), buffer: null });
    const removed = creature();
    startAttack(world, removed, get('chop'), FORWARD);
    steps(3);
    world.remove(removed, ActionTimelineComponent);
    steps(2);
    expect(log.ended.map((e) => [e.attacker, e.reason])).toEqual([
      [dropped, 'cancelled'],
      [removed, 'cancelled'],
    ]);
  });

  it('started while an older move runs, it waits for that move and then plays', () => {
    const { world, log, creature, steps } = setup();
    const skeleton = creature();
    requestMove(world, skeleton, 'step');
    steps(2);
    startAttack(world, skeleton, get('chop'), FORWARD); // canStartAttack would say busy
    steps(9); // the step (10 ticks) ends on tick 10 and the buffered chop starts then
    expect(actionOf(world, skeleton)).toEqual({ move: 'chop', tick: 0, startedAt: 10 });
    expect(log.ended).toEqual([]);
  });

  it('cancelAttack interrupts the running or requested move and keeps the timeline’s lock', () => {
    const { world, log, creature, steps } = setup();
    const running = creature();
    startAttack(world, running, get('chop'), FORWARD);
    steps(3);
    expect(cancelAttack(world, running, 'cancelled')).toBe(true);
    expect(actionOf(world, running)).toBeUndefined();
    const requested = creature();
    startAttack(world, requested, get('chop'), FORWARD);
    const locked = world.get(requested, ActionTimelineComponent);
    world.set(requested, ActionTimelineComponent, { ...must(locked), lockTicks: 7 });
    expect(cancelAttack(world, requested)).toBe(true);
    expect(world.get(requested, ActionTimelineComponent)).toMatchObject({
      buffer: null,
      lockTicks: 7,
    });
    const idle = creature();
    startAttack(world, idle, get('chop'), FORWARD);
    const plain = world.get(idle, ActionTimelineComponent);
    world.set(idle, ActionTimelineComponent, { ...must(plain), buffer: null });
    expect(cancelAttack(world, idle)).toBe(true);
    steps(1);
    expect(log.ended.map((e) => e.reason)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('only melee and area attacks of a creature with a timeline and hitboxes use the move system', () => {
    const { world, creature } = setup();
    const skeleton = creature();
    const bolt = attack('bolt', [CHOP], { kind: 'projectile' });
    expect(attacksOnTimeline(world, skeleton, bolt)).toBe(false);
    expect(attacksOnTimeline(world, skeleton, { ...bolt, kind: 'area' })).toBe(true);
    const bare = world.spawn();
    giveAttacker(world, bare);
    expect(attacksOnTimeline(world, bare, get('chop'))).toBe(false);
    giveActionTimeline(world, bare);
    expect(attacksOnTimeline(world, bare, get('chop'))).toBe(false); // no hitboxes
    const plain = new World<never>({ seed: 1 }).register(...ATTACK_COMPONENTS);
    const e = plain.spawn();
    giveAttacker(plain, e);
    expect(attacksOnTimeline(plain, e, get('chop'))).toBe(false);
    const { chain, ...unchained } = get('slash');
    expect(chain).toHaveLength(2);
    expect(attackChain(unchained).map((m) => m.id)).toEqual(['slash-1']);
  });

  it('startAttack turns an attacker without hurtboxes too; a world without facings is left alone', () => {
    const { world, steps } = setup();
    const skeleton = world.spawn();
    placeEntity(world, skeleton, v3(0, 0, 0), 0.4);
    giveAttacker(world, skeleton);
    giveActionTimeline(world, skeleton);
    giveHitboxes(world, skeleton);
    startAttack(world, skeleton, get('chop'), v3(1, 0, 0));
    expect(facingOf(world, skeleton)).toEqual(v3(1, 0, 0));
    steps(1);
    expect(actionOf(world, skeleton)?.move).toBe('chop');

    const bare = new World<never>({ seed: 2 }).register(
      ...ATTACK_COMPONENTS,
      ...ACTION_TIMELINE_COMPONENTS,
      HitboxComponent,
    );
    const e = bare.spawn();
    giveAttacker(bare, e);
    giveActionTimeline(bare, e);
    giveHitboxes(bare, e);
    startAttack(bare, e, get('chop'), v3(1, 0, 0));
    expect(bare.get(e, ActionTimelineComponent)?.buffer?.move).toBe('chop');
  });

  it('every target struck gets the extra packets (unblockable with its move); the dead and the unhurtable get none', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    const left = knight(v3(-0.2, 0, 1.2));
    const right = knight(v3(0.2, 0, 1.2));
    const frail = knight(v3(0, 0, 0.9));
    world.set(frail, HealthComponent, { current: 5, max: 5 });
    const post = world.spawn(); // a hurtbox and nothing to hurt
    placeEntity(world, post, v3(0, 0, 1.6), 0.4);
    giveHurtboxes(world, post, { facing: FORWARD, boxes: [torso] });
    startAttack(world, skeleton, get('crush'), FORWARD);
    steps(31); // the crush's first active tick is 30
    const byTarget = (target: EntityId) => log.hit.find((h) => h.target === target)?.results;
    expect(byTarget(left)?.map((r) => r.tags)).toEqual([['unblockable'], ['unblockable']]);
    expect(byTarget(right)).toHaveLength(2);
    expect(byTarget(frail)?.map((r) => r.died)).toEqual([true]); // nothing more lands on the dead
    expect(byTarget(post)).toEqual([]);
    expect(currentAttack(world, skeleton)?.hit).toEqual(
      [left, right, frail, post].sort((a, b) => a - b),
    );
  });

  it('HitParried for nobody, a non-attacker or an attacker not on the move system ends nothing', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    const target = knight();
    const parried = (attacker: EntityId | null) => {
      world.events.emit(HitParried, {
        tick: 0,
        entity: target,
        attacker,
        source: null,
        parriedTicks: 0,
      });
    };
    parried(null);
    parried(target);
    parried(skeleton);
    steps(1);
    expect(log.ended).toEqual([]);
  });

  it('MoveStruck from others’ moves, or from a move outside the attack, adds nothing', () => {
    const { world, log, creature, knight, steps } = setup();
    const skeleton = creature();
    const target = knight();
    const struck = (attacker: EntityId, moveId: string) => {
      world.events.emit(MoveStruck, { tick: 0, attacker, move: moveId, target, result: null });
    };
    struck(target, 'chop'); // the knight is no attacker
    struck(skeleton, 'chop'); // the skeleton is idle
    steps(1);
    expect(log.hit).toEqual([]);
    startAttack(world, skeleton, get('chop'), FORWARD);
    struck(skeleton, 'slash-1'); // not one of the chop's moves
    struck(skeleton, 'chop'); // nothing resolved: AttackHit with no results
    // A deflected packet gets no extra packets after it.
    const parried = { tags: ['parried'] } as unknown as DamageResult;
    world.events.emit(MoveStruck, {
      tick: 0,
      attacker: skeleton,
      move: 'chop',
      target,
      result: parried,
    });
    steps(1);
    expect(log.hit).toEqual([
      { tick: 1, attacker: skeleton, attack: 'chop', target, source: skeleton, results: [] },
      {
        tick: 1,
        attacker: skeleton,
        attack: 'chop',
        target,
        source: skeleton,
        results: [parried],
      },
    ]);
    expect(log.applied).toEqual([]);
  });
});

describe('attack queries for AI (mw-e04.20)', () => {
  it('AC-4: a creature move on cooldown 120 ticks: canUseMove at tick 60 is false with reason cooldown', () => {
    const { world, creature, steps } = setup();
    const skeleton = creature(['chop', 'slash']);
    startAttack(world, skeleton, get('chop'), FORWARD); // cooldown 2 s = 120 ticks, from tick 0
    steps(60); // the chop itself ended on tick 32: only the cooldown is in the way
    expect(world.tick).toBe(60);
    expect(canUseMove(world, skeleton, get('chop'))).toEqual({ ok: false, reason: 'cooldown' });
    expect(cooldownLeft(world, skeleton, get('chop'))).toBe(60);
    expect(cooldowns(world, skeleton)).toEqual({ chop: 60 });
    expect(canUseMove(world, skeleton, get('slash'))).toEqual({ ok: true });
    steps(59);
    expect(canUseMove(world, skeleton, get('chop')).ok).toBe(false);
    steps(1);
    expect(canUseMove(world, skeleton, get('chop'))).toEqual({ ok: true });
    expect(cooldownLeft(world, skeleton, get('chop'))).toBe(0);
    expect(cooldowns(world, skeleton)).toEqual({});
  });

  it('rangeFor, distances, inRange and the usable attacks a brain chooses from', () => {
    const { world, creature, knight } = setup();
    const skeleton = creature(['far', 'chop', 'gone']);
    const target = knight(v3(0, 0, 1.5));
    expect(rangeFor(get('far'))).toEqual({ min: 3, max: 6, reach: 'medium' });
    expect(distanceBetween(world, skeleton, target)).toBe(1.5);
    expect(inRange(world, skeleton, target, get('chop'))).toBe(true);
    expect(inRange(world, skeleton, target, get('far'))).toBe(false);
    // Range is only checked with a distance; unknown attacks are skipped.
    expect(usableAttacks(world, skeleton, TABLE).map((a) => a.id)).toEqual(['far', 'chop']);
    expect(usableAttacks(world, skeleton, TABLE, { distance: 1.5 }).map((a) => a.id)).toEqual([
      'chop',
    ]);
    expect(canUseMove(world, skeleton, get('far'), { distance: 1.5 })).toEqual({
      ok: false,
      reason: 'too-close',
    });
    // An attacker that lists none may use the whole table.
    const any = creature();
    expect(usableAttacks(world, any, TABLE).map((a) => a.id)).toEqual([
      'chop',
      'crush',
      'slash',
      'jab',
      'far',
    ]);
    const ghost = world.spawn();
    expect(distanceBetween(world, ghost, target)).toBeUndefined();
    expect(inRange(world, ghost, target, get('chop'))).toBe(false);
    expect(cooldownLeft(world, ghost, get('chop'))).toBe(0);
    expect(cooldowns(world, ghost)).toEqual({});
    expect(world.get(skeleton, AttackerComponent)?.attacks).toEqual(['far', 'chop', 'gone']);
    // Cooldowns list what is still cooling, in id order.
    const state = must(world.get(skeleton, AttackerComponent));
    world.set(skeleton, AttackerComponent, { ...state, readyAt: { slash: 30, chop: 0, far: 12 } });
    expect(Object.entries(cooldowns(world, skeleton))).toEqual([
      ['far', 12],
      ['slash', 30],
    ]);
  });
});
