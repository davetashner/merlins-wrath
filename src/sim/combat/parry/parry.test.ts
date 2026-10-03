import type { HitStopTable, MoveTable, MoveVerb, RuntimeMove, RuntimeShield } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import type { System } from '../../core/world';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import { cos, sin } from '../../math';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import type { DamagePacketInput } from '../damage/packet';
import { HitStopComponent } from '../hitstop/components';
import { HitStopStarted, type HitStopInfo } from '../hitstop/events';
import { installHitStop } from '../hitstop/hitstop';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  type Hurtbox,
  type SocketTrack,
} from '../hits/components';
import { hitVolumeSystem, noAllies } from '../hits/system';
import { facingOf, giveFacing, giveGuard, MELEE_COMPONENTS } from '../melee/components';
import { keepFacing, facingSystem } from '../melee/facing';
import { blockSystem, shieldGuard } from '../melee/guard';
import { installMeleeStrikes } from '../melee/strikes';
import { giveHitReactions, HitReactionComponent, reactionOf } from '../reactions/components';
import { HitReaction, type HitReactionInfo } from '../reactions/events';
import { installHitReactions } from '../reactions/reactions';
import { DEFAULT_STAMINA_PROFILE, giveStamina, StaminaComponent, staminaOf } from '../stamina';
import { staminaSystem } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  giveActionInput,
  giveActionTimeline,
} from '../timeline/components';
import { ActionStarted, type ActionStartInfo } from '../timeline/events';
import { actionOf, actionTimelineSystem, canActNow, requestMove } from '../timeline/timeline';
import {
  deflectedRun,
  isParried,
  PARRY_COMPONENTS,
  ParryComponent,
  parriedOf,
  updateParry,
} from './components';
import { HitParried, type ParryInfo } from './events';
import {
  COUNTER_HIT_MULTIPLIER,
  counterHitModifier,
  installParry,
  PARRIED_TICKS,
  parriedSystem,
  parryGuard,
  parryPhaseOf,
  parryWindowOf,
  RIPOSTE_ARC_DEGREES,
  RIPOSTE_DAMAGE_MULTIPLIER,
  RIPOSTE_RANGE,
  riposteModifier,
  riposteRedirect,
  riposteTargetOf,
} from './parry';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const TABLE: HitStopTable = Object.freeze({
  light: 3,
  heavy: 5,
  charged: 6,
  parry: 8,
  critical: 10,
});

const WOOD: RuntimeShield = Object.freeze({
  id: 'wood-shield',
  kind: 'shield',
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
  readonly tags?: readonly string[];
  readonly parryable?: boolean;
  readonly reach?: number;
  readonly iframes?: { readonly from: number; readonly to: number };
  readonly hitStop?: RuntimeMove['hitStop'];
}

/** A RuntimeMove as compileMove builds it; a hitting move thrusts a blade along +z at chest height. */
function move(spec: MoveSpec): RuntimeMove {
  const { id, verb = 'attack', frames, cost = 0, slash = 20, poise = 15 } = spec;
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
    cancelWindows: [],
    damage: canHit
      ? {
          amounts: { slash },
          poiseDamage: poise,
          staminaDamage: 12,
          impulse: v3(0, 0, 0),
          impactForce: 0,
          tags: spec.tags ?? [],
        }
      : null,
    hitbox: canHit
      ? {
          track: `${id}-track`,
          shape: {
            kind: 'capsule',
            from: v3(0, 1.1, 0.3),
            to: v3(0, 1.1, spec.reach ?? 1.8),
            radius: 0.12,
          },
          reach: 'medium',
          swing: 'thrust',
        }
      : null,
    parryable: canHit && spec.parryable !== false,
    blockable: canHit,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: spec.iframes ?? null,
    telegraphTick: 0,
    chainNext: null,
    charge: null,
    motion: null,
    hitStop: canHit ? (spec.hitStop ?? 'light') : null,
    presentation: { anim: `anim-${id}` },
  } satisfies RuntimeMove);
}

