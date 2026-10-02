import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import {
  frameDataView,
  installSandboxRules,
  prepareTestbedCombat,
  sandboxFrameData,
  startTestbedCombat,
  type SandboxFrameData,
} from '@game/combat/index';
import {
  actionOf,
  ActionEnded,
  ActionPhaseChanged,
  actionTimelineSystem,
  ActionTimelineComponent,
  attackerFromTuning,
  AttackEnded,
  box,
  DAMAGE_COMPONENTS,
  DamageApplied,
  dummySpecFrom,
  FactionMemberComponent,
  giveActionTimeline,
  giveCombatant,
  giveFacing,
  giveHurtboxes,
  hashWorld,
  HIT_VOLUME_COMPONENTS,
  HitParried,
  HitStopStarted,
  NO_SPAWN_PARAMS,
  parriedOf,
  placeEntity,
  RapierPhysics,
  requestMove,
  riposteTargetOf,
  spawnAttackerDummy,
  startAttack,
  TelegraphStarted,
  World,
  type EntityId,
  type SceneCreatures,
  type SceneSpawnPlacement,
} from '@sim/index';
import { loadDevContent } from '@content/dev-content';
import { RenderSync } from '@game/loop/index';
import {
  bindCreatures,
  creatureReadout,
  CreatureTelegraphs,
  prepareCreatures,
  sceneCreatureErrors,
  startCreatures,
  viewCentrePoint,
  type CreatureLook,
} from './index';

