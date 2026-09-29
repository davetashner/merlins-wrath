import * as RAPIER from '@dimforge/rapier3d-deterministic';
import type { CancelTarget, MoveTable, RuntimeMove, TickRange } from '@content/index';
import { describe, expect, it } from 'vitest';
import { CharacterController, spawnCharacter } from '../../character/system';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { cos, sin } from '../../math';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../../physics/objects';
import { RapierPhysics } from '../../physics/rapier';
import { addProperties, registerWorldProperties } from '../../properties/components';
import { hashWorld } from '../../snapshot';
import { installStimuli } from '../../stimulus/stimulus';
import type { Vec3 } from '../../stimulus/shapes';
import { StaminaComponent } from '../stamina';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf, poiseOf } from '../damage/components';
import { PoiseBroken } from '../damage/events';
import { DamageModel } from '../damage/model';
import type { DamagePacketInput } from '../damage/packet';
import { giveHurtboxes, HurtboxComponent } from '../hits/components';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionTimeline,
} from '../timeline/components';
import { ActionEnded, ActionStarted, type ActionEndInfo } from '../timeline/events';
import { actionOf, actionTimelineSystem, requestMove } from '../timeline/timeline';
import {
  DEFAULT_REACTION_PROFILE,
  giveHitReactions,
  hasWakeIframes,
  HitReactionComponent,
  REACTION_DIRECTIONS,
  REACTION_KINDS,
  REACTION_TICKS,
  reactionOf,
  reactionProfileFromCreature,
  reactionRank,
  WAKE_IFRAME_TICKS,
  type ReactionProfile,
} from './components';
import {
  HitReaction,
  HitReactionEnded,
  type HitReactionEndInfo,
  type HitReactionInfo,
} from './events';
import {
  applyHitReaction,
  chooseReaction,
  hitDirection,
  hurtboxFacing,
  hyperarmorModifier,
  installHitReactions,
  pushCharacter,
  pushPhysicsObject,
  REACTION_TAGS,
  resolveHitReaction,
  type Pusher,
  type ReactionFactors,
} from './reactions';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

interface MoveSpec {
  readonly id: string;
  readonly frames: readonly [number, number, number];
  readonly hyperarmor?: TickRange & { readonly poiseCap: number };
}

/** A RuntimeMove as compileMove would build it, with only the fields these rules read varied. */
function move({ id, frames, hyperarmor }: MoveSpec): RuntimeMove {
  const [startup, active, recovery] = frames;
  return Object.freeze({
    id,
    verb: 'attack',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: 0,
    cancelWindows: [] as readonly (TickRange & { readonly into: CancelTarget })[],
    damage: null,
    hitbox: null,
    parryable: false,
    blockable: false,
    unblockable: false,
    interruptible: false,
    hyperarmor: hyperarmor ?? null,
    iframes: null,
    telegraphTick: 0,
    chainNext: null,
    charge: null,
    presentation: { anim: `anim-${id}` },
  } satisfies RuntimeMove);
}

const SWING = move({ id: 'swing', frames: [12, 4, 18] });
// The knight's heavy: 24/5/26, hyperarmor ticks 10–29 absorbing up to 40 poise.
const HEAVY = move({
  id: 'heavy',
  frames: [24, 5, 26],
  hyperarmor: { from: 10, to: 29, poiseCap: 40 },
});
const MOVES: MoveTable = new Map([SWING, HEAVY].map((m) => [m.id, m]));

const TROLL: ReactionProfile = {
  ...DEFAULT_REACTION_PROFILE,
  mass: 400,
  replace: { knockdown: 'knockback' },
};

interface Setup {
  readonly world: World<never>;
  readonly damage: DamageModel;
  readonly reactions: HitReactionInfo[];
  readonly ended: HitReactionEndInfo[];
  readonly actionsEnded: ActionEndInfo[];
  readonly uninstall: () => void;
  /** A combatant with a timeline that reacts to hits. */
  creature(options?: { poise?: number; profile?: ReactionProfile; timeline?: boolean }): EntityId;
  /** Queues a hit (10 slash plus `packet`) for the next step, after the timeline runs. */
  hit(target: EntityId, packet?: Partial<DamagePacketInput>): void;
  steps(n: number): void;
  stepTo(tick: number): void;
}