// The knight's parry (bead numbers: 30 ticks, 10 stamina, window 4–13), a light attack, the riposte
// (a critical tagged in data, i-frames for its duration) and a foe's parryable swing.
const PARRY = move({ id: 'parry', verb: 'parry', frames: [4, 10, 16], cost: 10 });
const LIGHT = move({ id: 'light', frames: [12, 4, 18], cost: 12 });
const RIPOSTE = move({
  id: 'riposte',
  frames: [8, 4, 24],
  poise: 0,
  tags: ['critical', 'riposte'],
  iframes: { from: 0, to: 35 },
  hitStop: 'critical',
});
const SWING = move({ id: 'swing', frames: [18, 4, 14], slash: 30, poise: 20 });
const MOVES: MoveTable = new Map([PARRY, LIGHT, RIPOSTE, SWING].map((m) => [m.id, m]));
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

const press = (button: ButtonAction) =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === button, b === button, false),
  });

/** The foe's parryable 30-slash swing, arriving at the knight (at the origin) from +z. */
const SWING_HIT: DamagePacketInput = {
  amounts: { slash: 30 },
  poiseDamage: 20,
  staminaDamage: 20,
  direction: v3(0, 0, -1),
  tags: ['parryable'],
};

interface Options {
  /** Where the foe stands (default 1.8 m in front of the knight). */
  readonly foeAt?: Vec3;
  /** Install the parry-tier hit-stop (default true). */
  readonly hitStop?: boolean;
  readonly difficulty?: { readonly parryWindow: number };
  /** The knight carries the wood shield (default true). */
  readonly shield?: boolean;
  /** The knight is the player (default true). */
  readonly player?: boolean;
}

