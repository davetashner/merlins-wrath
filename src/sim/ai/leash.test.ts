// Leashes (mw-e01.17): a creature in Combat chases only so far from its post, then drops its target,
// searches at the leash edge, walks home and settles, keeping its wounds. The behaviour is written
// tersely in the Forgotten's shape (sim tests may not load content; the Forgotten's own content
// leashes in tests/integration/creature-leash.test.ts).

import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureComponent, type CreatureLeash } from '../creatures/components';
import { entitySource, percept } from '../perception/percept';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { compileBehaviour, compileBehaviours } from './behaviour';
import { AlertStateChanged, BrainComponent, type AlertStateChange, type Brain } from './components';
import { resolveInput } from './inputs';
import { DEFAULT_LEASH_SEARCH_S, fromPost, leashAllows, withinLeash } from './leash';
import { observePercepts } from './memory';
import { brainOf, giveBrain, installAi, writeBlackboard } from './runtime';
import type { AgentView } from './view';

type Loose = Readonly<Record<string, unknown>>;

const HZ = 60;
/** The Forgotten's shamble (locomotion `forgotten`). */
const GAITS = { sneak: 0.6, walk: 0.9, run: 2.6 };
const POST: Vec3 = { x: 0, y: 0, z: 0 };
const FACING: Vec3 = { x: 0, y: 0, z: -1 };

/** A creature behaviour in the Forgotten's shape: it fights what it sees, searches, walks home. */
function leashed(
  options: { combat?: Loose; searching?: Loose; tuning?: Record<string, number> } = {},
): Frozen<BehaviourDef> {
  const activity = (steps: Loose[], extra: Loose = {}) => ({
    weight: 1,
    interruptible: true,
    retryAfterS: 2,
    considerations: [],
    steps,
    ...extra,
  });
  const sees = { to: 'combat', when: { input: 'targetVisible', gte: 1 } };
  return {
    id: 'leashed',
    schemaVersion: 1,
    tuning: {
      searchingTimeoutS: 20,
      combatLostS: 6,
      leashSearchS: 3,
      postAlertS: 30,
      postAlertAwarenessRate: 1.5,
      ...options.tuning,
    },
    thinkHz: 10,
    inertia: 0.1,
    initial: 'unaware',
    states: {
      unaware: {
        transitions: [sees],
        timeoutFrom: 'entered',
        postAlert: false,
        activities: ['home', 'stand'],
      },
      searching: {
        timeoutS: { tuning: 'searchingTimeoutS' },
        onTimeout: 'unaware',
        transitions: [sees],
        timeoutFrom: 'entered',
        postAlert: true,
        activities: ['search'],
        ...options.searching,
      },
      combat: {
        transitions: [
          { to: 'searching', when: { input: 'targetLostS', gte: { tuning: 'combatLostS' } } },
        ],
        timeoutFrom: 'entered',
        postAlert: false,
        activities: ['chase'],
        ...options.combat,
      },
    },
    activities: {
      home: activity([{ do: 'move-to', target: 'post', within: 0.5, gait: 'run' }], {
        weight: 2,
        considerations: [
          { input: 'fromPost', curve: { kind: 'step', at: 0.5, below: 0, above: 1 } },
        ],
      }),
      stand: activity([{ do: 'wait', seconds: 1 }]),
      search: activity([
        { do: 'move-to', target: 'lkp', within: 1, gait: 'walk' },
        { do: 'look-around', seconds: 4 },
      ]),
      chase: activity([{ do: 'move-to', target: 'target', within: 1, gait: 'run' }]),
    },
  } as unknown as Frozen<BehaviourDef>;
}

interface Chase {
  readonly world: World<never>;
  readonly skeleton: EntityId;
  readonly foe: EntityId;
  readonly changes: AlertStateChange[];
  /** Whether the skeleton sees the foe each tick (as awareness would write it). */
  visible: boolean;
  /** The foe's speed along +x, m/s. */
  foeSpeed: number;
  /** One tick: the foe moves, the skeleton sees it if visible, the world steps. */
  tick(): void;
  brain(): Readonly<Brain>;
  at(entity: EntityId): Vec3;
}

