// Heavy and charged attacks (mw-e04.13): the charge hold in the action timeline, the lerp of a
// released charge, and hyperarmor on a charging knight. The moves mirror content (sword-heavy and
// sword-heavy-charged); the knight's real numbers through the game's wiring are in
// tests/integration/knight-attacks.test.ts and src/sim/player/knight.test.ts.
import type { DamageTemplate, MoveTable, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf, poiseOf } from '../damage/components';
import { DamageModel } from '../damage/model';
import type { DamagePacketInput } from '../damage/packet';
import { HurtboxComponent } from '../hits/components';
import { giveHitReactions, HitReactionComponent } from '../reactions/components';
import { HitReaction, type HitReactionInfo } from '../reactions/events';
import { installHitReactions } from '../reactions/reactions';
import { giveStamina, StaminaComponent, staminaOf, staminaSystem } from '../stamina';
import { chargedMove, chargeIndex, chargeLevel, effectiveMove } from './charge';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionInput,
  giveActionTimeline,
} from './components';
import {
  ActionEnded,
  ActionPhaseChanged,
  ChargeReady,
  ChargeReleased,
  type ActionEndInfo,
  type ActionPhaseInfo,
  type ChargeReadyInfo,
  type ChargeReleaseInfo,
} from './events';
import {
  actionOf,
  actionTimelineSystem,
  interruptAction,
  releaseCharge,
  requestMove,
  setTimeScale,
} from './timeline';

const damage = (slash: number, poise: number, impactForce: number): DamageTemplate => ({
  amounts: { slash },
  poiseDamage: poise,
  staminaDamage: poise,
  impulse: { x: 0, y: 0, z: impactForce / 10 },
  impactForce,
  tags: [],
});

function move(id: string, overrides: Partial<RuntimeMove> = {}): RuntimeMove {
  return Object.freeze({
    id,
    verb: 'attack',
    startup: 24,
    active: 5,
    recovery: 26,
    totalTicks: 55,
    activeFrom: 24,
    recoveryFrom: 29,
    staminaCost: 25,
    cancelWindows: [],
    damage: damage(32, 33, 1500),
    hitbox: {
      track: 'arc',
      shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 },
      reach: 'medium',
      swing: 'vertical',
    },
    parryable: true,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: { from: 10, to: 29, poiseCap: 40 },
    iframes: null,
    telegraphTick: 0,
    hitStop: 'heavy',
    chainNext: null,
    charge: null,
    motion: null,
    worldImpact: { blunt: 150 },
    presentation: { anim: `anim-${id}` },
    ...overrides,
  } satisfies RuntimeMove);
}

/** `m` without a world impact. */
function noImpact(m: RuntimeMove): RuntimeMove {
  const copy: { -readonly [K in keyof RuntimeMove]?: RuntimeMove[K] } = { ...m };
  delete copy.worldImpact;
  return copy as RuntimeMove;
}

const CHARGE = { from: 'heavy', minHoldTicks: 12, fullHoldTicks: 60, autoReleaseTicks: 90 };
// sword-heavy: 24/5/26, 25 stamina, 32 slash (1.6× light 1's 20), 33 poise (2.2× light 1's 15).
const HEAVY = move('heavy');
// sword-heavy-charged: 35 stamina, 57.6 slash (1.8× the heavy), 52.5 poise (3.5× light 1's 15).
const CHARGED = move('charged', {
  staminaCost: 35,
  damage: damage(57.6, 52.5, 2500),
  hitStop: 'charged',
  worldImpact: { blunt: 220 },
  charge: { ...CHARGE, holdTick: 18 },
});
const POKE = move('poke', {
  startup: 2,
  active: 2,
  recovery: 2,
  totalTicks: 6,
  activeFrom: 2,
  recoveryFrom: 4,
  staminaCost: 5,
  hyperarmor: null,
});
const table = (...moves: RuntimeMove[]): MoveTable => new Map(moves.map((m) => [m.id, m]));
const MOVES = table(HEAVY, CHARGED, POKE);

/** A frame with `pressed` going down this tick and `held` (and `pressed`) down. */
function frame(pressed: readonly ButtonAction[] = [], held: readonly ButtonAction[] = []) {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });
}

interface Setup {
  readonly world: World<ActionFrame>;
  readonly knight: EntityId;
  readonly ready: ChargeReadyInfo[];
  readonly released: ChargeReleaseInfo[];
  readonly phases: ActionPhaseInfo[];
  readonly ended: ActionEndInfo[];
  readonly reactions: HitReactionInfo[];
  readonly model: DamageModel;
  /** Presses the heavy button on this tick and holds it `ticks` ticks in all, then lets go. */
  hold(ticks: number): void;
  steps(n: number, frame?: ActionFrame): void;
  stamina(): number;
}

