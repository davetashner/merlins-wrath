import type { HitStopTable, MoveTable, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE, type Pose } from '../../geom';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant } from '../damage/components';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  type Hurtbox,
} from '../hits/components';
import { HitboxHit, type HitboxHitInfo } from '../hits/events';
import { hitVolumeDebug, hitVolumeSystem, noAllies } from '../hits/system';
import { MELEE_COMPONENTS } from '../melee/components';
import { StaminaComponent } from '../stamina';
import { installMeleeStrikes } from '../melee/strikes';
import { giveHitReactions, HitReactionComponent, WAKE_IFRAME_TICKS } from '../reactions/components';
import { HitReactionEnded, type HitReactionEndInfo } from '../reactions/events';
import { applyHitReaction, installHitReactions } from '../reactions/reactions';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionTimeline,
} from '../timeline/components';
import { ActionEnded, ActionStarted, type ActionEndInfo } from '../timeline/events';
import { actionOf, actionTimelineSystem, requestMove, setTimeScale } from '../timeline/timeline';
import { HitStopComponent, hitStopOf, isHitStopped } from './components';
import { HitStopStarted, type HitStopInfo } from './events';
import { applyHitStop, installHitStop } from './hitstop';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// The bead's numbers (the content table, src/content/data/hit-stop/hit-stop.json, pins them too).
const TABLE: HitStopTable = Object.freeze({
  light: 3,
  heavy: 5,
  charged: 6,
  parry: 8,
  critical: 10,
});

/** A RuntimeMove as compileMove builds it: a blade along +z at chest height, or no hitbox. */
function move(
  id: string,
  frames: readonly [number, number, number],
  hitStop: RuntimeMove['hitStop'],
  poise = 5,
): RuntimeMove {
  const [startup, active, recovery] = frames;
  const canHit = hitStop !== null;
  return Object.freeze({
    id,
    verb: canHit ? 'attack' : 'dodge',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: 0,
    cancelWindows: [],
    damage: canHit
      ? {
          amounts: { slash: 10 },
          poiseDamage: poise,
          staminaDamage: 0,
          impulse: v3(0, 0, 0),
          impactForce: 0,
          tags: [],
        }
      : null,
    hitbox: canHit
      ? {
          track: `${id}-track`,
          shape: {
            kind: 'capsule',
            from: v3(0, 1.2, 0.35),
            to: v3(0, 1.2, 1.45),
            radius: 0.08,
          },
          reach: 'medium',
          swing: 'vertical',
        }
      : null,
    parryable: canHit,
    blockable: canHit,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    chainNext: null,
    charge: null,
    motion: null,
    hitStop,
    presentation: { anim: `anim-${id}` },
  } satisfies RuntimeMove);
}

// A heavy that turns active on move tick 20 (so it connects on world tick 20 when started on 0), a
// light, a heavier poise-breaking heavy, a long non-hitting stance for the victim, and a slow swing.
const HEAVY = move('heavy', [20, 5, 20], 'heavy');
const LIGHT = move('light', [20, 4, 10], 'light');
const BREAKER = move('breaker', [20, 5, 20], 'heavy', 100);
const STANCE = move('stance', [0, 60, 0], null);
const SWING = move('swing', [10, 4, 10], 'light');
const MOVES: MoveTable = new Map([HEAVY, LIGHT, BREAKER, STANCE, SWING].map((m) => [m.id, m]));

/** Key k is active tick k; each key moves the blade 1 cm right, so every sweep has its own pose. */
const TRACK_KEYS: readonly Pose[] = Array.from({ length: 6 }, (_, k) => ({
  position: v3(k / 100, 0, 0),
  rotation: IDENTITY_POSE.rotation,
}));
const TRACKS = new Map(
  [...MOVES.values()].map((m) => [`${m.id}-track`, { id: `${m.id}-track`, keys: TRACK_KEYS }]),
);