function setup(
  world = new World<never>({ seed: 1 }),
  pushers: readonly Pusher[] = [pushCharacter],
): Setup {
  world.register(...DAMAGE_COMPONENTS, ...ACTION_TIMELINE_COMPONENTS, HitReactionComponent);
  world.register(CharacterController, HurtboxComponent, StaminaComponent);
  world.addSystem(actionTimelineSystem({ moves: MOVES }));
  const damage = new DamageModel();
  // Hits land after the timeline has run, as the hit-volume system's do.
  const pending: [EntityId, DamagePacketInput][] = [];
  world.addSystem({
    name: 'test-hits',
    run: () => {
      for (const [target, packet] of pending.splice(0)) damage.apply(world, target, packet);
    },
  });
  const uninstall = installHitReactions(world, { moves: MOVES, damage, pushers });
  const reactions: HitReactionInfo[] = [];
  const ended: HitReactionEndInfo[] = [];
  const actionsEnded: ActionEndInfo[] = [];
  world.events.on(HitReaction, (e) => reactions.push(e));
  world.events.on(HitReactionEnded, (e) => ended.push(e));
  world.events.on(ActionEnded, (e) => actionsEnded.push(e));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step([]);
  };
  return {
    world,
    damage,
    reactions,
    ended,
    actionsEnded,
    uninstall,
    creature: ({ poise = 40, profile, timeline = true } = {}) => {
      const e = world.spawn();
      giveCombatant(world, e, { health: 200, poise });
      if (timeline) giveActionTimeline(world, e);
      giveHitReactions(world, e, profile);
      return e;
    },
    hit: (target, packet = {}) => {
      pending.push([target, { amounts: { slash: 10 }, ...packet }]);
    },
    steps,
    stepTo: (tick) => {
      steps(tick - world.tick);
    },
  };
}

/** Starts `id` on the next step; returns that tick (the move's tick 0). */
function startMove(s: Setup, e: EntityId, id: string): number {
  const at = s.world.tick;
  requestMove(s.world, e, id);
  s.steps(1);
  expect(actionOf(s.world, e)?.startedAt).toBe(at);
  return at;
}

const last = <T>(list: readonly T[]): T => {
  const item = list.at(-1);
  if (item === undefined) throw new Error('empty');
  return item;
};

describe('hit reactions: flinch (mw-e04.7)', () => {
  it('AC-1: a 15-poise hit during startup of a 40-poise creature flinches it for 12 ticks, interrupting the attack', () => {
    const s = setup();
    const goblin = s.creature({ poise: 40 });
    const t0 = startMove(s, goblin, 'swing');
    s.stepTo(t0 + 5); // move tick 5 when the hit lands: startup
    s.hit(goblin, { poiseDamage: 15 });
    const T = s.world.tick;
    s.steps(1);
    expect(last(s.reactions)).toEqual({
      tick: T,
      entity: goblin,
      reaction: 'flinch',
      direction: 'front',
      ticks: 12,
      interrupted: true,
      displaced: false,
      suppressed: null,
      instigator: null,
      source: null,
    });
    expect(s.actionsEnded).toEqual([
      { tick: T, entity: goblin, move: 'swing', reason: 'interrupted', moveTick: 5 },
    ]);
    expect(poiseOf(s.world, goblin)?.current).toBe(25);
    expect(reactionOf(s.world, goblin)).toEqual({
      kind: 'flinch',
      direction: 'front',
      startedAt: T,
      endsAt: T + 13,
      interrupted: true,
    });
    // Locked for exactly 12 ticks (T+1…T+12): a buffered request starts on T + 13, as it ends.
    const started: number[] = [];
    s.world.events.on(ActionStarted, (e) => started.push(e.tick));
    s.stepTo(T + 8);
    requestMove(s.world, goblin, 'swing');
    s.stepTo(T + 13);
    expect(reactionOf(s.world, goblin)?.kind).toBe('flinch');
    expect(started).toEqual([]);
    s.steps(1);
    expect(started).toEqual([T + 13]);
    expect(s.ended).toEqual([
      { tick: T + 13, entity: goblin, reaction: 'flinch', iframesUntil: null },
    ]);
    expect(reactionOf(s.world, goblin)).toBeUndefined();
  });

  it('AC-1: a flinch during active or recovery ticks plays over the committed move without interrupting it', () => {
    const s = setup();
    const goblin = s.creature();
    const t0 = startMove(s, goblin, 'swing');
    s.stepTo(t0 + 13); // move tick 12: active
    s.hit(goblin, { poiseDamage: 5 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'flinch', interrupted: false, ticks: 12 });
    expect(reactionOf(s.world, goblin)?.interrupted).toBe(false);
    expect(s.actionsEnded).toEqual([]);
    s.stepTo(t0 + 40);
    expect(s.actionsEnded.map((e) => e.reason)).toEqual(['completed']);
  });

  it('an idle creature flinched is held for the flinch (no move to interrupt)', () => {
    const s = setup();
    const goblin = s.creature();
    s.hit(goblin, { poiseDamage: 5 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'flinch', interrupted: false });
    expect(reactionOf(s.world, goblin)?.interrupted).toBe(true);
    expect(s.world.get(goblin, ActionTimelineComponent)?.lockTicks).toBeGreaterThan(0);
  });

  it('a creature without an action timeline still reacts, but nothing is locked', () => {
    const s = setup();
    const post = s.creature({ timeline: false });
    s.hit(post, { poiseDamage: 50 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'stagger', interrupted: false });
    expect(reactionOf(s.world, post)?.interrupted).toBe(false);
  });

  it('a hit with no poise damage and no push causes no reaction', () => {
    const s = setup();
    const goblin = s.creature();
    s.hit(goblin, { amounts: { poison: 3 } });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'none', ticks: 0, suppressed: null });
    expect(reactionOf(s.world, goblin)).toBeUndefined();
  });
});