function setup(options: Options = {}) {
  const world = new World<ActionFrame>({
    seed: 1,
    ...(options.difficulty && { difficulty: options.difficulty }),
  }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    HitStopComponent,
    HitReactionComponent,
  );
  const damage = new DamageModel();
  damage.register(shieldGuard());
  /** Scripted hits on the knight, applied on their world tick after the timeline has run. */
  const strikes = new Map<number, DamagePacketInput>();
  const results: (DamageResult | undefined)[] = [];
  let knight = 0 as EntityId;
  let foe = 0 as EntityId;
  const striker: System<ActionFrame> = {
    name: 'test-strikes',
    run: ({ world: w }) => {
      const packet = strikes.get(w.tick);
      if (packet !== undefined)
        results.push(damage.apply(w, knight, { instigator: foe, ...packet }));
    },
  };
  world
    .addSystem(staminaSystem())
    .addSystem(blockSystem({ moves: MOVES }))
    .addSystem(
      actionTimelineSystem({
        moves: MOVES,
        redirect: riposteRedirect({ trigger: 'light', riposte: 'riposte' }),
      }),
    )
    .addSystem(facingSystem({ moves: MOVES, desired: keepFacing }))
    .addSystem(striker)
    .addSystem(hitVolumeSystem({ isAlly: noAllies }));
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  if (options.hitStop !== false) installHitStop(world, { moves: MOVES, table: TABLE });
  installHitReactions(world, { moves: MOVES, damage });
  const uninstall = installParry(world, {
    moves: MOVES,
    damage,
    ...(options.hitStop !== false && { hitStop: TABLE }),
    riposte: 'riposte',
  });

  knight = world.spawn();
  placeEntity(world, knight, v3(0, 0, 0), 0.35);
  giveActionTimeline(world, knight);
  giveStamina(world, knight, { ...DEFAULT_STAMINA_PROFILE, regenPerSecond: 0 });
  giveFacing(world, knight);
  if (options.shield !== false) giveGuard(world, knight, WOOD);
  giveHitboxes(world, knight);
  giveHurtboxes(world, knight, { boxes: [torso] });
  giveCombatant(world, knight, { health: 100, poise: 50, player: options.player !== false });
  giveActionInput(world, knight, { primaryAttack: 'light', ability3: 'parry' });

  foe = world.spawn();
  placeEntity(world, foe, options.foeAt ?? v3(0, 0, 1.8), 0.4);
  giveActionTimeline(world, foe);
  giveFacing(world, foe, v3(0, 0, -1));
  giveHitboxes(world, foe);
  giveHurtboxes(world, foe, { facing: v3(0, 0, -1), boxes: [torso] });
  giveCombatant(world, foe, { health: 500, poise: 40 });
  giveHitReactions(world, foe);

  const started: ActionStartInfo[] = [];
  const applied: DamageResult[] = [];
  const parries: ParryInfo[] = [];
  const freezes: HitStopInfo[] = [];
  const reactions: HitReactionInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(DamageApplied, (e) => applied.push(e));
  world.events.on(HitParried, (e) => parries.push(e));
  world.events.on(HitStopStarted, (e) => freezes.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  /** Steps until `tick` is the next tick to simulate. */
  const stepTo = (tick: number) => {
    while (world.tick < tick) world.step([IDLE_ACTION_FRAME]);
  };
  /** Presses `button` on world tick `tick`. */
  const pressAt = (tick: number, button: ButtonAction) => {
    stepTo(tick);
    world.step([press(button)]);
  };
  /** Strikes the knight on world tick `tick` with `packet` (the foe's swing by default). */
  const strikeAt = (
    tick: number,
    packet: { readonly [K in keyof DamagePacketInput]?: DamagePacketInput[K] | undefined } = {},
  ) => {
    strikes.set(tick, { ...SWING_HIT, ...packet } as DamagePacketInput);
  };
  return {
    world,
    damage,
    knight,
    foe,
    results,
    started,
    applied,
    parries,
    freezes,
    reactions,
    stepTo,
    pressAt,
    strikeAt,
    uninstall,
  };
}

type Setup = ReturnType<typeof setup>;

/** Parry pressed on tick 0 and one swing landing on `tick`; the resolved hit. */
function parryThenHitOn(tick: number, options: Options = {}): Setup & { hit: DamageResult } {
  const s = setup(options);
  s.strikeAt(tick);
  s.pressAt(0, 'ability3');
  s.stepTo(tick + 1);
  const hit = s.results[0];
  if (hit === undefined) throw new Error('the strike did not resolve');
  return { ...s, hit };
}

const health = (s: Setup, e: EntityId) => healthOf(s.world, e)?.current;

describe('parry window (mw-e04.12)', () => {
  it('AC-1: parry pressed on tick 0 deflects a parryable hit landing on tick 4 or 13, not on 3 or 14', () => {
    const outcomes = [3, 4, 13, 14].map((tick) => {
      const { hit, parries } = parryThenHitOn(tick);
      return [tick, hit.total, hit.tags.includes('parried'), parries.length];
    });
    expect(outcomes).toEqual([
      [3, 30, false, 0],
      [4, 0, true, 1],
      [13, 0, true, 1],
      [14, 30 * COUNTER_HIT_MULTIPLIER, false, 0],
    ]);
  });

  it('AC-2: a successful parry costs the defender no health and no stamina; the attacker is Parried for exactly 90 ticks', () => {
    const s = setup({ hitStop: false });
    s.strikeAt(4);
    s.pressAt(0, 'ability3');
    s.stepTo(4);
    const staminaBefore = staminaOf(s.world, s.knight)?.current;
    expect(staminaBefore).toBe(100 - 10); // the parry's own cost, spent on tick 0
    s.stepTo(5);
    expect(staminaOf(s.world, s.knight)?.current).toBe(staminaBefore);
    expect(health(s, s.knight)).toBe(100);
    expect(s.applied.map((d) => [d.tick, d.total, d.poiseDamage, d.staminaDamage])).toEqual([
      [4, 0, 0, 0],
    ]);
    expect(s.parries).toEqual([
      { tick: 4, entity: s.knight, attacker: s.foe, source: null, parriedTicks: PARRIED_TICKS },
    ]);
    // Parried from tick 5 through tick 94: 90 ticks, and locked exactly as long.
    const parried: number[] = [];
    for (let tick = 5; tick <= 120; tick++) {
      if (isParried(s.world, s.foe)) parried.push(s.world.tick);
      expect(canActNow(s.world, s.foe, MOVES, 'attack')).toBe(!isParried(s.world, s.foe));
      s.stepTo(tick + 1);
    }
    expect(parried).toHaveLength(PARRIED_TICKS);
    expect([parried[0], parried.at(-1)]).toEqual([5, 94]);
  });

  it('AC-2: the parry freezes both fighters for the parry tier, and the stun lasts 90 unfrozen ticks', () => {
    const s = setup();
    s.strikeAt(4);
    s.pressAt(0, 'ability3');
    s.stepTo(5);
    expect(s.freezes.map((f) => [f.entity, f.tier, f.ticks])).toEqual([
      [s.foe, 'parry', 8],
      [s.knight, 'parry', 8],
    ]);
    expect(parriedOf(s.world, s.foe)).toMatchObject({ by: s.knight, startedAt: 4, ticksLeft: 90 });
    s.stepTo(102);
    expect(parriedOf(s.world, s.foe)?.ticksLeft).toBe(1);
    expect(canActNow(s.world, s.foe, MOVES, 'attack')).toBe(false);
    s.stepTo(103);
    expect(isParried(s.world, s.foe)).toBe(false);
    expect(canActNow(s.world, s.foe, MOVES, 'attack')).toBe(true);
  });

  it('AC-5: a failed parry is vulnerable after its window: a hit on tick 20 deals ×1.25, tagged counter', () => {
    const { hit } = parryThenHitOn(20);
    expect(hit.total).toBe(37.5);
    expect(hit.tags).toContain('counter');
    expect(hit.tags).not.toContain('parried');
  });

  it('AC-5: a parry that deflected a hit has no counter window', () => {
    const s = setup({ hitStop: false });
    s.strikeAt(6);
    s.strikeAt(20, { instigator: null });
    s.pressAt(0, 'ability3');
    s.stepTo(21);
    expect(s.results.map((r) => [r?.tick, r?.total, r?.tags])).toEqual([
      [6, 0, ['parried', 'parryable']],
      [20, 30, ['parryable']],
    ]);
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBe('recovery');
  });

  it('AC-6: an unparryable hit (no parryable tag: grabs, most spells) inside the window is a normal unblocked hit', () => {
    const s = setup();
    s.strikeAt(8, { tags: [] });
    s.pressAt(0, 'ability3');
    s.stepTo(9);
    expect(s.results[0]?.total).toBe(30);
    expect(s.results[0]?.poiseDamage).toBe(20);
    expect(s.results[0]?.tags).toEqual([]);
    expect(s.parries).toEqual([]);
    expect(isParried(s.world, s.foe)).toBe(false);
    expect(health(s, s.knight)).toBe(70);
  });

  it('the parry assist widens the player’s window from its first tick (×2.0: ticks 4–23)', () => {
    const wide = { difficulty: { parryWindow: 2 } };
    expect(parryThenHitOn(23, wide).hit.tags).toContain('parried');
    expect(parryThenHitOn(24, wide).hit.tags).toContain('counter');
    // Only the player's window scales.
    expect(parryThenHitOn(14, { ...wide, player: false }).hit.tags).toContain('counter');
  });

  it('parryWindowOf: the active ticks of a parry, scaled from the first, at least 1 and inside the move', () => {
    expect(parryWindowOf(PARRY)).toEqual({ from: 4, to: 13 });
    expect(parryWindowOf(PARRY, 1.5)).toEqual({ from: 4, to: 18 });
    expect(parryWindowOf(PARRY, 3)).toEqual({ from: 4, to: 29 });
    expect(parryWindowOf(PARRY, 0.01)).toEqual({ from: 4, to: 4 });
    expect(parryWindowOf(LIGHT)).toBeNull();
    expect(parryWindowOf(move({ id: 'feint', verb: 'parry', frames: [4, 0, 6] }))).toBeNull();
  });

  it('a shielded parry deflects only hits from inside its shield’s arc; without a shield, any side', () => {
    const behind = { direction: v3(0, 0, 1) };
    const shielded = setup();
    shielded.strikeAt(6, behind);
    shielded.pressAt(0, 'ability3');
    shielded.stepTo(7);
    expect(shielded.results[0]?.total).toBe(30);
    const bare = setup({ shield: false });
    bare.strikeAt(6, behind);
    bare.pressAt(0, 'ability3');
    bare.stepTo(7);
    expect(bare.results[0]?.tags).toContain('parried');
    // A hit with no direction meets the shield rule's "unknown side": still parried.
    const blind = setup();
    blind.strikeAt(6, { direction: undefined });
    blind.pressAt(0, 'ability3');
    blind.stepTo(7);
    expect(blind.results[0]?.tags).toContain('parried');
  });

  it('a deflection with no attacker to stun freezes only the parrier; one by an entity without a timeline stuns nobody', () => {
    const s = setup();
    s.strikeAt(5, { instigator: null });
    s.pressAt(0, 'ability3');
    s.stepTo(6);
    expect(s.parries.map((p) => [p.attacker, p.parriedTicks])).toEqual([[null, 0]]);
    expect(s.freezes.map((f) => f.entity)).toEqual([s.knight]);

    const t = setup({ hitStop: false });
    const post = t.world.spawn();
    t.strikeAt(5, { instigator: post });
    t.strikeAt(7, { instigator: t.knight });
    t.pressAt(0, 'ability3');
    t.stepTo(8);
    expect(t.parries.map((p) => [p.attacker, p.parriedTicks])).toEqual([
      [post, 0],
      [t.knight, 0],
    ]);
    expect(isParried(t.world, post)).toBe(false);
  });

  it('the foe’s real swing, parried in the window, closes its hitbox and makes it Parried', () => {
    const s = setup({ foeAt: v3(0, 0, 1.2) });
    s.world.step([IDLE_ACTION_FRAME]);
    requestMove(s.world, s.foe, 'swing'); // starts on tick 1: active on 19
    s.stepTo(12);
    s.pressAt(12, 'ability3'); // window 16–25
    s.stepTo(60);
    expect(s.applied.map((d) => [d.tick, d.target, d.total, d.tags])).toEqual([
      [19, s.knight, 0, ['parried', 'parryable']],
    ]);
    expect(parriedOf(s.world, s.foe)?.by).toBe(s.knight);
    expect(actionOf(s.world, s.foe)).toBeUndefined();
    // No reaction plays for a deflected hit.
    expect(s.reactions).toEqual([]);
  });

  it('a Parried stun is kept (and re-parried) in the same component', () => {
    const s = setup({ hitStop: false });
    s.strikeAt(4);
    s.pressAt(0, 'ability3');
    s.stepTo(40);
    s.strikeAt(44);
    s.pressAt(40, 'ability3');
    s.stepTo(45);
    expect(s.parries.map((p) => p.tick)).toEqual([4, 44]);
    expect(parriedOf(s.world, s.foe)?.startedAt).toBe(44);
    expect(deflectedRun(s.world, s.knight)).toBe(40);
  });
});

describe('riposte (mw-e04.12)', () => {
  /** A knight that parried the foe on tick 4 and stands idle again by tick 50. */
  function parried(options: Options = {}) {
    const s = setup(options);
    s.strikeAt(4);
    s.pressAt(0, 'ability3');
    s.stepTo(50);
    expect(isParried(s.world, s.foe)).toBe(true);
    return s;
  }

  it('AC-3: attack pressed with a Parried target 1.8 m ahead starts the riposte: 3× base damage, critical and riposte', () => {
    const s = parried();
    expect(riposteTargetOf(s.world, s.knight)).toBe(s.foe);
    s.pressAt(50, 'primaryAttack');
    s.stepTo(80);
    expect(s.started.filter((e) => e.entity === s.knight).map((e) => [e.tick, e.move])).toEqual([
      [0, 'parry'],
      [50, 'riposte'],
    ]);
    const hit = s.applied.find((d) => d.target === s.foe);
    expect(hit?.total).toBe(20 * RIPOSTE_DAMAGE_MULTIPLIER);
    expect(hit?.tags).toEqual(expect.arrayContaining(['critical', 'riposte']));
    expect(health(s, s.foe)).toBe(500 - 60);
    // The riposte ends the stun; the critical staggers although it deals no poise damage.
    expect(isParried(s.world, s.foe)).toBe(false);
    expect(s.reactions.find((r) => r.entity === s.foe)?.reaction).toBe('stagger');
    expect(s.freezes.filter((f) => f.tier === 'critical')).toHaveLength(2);
  });

  it('AC-4: with the Parried target 2.2 m away, attack starts a normal light attack', () => {
    const s = parried({ foeAt: v3(0, 0, 2.2) });
    expect(riposteTargetOf(s.world, s.knight)).toBeUndefined();
    s.pressAt(50, 'primaryAttack');
    expect(s.started.at(-1)).toMatchObject({ tick: 50, entity: s.knight, move: 'light' });
  });

  it('the target must be inside the frontal 60°; the riposte turns the knight to face it', () => {
    const r = RIPOSTE_RANGE * 0.9;
    const outside = parried({ foeAt: v3(r * sin(0.6), 0, r * cos(0.6)) }); // 34° off
    expect(riposteTargetOf(outside.world, outside.knight)).toBeUndefined();
    const inside = parried({ foeAt: v3(r * sin(0.5), 0, r * cos(0.5)) }); // 28.6° off
    expect(RIPOSTE_ARC_DEGREES / 2).toBeGreaterThan((0.5 * 180) / Math.PI);
    inside.pressAt(50, 'primaryAttack');
    const facing = facingOf(inside.world, inside.knight);
    expect(facing.x).toBeCloseTo(sin(0.5), 9);
    expect(facing.z).toBeCloseTo(cos(0.5), 9);
  });

  it('the nearest Parried foe wins; nobody is a riposte target of itself or without a stun', () => {
    const s = parried();
    const near = s.world.spawn();
    placeEntity(s.world, near, v3(0, 0, 1), 0.4);
    const far = s.world.spawn();
    placeEntity(s.world, far, v3(0, 0, 1.9), 0.4);
    s.world.step([IDLE_ACTION_FRAME]);
    updateParry(s.world, near, {
      parried: { by: s.knight, startedAt: 50, endsAt: 200 },
    });
    updateParry(s.world, far, {
      parried: { by: s.knight, startedAt: 50, endsAt: 200 },
    });
    s.world.step([IDLE_ACTION_FRAME]);
    expect(riposteTargetOf(s.world, s.knight)).toBe(near);
    expect(riposteTargetOf(s.world, near)).toBe(s.foe);
    // A knight standing on its Parried foe's spot still ripostes it, and keeps its facing.
    placeEntity(s.world, s.knight, v3(0, 0, 1), 0.35);
    expect(riposteTargetOf(s.world, s.knight)).toBe(near);
    const before = facingOf(s.world, s.knight);
    s.pressAt(s.world.tick, 'primaryAttack');
    expect(s.started.at(-1)?.move).toBe('riposte');
    expect(facingOf(s.world, s.knight)).toEqual(before);
  });

  it('riposteTargetOf needs placements and the parry component', () => {
    const s = parried();
    const drifter = s.world.spawn();
    expect(riposteTargetOf(s.world, drifter)).toBeUndefined();
    const bare = new World({ seed: 1 });
    expect(riposteTargetOf(bare, bare.spawn())).toBeUndefined();
    const placed = new World({ seed: 1 }).register(...PARRY_COMPONENTS);
    expect(riposteTargetOf(placed, placed.spawn())).toBeUndefined();
  });

  it('the redirect only replaces its trigger', () => {
    const s = parried();
    const redirect = riposteRedirect({ trigger: 'light', riposte: 'riposte' });
    expect(redirect(s.world, s.knight, 'light', LIGHT)).toBe('riposte');
    expect(redirect(s.world, s.knight, 'swing', SWING)).toBeUndefined();
    expect(redirect(s.world, s.foe, 'light', LIGHT)).toBeUndefined();
  });

  it('a riposte hit on a target that is not Parried still deals 3× and is critical', () => {
    const s = setup();
    s.world.step([IDLE_ACTION_FRAME]);
    const result = s.damage.apply(s.world, s.foe, {
      instigator: s.knight,
      amounts: { slash: 20 },
      tags: ['riposte'],
    });
    expect(result?.total).toBe(60);
    expect(result?.tags).toEqual(['critical', 'riposte']);
  });
});

describe('parry rules in isolation (mw-e04.12)', () => {
  it('parryPhaseOf: startup, window, counter; undefined when not parrying or without timelines', () => {
    const s = setup();
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBeUndefined();
    s.pressAt(0, 'ability3');
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBe('startup');
    s.stepTo(5);
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBe('window');
    s.stepTo(15);
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBe('counter');
    expect(parryPhaseOf(s.world, s.knight, new Map())).toBeUndefined();
    s.pressAt(40, 'primaryAttack');
    expect(parryPhaseOf(s.world, s.knight, MOVES)).toBeUndefined();
    expect(parryPhaseOf(new World({ seed: 1 }), 1, MOVES)).toBeUndefined();
  });

  it('counter-hits spare environmental damage and self-harm', () => {
    const s = setup();
    s.strikeAt(20, { tags: ['environment'] });
    s.strikeAt(21, { instigator: undefined });
    s.pressAt(0, 'ability3');
    s.stepTo(22);
    expect(s.results.map((r) => r?.total)).toEqual([30, 37.5]);
    // Harm to itself (the knight is the instigator) is never a counter-hit.
    const t = setup();
    t.strikeAt(20, { instigator: t.knight });
    t.pressAt(0, 'ability3');
    t.stepTo(21);
    expect(t.results[0]?.total).toBe(30);
  });

  it('parry state reads nothing in a world without the component', () => {
    const world = new World({ seed: 1 });
    const e = world.spawn();
    expect(parriedOf(world, e)).toBeUndefined();
    expect(deflectedRun(world, e)).toBeNull();
    expect(world.isRegistered(ParryComponent)).toBe(false);
  });

  it('the Parried system only extends stuns that are running and frozen', () => {
    const world = new World({ seed: 1 }).register(...PARRY_COMPONENTS, HitStopComponent);
    world.addSystem(parriedSystem());
    const calm = world.spawn();
    const over = world.spawn();
    const running = world.spawn();
    updateParry(world, calm, { deflected: 3 });
    updateParry(world, over, { parried: { by: calm, startedAt: 0, endsAt: 1 } });
    updateParry(world, running, { parried: { by: calm, startedAt: 0, endsAt: 10 } });
    world.add(running, HitStopComponent, { tier: 'parry', startedAt: 0, from: 2, until: 3 });
    for (let i = 0; i < 6; i++) world.step();
    expect(world.get(over, ParryComponent)?.parried?.endsAt).toBe(1);
    expect(world.get(running, ParryComponent)?.parried?.endsAt).toBe(12);
  });

  it('the rules register on the damage model and come off with the uninstaller', () => {
    const s = setup();
    const names = () => s.damage.modifiers().map((m) => m.name);
    expect(names()).toEqual(
      expect.arrayContaining(['parry', 'counter-hit', 'riposte', 'shield-block']),
    );
    s.uninstall();
    expect(names()).not.toContain('parry');
    expect(names()).not.toContain('counter-hit');
    expect(names()).not.toContain('riposte');
  });

  it('installParry without a riposte (or without facings) turns nobody', () => {
    for (const riposte of [undefined, 'riposte']) {
      const world = new World<ActionFrame>({ seed: 1 }).register(
        ...ACTION_TIMELINE_COMPONENTS,
        ...DAMAGE_COMPONENTS,
        StaminaComponent,
        PlacementComponent,
      );
      installParry(world, {
        moves: MOVES,
        damage: new DamageModel(),
        ...(riposte !== undefined && { riposte }),
      });
      world.addSystem(actionTimelineSystem({ moves: MOVES }));
      const e = world.spawn();
      giveActionTimeline(world, e);
      world.step([]);
      requestMove(world, e, 'riposte');
      world.step([]);
      expect(actionOf(world, e)?.move).toBe('riposte');
      expect(world.isRegistered(ParryComponent)).toBe(true);
    }
  });

  it('a world without shields (and with the component registered already) parries from any side', () => {
    const world = new World<ActionFrame>({ seed: 1 }).register(
      ...ACTION_TIMELINE_COMPONENTS,
      ...DAMAGE_COMPONENTS,
      ...PARRY_COMPONENTS,
      StaminaComponent,
    );
    const damage = new DamageModel();
    installParry(world, { moves: MOVES, damage });
    const fighter = world.spawn();
    const results: (DamageResult | undefined)[] = [];
    world.addSystem(actionTimelineSystem({ moves: MOVES })).addSystem({
      name: 'strike',
      run: ({ world: w }) => {
        if (w.tick === 5) results.push(damage.apply(w, fighter, SWING_HIT));
      },
    });
    giveActionTimeline(world, fighter);
    giveCombatant(world, fighter, { health: 50 });
    requestMove(world, fighter, 'parry');
    while (world.tick < 6) world.step([]);
    expect(results[0]?.tags).toContain('parried');
  });

  it('a riposte started with no Parried foe in reach keeps the knight’s facing', () => {
    const s = setup();
    s.world.step([IDLE_ACTION_FRAME]);
    const before = facingOf(s.world, s.knight);
    requestMove(s.world, s.knight, 'riposte');
    s.world.step([IDLE_ACTION_FRAME]);
    expect(actionOf(s.world, s.knight)?.move).toBe('riposte');
    expect(facingOf(s.world, s.knight)).toEqual(before);
  });

  it('the rules are plain damage modifiers at the stages the model documents', () => {
    expect(parryGuard({ moves: MOVES }).stage).toBe('guard');
    expect(counterHitModifier(MOVES).stage).toBe('attacker');
    expect(riposteModifier().stage).toBe('attacker');
  });

  it('the shield never takes a hit a parry already deflected', () => {
    const s = setup();
    const hold = actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (b) => actionButton(false, b === 'secondaryAttack', false),
    });
    for (let i = 0; i < 10; i++) s.world.step([hold]);
    // Raised and not parrying: a parryable hit is blocked like any other.
    const blocked = s.damage.apply(s.world, s.knight, { instigator: s.foe, ...SWING_HIT });
    expect(blocked?.tags).toContain('blocked');
    const deflecting = new DamageModel();
    deflecting.register({
      name: 'deflect',
      stage: 'guard',
      apply: (hit) => ({ ...hit, tags: [...hit.tags, 'parried'] }),
    });
    deflecting.register(shieldGuard());
    const stamina = staminaOf(s.world, s.knight)?.current;
    const deflected = deflecting.apply(s.world, s.knight, { instigator: s.foe, ...SWING_HIT });
    expect(deflected?.tags).not.toContain('blocked');
    expect(staminaOf(s.world, s.knight)?.current).toBe(stamina);
    expect(reactionOf(s.world, s.knight)).toBeUndefined();
  });
});