/** A skeleton at its post facing -z, already in Combat with a foe 3 m away that runs along +x. */
function chase(
  options: {
    leash?: CreatureLeash;
    behaviour?: Frozen<BehaviourDef>;
    tuning?: Record<string, number>;
  } = {},
): Chase {
  const world = new World<never>({ seed: 5, hz: HZ });
  world.register(
    PlacementComponent,
    CombatFacingComponent,
    CreatureComponent,
    ...DAMAGE_COMPONENTS,
  );
  const def = options.behaviour ?? leashed();
  installAi(world, { behaviours: compileBehaviours([def]) });
  const foe = world.spawn();
  placeEntity(world, foe, { x: 3, y: 0, z: 0 }, 0.35);
  const skeleton = world.spawn();
  placeEntity(world, skeleton, POST, 0.35);
  world.add(skeleton, CombatFacingComponent, { facing: FACING });
  giveCombatant(world, skeleton, { health: 100, poise: 40 });
  world.add(skeleton, CreatureComponent, {
    origin: {
      creature: 'skeleton',
      at: POST,
      facing: FACING,
      ...(options.leash !== undefined && { leash: options.leash }),
    },
    behaviour: def.id,
    tuning: options.tuning ?? {},
    needs: {},
  });
  giveBrain(world, skeleton, { behaviour: def.id, gaits: GAITS });
  world.step();
  const changes: AlertStateChange[] = [];
  world.events.on(AlertStateChanged, (e) => changes.push(e));
  const state: Chase = {
    world,
    skeleton,
    foe,
    changes,
    visible: true,
    foeSpeed: 5,
    tick() {
      const at = state.at(foe);
      world.set(foe, PlacementComponent, { ...at, x: at.x + state.foeSpeed / HZ, radius: 0.35 });
      if (state.visible) seen(world, skeleton, foe);
      world.step();
    },
    brain: () => must(brainOf(world, skeleton)),
    at: (entity) => must(world.get(entity, PlacementComponent)),
  };
  seen(world, skeleton, foe);
  must(world.get(skeleton, BrainComponent)).state = 'combat';
  return state;
}

/** `hunter` sees `prey` where it stands now, as awareness writes it from a percept (mw-e11.8). */
function seen(world: World<never>, hunter: EntityId, prey: EntityId): void {
  const at = must(world.get(prey, PlacementComponent));
  const position = { x: at.x, y: at.y, z: at.z };
  const source = entitySource(prey);
  const p = percept({
    source,
    kind: 'seen-target',
    sense: 'sight',
    position,
    strength: 1,
    certainty: 1,
  });
  const brain = must(world.get(hunter, BrainComponent));
  observePercepts(brain.memory, [p], world.tick, world.clock.hz);
  writeBlackboard(world, hunter, {
    target: prey,
    targetSource: source,
    lkp: position,
    targetVisible: true,
  });
}

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

const LEASH: CreatureLeash = { radius: 25, post: POST };

/** Ticks until `done` holds (at most `limit`), stepping `c`; returns how many. */
function until(c: Chase, done: () => boolean, limit: number): number {
  for (let n = 1; n <= limit; n++) {
    c.tick();
    if (done()) return n;
  }
  throw new Error(
    `not within ${String(limit)} ticks: ${JSON.stringify([c.brain().state, c.brain().activity, c.at(c.skeleton)])}`,
  );
}