describe('hit reactions: stagger', () => {
  it('AC-2: a hit that emits PoiseBroken staggers for 45 ticks and cancels the current action', () => {
    const s = setup();
    const goblin = s.creature({ poise: 40 });
    const broken: number[] = [];
    s.world.events.on(PoiseBroken, (e) => broken.push(e.target));
    const t0 = startMove(s, goblin, 'swing');
    s.stepTo(t0 + 14); // move tick 14 when the hit lands: active — a stagger interrupts any phase
    s.hit(goblin, { poiseDamage: 40 });
    const T = s.world.tick;
    s.steps(1);
    expect(broken).toEqual([goblin]);
    expect(last(s.reactions)).toMatchObject({
      reaction: 'stagger',
      ticks: 45,
      interrupted: true,
    });
    expect(s.actionsEnded).toEqual([
      { tick: T, entity: goblin, move: 'swing', reason: 'interrupted', moveTick: 14 },
    ]);
    expect(actionOf(s.world, goblin)).toBeUndefined();
    s.stepTo(T + 46); // through tick T + 45
    expect(reactionOf(s.world, goblin)?.kind).toBe('stagger');
    s.steps(1);
    expect(reactionOf(s.world, goblin)).toBeUndefined();
    expect(s.ended.map((e) => [e.tick, e.reaction])).toEqual([[T + 46, 'stagger']]);
  });

  it('a weaker reaction never cuts a stronger one short; an equal one restarts it', () => {
    const s = setup();
    const goblin = s.creature({ poise: 10 });
    s.hit(goblin, { poiseDamage: 10 });
    s.steps(5);
    const first = reactionOf(s.world, goblin);
    s.hit(goblin, { poiseDamage: 1 }); // a flinch during the stagger
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'none', suppressed: 'weaker' });
    expect(reactionOf(s.world, goblin)).toEqual(first);
    s.hit(goblin, { poiseDamage: 50 }); // poise was refilled on the break: breaks again
    const T = s.world.tick;
    s.steps(1);
    expect(reactionOf(s.world, goblin)).toMatchObject({ kind: 'stagger', startedAt: T });
  });
});