/** `value`, which the test knows is there. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test value');
  return value;
}

describe('game creatures (mw-e12.4)', () => {
  it('with no creature in content, starting creatures leaves the world exactly as it was', () => {
    const content = loadGameContent();
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    expect(creatures.table.size).toBe(0);
    expect(creatures.spawners.size).toBe(0);
    const world = new World<never>({ seed: 1 });
    const before = hashWorld(world);
    expect(startCreatures(world, creatures, combat, [])).toEqual({ entities: [], errors: [] });
    expect(world.isRegistered(FactionMemberComponent)).toBe(false);
    expect(hashWorld(world)).toBe(before);
  });

  it('formats failed scene spawns for the browser console', () => {
    const result: SceneCreatures = {
      entities: [],
      errors: [
        { point: 'nest', error: { kind: 'unknown-creature', creature: 'wyvern' } },
        { point: 'gate', error: { kind: 'unknown-faction', creature: 'guard', faction: 'elves' } },
      ],
    };
    expect(sceneCreatureErrors(result)).toEqual([
      'creature spawn "nest": unknown creature "wyvern"',
      'creature spawn "gate": creature "guard": unknown faction "elves"',
    ]);
  });

  it('at-cursor: the view centre meets the floor below a camera looking down, and nothing above', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(box({ x: -10, y: -1, z: -10 }, { x: 10, y: 0, z: 10 }));
    physics.step(0);
    // Pitched 90° down: rotating −z about +x by −90° points it at −y.
    const s = Math.SQRT1_2;
    const down = { x: -s, y: 0, z: 0, w: s };
    const point = viewCentrePoint(physics, { position: { x: 2, y: 5, z: 3 }, quaternion: down });
    expect(point?.x).toBeCloseTo(2, 6);
    expect(point?.y).toBeCloseTo(0, 6);
    expect(point?.z).toBeCloseTo(3, 6);
    const up = { x: s, y: 0, z: 0, w: s };
    expect(viewCentrePoint(physics, { position: { x: 2, y: 5, z: 3 }, quaternion: up })).toBe(
      undefined,
    );
  });

  it('binds a proxy once per creature and reads out how many are drawn and in view', () => {
    const content = loadDevContent();
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    const world = new World<never>({ seed: 1 });
    const sync = new RenderSync(world);
    const nothing = (): undefined => undefined;
    const looks: CreatureLook[] = [];
    const bind = () =>
      bindCreatures(world, sync, (_entity, look) => {
        looks.push(look);
        return { object: look, read: nothing, apply: nothing, dispose: nothing };
      });
    // Not installed yet: nothing to bind or read.
    expect(bind()).toBe(0);
    expect(creatureReadout(world, () => true)).toEqual({
      count: 0,
      drawn: 0,
      inView: 0,
      kinds: {},
    });
    const spawn = (id: string, creature: string, x: number): SceneSpawnPlacement => ({
      id,
      position: { x, y: 0, z: 0 },
      yaw: 0,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      prop: undefined,
      tags: [],
      creature,
    });
    const result = startCreatures(world, creatures, combat, [
      spawn('a', 'fixture-guard', 0),
      spawn('b', 'fixture-hound', 5),
      spawn('c', 'fixture-hound', -5),
    ]);
    const [guard, hound] = result.entities;
    expect(creatureReadout(world, (id) => sync.has(id))).toEqual({
      count: 3,
      drawn: 0,
      inView: 0,
      kinds: { 'fixture-guard': 1, 'fixture-hound': 2 },
    });
    expect(bind()).toBe(3);
    expect(bind()).toBe(0); // already bound
    expect(looks.map((l) => [l.id, l.armed, l.nav.height])).toEqual([
      ['fixture-guard', true, 1.8],
      ['fixture-hound', false, 0.9],
      ['fixture-hound', false, 0.9],
    ]);
    // In view: x within ±1 of the stand-in projection, i.e. only the guard at x = 0.
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: 0, z: 0 });
    expect(creatureReadout(world, (id) => sync.has(id), project)).toMatchObject({
      drawn: 3,
      inView: 1,
    });
    expect(guard).toBeDefined();
    expect(hound).toBeDefined();
  });
});

describe('creature attacks on the move system in the game wiring (mw-e04.20)', () => {
  const content = loadDevContent();

  /**
   * The grey-box skeleton's overhead chop swung at a knight 1.2 m ahead who parries on tick 16 (its
   * window covers the chop's first active tick, 24), by a creature (startAttack, the AI's way) or by
   * the combat sandbox's attacker dummy (a plain move request): what each side sees, entity ids
   * replaced by roles.
   */
  function parriedChop(by: 'creature' | 'dummy') {
    // Each run its own damage model: rules register on it per world.
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    const world = new World<unknown>({ seed: 1 });
    installSandboxRules(world, combat);
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    world.addSystem(actionTimelineSystem({ moves: combat.moves })); // the player's, in the game
    startTestbedCombat(world, combat, []);
    const w: World<never> = world;
    let attacker: EntityId;
    if (by === 'creature') {
      const spawned = startCreatures(world, creatures, combat, [
        {
          id: 'skeleton',
          position: { x: 0, y: 0, z: 0 },
          yaw: 0,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          prop: undefined,
          tags: [],
          creature: 'fixture-guard',
        },
      ]);
      attacker = must(spawned.entities[0]);
    } else {
      const { tuning } = combat.sandbox;
      attacker = spawnAttackerDummy(
        w,
        { x: 0, y: 0, z: 0 },
        dummySpecFrom(tuning.dummy, NO_SPAWN_PARAMS),
        { ...attackerFromTuning(tuning.attacker), enabled: false },
        { tuning },
      );
    }
    const knight = w.spawn();
    placeEntity(w, knight, { x: 0, y: 0, z: 1.2 }, 0.35);
    giveFacing(w, knight, { x: 0, y: 0, z: -1 });
    giveHurtboxes(w, knight, {
      facing: { x: 0, y: 0, z: -1 },
      boxes: [
        {
          id: 'body',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.4, z: 0 },
            to: { x: 0, y: 1.4, z: 0 },
            radius: 0.35,
          },
        },
      ],
    });
    giveCombatant(w, knight, { health: 100, poise: 40 });
    giveActionTimeline(w, knight);
    world.step([]); // spawns land at the end of the tick
    const role = (e: EntityId | null) =>
      e === attacker ? 'attacker' : e === knight ? 'knight' : e;
    const trace: unknown[] = [];
    const start = w.tick;
    const at = (tick: number) => tick - start;
    w.events.on(HitParried, (e) =>
      trace.push(['parried', at(e.tick), role(e.entity), role(e.attacker), e.parriedTicks]),
    );
    w.events.on(ActionEnded, (e) =>
      trace.push(['ended', at(e.tick), role(e.entity), e.move, e.reason, e.moveTick]),
    );
    w.events.on(HitStopStarted, (e) =>
      trace.push(['hit-stop', at(e.tick), role(e.entity), e.tier, e.ticks]),
    );
    w.events.on(DamageApplied, (e) =>
      trace.push(['damage', at(e.tick), role(e.target), e.total, e.tags]),
    );
    const telegraphs: unknown[] = [];
    const ends: unknown[] = [];
    const frames: SandboxFrameData[] = [];
    w.events.on(TelegraphStarted, (e) => telegraphs.push([at(e.tick), e.move, e.cue]));
    w.events.on(AttackEnded, (e) => ends.push([at(e.tick), e.attack, e.reason]));
    const chop = creatures.attacks.get('forgotten-overhead-chop');
    if (chop === undefined) throw new Error('the skeleton set has no overhead chop');
    if (by === 'creature') startAttack(w, attacker, chop, { x: 0, y: 0, z: 1 });
    else requestMove(w, attacker, chop.move.id);
    const states: unknown[] = [];
    for (let i = 0; i < 140; i++) {
      if (i === 16) requestMove(w, knight, 'shield-parry');
      world.step([]);
      if (i === 10) frames.push(sandboxFrameData(w, { moves: combat.moves }));
      if (i === 24) {
        const stun = parriedOf(w, attacker);
        states.push({
          stun: stun === undefined ? null : [at(stun.startedAt), stun.endsAt - stun.startedAt],
          lock: w.get(attacker, ActionTimelineComponent)?.lockTicks,
          riposte: role(riposteTargetOf(w, knight) ?? null),
          health: w.get(knight, DAMAGE_COMPONENTS[0])?.current,
        });
      }
    }
    states.push({
      free: actionOf(w, attacker) === undefined,
      stunned: parriedOf(w, attacker) !== undefined,
    });
    return { trace, states, telegraphs, ends, frames };
  }

  it('AC-5: the knight parrying the skeleton’s overhead chop in the window leaves it Parried exactly as the dummy', () => {
    const creature = parriedChop('creature');
    const dummy = parriedChop('dummy');
    expect(creature.trace).toEqual(dummy.trace);
    expect(creature.states).toEqual(dummy.states);
    expect(creature.trace).toContainEqual(['parried', 24, 'knight', 'attacker', 90]);
    expect(creature.trace).toContainEqual([
      'ended',
      24,
      'attacker',
      'forgotten-overhead-chop',
      'interrupted',
      24,
    ]);
    expect(creature.states[0]).toMatchObject({ stun: [24, 91], riposte: 'attacker', health: 100 });
    // Only the creature's swing is an attack: it telegraphed on tick 0 and ended parried.
    expect(creature.telegraphs).toEqual([[0, 'forgotten-overhead-chop', 'forgotten-windup']]);
    expect(creature.ends).toEqual([[24, 'forgotten-overhead-chop', 'parried']]);
    expect(dummy.telegraphs).toEqual([]);
  });

  it('the frame-data overlay shows a creature’s swing like the dummy’s', () => {
    const [frame] = parriedChop('creature').frames;
    const row = frame?.fighters.find((f) => f.role === 'creature');
    expect(row).toMatchObject({
      move: 'forgotten-overhead-chop',
      phase: 'startup',
      moveTick: 10,
      totalTicks: 54,
    });
    expect(frameDataView(must(frame)).rows.map((r) => r.label)).toEqual([
      `Creature #${String(row?.entity)}`,
    ]);
  });
});