describe('creature leashes (mw-e01.17)', () => {
  it('AC-1: in Combat with a 25 m leash, within one tick of passing 25 m from its post it drops the target and enters Searching', () => {
    const c = chase({ leash: LEASH });
    // It is aware of the foe, and of a noise elsewhere: it forgets only the foe.
    const record = (source: string, level: number) => ({
      source,
      level,
      quietS: 0,
      cause: { kind: 'heard-noise', sense: 'hearing', position: POST, amount: level },
    });
    must(c.world.get(c.skeleton, BrainComponent)).awareness = [
      record(entitySource(c.foe), 1),
      record('noise:far', 0.4),
    ] as Brain['awareness'];
    let past = -1;
    until(
      c,
      () => {
        if (past < 0 && flat(c.at(c.skeleton), POST) > 25) past = c.world.tick;
        return c.brain().state !== 'combat';
      },
      30 * HZ,
    );
    const broke = must(c.changes.find((e) => e.cause === 'leash'));
    expect(broke).toMatchObject({ entity: c.skeleton, from: 'combat', to: 'searching' });
    // `past` is the tick whose movement took it over; the very next tick's check breaks the leash.
    expect(broke.tick - past).toBeLessThanOrEqual(1);
    expect(flat(c.at(c.skeleton), POST)).toBeLessThan(25 + GAITS.run / HZ + 1e-9);
    // Dropped: no target, no target memory to aim at, unseen; it searches the leash edge.
    const board = c.brain().blackboard;
    expect(board.targetVisible).toBe(false);
    expect(board.lkp).not.toBeNull();
    expect(flat(must(board.lkp), POST)).toBeGreaterThan(25);
    expect(c.brain().awareness.map((r) => r.source)).toEqual(['noise:far']);
    expect(board.awareness).toBe(0.4);
  });

  it('AC-1: a creature past its leash with no target memory still breaks off and searches where it stands', () => {
    const c = chase({ leash: LEASH });
    c.visible = false;
    writeBlackboard(c.world, c.skeleton, { target: null, targetSource: null, lkp: null });
    c.world.set(c.skeleton, PlacementComponent, { x: 0, y: 0, z: 26, radius: 0.35 });
    c.tick();
    expect(c.changes).toMatchObject([{ from: 'combat', to: 'searching', cause: 'leash' }]);
    expect(c.brain().blackboard.lkp).toEqual({ x: 0, y: 0, z: 26 });
  });

  it('AC-1: the foe still in sight beyond the leash is not fought again, and the search stays inside the leash', () => {
    const c = chase({ leash: LEASH });
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    let furthest = 0;
    for (let n = 0; n < 2 * HZ; n++) {
      c.tick(); // it sees the foe, now well past the leash, every tick
      furthest = Math.max(furthest, flat(c.at(c.skeleton), POST));
      expect(c.brain().state).toBe('searching');
    }
    expect(c.brain().blackboard.targetVisible).toBe(true);
    expect(furthest).toBeLessThan(25 + GAITS.run / HZ + 1e-9);
  });

  it('AC-1: a target that steps back inside the leash while it searches is fought again', () => {
    const c = chase({ leash: LEASH });
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    c.foeSpeed = 0;
    c.world.set(c.foe, PlacementComponent, { x: 10, y: 0, z: 0, radius: 0.35 });
    until(c, () => c.brain().state === 'combat', HZ);
    expect(c.changes.at(-1)).toMatchObject({ from: 'searching', to: 'combat' });
  });

  it('AC-2: once its search at the leash edge ends it walks to its post and is Unaware in its post idle within 10 s', () => {
    const c = chase({ leash: LEASH });
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    const searchFrom = c.world.tick;
    c.visible = false; // the foe has gone
    until(c, () => c.brain().state === 'unaware', 30 * HZ);
    const standDown = must(c.changes.at(-1));
    expect(standDown).toMatchObject({ from: 'searching', to: 'unaware', cause: 'timeout' });
    // It searched for leashSearchS (3 s), not its 20 s Searching timeout.
    // (A think at 10 Hz reads the timer: within 6 ticks of it.)
    expect(standDown.tick - searchFrom).toBeLessThanOrEqual(3 * HZ + 6);
    const walked = until(
      c,
      () => c.brain().activity === 'stand' && flat(c.at(c.skeleton), POST) <= 0.5,
      10 * HZ,
    );
    expect(walked).toBeLessThanOrEqual(10 * HZ);
    expect(c.brain().state).toBe('unaware');
    expect(c.world.get(c.skeleton, CombatFacingComponent)?.facing).toEqual(FACING); // its post's way
    for (let n = 0; n < 2 * HZ; n++) c.tick(); // and it stays there
    expect(flat(c.at(c.skeleton), POST)).toBeLessThanOrEqual(0.5);
    expect(c.brain().scores[0]?.[0]).toBe('stand');
  });

  it('AC-3: edge: 40 damage taken before the leash broke is still 40 below max when it is home', () => {
    const c = chase({ leash: LEASH });
    const hit = new DamageModel().apply(c.world, c.skeleton, {
      amounts: { slash: 40 },
      instigator: null,
    });
    expect(hit?.healthAfter).toBe(60);
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    c.visible = false;
    until(c, () => c.brain().activity === 'stand', 20 * HZ);
    const health = must(c.world.get(c.skeleton, HealthComponent));
    expect(health.max - health.current).toBe(40);
  });

  it('AC-4: without a leash it chases on past 25 m, still in Combat, and never walks home', () => {
    const c = chase();
    until(c, () => flat(c.at(c.skeleton), POST) > 40, 60 * HZ);
    expect(c.brain().state).toBe('combat');
    expect(c.changes).toEqual([]);
    const view = { world: c.world, entity: c.skeleton, creature: undefined } as AgentView;
    expect(must(resolveInput('fromPost'))(view)).toBe(0);
    c.visible = false;
    writeBlackboard(c.world, c.skeleton, { targetVisible: false });
    until(c, () => c.brain().state === 'unaware', 40 * HZ);
    for (let n = 0; n < HZ; n++) c.tick();
    expect(c.brain().scores[0]?.[0]).toBe('stand');
    expect(c.brain().scores[1]).toEqual(['home', 0]); // `home` scores 0 without a leash
    expect(flat(c.at(c.skeleton), POST)).toBeGreaterThan(40);
  });

  it('a behaviour whose table has no Combat → Searching move has no leash', () => {
    const def = leashed({ combat: { transitions: [] } });
    expect(compileBehaviour(def).leashMove).toBe(false);
    const c = chase({ leash: LEASH, behaviour: def });
    until(c, () => flat(c.at(c.skeleton), POST) > 30, 60 * HZ);
    expect(c.brain().state).toBe('combat');
  });

  it('a Combat timeout into Searching is a leash move too', () => {
    const def = leashed({ combat: { transitions: [], timeoutS: 99, onTimeout: 'searching' } });
    expect(compileBehaviour(def).leashMove).toBe(true);
  });

  it('the leash search reads the creature’s override, else the behaviour’s, else 3 s', () => {
    const fallback = leashed();
    const bare = compileBehaviour({
      ...fallback,
      tuning: Object.fromEntries(
        Object.entries(fallback.tuning).filter(([key]) => key !== 'leashSearchS'),
      ),
    });
    const view = (tuning: Record<string, number>) =>
      ({ creature: { tuning } }) as unknown as AgentView;
    expect(bare.leashSearch(view({}))).toBe(DEFAULT_LEASH_SEARCH_S);
    expect(compileBehaviour(fallback).leashSearch(view({}))).toBe(3);
    expect(compileBehaviour(fallback).leashSearch(view({ leashSearchS: 7 }))).toBe(7);
    const c = chase({ leash: LEASH, tuning: { leashSearchS: 1 } });
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    const from = c.world.tick;
    c.visible = false;
    until(c, () => c.brain().state === 'unaware', 30 * HZ);
    expect(c.world.tick - from).toBeLessThanOrEqual(HZ + 6);
  });

  it('a Searching state without a timeout keeps searching after the leash search', () => {
    const def = leashed({ searching: { timeoutS: undefined, onTimeout: undefined } });
    const c = chase({ leash: LEASH, behaviour: def });
    until(c, () => c.brain().state === 'searching', 30 * HZ);
    c.visible = false;
    for (let n = 0; n < 5 * HZ; n++) c.tick();
    expect(c.brain().state).toBe('searching');
    expect(c.brain().leashSearchUntil).toBeDefined();
  });

  it('without a leash, `post` is its spawn point, and arriving there turns it the way it was placed', () => {
    const def = leashed();
    const walker = {
      ...def,
      activities: {
        ...def.activities,
        home: { ...def.activities['home'], considerations: [] },
      },
    } as unknown as Frozen<BehaviourDef>;
    const c = chase({ behaviour: walker });
    c.visible = false;
    writeBlackboard(c.world, c.skeleton, { targetVisible: false });
    must(c.world.get(c.skeleton, BrainComponent)).state = 'unaware';
    c.world.set(c.skeleton, PlacementComponent, { x: 4, y: 0, z: 3, radius: 0.35 });
    until(c, () => c.brain().ended?.activity === 'home', 5 * HZ);
    expect(c.brain().ended?.ok).toBe(true);
    expect(flat(c.at(c.skeleton), POST)).toBeLessThanOrEqual(0.5);
    expect(c.world.get(c.skeleton, CombatFacingComponent)?.facing).toEqual(FACING);
  });

  describe('its pieces', () => {
    const view = (leash: CreatureLeash | undefined, brain: Partial<Brain> = {}) => {
      const world = new World<never>({ seed: 1 });
      world.register(PlacementComponent);
      const entity = world.spawn();
      world.step();
      return {
        world,
        entity,
        creature: leash === undefined ? undefined : { origin: { at: POST, facing: FACING, leash } },
        brain: {
          state: 'searching',
          memory: [],
          blackboard: { target: null, targetSource: null, lkp: null },
          ...brain,
        },
        tick: 0,
        hz: HZ,
        ports: { memory: { decayPerS: 0, predictS: 0, persistent: [] } },
      } as unknown as AgentView;
    };

    it('fromPost reads 0 for a leashed agent with no placement', () => {
      expect(fromPost(view(LEASH))).toBe(0);
    });

    it('withinLeash pulls a goal beyond the leash in to its edge out of Combat, and only then', () => {
      const far = { x: 30, y: 1, z: 40 };
      expect(withinLeash(view(LEASH), far)).toEqual({ x: 15, y: 1, z: 20 });
      expect(withinLeash(view(LEASH), { x: 3, y: 0, z: 4 })).toEqual({ x: 3, y: 0, z: 4 });
      expect(withinLeash(view(LEASH, { state: 'combat' }), far)).toBe(far);
      expect(withinLeash(view(undefined), far)).toBe(far);
    });

    it('leashAllows reads the last-known position without a target memory, and allows with neither', () => {
      const lkp = (p: Vec3) =>
        view(LEASH, { blackboard: { target: null, targetSource: null, lkp: p } } as never);
      expect(leashAllows(lkp({ x: 0, y: 0, z: 30 }))).toBe(false);
      expect(leashAllows(lkp({ x: 0, y: 0, z: 20 }))).toBe(true);
      expect(leashAllows(view(LEASH))).toBe(true);
      expect(leashAllows(view(undefined))).toBe(true);
    });
  });
});