describe('hit reactions: direction', () => {
  const FACING = v(0, 0, 1);
  /** A hit whose source lies `degrees` to the right of the facing (it travels towards the entity). */
  const from = (degrees: number): Vec3 => {
    const r = (degrees * Math.PI) / 180;
    // right of +z facing is −x (right = facing × up).
    return v(sin(r), 0, -cos(r));
  };

  it('AC-3: a hit from behind is back; a hit at 80° to the right is right', () => {
    expect(hitDirection(FACING, from(180))).toBe('back');
    expect(hitDirection(FACING, from(80))).toBe('right');
  });

  it('AC-3: the four quadrants, with 45° boundaries counting as front or back', () => {
    expect(hitDirection(FACING, from(0))).toBe('front');
    expect(hitDirection(FACING, from(-80))).toBe('left');
    expect(hitDirection(FACING, from(-100))).toBe('left');
    expect(hitDirection(FACING, from(100))).toBe('right');
    expect(hitDirection(FACING, from(170))).toBe('back');
    expect(hitDirection(FACING, v(1, 0, -1))).toBe('front'); // exactly 45° to the right
    expect(hitDirection(FACING, v(1, 0, 1))).toBe('back'); // exactly 135°
    expect(hitDirection(v(1, 0, 0), v(0, 0, -1))).toBe('right'); // facing +x, hit from +z
  });

  it('a hit without a (horizontal) direction counts as front', () => {
    expect(hitDirection(FACING, undefined)).toBe('front');
    expect(hitDirection(FACING, v(0, -1, 0))).toBe('front');
  });

  it('AC-3: resolved hits read the facing of the hurtbox frame (+z without hurtboxes)', () => {
    const s = setup();
    const goblin = s.creature();
    giveHurtboxes(s.world, goblin, { boxes: [], facing: v(1, 0, 0) });
    s.hit(goblin, { poiseDamage: 5, direction: v(1, 0, 0) }); // travels along its facing: from behind
    s.steps(1);
    expect(last(s.reactions).direction).toBe('back');
    const plain = s.creature();
    s.hit(plain, { poiseDamage: 5, direction: v(1, 0, 0) });
    s.steps(1);
    expect(last(s.reactions).direction).toBe('right'); // facing +z; source at −x, its right
    expect(hurtboxFacing(s.world, plain)).toBeUndefined();
  });

  it('a custom facing reader is used when given', () => {
    const world = new World<never>({ seed: 1 });
    const s = setup(world);
    const goblin = s.creature();
    const info = resolveHitReaction(
      world,
      {
        tick: world.tick,
        target: goblin,
        packet: {
          instigator: null,
          source: null,
          amounts: {},
          poiseDamage: 5,
          staminaDamage: 0,
          impulse: v(0, 0, 0),
          impactForce: 0,
          direction: v(0, 0, 1),
          regionMultiplier: 1,
          tags: [],
        },
        amounts: {},
        total: 0,
        immune: false,
        poiseDamage: 5,
        staminaDamage: 0,
        tags: [],
        healthBefore: 200,
        healthAfter: 200,
        poiseBroken: false,
        died: false,
      },
      { moves: MOVES, facing: () => v(0, 0, -1) },
    );
    expect(info?.direction).toBe('front');
  });
});