describe('creature telegraphs for the render (mw-e04.20)', () => {
  it('a creature shows its telegraph from TelegraphStarted until the move turns active or the attack ends', () => {
    const world = new World<never>({ seed: 1 });
    const telegraphs = new CreatureTelegraphs(world);
    const started = (
      attacker: EntityId,
      move: string,
      parryable: boolean,
      unblockable: boolean,
    ) => {
      world.events.emit(TelegraphStarted, {
        tick: 0,
        attacker,
        attack: move,
        move,
        cue: 'windup',
        audioCue: null,
        vfxCue: null,
        parryable,
        unblockable,
      });
    };
    const phase = (entity: EntityId, move: string, p: 'startup' | 'active') => {
      world.events.emit(ActionPhaseChanged, { tick: 0, entity, move, phase: p, moveTick: 0 });
    };
    expect(telegraphs.drain()).toEqual([]);
    started(1, 'chop', true, false);
    started(2, 'thrust', false, false);
    started(3, 'crush', false, true);
    world.step();
    expect(telegraphs.drain()).toEqual([
      [1, 'parry'],
      [2, 'block'],
      [3, 'unblockable'],
    ]);
    expect(telegraphs.drain()).toEqual([]);
    phase(1, 'other', 'active'); // another move's phase: still telegraphing
    phase(1, 'chop', 'startup');
    phase(1, 'chop', 'active');
    world.events.emit(AttackEnded, {
      tick: 0,
      attacker: 2,
      attack: 'thrust',
      reason: 'parried',
      elapsed: 3,
    });
    world.events.emit(AttackEnded, {
      tick: 0,
      attacker: 9,
      attack: 'x',
      reason: 'died',
      elapsed: 1,
    });
    world.step();
    expect(telegraphs.drain()).toEqual([
      [1, null],
      [2, null],
    ]);
    expect([1, 2, 3].map((e) => telegraphs.lookOf(e))).toEqual([null, null, 'unblockable']);
    telegraphs.dispose();
    started(4, 'chop', true, false);
    world.step();
    expect(telegraphs.drain()).toEqual([]);
    expect(telegraphs.lookOf(3)).toBeNull();
  });
});