const torso: Hurtbox = {
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.3 },
};

interface SetupOptions {
  /** Victims along the blade, at these distances ahead of the attacker (default one, at 1 m). */
  readonly victims?: readonly number[];
  /** Victims react to hits (e04.7). */
  readonly reactions?: boolean;
}

function setup(options: SetupOptions = {}) {
  const world = new World({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    HitReactionComponent,
    HitStopComponent,
    StaminaComponent,
  );
  const damage = new DamageModel();
  world
    .addSystem(actionTimelineSystem({ moves: MOVES }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies }));
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  if (options.reactions === true) installHitReactions(world, { moves: MOVES, damage });
  const uninstall = installHitStop(world, { moves: MOVES, table: TABLE });

  const fighter = (at: Vec3): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, at, 0.3);
    giveActionTimeline(world, e);
    giveHitboxes(world, e);
    giveHurtboxes(world, e, { boxes: [torso] });
    giveCombatant(world, e, { health: 1000, poise: 50 });
    if (options.reactions === true) giveHitReactions(world, e);
    return e;
  };
  const attacker = fighter(v3(0, 0, 0));
  const victims = (options.victims ?? [1]).map((z) => fighter(v3(0, 0, z)));

  const hits: HitboxHitInfo[] = [];
  const stops: HitStopInfo[] = [];
  const ended: ActionEndInfo[] = [];
  const reactionsEnded: HitReactionEndInfo[] = [];
  const startedAt = new Map<EntityId, number[]>();
  world.events.on(HitboxHit, (e) => hits.push(e));
  world.events.on(HitStopStarted, (e) => stops.push(e));
  world.events.on(ActionEnded, (e) => ended.push(e));
  world.events.on(HitReactionEnded, (e) => reactionsEnded.push(e));
  world.events.on(ActionStarted, (e) => {
    startedAt.set(e.entity, [...(startedAt.get(e.entity) ?? []), e.tick]);
  });
  const w: World<never> = world;
  /** Steps until `tick` is the next tick to simulate, calling `after` with each simulated tick. */
  const stepTo = (tick: number, after?: (simulated: number) => void) => {
    while (world.tick < tick) {
      world.step([]);
      after?.(world.tick - 1);
    }
  };
  const scale = (e: EntityId) => w.get(e, ActionTimelineComponent)?.timeScale;
  const endOf = (e: EntityId) => ended.find((x) => x.entity === e)?.tick;
  return {
    world: w,
    attacker,
    victims,
    hits,
    stops,
    ended,
    reactionsEnded,
    startedAt,
    stepTo,
    scale,
    endOf,
    uninstall,
  };
}