describe('hit reactions: hyperarmor', () => {
  it('AC-4: in a hyperarmor window with 40 cap left, a 30-poise hit causes no reaction but damage applies', () => {
    const s = setup();
    const knight = s.creature({ poise: 50 });
    const t0 = startMove(s, knight, 'heavy');
    s.stepTo(t0 + 11); // move tick 10: the window opens
    s.hit(knight, { amounts: { slash: 20 }, poiseDamage: 30 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'none', suppressed: 'hyperarmor' });
    expect(healthOf(s.world, knight)?.current).toBe(180);
    expect(poiseOf(s.world, knight)?.current).toBe(50); // the armor soaked it
    expect(actionOf(s.world, knight)?.move).toBe('heavy');
    expect(s.world.get(knight, HitReactionComponent)?.armor).toEqual({
      startedAt: t0,
      absorbed: 30,
      broken: false,
    });
  });

  it('a further hit past the cap breaks the hyperarmor: it staggers and interrupts', () => {
    const s = setup();
    const knight = s.creature({ poise: 50 });
    const t0 = startMove(s, knight, 'heavy');
    s.stepTo(t0 + 12);
    s.hit(knight, { poiseDamage: 30 });
    s.hit(knight, { poiseDamage: 15 });
    s.steps(1);
    expect(s.reactions.map((r) => [r.reaction, r.suppressed])).toEqual([
      ['none', 'hyperarmor'],
      ['stagger', null],
    ]);
    expect(poiseOf(s.world, knight)?.current).toBe(35);
    expect(s.actionsEnded.map((e) => e.reason)).toEqual(['interrupted']);
  });

  it('once broken, the rest of that run has no hyperarmor; a new run starts a fresh cap', () => {
    const s = setup();
    const knight = s.creature({ poise: 500 });
    const damage = s.damage;
    const tags: (readonly string[])[] = [];
    const t0 = startMove(s, knight, 'heavy');
    s.stepTo(t0 + 12);
    // Applied straight through the model so the heavy keeps running (no reaction resolves yet).
    tags.push(damage.apply(s.world, knight, { amounts: {}, poiseDamage: 50 })?.tags ?? []);
    tags.push(damage.apply(s.world, knight, { amounts: {}, poiseDamage: 5 })?.tags ?? []);
    expect(tags).toEqual([[REACTION_TAGS.hyperarmorBroken], []]);
    s.steps(1); // the stagger interrupts the heavy
    s.stepTo(s.world.tick + 50);
    const t1 = startMove(s, knight, 'heavy');
    s.stepTo(t1 + 11);
    expect(damage.apply(s.world, knight, { amounts: {}, poiseDamage: 5 })?.tags).toEqual([
      REACTION_TAGS.hyperarmor,
    ]);
  });

  it('outside the window, or for a hit without poise damage, hyperarmor does nothing', () => {
    const s = setup();
    const knight = s.creature({ poise: 50 });
    const t0 = startMove(s, knight, 'heavy');
    s.stepTo(t0 + 5); // move tick 4: before the window
    expect(s.damage.apply(s.world, knight, { amounts: { slash: 1 } })?.tags).toEqual([]);
    s.hit(knight, { poiseDamage: 5 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'flinch', interrupted: true });
  });

  it('hyperarmor needs a move in the table and an entity that reacts to hits', () => {
    const world = new World<never>({ seed: 1 });
    const s = setup(world);
    const knight = s.creature();
    const t0 = startMove(s, knight, 'heavy');
    s.stepTo(t0 + 12);
    const other = new DamageModel();
    other.register(hyperarmorModifier(new Map()));
    expect(other.apply(world, knight, { amounts: {}, poiseDamage: 5 })?.tags).toEqual([]);
    const dummy = world.spawn();
    giveCombatant(world, dummy, { health: 10, poise: 10 });
    expect(s.damage.apply(world, dummy, { amounts: {}, poiseDamage: 5 })?.tags).toEqual([]);
  });
});