function setup(
  options: { moves?: MoveTable; stamina?: boolean; poise?: number; input?: boolean } = {},
): Setup {
  const moves = options.moves ?? MOVES;
  const world = new World<ActionFrame>({ seed: 3 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    StaminaComponent,
    HitReactionComponent,
    HurtboxComponent,
  );
  world.addSystem(staminaSystem()).addSystem(actionTimelineSystem({ moves }));
  const model = new DamageModel();
  installHitReactions(world, { moves, damage: model });
  const knight = world.spawn();
  giveActionTimeline(world, knight);
  if (options.input ?? true) {
    giveActionInput(world, knight, { ability1: 'heavy', primaryAttack: 'poke' });
  }
  if (options.stamina ?? true) giveStamina(world, knight);
  giveCombatant(world, knight, { health: 200, poise: options.poise ?? 50 });
  giveHitReactions(world, knight);
  const ready: ChargeReadyInfo[] = [];
  const released: ChargeReleaseInfo[] = [];
  const phases: ActionPhaseInfo[] = [];
  const ended: ActionEndInfo[] = [];
  const reactions: HitReactionInfo[] = [];
  world.events.on(ChargeReady, (e) => ready.push(e));
  world.events.on(ChargeReleased, (e) => released.push(e));
  world.events.on(ActionPhaseChanged, (e) => phases.push(e));
  world.events.on(ActionEnded, (e) => ended.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  const steps = (n: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < n; i++) world.step([input]);
  };
  return {
    world,
    knight,
    ready,
    released,
    phases,
    ended,
    reactions,
    model,
    hold: (ticks) => {
      steps(1, frame(['ability1']));
      steps(ticks - 1, frame([], ['ability1']));
      steps(1); // let go
    },
    steps,
    stamina: () => staminaOf(world, knight)?.current ?? Number.NaN,
  };
}

describe('charged moves: the data (mw-e04.13)', () => {
  it('chargeIndex maps each chargeable move to its charged variant', () => {
    expect([...chargeIndex(MOVES)]).toEqual([['heavy', CHARGED]]);
    expect(chargeIndex(table(POKE)).size).toBe(0);
  });

  it('chargeIndex refuses a charged move without its move, with other frames or holding too late', () => {
    expect(() => chargeIndex(table(CHARGED))).toThrow(/charges "heavy", not in the table/);
    const longer = move('heavy', { totalTicks: 60, recovery: 31 });
    expect(() => chargeIndex(table(longer, CHARGED))).toThrow(/must have the frames of "heavy"/);
    const late = move('charged', { charge: { ...CHARGE, holdTick: 24 } });
    expect(() => chargeIndex(table(HEAVY, late))).toThrow(/must hold before "heavy" turns active/);
  });

  it('the charge level is 0 up to 12 ticks held, 1 from 60, linear between', () => {
    expect([0, 8, 12, 36, 59, 60, 90].map((held) => chargeLevel(CHARGED, held))).toEqual([
      0,
      0,
      0,
      0.5,
      47 / 48,
      1,
      1,
    ]);
    expect(() => chargeLevel(HEAVY, 1)).toThrow(/not a charged move/);
    const instant = move('charged', {
      charge: { ...CHARGE, minHoldTicks: 30, fullHoldTicks: 30, holdTick: 18 },
    });
    expect([29, 30].map((held) => chargeLevel(instant, held))).toEqual([0, 1]);
  });

  it('a released charge lerps damage, poise, impact, world impact and stamina from the heavy', () => {
    const half = chargedMove(MOVES, CHARGED, 0.5);
    expect(half.damage).toEqual({
      amounts: { slash: 44.8 },
      poiseDamage: 42.75,
      staminaDamage: 42.75,
      impulse: { x: 0, y: 0, z: 200 },
      impactForce: 2000,
      tags: [],
    });
    expect(half.worldImpact).toEqual({ blunt: 185 });
    expect(half.staminaCost).toBe(30);
    expect(half.hitStop).toBe('charged');
    expect(chargedMove(MOVES, CHARGED, 0).damage?.amounts).toEqual({ slash: 32 });
    expect(chargedMove(MOVES, CHARGED, -1).damage?.poiseDamage).toBe(33);
    expect(chargedMove(MOVES, CHARGED, 1)).toBe(CHARGED);
    expect(chargedMove(table(CHARGED), CHARGED, 0.5)).toBe(CHARGED);
  });

  it('types and impacts only one side has lerp from or to 0; a move without them keeps none', () => {
    const plain = noImpact(move('heavy', { damage: null }));
    const mixed = move('charged', {
      charge: CHARGED.charge,
      damage: { ...damage(40, 40, 0), amounts: { blunt: 40 } },
    });
    const half = chargedMove(table(plain, mixed), mixed, 0.5);
    expect(half.damage?.amounts).toEqual({ blunt: 40 });
    expect(half.worldImpact).toEqual({ blunt: 75 });
    const swap = chargedMove(table(HEAVY, mixed), mixed, 0.5);
    expect(swap.damage?.amounts).toEqual({ blunt: 20, slash: 16 });
    const gap = move('charged', { charge: CHARGED.charge, worldImpact: { blunt: undefined } });
    expect(chargedMove(table(HEAVY, gap), gap, 0.5).worldImpact).toEqual({ blunt: 75 });
    const slashy = move('heavy', { worldImpact: { slash: 100 } });
    const both = chargedMove(table(slashy, CHARGED), CHARGED, 0.5);
    expect(both.damage?.amounts).toEqual({ slash: 44.8 });
    expect(both.worldImpact).toEqual({ blunt: 110 });
    const bare = noImpact(move('charged', { charge: CHARGED.charge, damage: null }));
    const none = chargedMove(MOVES, bare, 0.5);
    expect(none.damage).toBeNull();
    expect(none.worldImpact).toBeUndefined();
  });
});

describe('charged moves: holding the heavy (mw-e04.13)', () => {
  it('AC-1: held 60 ticks and released, it swings the full charge having spent 25 + 10 stamina', () => {
    const s = setup();
    s.hold(60);
    expect(s.ready).toEqual([
      { tick: 59, entity: s.knight, move: 'heavy', charged: 'charged', held: 60 },
    ]);
    expect(s.released).toEqual([
      {
        tick: 60,
        entity: s.knight,
        move: 'heavy',
        released: 'charged',
        held: 60,
        charge: 1,
        auto: false,
      },
    ]);
    expect(s.stamina()).toBe(100 - 35);
    expect(actionOf(s.world, s.knight)).toEqual({
      move: 'charged',
      tick: 19,
      startedAt: 0,
      charge: 1,
    });
    const swing = effectiveMove(s.world, MOVES, s.knight, CHARGED);
    expect(swing.damage?.amounts.slash).toBe(1.8 * 32);
    expect(swing.damage?.poiseDamage).toBe(3.5 * 15);
  });

  it('AC-1: the windup holds on tick 18 while held, then plays on: active 5 ticks after the release', () => {
    const s = setup();
    s.steps(1, frame(['ability1']));
    s.steps(30, frame([], ['ability1']));
    expect(actionOf(s.world, s.knight)).toMatchObject({ move: 'heavy', tick: 18 });
    expect(actionOf(s.world, s.knight)?.hold).toEqual({ held: 31, holding: true });
    s.steps(1); // let go on tick 31
    s.steps(40);
    expect(s.phases.map((p) => [p.tick, p.move, p.phase, p.moveTick])).toEqual([
      [0, 'heavy', 'startup', 0],
      [36, 'charged', 'active', 24],
      [41, 'charged', 'recovery', 29],
    ]);
    expect(s.ended).toEqual([
      { tick: 67, entity: s.knight, move: 'charged', reason: 'completed', moveTick: 55 },
    ]);
  });

  it('AC-2: released after 8 ticks of hold it is an uncharged heavy, its windup never held', () => {
    const s = setup();
    s.hold(8);
    expect(s.released).toEqual([
      {
        tick: 8,
        entity: s.knight,
        move: 'heavy',
        released: 'heavy',
        held: 8,
        charge: null,
        auto: false,
      },
    ]);
    expect(actionOf(s.world, s.knight)).toEqual({ move: 'heavy', tick: 8, startedAt: 0 });
    expect(effectiveMove(s.world, MOVES, s.knight, HEAVY)).toBe(HEAVY);
    expect(s.stamina()).toBe(75);
    s.steps(60);
    expect(s.ended.map((e) => [e.tick, e.move, e.reason])).toEqual([[55, 'heavy', 'completed']]);
    expect(s.ready).toEqual([]);
  });

  it('AC-2: a tap (pressed and let go inside one tick) is an uncharged heavy', () => {
    const s = setup();
    s.steps(
      1,
      actionFrame({
        move: actionVector(0, 0),
        look: actionVector(0, 0),
        buttons: (b) => actionButton(b === 'ability1', false, b === 'ability1'),
      }),
    );
    s.steps(1);
    expect(s.released.map((r) => [r.tick, r.released, r.held])).toEqual([[1, 'heavy', 1]]);
  });

  it('a 36-tick hold swings half a charge under the charged id for 30 stamina', () => {
    const s = setup();
    s.hold(36);
    expect(s.released.map((r) => [r.released, r.charge])).toEqual([['charged', 0.5]]);
    expect(s.stamina()).toBe(70);
    expect(effectiveMove(s.world, MOVES, s.knight, CHARGED).damage?.amounts.slash).toBe(44.8);
    expect(effectiveMove(s.world, MOVES, s.world.spawn(), CHARGED)).toBe(CHARGED);
  });

  it('a 12-tick hold, the shortest charge, swings at charge 0: a heavy’s numbers under the charged id', () => {
    const s = setup();
    s.hold(12);
    expect(s.released.map((r) => [r.released, r.charge])).toEqual([['charged', 0]]);
    expect(s.stamina()).toBe(75);
    expect(effectiveMove(s.world, MOVES, s.knight, CHARGED).damage?.amounts.slash).toBe(32);
  });

  it('AC-3: held for 90 ticks, it releases itself at full charge on the 90th tick', () => {
    const s = setup();
    s.steps(1, frame(['ability1']));
    s.steps(150, frame([], ['ability1']));
    expect(s.released).toEqual([
      {
        tick: 89,
        entity: s.knight,
        move: 'heavy',
        released: 'charged',
        held: 90,
        charge: 1,
        auto: true,
      },
    ]);
    expect(s.ended.map((e) => [e.tick, e.move, e.reason])).toEqual([
      [89 + 55 - 19, 'charged', 'completed'],
    ]);
    expect(s.stamina()).toBeGreaterThan(65); // regen resumed once the charge stopped draining
  });

  it('AC-5: reaching full charge emits exactly one ChargeReady, on the tick the hold reaches 60', () => {
    const s = setup();
    s.steps(1, frame(['ability1']));
    s.steps(58, frame([], ['ability1']));
    expect(s.ready).toEqual([]);
    s.steps(1, frame([], ['ability1']));
    expect(s.ready.map((r) => [r.tick, r.held])).toEqual([[59, 60]]);
    s.steps(29, frame([], ['ability1']));
    s.steps(60);
    expect(s.ready).toHaveLength(1);
    const short = setup();
    short.hold(59);
    expect(short.ready).toEqual([]);
  });

  it('the charge drains as it builds, holding the regen pause, and a drained pool does not stop it', () => {
    const s = setup();
    s.steps(1, frame(['ability1']));
    s.steps(11, frame([], ['ability1']));
    expect(s.stamina()).toBe(75);
    s.steps(24, frame([], ['ability1'])); // held 36: half the extra
    expect(s.stamina()).toBe(70);
    const empty = setup();
    const pool = staminaOf(empty.world, empty.knight);
    if (pool === undefined) throw new Error('no pool');
    empty.world.set(empty.knight, StaminaComponent, { ...pool, current: 26 });
    empty.hold(60);
    expect(empty.stamina()).toBe(0);
    expect(empty.released.map((r) => r.charge)).toEqual([1]);
  });

  it('without a stamina pool, or with no extra cost, the charge drains nothing', () => {
    const s = setup({ stamina: false });
    s.hold(60);
    expect(s.released.map((r) => r.charge)).toEqual([1]);
    const free = setup({ moves: table(HEAVY, { ...CHARGED, staminaCost: 25 }, POKE) });
    free.hold(60);
    expect(free.stamina()).toBeGreaterThan(75); // nothing drained, so the pool regenerated
  });

  it('requestMove with hold charges for AI and scripts; releaseCharge lets go (once)', () => {
    const s = setup({ input: false });
    requestMove(s.world, s.knight, 'heavy', { hold: true });
    s.steps(40);
    expect(actionOf(s.world, s.knight)?.hold).toEqual({ held: 40, holding: true });
    expect(releaseCharge(s.world, s.knight)).toBe(true);
    expect(releaseCharge(s.world, s.knight)).toBe(false);
    s.steps(1);
    expect(s.released.map((r) => [r.tick, r.held])).toEqual([[40, 40]]);
    expect(releaseCharge(s.world, s.knight)).toBe(false);
  });

  it('a request without hold, or for a move that cannot charge, never holds', () => {
    const s = setup();
    requestMove(s.world, s.knight, 'heavy');
    s.steps(1);
    expect(actionOf(s.world, s.knight)).toEqual({ move: 'heavy', tick: 0, startedAt: 0 });
    const poke = setup();
    poke.steps(1, frame(['primaryAttack']));
    expect(poke.world.get(poke.knight, ActionTimelineComponent)?.buffer).toBeNull();
    expect(actionOf(poke.world, poke.knight)).toEqual({ move: 'poke', tick: 0, startedAt: 0 });
  });

  it('a press buffered behind another move keeps its hold and charges once it starts', () => {
    const s = setup();
    s.steps(1, frame(['primaryAttack']));
    s.steps(1, frame(['ability1']));
    expect(s.world.get(s.knight, ActionTimelineComponent)?.buffer).toEqual({
      move: 'heavy',
      age: 1,
      hold: true,
    });
    s.steps(20, frame([], ['ability1']));
    expect(actionOf(s.world, s.knight)).toMatchObject({ move: 'heavy', startedAt: 6 });
    expect(actionOf(s.world, s.knight)?.hold?.holding).toBe(true);
  });

  it('hit-stop freezes the hold with the windup; an interrupt drops the charge with the move', () => {
    const s = setup();
    s.steps(1, frame(['ability1']));
    s.steps(19, frame([], ['ability1']));
    setTimeScale(s.world, s.knight, 0, 5);
    s.steps(5, frame([], ['ability1']));
    expect(actionOf(s.world, s.knight)?.hold).toEqual({ held: 20, holding: true });
    interruptAction(s.world, s.knight);
    s.steps(100, frame([], ['ability1']));
    expect(actionOf(s.world, s.knight)).toBeUndefined();
    expect(s.released).toEqual([]);
    expect(s.ready).toEqual([]);
  });

  it('a held timeline without its charged variant is an error', () => {
    const s = setup();
    const timeline = s.world.get(s.knight, ActionTimelineComponent);
    if (timeline === undefined) throw new Error('no timeline');
    s.world.set(s.knight, ActionTimelineComponent, {
      ...timeline,
      current: { move: 'poke', tick: 0, startedAt: 0, hold: { held: 1, holding: true } },
    });
    expect(() => {
      s.steps(1);
    }).toThrow(/move "poke" has no charged variant to hold/);
  });
});

describe('charged moves: hyperarmor while charging (mw-e04.13)', () => {
  /** Queues `packet` to land (through the damage model) on the next step, after the timeline. */
  function hit(s: Setup, packet: DamagePacketInput) {
    const at = s.world.tick;
    s.world.addSystem({
      name: `hit-${String(at)}`,
      run: ({ world }) => {
        if (world.tick === at) s.model.apply(world, s.knight, packet);
      },
    });
  }

  it('AC-4: a charging knight with cap 40 shrugs off a 30-poise hit; a further 15 staggers it and the charge is lost', () => {
    const s = setup({ poise: 50 });
    const creature = s.world.spawn();
    s.steps(1, frame(['ability1']));
    s.steps(40, frame([], ['ability1'])); // held 41: the windup holds on tick 18, inside 10–29
    hit(s, { amounts: { slash: 20 }, poiseDamage: 30, instigator: creature });
    s.steps(1, frame([], ['ability1']));
    expect(s.reactions.map((r) => [r.reaction, r.suppressed])).toEqual([['none', 'hyperarmor']]);
    expect(healthOf(s.world, s.knight)?.current).toBe(180);
    expect(poiseOf(s.world, s.knight)?.current).toBe(50);
    expect(actionOf(s.world, s.knight)?.hold).toEqual({ held: 42, holding: true });
    hit(s, { amounts: { slash: 5 }, poiseDamage: 15, instigator: creature });
    s.steps(1, frame([], ['ability1']));
    expect(s.reactions.map((r) => [r.reaction, r.suppressed])).toEqual([
      ['none', 'hyperarmor'],
      ['stagger', null],
    ]);
    expect(s.ended.map((e) => [e.move, e.reason, e.moveTick])).toEqual([
      ['heavy', 'interrupted', 18],
    ]);
    s.steps(60, frame([], ['ability1']));
    expect(s.released).toEqual([]);
    expect(s.ready).toEqual([]);
    expect(s.stamina()).toBeGreaterThan(0);
  });

  it('a released charge keeps the soak of its run: the cap is shared before and after the release', () => {
    const s = setup({ poise: 100 });
    s.steps(1, frame(['ability1']));
    s.steps(29, frame([], ['ability1']));
    hit(s, { amounts: {}, poiseDamage: 30 });
    s.steps(1, frame([], ['ability1']));
    s.steps(1); // let go: the charged swing plays on from tick 18 with the same run
    hit(s, { amounts: {}, poiseDamage: 15 });
    s.steps(1);
    expect(s.reactions.map((r) => r.reaction)).toEqual(['none', 'stagger']);
  });
});