describe('hit-stop (mw-e04.11)', () => {
  it('AC-1: a heavy connecting on tick 20 freezes attacker and victim on ticks 20–24; they resume on 25', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    requestMove(s.world, s.attacker, 'heavy'); // 0–44 at normal speed
    s.stepTo(10);
    requestMove(s.world, victim, 'stance'); // 10–69 at normal speed
    const frozen: Record<string, number[]> = { attacker: [], victim: [] };
    const moveTicks: number[] = [];
    s.stepTo(40, (tick) => {
      if (s.scale(s.attacker) === 0) frozen['attacker']?.push(tick);
      if (s.scale(victim) === 0) frozen['victim']?.push(tick);
      moveTicks.push(actionOf(s.world, s.attacker)?.tick ?? -1);
    });
    expect(s.hits.map((h) => [h.tick, h.attacker, h.target])).toEqual([[20, s.attacker, victim]]);
    expect(frozen).toEqual({ attacker: [20, 21, 22, 23, 24], victim: [20, 21, 22, 23, 24] });
    // The move holds the tick it connected on until time resumes, then goes on from there.
    expect(moveTicks.slice(19 - 10, 28 - 10)).toEqual([19, 20, 20, 20, 20, 20, 20, 21, 22]);
    s.stepTo(100);
    // Each move ends exactly 5 ticks later than it would have.
    expect(s.endOf(s.attacker)).toBe(45 + 5);
    expect(s.endOf(victim)).toBe(70 + 5);
    expect(s.stops).toEqual([
      { tick: 20, entity: s.attacker, tier: 'heavy', ticks: 5, until: 25, instigator: s.attacker },
      { tick: 20, entity: victim, tier: 'heavy', ticks: 5, until: 25, instigator: s.attacker },
    ]);
  });

  it('AC-1: the frozen timeline runs are ticks 21–25, and the overlay counts them down', () => {
    const s = setup();
    requestMove(s.world, s.attacker, 'heavy');
    const stopped: number[] = [];
    const left: (number | undefined)[] = [];
    s.stepTo(30, (tick) => {
      if (isHitStopped(s.world, s.attacker, tick)) stopped.push(tick);
      left.push(hitStopOf(s.world, s.attacker)?.ticksLeft);
    });
    expect(stopped).toEqual([21, 22, 23, 24, 25]);
    // Read between steps: after tick 20 five frozen runs are left; none after tick 25.
    expect(left.slice(19, 27)).toEqual([undefined, 5, 4, 3, 2, 1, undefined, undefined]);
    expect(hitStopOf(s.world, s.attacker, 20)).toEqual({ tier: 'heavy', ticksLeft: 5 });
    expect(s.world.get(s.attacker, HitStopComponent)).toEqual({
      tier: 'heavy',
      startedAt: 20,
      from: 21,
      until: 25,
    });
  });

  it('AC-2: a third creature attacking during the freeze keeps its own time', () => {
    const s = setup();
    const third = s.world.spawn();
    giveActionTimeline(s.world, third);
    requestMove(s.world, s.attacker, 'heavy');
    s.stepTo(15);
    requestMove(s.world, third, 'swing'); // 15–38 at normal speed
    const thirdTicks: number[] = [];
    s.stepTo(40, () => {
      thirdTicks.push(actionOf(s.world, third)?.tick ?? -1);
      expect(s.scale(third)).toBe(1);
    });
    expect(thirdTicks.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // ticks 15–24
    expect(s.endOf(third)).toBe(15 + 24);
    expect(isHitStopped(s.world, third, 22)).toBe(false);
    expect(s.stops.map((e) => e.entity)).not.toContain(third);
  });

  it('AC-3: one heavy swing hitting three enemies on one tick freezes the attacker 5 ticks, not 15', () => {
    const s = setup({ victims: [0.5, 0.9, 1.3] });
    requestMove(s.world, s.attacker, 'heavy');
    s.stepTo(100);
    expect(s.hits.map((h) => [h.tick, h.target])).toEqual(s.victims.map((v) => [20, v]));
    expect(s.endOf(s.attacker)).toBe(45 + 5);
    const attackerStops = s.stops.filter((e) => e.entity === s.attacker);
    expect(attackerStops).toHaveLength(1);
    expect(attackerStops[0]?.ticks).toBe(5);
    // Each victim froze once, for 5.
    expect(s.stops.filter((e) => e.entity !== s.attacker).map((e) => [e.entity, e.ticks])).toEqual(
      s.victims.map((v) => [v, 5]),
    );
  });

  it('AC-4: a victim frozen 3 ticks and hit by a parry-tier event stays frozen 8 (max), not 11', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    requestMove(s.world, s.attacker, 'light'); // connects on tick 20: light, 3 ticks
    // A parry-tier event on the same tick, after the hit (a system after the hit volumes).
    s.world.addSystem({
      name: 'parry-event',
      run: ({ tick }) => {
        if (tick === 20) {
          expect(s.world.get(victim, ActionTimelineComponent)?.scaleTicks).toBe(3);
          expect(applyHitStop(s.world, victim, 'parry', TABLE.parry)).toBe(true);
        }
      },
    });
    s.stepTo(10);
    requestMove(s.world, victim, 'stance'); // 10–69
    s.stepTo(21);
    expect(s.world.get(victim, ActionTimelineComponent)?.scaleTicks).toBe(8);
    s.stepTo(100);
    expect(s.endOf(victim)).toBe(70 + 8);
    expect(s.endOf(s.attacker)).toBe(34 + 3);
    expect(s.stops.filter((e) => e.entity === victim).map((e) => [e.tier, e.ticks])).toEqual([
      ['light', 3],
      ['parry', 8],
    ]);
  });

  it('AC-4: a parry-tier event two frozen ticks in makes the freeze 8 from then, one freeze', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    requestMove(s.world, s.attacker, 'light');
    s.world.addSystem({
      name: 'parry-event',
      run: ({ tick }) => {
        if (tick === 22) applyHitStop(s.world, victim, 'parry', TABLE.parry);
      },
    });
    s.stepTo(10);
    requestMove(s.world, victim, 'stance');
    const stopped: number[] = [];
    s.stepTo(100, (tick) => {
      if (isHitStopped(s.world, victim, tick)) stopped.push(tick);
    });
    // Runs 21 and 22 of the light freeze, then 8 more: 23–30.
    expect(stopped).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(s.endOf(victim)).toBe(70 + 10);
    expect(s.world.get(victim, HitStopComponent)).toMatchObject({ tier: 'parry', from: 21 });
  });

  it('a later hit starts a new freeze; a shorter or equal one never shortens or restarts it', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    s.world.addSystem({
      name: 'events',
      run: ({ tick }) => {
        if (tick === 5) {
          expect(applyHitStop(s.world, victim, 'heavy', 5)).toBe(true);
          expect(applyHitStop(s.world, victim, 'light', 3)).toBe(false);
          expect(applyHitStop(s.world, victim, 'heavy', 5)).toBe(false);
        }
        if (tick === 30) applyHitStop(s.world, victim, 'critical', 10);
      },
    });
    s.stepTo(41);
    expect(s.world.get(victim, HitStopComponent)).toEqual({
      tier: 'critical',
      startedAt: 30,
      from: 31,
      until: 40,
    });
    expect(isHitStopped(s.world, victim, 10)).toBe(false);
    expect(s.stops.map((e) => [e.tick, e.tier, e.instigator])).toEqual([
      [5, 'heavy', null],
      [30, 'critical', null],
    ]);
  });

  it('a freeze reaching the last tick of another continues it as one freeze', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    s.world.addSystem({
      name: 'events',
      run: ({ tick }) => {
        if (tick === 5) applyHitStop(s.world, victim, 'light', 3); // runs 6–8
        if (tick === 8) applyHitStop(s.world, victim, 'light', 3); // runs 9–11
      },
    });
    s.stepTo(12);
    expect(s.world.get(victim, HitStopComponent)).toMatchObject({ from: 6, until: 11 });
  });

  it('holds an open hitbox still: each active tick sweeps once, the first after the freeze on 26', () => {
    const s = setup();
    requestMove(s.world, s.attacker, 'heavy');
    const swept: (number | undefined)[] = [];
    s.stepTo(31, (tick) => {
      if (tick >= 20) swept.push(hitVolumeDebug(s.world).hitboxes[0]?.activeTick);
    });
    // Ticks 20–30: active tick 1, held through the freeze (21–25), then 2–5 on 26–29; spent on 30.
    expect(swept).toEqual([1, 1, 1, 1, 1, 1, 2, 3, 4, 5, undefined]);
  });

  it('keeps a reaction in step with the timeline lock: both end 5 ticks later (mw-e04.7 comment)', () => {
    const s = setup({ reactions: true });
    const [victim] = s.victims as [EntityId];
    requestMove(s.world, s.attacker, 'breaker'); // 100 poise: staggers on tick 20
    // The victim asks to act every tick from 60 on; it may once its stagger is over.
    s.stepTo(60);
    s.world.addSystem({
      name: 'victim-wants-to-act',
      run: () => {
        requestMove(s.world, victim, 'stance');
      },
    });
    s.stepTo(90);
    // Stagger 45 from tick 20 would end on 66; five frozen ticks make it 71, when the lock runs out.
    expect(s.reactionsEnded.map((e) => [e.tick, e.entity, e.reaction])).toEqual([
      [71, victim, 'stagger'],
    ]);
    expect(s.startedAt.get(victim)).toEqual([71]);
  });

  it('moves a knockdown’s wake-up i-frames with its end while frozen', () => {
    const s = setup({ reactions: true });
    const [victim] = s.victims as [EntityId];
    s.world.addSystem({
      name: 'knockdown',
      run: ({ tick }) => {
        if (tick !== 5) return;
        applyHitReaction(s.world, victim, { kind: 'knockdown' }, { moves: MOVES });
        applyHitStop(s.world, victim, 'critical', 10);
      },
    });
    s.stepTo(7);
    const state = s.world.get(victim, HitReactionComponent);
    // Knockdown 90 from tick 5 ends on 96; one frozen tick (6) so far.
    expect(state?.current?.endsAt).toBe(97);
    expect([state?.iframesFrom, state?.iframesUntil]).toEqual([97, 97 + WAKE_IFRAME_TICKS]);
    s.stepTo(200);
    expect(s.reactionsEnded.map((e) => [e.tick, e.iframesUntil])).toEqual([
      [106, 106 + WAKE_IFRAME_TICKS],
    ]);
  });

  it('is deterministic: same inputs, same hashes every tick', () => {
    const run = () => {
      const s = setup({ victims: [0.6, 1.2], reactions: true });
      requestMove(s.world, s.attacker, 'heavy');
      const hashes: string[] = [];
      s.stepTo(80, () => hashes.push(hashWorld(s.world)));
      return hashes;
    };
    expect(run()).toEqual(run());
  });

  it('skips entities without a timeline, zero-tick tiers and open-ended freezes', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    const bare = s.world.spawn();
    expect(applyHitStop(s.world, bare, 'heavy', 5)).toBe(false);
    expect(applyHitStop(s.world, victim, 'light', 0)).toBe(false);
    setTimeScale(s.world, victim, 0);
    expect(applyHitStop(s.world, victim, 'critical', 10)).toBe(false);
    expect(s.world.get(victim, ActionTimelineComponent)?.scaleTicks).toBeNull();
    expect(s.stops).toEqual([]);
    for (const bad of [-1, 2.5, Number.NaN]) {
      expect(() => applyHitStop(s.world, victim, 'light', bad)).toThrow(RangeError);
    }
  });

  it('ignores hits of hitboxes that are not moves, and stops with its uninstaller', () => {
    const s = setup();
    const [victim] = s.victims as [EntityId];
    const hit = (hitbox: string): HitboxHitInfo => ({
      tick: 0,
      attacker: s.attacker,
      hitbox,
      activeTick: 1,
      target: victim,
      hurtbox: 'torso',
      region: 'torso',
      multiplier: 1,
      armored: false,
      direction: v3(0, 0, 1),
    });
    s.world.events.emit(HitboxHit, hit('not-a-move'));
    s.world.events.flush();
    expect(s.stops).toEqual([]);
    s.uninstall();
    requestMove(s.world, s.attacker, 'heavy');
    s.stepTo(30);
    expect(s.hits).toHaveLength(2);
    expect(s.stops).toEqual([]);
  });

  it('reads nothing in a world without the hit-stop component', () => {
    const world = new World({ seed: 1 });
    const e = world.spawn();
    expect(isHitStopped(world, e)).toBe(false);
    expect(hitStopOf(world, e)).toBeUndefined();
  });
});