describe('hit reactions: knockback and knockdown', () => {
  it('AC-5: an impulse ≥ 300 N·s knocks a character back for 60 ticks, launched through the controller', () => {
    const s = setup();
    const e = spawnCharacter(s.world, v(0, 0, 0));
    giveCombatant(s.world, e, { health: 100, poise: 40 });
    giveHitReactions(s.world, e);
    s.world.set(e, CharacterController, {
      ...(s.world.get(e, CharacterController) ?? expect.fail('no controller')),
      grounded: true,
      velocity: v(0, -1, 0),
    });
    s.hit(e, { impulse: v(400, 0, 0), direction: v(1, 0, 0) });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({
      reaction: 'knockback',
      ticks: 60,
      displaced: true,
      direction: 'right',
    });
    const state = s.world.get(e, CharacterController);
    expect(state).toMatchObject({ velocity: v(5, 2, 0), grounded: false, jumped: true });
    expect(state?.groundBody).toBeNull();
  });

  it('a push without lift or rise leaves a grounded character on the ground', () => {
    const s = setup();
    const e = spawnCharacter(s.world, v(0, 0, 0));
    giveCombatant(s.world, e, { health: 100 });
    giveHitReactions(s.world, e, { ...DEFAULT_REACTION_PROFILE, launchSpeed: 0 });
    s.world.set(e, CharacterController, {
      ...(s.world.get(e, CharacterController) ?? expect.fail('no controller')),
      grounded: true,
      groundBody: 7,
    });
    s.hit(e, { impulse: v(0, 0, -800) });
    s.steps(1);
    expect(s.world.get(e, CharacterController)).toMatchObject({
      velocity: v(0, 0, -10),
      grounded: true,
      groundBody: 7,
      jumped: false,
    });
  });

  it('knockback pushes a physics object through its rigid body', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3, physics })));
    installPhysicsObjects(world);
    const s = setup(world, [pushCharacter, pushPhysicsObject]);
    const barrelman = s.creature({ timeline: false });
    addProperties(world, barrelman, { weight: 100 });
    addPhysicsObject(world, barrelman, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.9, 0.3) },
      position: v(0, 5, 0),
    });
    const ghost = s.creature({ timeline: false });
    s.hit(ghost, { impulse: v(0, 0, 500) });
    s.hit(barrelman, { impulse: v(0, 0, 500) });
    s.steps(3);
    expect(s.reactions.map((r) => [r.entity, r.reaction, r.displaced])).toEqual([
      [ghost, 'knockback', false],
      [barrelman, 'knockback', true],
    ]);
    const body = world.get(barrelman, PhysicsObjectComponent);
    expect(body?.position.z).toBeGreaterThan(0.1);
  });

  it('an entity neither a character nor a physics object reacts without being displaced', () => {
    const s = setup();
    const goblin = s.creature();
    s.hit(goblin, { impulse: v(0, 0, 350) });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'knockback', displaced: false });
  });

  it('without pushers nothing is displaced, not even a character', () => {
    const s = setup();
    const e = spawnCharacter(s.world, v(0, 0, 0));
    giveCombatant(s.world, e, { health: 100 });
    giveHitReactions(s.world, e);
    const result = s.damage.apply(s.world, e, { amounts: {}, impulse: v(0, 0, 400) });
    const info = resolveHitReaction(s.world, result ?? expect.fail('no result'), { moves: MOVES });
    expect(info).toMatchObject({ reaction: 'knockback', displaced: false });
    expect(s.world.get(e, CharacterController)?.velocity).toEqual(v(0, 0, 0));
  });

  it('a creature schema may replace tiers: a troll is knocked back where others are knocked down', () => {
    const s = setup();
    const troll = s.creature({ profile: TROLL });
    s.hit(troll, { impulse: v(0, 0, 1000) });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'knockback', ticks: 60 });
    const stoic = s.creature({
      profile: { ...DEFAULT_REACTION_PROFILE, replace: { flinch: 'none' } },
    });
    s.hit(stoic, { poiseDamage: 1 });
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'none', suppressed: 'replaced' });
  });

  it('AC-6: a knocked-down entity lies 90 ticks, then wakes invulnerable for 20 ticks and cannot be re-knocked-down', () => {
    const s = setup();
    const goblin = s.creature();
    s.hit(goblin, { impulse: v(0, 0, 900) });
    const T = s.world.tick;
    s.steps(1);
    expect(last(s.reactions)).toMatchObject({ reaction: 'knockdown', ticks: 90 });
    const wake = T + 91;
    s.stepTo(wake - 1);
    expect(reactionOf(s.world, goblin)?.kind).toBe('knockdown');
    const invulnerable: number[] = [];
    for (let t = wake - 1; t < wake + 25; t++) {
      if (hasWakeIframes(s.world, goblin)) invulnerable.push(s.world.tick);
      s.steps(1);
    }
    expect(invulnerable).toEqual(Array.from({ length: WAKE_IFRAME_TICKS }, (_, i) => wake + i));
    expect(s.ended).toEqual([
      { tick: wake, entity: goblin, reaction: 'knockdown', iframesUntil: wake + 20 },
    ]);

    // During the i-frames: no damage, no poise, no reaction.
    const again = setup();
    const g = again.creature();
    again.hit(g, { impulse: v(0, 0, 900) });
    const T2 = again.world.tick;
    again.stepTo(T2 + 91 + 5);
    again.hit(g, { amounts: { slash: 30 }, poiseDamage: 30, impulse: v(0, 0, 900) });
    again.steps(1);
    expect(last(again.reactions)).toMatchObject({ reaction: 'none', suppressed: 'invulnerable' });
    expect(healthOf(again.world, g)?.current).toBe(190);
    expect(poiseOf(again.world, g)?.current).toBe(40);
    // After them, a knockdown lands again.
    again.stepTo(T2 + 91 + 20);
    again.hit(g, { impulse: v(0, 0, 900) });
    again.steps(1);
    expect(last(again.reactions)).toMatchObject({ reaction: 'knockdown' });
  });

  it('wake-up i-frames also stop a hit whose damage bypassed the modifier', () => {
    const s = setup();
    const goblin = s.creature();
    s.hit(goblin, { impulse: v(0, 0, 900) });
    const T = s.world.tick;
    s.stepTo(T + 92);
    s.uninstall(); // modifiers gone: the damage lands…
    const info = resolveHitReaction(
      s.world,
      s.damage.apply(s.world, goblin, {
        amounts: { slash: 5 },
        impulse: v(0, 0, 900),
      }) ?? expect.fail('no result'),
      { moves: MOVES },
    );
    expect(info).toMatchObject({ reaction: 'none', suppressed: 'invulnerable' }); // …the reaction does not
  });
});

describe('hit reactions: forced reactions and edge cases', () => {
  it('applyHitReaction imposes a guard break’s 60-tick stagger over anything playing', () => {
    const s = setup();
    const knight = s.creature();
    s.hit(knight, { impulse: v(0, 0, 900) });
    s.steps(1);
    const T = s.world.tick;
    const info = applyHitReaction(
      s.world,
      knight,
      { kind: 'stagger', ticks: 60, direction: 'left', instigator: 3, source: 4 },
      { moves: MOVES },
    );
    expect(info).toEqual({
      tick: T,
      entity: knight,
      reaction: 'stagger',
      direction: 'left',
      ticks: 60,
      interrupted: false,
      displaced: false,
      suppressed: null,
      instigator: 3,
      source: 4,
    });
    expect(reactionOf(s.world, knight)).toMatchObject({ kind: 'stagger', endsAt: T + 61 });
    expect(hasWakeIframes(s.world, knight)).toBe(false);
    s.steps(1);
    expect(last(s.reactions)).toEqual(info);
  });

  it('a guard break’s 60-tick stagger is not cut short by the stagger its own hit resolves to', () => {
    const s = setup();
    const knight = s.creature({ poise: 10 });
    s.steps(1);
    const T = s.world.tick;
    applyHitReaction(s.world, knight, { kind: 'stagger', ticks: 60 }, { moves: MOVES });
    s.hit(knight, { poiseDamage: 10 }); // the same tick: breaks poise, a 45-tick stagger
    s.steps(1);
    expect(s.reactions.map((r) => [r.reaction, r.suppressed])).toEqual([
      ['stagger', null],
      ['none', 'weaker'],
    ]);
    expect(reactionOf(s.world, knight)?.endsAt).toBe(T + 61);
  });

  it('applyHitReaction defaults: the kind’s length, front, no push; none only reports', () => {
    const s = setup();
    const e = s.creature();
    expect(applyHitReaction(s.world, e, { kind: 'knockback' }, { moves: MOVES })).toMatchObject({
      ticks: 60,
      direction: 'front',
      displaced: false,
    });
    expect(applyHitReaction(s.world, e, { kind: 'none' }, { moves: MOVES })).toMatchObject({
      reaction: 'none',
      ticks: 0,
    });
    expect(reactionOf(s.world, e)?.kind).toBe('knockback');
  });

  it('applyHitReaction rejects a bad length and ignores entities that do not react', () => {
    const s = setup();
    const e = s.creature();
    expect(() =>
      applyHitReaction(s.world, e, { kind: 'stagger', ticks: 0 }, { moves: MOVES }),
    ).toThrow(RangeError);
    expect(() =>
      applyHitReaction(s.world, e, { kind: 'stagger', ticks: 1.5 }, { moves: MOVES }),
    ).toThrow('reaction length must be a whole number of ticks ≥ 1, got 1.5');
    expect(
      applyHitReaction(s.world, s.world.spawn(), { kind: 'flinch' }, { moves: MOVES }),
    ).toBeUndefined();
  });

  it('a killing blow and a target that does not react cause no reaction event', () => {
    const s = setup();
    const goblin = s.creature();
    const rock = s.world.spawn();
    giveCombatant(s.world, rock, { health: 10 });
    s.hit(rock, { poiseDamage: 50 });
    s.hit(goblin, { amounts: { slash: 500 }, poiseDamage: 50 });
    s.steps(1);
    expect(s.reactions).toEqual([]);
    expect(reactionOf(s.world, rock)).toBeUndefined();
    expect(hasWakeIframes(s.world, rock)).toBe(false);
  });

  it('uninstalling removes the subscription and the modifiers', () => {
    const s = setup();
    const goblin = s.creature();
    s.uninstall();
    expect(s.damage.modifiers()).toEqual([]);
    s.hit(goblin, { poiseDamage: 50 });
    s.steps(1);
    expect(s.reactions).toEqual([]);
  });

  it('reaction state is plain data in the world hash', () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      const e = s.creature();
      s.hit(e, { poiseDamage: 50, direction: v(0, 0, 1) });
      s.steps(10);
    }
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
  });
});

describe('hit reactions: choosing and profiles', () => {
  const calm: ReactionFactors = {
    poiseDamage: 0,
    poiseBroken: false,
    impulse: 0,
    hyperarmor: null,
    invulnerable: false,
  };
  const choose = (f: Partial<ReactionFactors>, p = DEFAULT_REACTION_PROFILE) =>
    chooseReaction({ ...calm, ...f }, p).kind;

  it('tiers from poise, hyperarmor and impulse, strongest first', () => {
    expect(choose({})).toBe('none');
    expect(choose({ poiseDamage: 1 })).toBe('flinch');
    expect(choose({ poiseBroken: true })).toBe('stagger');
    expect(choose({ hyperarmor: 'broken' })).toBe('stagger');
    expect(choose({ impulse: 299.99, poiseDamage: 1 })).toBe('flinch');
    expect(choose({ impulse: 300 })).toBe('knockback');
    expect(choose({ impulse: 900, poiseBroken: true })).toBe('knockdown');
    expect(choose({ impulse: 900, hyperarmor: 'absorbed' })).toBe('none');
    expect(choose({ impulse: 900, invulnerable: true })).toBe('none');
  });

  it('reaction and direction lists, ranks and lengths', () => {
    expect(REACTION_KINDS).toEqual(['none', 'flinch', 'stagger', 'knockback', 'knockdown']);
    expect(REACTION_DIRECTIONS).toEqual(['front', 'back', 'left', 'right']);
    expect(REACTION_KINDS.map(reactionRank)).toEqual([0, 1, 2, 3, 4]);
    expect(REACTION_TICKS).toEqual({ flinch: 12, stagger: 45, knockback: 60, knockdown: 90 });
  });

  it('a creature definition gives its profile; bad profiles are rejected', () => {
    expect(
      reactionProfileFromCreature({
        stats: { health: 1, poise: 1, mass: 350, size: 'large' },
        reactions: {
          knockbackImpulse: 500,
          knockdownImpulse: 2000,
          launchSpeed: 1,
          replace: { knockdown: 'knockback' },
        },
      }),
    ).toEqual({
      knockbackImpulse: 500,
      knockdownImpulse: 2000,
      launchSpeed: 1,
      mass: 350,
      replace: { knockdown: 'knockback' },
    });
    const world = new World<never>({ seed: 1 }).register(HitReactionComponent);
    const e = world.spawn();
    const bad = (p: Partial<ReactionProfile>) => () => {
      giveHitReactions(world, e, { ...DEFAULT_REACTION_PROFILE, ...p });
    };
    expect(bad({ mass: 0 })).toThrow(
      'reaction impulse thresholds and mass must be finite numbers > 0',
    );
    expect(bad({ knockbackImpulse: Number.NaN })).toThrow(RangeError);
    expect(bad({ knockdownImpulse: -1 })).toThrow(RangeError);
    expect(bad({ knockdownImpulse: 100 })).toThrow('knockdownImpulse must be ≥ knockbackImpulse');
    expect(bad({ launchSpeed: -1 })).toThrow('launchSpeed must be a finite number ≥ 0');
    expect(bad({ launchSpeed: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});
