// Patrol routines (mw-e11.9): loop, ping-pong, random and post routes walked by `follow-route`, with
// dwell, look direction, scan arc and idle cues per waypoint; resuming at the waypoint nearest by
// navigation distance; skipping an unreachable waypoint with RouteBlocked; routines scheduled by
// windows of hours. Behaviours are written tersely with the schema's defaults filled (sim tests may
// not load content).

import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World, type WorldSnapshot } from '../core/world';
import { CreatureComponent, type Creature } from '../creatures/components';
import type { NavDoorState } from '../nav/doors';
import { twoRooms } from '../nav/fixtures';
import { navmeshNavigation } from '../nav/navigation';
import { sin } from '../math';
import { hashWorld } from '../snapshot';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { compileBehaviours } from './behaviour';
import {
  AiCuePlayed,
  AlertStateChanged,
  RouteBlocked,
  type AiCue,
  type AlertStateChange,
  type Brain,
  type RouteBlock,
} from './components';
import { resolveInput } from './inputs';
import { straightDistance, straightLineNavigation, type AiNavigation } from './navigation';
import { WAYPOINT_RADIUS } from './primitives';
import {
  activeRoute,
  inWindow,
  nearestWaypoint,
  nextWaypoint,
  patrolLoop,
  scanYaw,
  type PatrolRoute,
  type PatrolRoutine,
  type PatrolWaypoint,
} from './routes';
import { aiPorts, brainOf, giveBrain, installAi, type AiOptions } from './runtime';
import type { AgentView } from './view';

type Loose = Readonly<Record<string, unknown>>;

const hypot = (dx: number, dz: number): number => Math.sqrt(dx * dx + dz * dz);

interface Spec {
  readonly initial?: string;
  readonly thinkHz?: number;
  readonly states: Readonly<Record<string, Loose & { readonly activities: readonly string[] }>>;
  readonly activities: Readonly<Record<string, readonly Loose[]>>;
}

/** A behaviour definition as content would load it (defaults filled). */
function behaviour(spec: Spec): Frozen<BehaviourDef> {
  const step = (s: Loose): Loose => {
    if (s['do'] === 'follow-route') return { dwellS: 0, gait: 'walk', ...s };
    if (s['do'] === 'move-to') return { within: 0.5, gait: 'walk', ...s };
    return s;
  };
  return {
    id: 'test',
    schemaVersion: 1,
    tuning: {},
    thinkHz: spec.thinkHz ?? 60,
    inertia: 0.1,
    initial: spec.initial ?? 'unaware',
    states: Object.fromEntries(
      Object.entries(spec.states).map(([name, s]) => [
        name,
        { transitions: [], timeoutFrom: 'entered', postAlert: false, ...s },
      ]),
    ),
    activities: Object.fromEntries(
      Object.entries(spec.activities).map(([name, steps]) => [
        name,
        {
          weight: 1,
          interruptible: true,
          retryAfterS: 2,
          considerations: [],
          steps: steps.map(step),
        },
      ]),
    ),
  } as unknown as Frozen<BehaviourDef>;
}

/** One state, one activity: patrol with `step`'s parameters. */
const patrolling = (step: Loose = {}) =>
  behaviour({
    states: { unaware: { activities: ['patrol'] } },
    activities: { patrol: [{ do: 'follow-route', ...step }] },
  });

function aiWorld(def: Frozen<BehaviourDef>, options: Omit<AiOptions, 'behaviours'> = {}, seed = 7) {
  const world = new World<never>({ seed });
  world.register(PlacementComponent, CombatFacingComponent, CreatureComponent);
  installAi(world, { behaviours: compileBehaviours([def]), ...options });
  return world;
}

const GAITS = Object.freeze({ sneak: 1, walk: 1.5, run: 3 });

/** A creature at `at` walking `routine` (or `patrol` points), with a brain running "test". */
function guard(
  world: World<never>,
  at: Vec3,
  route: { routine?: readonly PatrolRoutine[]; patrol?: readonly Vec3[] },
  placed = true,
): EntityId {
  const entity = world.spawn();
  if (placed) placeEntity(world, entity, at, 0.35);
  world.add(entity, CombatFacingComponent, Object.freeze({ facing: { x: 0, y: 0, z: 1 } }));
  const creature: Creature = {
    origin: { creature: 'c', at, facing: { x: 0, y: 0, z: 1 }, ...route },
    behaviour: 'test',
    tuning: {},
    needs: {},
  };
  world.add(entity, CreatureComponent, creature);
  giveBrain(world, entity, { behaviour: 'test', gaits: GAITS });
  return entity;
}

const wp = (id: string, x: number, z: number, extra: Partial<PatrolWaypoint> = {}) =>
  Object.freeze({ id, at: Object.freeze({ x, y: 0, z }), ...extra });

const route = (
  id: string,
  kind: PatrolRoute['kind'],
  waypoints: readonly PatrolWaypoint[],
  links?: PatrolRoute['links'],
): PatrolRoute => Object.freeze({ id, kind, waypoints, ...(links !== undefined && { links }) });

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

const brain = (world: World<never>, entity: EntityId): Readonly<Brain> =>
  must(brainOf(world, entity));

const placeOf = (world: World<never>, entity: EntityId) =>
  must(world.get(entity, PlacementComponent));

const facingOf = (world: World<never>, entity: EntityId) =>
  must(world.get(entity, CombatFacingComponent)).facing;

/** Where the agent stood at a waypoint: from the tick it arrived until the tick it left. */
interface Stand {
  readonly at: string;
  /** The tick it arrived (its last move), or the first tick when it started there. */
  readonly from: number;
  /** Ticks until it moved again (-1 while it is still there). */
  readonly ticks: number;
}

/**
 * Steps `world` `n` times and returns, in order, the waypoints of `waypoints` the agent stood at
 * (stood still within reach of), each from its arrival to its departure. Standing still elsewhere
 * (a path being planned) is not a stand.
 */
function stands(
  world: World<never>,
  entity: EntityId,
  waypoints: readonly PatrolWaypoint[],
  n: number,
): Stand[] {
  const out: { at: string; from: number; ticks: number }[] = [];
  let last = { ...placeOf(world, entity) };
  let lastMove = -1;
  let current: { at: string; from: number; ticks: number } | undefined;
  for (let i = 0; i < n; i++) {
    const tick = world.tick;
    world.step();
    const here = placeOf(world, entity);
    const moved = here.x !== last.x || here.z !== last.z;
    last = { ...here };
    if (moved) {
      if (current !== undefined) current.ticks = tick - current.from;
      current = undefined;
      lastMove = tick;
      continue;
    }
    if (current !== undefined) continue;
    const near = waypoints.find(
      (w) => hypot(w.at.x - here.x, w.at.z - here.z) <= WAYPOINT_RADIUS + 1e-9,
    );
    if (near === undefined) continue;
    current = { at: near.id, from: lastMove >= 0 ? lastMove : tick, ticks: -1 };
    out.push(current);
  }
  return out;
}

const A = wp('a', 0, 0, { dwellS: 2 });
const B = wp('b', 4, 0, { dwellS: 2 });
const C = wp('c', 4, 4, { dwellS: 2 });

describe('routes (mw-e11.9)', () => {
  it('AC-1: a loop A→B→C with 2 s dwell at each visits A, B, C, A in order, dwelling 120 ticks ±1', () => {
    const world = aiWorld(patrolling());
    const loop = route('yard', 'loop', [A, B, C]);
    const g = guard(world, A.at, { routine: [{ route: loop }] });
    const seen = stands(world, g, loop.waypoints, 1300);
    expect(seen.map((s) => s.at).slice(0, 4)).toEqual(['a', 'b', 'c', 'a']);
    for (const stand of seen.slice(0, 3))
      expect(Math.abs(stand.ticks - 120)).toBeLessThanOrEqual(1);
    // The step's own dwell (0) is only the default: the waypoint's 2 s wins.
    const brisk = aiWorld(patrolling({ dwellS: 0.5 }));
    const plain = route('yard', 'loop', [wp('a', 0, 0), wp('b', 4, 0)]);
    const h = guard(brisk, A.at, { routine: [{ route: plain }] });
    const quick = stands(brisk, h, plain.waypoints, 400);
    expect(quick.slice(0, 2).map((s) => [s.at, s.ticks])).toEqual([
      ['a', 30],
      ['b', 30],
    ]);
  });

  it('AC-2: a ping-pong reverses at the last waypoint and again at the first', () => {
    const world = aiWorld(patrolling({ dwellS: 0.5 }));
    const walk = route('wall', 'ping-pong', [wp('a', 0, 0), wp('b', 3, 0), wp('c', 6, 0)]);
    const g = guard(world, { x: 0, y: 0, z: 0 }, { routine: [{ route: walk }] });
    const seen = stands(world, g, walk.waypoints, 1300);
    expect(seen.map((s) => s.at).slice(0, 7)).toEqual(['a', 'b', 'c', 'b', 'a', 'b', 'c']);
    // Heading back from c, it remembers the way it walks (kept in the brain across alerts).
    const back = aiWorld(patrolling());
    const h = guard(back, { x: 0, y: 0, z: 0 }, { routine: [{ route: walk }] });
    for (let i = 0; i < 1100 && brain(back, h).routeDir === 1; i++) back.step();
    expect(brain(back, h).routeDir).toBe(-1);
    expect(brain(back, h).blackboard.waypoint).toBe(1);
  });

  // The two-room navmesh (src/sim/nav/fixtures.ts): the guard stands in room A by the dividing wall.
  // Waypoint 1 is just across the wall in room B (nearest in a straight line, but the path goes round
  // through the doorway); waypoint 2 is further away in room A (nearest by path); waypoint 0, the
  // next index, is at the far end of room B.
  const mesh = twoRooms();
  const nav = (doors: () => NavDoorState = () => 'open') => navmeshNavigation({ mesh, doors });
  const ROOMS = route('rooms', 'loop', [wp('far', 12, 1), wp('across', 7.8, 1), wp('back', 4, 1)]);
  const BY_WALL = { x: 6.2, y: 0, z: 1 };
  const searching = (activity: Loose) =>
    behaviour({
      initial: 'searching',
      thinkHz: 10,
      states: {
        searching: { activities: ['look'], timeoutS: 0.5, onTimeout: 'unaware' },
        unaware: { activities: ['resume'] },
      },
      activities: { look: [{ do: 'wait', seconds: 100 }], resume: [activity] },
    });

  for (const [how, activity] of [
    ['walking its route', { do: 'follow-route' }],
    ['returning to its route', { do: 'move-to', target: 'nearest-waypoint', within: 0.25 }],
  ] as const) {
    it(`AC-3: back from Searching, it paths to the nearest waypoint by nav distance, not the next index (${how})`, () => {
      const navigation = nav();
      const world = aiWorld(searching(activity), { navigation });
      const changes: AlertStateChange[] = [];
      world.events.on(AlertStateChanged, (c) => changes.push(c));
      const g = guard(world, BY_WALL, { routine: [{ route: ROOMS }] });
      expect(brain(world, g).blackboard.waypoint).toBe(0); // the next index is the far one
      // Not vacuous: in a straight line the waypoint across the wall is nearer than the one back.
      const view = viewOf(world, g);
      expect(
        nearestWaypoint(
          { ...view, ports: { ...view.ports, navigation: straightLineNavigation } },
          ROOMS,
        ),
      ).toBe(1);
      expect(must(navigation.distance)(world, g, at(ROOMS, 1))).toBeGreaterThan(
        must(navigation.distance)(world, g, at(ROOMS, 2)),
      );
      // Walk until it reaches a waypoint of its route.
      const trail: Vec3[] = [];
      const reached = () =>
        ROOMS.waypoints.find((w) => {
          const p = placeOf(world, g);
          return hypot(w.at.x - p.x, w.at.z - p.z) <= WAYPOINT_RADIUS + 1e-9;
        });
      for (let i = 0; i < 400 && reached() === undefined; i++) {
        world.step();
        if (brain(world, g).state === 'unaware') trail.push({ ...placeOf(world, g) });
      }
      expect(changes.map((c) => `${c.from}>${c.to}:${c.cause}`)).toEqual([
        'searching>unaware:timeout',
      ]);
      expect(reached()?.id).toBe('back');
      expect(trail.length).toBeGreaterThan(60); // it walked there: about 2.2 m at 1.5 m/s
      expect(trail.every((p) => p.x <= BY_WALL.x + 1e-9)).toBe(true); // straight back, never round
    });
  }

  it('AC-4: a waypoint behind a door that becomes locked is skipped, with RouteBlocked', () => {
    let gate: NavDoorState = 'open';
    const navigation = nav(() => gate);
    const world = aiWorld(patrolling({ dwellS: 0.5 }), { navigation });
    const blocked: RouteBlock[] = [];
    world.events.on(RouteBlocked, (b) => blocked.push(b));
    const yard = route('yard', 'loop', [wp('home', 4, 1), wp('store', 12, 1), wp('yard', 2, 1)]);
    const g = guard(world, { x: 4, y: 0, z: 1 }, { routine: [{ route: yard }] });
    // First lap with the door open: it goes through to room B and back.
    const lap = stands(world, g, yard.waypoints, 1400);
    expect(lap.map((s) => s.at).slice(0, 4)).toEqual(['home', 'store', 'yard', 'home']);
    expect(blocked).toEqual([]);
    // Back home, the door is locked: the store cannot be reached.
    for (let i = 0; i < 400 && brain(world, g).blackboard.waypoint !== 1; i++) world.step();
    gate = 'locked';
    const tick = world.tick;
    const after = stands(world, g, yard.waypoints, 600);
    expect(blocked[0]).toEqual({
      tick: expect.any(Number) as number,
      entity: g,
      route: 'yard',
      waypoint: 'store',
      at: { x: 12, y: 0, z: 1 },
    });
    expect(must(blocked[0]).tick).toBeGreaterThanOrEqual(tick);
    expect(after.map((s) => s.at).slice(0, 3)).toEqual(['home', 'yard', 'home']);
    expect(placeOf(world, g).x).toBeLessThan(7);
    expect(brain(world, g).activity).toBe('patrol'); // still patrolling, minus the store
  });

  it('AC-4: when every waypoint is blocked the activity fails, reporting each one', () => {
    const navigation: AiNavigation = { travel: () => 'failure' };
    const world = aiWorld(patrolling(), { navigation });
    const blocked: RouteBlock[] = [];
    world.events.on(RouteBlocked, (b) => blocked.push(b));
    const g = guard(world, A.at, { routine: [{ route: route('yard', 'loop', [A, B, C]) }] });
    world.step();
    expect(blocked.map((b) => b.waypoint)).toEqual(['a', 'b', 'c']);
    expect(brain(world, g).ended).toEqual({ activity: 'patrol', ok: false });
    // Without a placement it cannot measure or walk: the same.
    const lost = aiWorld(patrolling());
    const ghost = guard(lost, A.at, { routine: [{ route: route('yard', 'loop', [A, B]) }] }, false);
    lost.step();
    expect(brain(lost, ghost).ended).toEqual({ activity: 'patrol', ok: false });
  });

  it('a post holds its waypoint for good, faces its look, sweeps its scan arc and plays its idle cue once', () => {
    const world = aiWorld(patrolling({ dwellS: 1 }));
    const cues: AiCue[] = [];
    world.events.on(AiCuePlayed, (c) => cues.push(c));
    const gate = wp('gate', 3, 0, { look: 90, scanArc: 90, scanS: 2, idle: 'guard-lean' });
    const g = guard(
      world,
      { x: 0, y: 0, z: 0 },
      { routine: [{ route: route('gate', 'post', [gate]) }] },
    );
    let arrived = -1;
    for (let i = 0; i < 200 && arrived < 0; i++) {
      world.step();
      if (cues.length > 0) arrived = world.tick - 1;
    }
    expect(cues).toEqual([{ tick: arrived, entity: g, cue: 'guard-lean' }]);
    expect(facingOf(world, g)).toEqual({ x: 1, y: 0, z: expect.closeTo(0, 9) as number }); // look 90°
    world.step(); // one tick into the sweep
    expect(facingOf(world, g).x).toBeCloseTo(
      sin(((90 + 45 * sin(Math.PI / 60)) * Math.PI) / 180),
      9,
    );
    // A quarter of the sweep in, it looks 45° further round (toward −z).
    while (world.tick < arrived + 31) world.step();
    expect(facingOf(world, g).x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(facingOf(world, g).z).toBeCloseTo(-Math.SQRT1_2, 9);
    const at = { ...placeOf(world, g) };
    for (let i = 0; i < 1000; i++) world.step();
    expect(placeOf(world, g)).toEqual(at);
    expect(cues).toHaveLength(1);
    expect(brain(world, g).blackboard.waypoint).toBe(0);
  });

  it('a random route draws each next waypoint by link weight from the agent’s own seeded stream', () => {
    const hub = wp('hub', 0, 0);
    const graph = route(
      'wander',
      'random',
      [hub, wp('east', 2, 0), wp('north', 0, 2)],
      [
        { from: 0, to: 1, weight: 3 },
        { from: 0, to: 2, weight: 1 },
        { from: 1, to: 0, weight: 1 },
        { from: 2, to: 0, weight: 1 },
      ],
    );
    const visits = (seed: number) => {
      const world = aiWorld(patrolling({ dwellS: 0.5 }), {}, seed);
      const g = guard(world, hub.at, { routine: [{ route: graph }] });
      const order = stands(world, g, graph.waypoints, 6000).map((s) => s.at);
      return { order, world, g };
    };
    const { order, world, g } = visits(7);
    expect(order.length).toBeGreaterThan(20);
    order.forEach((at, i) => {
      if (i > 0) expect(at === 'hub' || order[i - 1] === 'hub').toBe(true); // only along links
      if (i > 0) expect(at !== order[i - 1]).toBe(true);
    });
    const east = order.filter((at) => at === 'east').length;
    const north = order.filter((at) => at === 'north').length;
    expect(east).toBeGreaterThan(north);
    expect(north).toBeGreaterThan(0);
    expect(visits(7).order).toEqual(order); // deterministic
    expect(visits(8).order).not.toEqual(order);
    // Its draws come from its own stream, so the shared `ai` stream is untouched.
    const fresh = new World<never>({ seed: 7 });
    expect(world.random('ai').serialize()).toEqual(fresh.random('ai').serialize());
    expect(world.random(`ai-route:${String(g)}`).serialize()).not.toEqual(
      fresh.random(`ai-route:${String(g)}`).serialize(),
    );
    // A random route without a way out of its waypoint stays put.
    const alone = route('alone', 'random', [hub]);
    expect(nextWaypoint(viewOf(world, g), alone, 0)).toBe(0);
  });

  it('a routine runs the first route whose window holds the hour, and switches route when the hour moves', () => {
    let hour = 12;
    const day = route('day', 'loop', [wp('d0', 0, 0), wp('d1', 6, 0)]);
    const night = route('night', 'post', [wp('n0', 0, 4)]);
    const routine: PatrolRoutine[] = [
      { route: day, hours: [6, 18] },
      { route: night, hours: [18, 6] },
    ];
    const world = aiWorld(patrolling(), { hourOfDay: () => hour });
    const g = guard(world, { x: 0, y: 0, z: 0 }, { routine });
    for (let i = 0; i < 60; i++) world.step();
    expect(placeOf(world, g).x).toBeGreaterThan(1); // walking the day loop toward d1
    hour = 20;
    for (let i = 0; i < 400; i++) world.step();
    const end = placeOf(world, g);
    expect(hypot(end.x, end.z - 4)).toBeLessThanOrEqual(WAYPOINT_RADIUS + 1e-9); // at its post
    // No window holds 03:00 for a day-only routine: there is no route to walk.
    const early = aiWorld(patrolling(), { hourOfDay: () => 3 });
    const e = guard(early, { x: 0, y: 0, z: 0 }, { routine: [{ route: day, hours: [6, 18] }] });
    early.step();
    expect(brain(early, e).ended).toEqual({ activity: 'patrol', ok: false });
    // Without an hour of the day the first route runs; hours wrap into 0–24.
    const clockless = aiWorld(patrolling());
    const c = guard(clockless, { x: 0, y: 0, z: 0 }, { routine });
    expect(activeRoute(viewOf(clockless, c))?.route.id).toBe('day');
    const late = aiWorld(patrolling(), { hourOfDay: () => -3 });
    const l = guard(late, { x: 0, y: 0, z: 0 }, { routine });
    expect(activeRoute(viewOf(late, l))?.route.id).toBe('night'); // −3 h is 21:00
  });

  it('a creature’s patrol points are a loop named "patrol"', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    expect(patrolLoop(points)).toBe(patrolLoop(points));
    expect(patrolLoop(points)).toEqual({
      id: 'patrol',
      kind: 'loop',
      waypoints: [
        { id: '0', at: points[0] },
        { id: '1', at: points[1] },
      ],
    });
    const world = aiWorld(patrolling());
    const g = guard(world, points[0] as Vec3, { patrol: points });
    const none = guard(world, points[0] as Vec3, { patrol: [] });
    expect(activeRoute(viewOf(world, g))).toEqual({ route: patrolLoop(points), entry: 0 });
    expect(activeRoute(viewOf(world, none))).toBeUndefined();
  });
});

/** A view of `entity` as the runtime would build it. */
function viewOf(world: World<never>, entity: EntityId): AgentView {
  return {
    world,
    entity,
    brain: brainOf(world, entity) as Brain,
    creature: world.get(entity, CreatureComponent),
    tuning: {},
    tick: world.tick,
    hz: 60,
    ports: aiPorts(world),
  };
}

const at = (r: PatrolRoute, i: number): Vec3 => must(r.waypoints[i]).at;

describe('route geometry (mw-e11.9)', () => {
  it('windows hold [from, to), wrapping past midnight when from > to', () => {
    expect(inWindow(undefined, 3)).toBe(true);
    expect([5.9, 6, 17.9, 18].map((h) => inWindow([6, 18], h))).toEqual([false, true, true, false]);
    expect([17.9, 18, 23, 0, 5.9, 6].map((h) => inWindow([18, 6], h))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('measures how far off its route the agent is, along the ways each kind walks', () => {
    const world = aiWorld(patrolling());
    const square = [wp('a', 0, 0), wp('b', 4, 0), wp('c', 4, 4), wp('d', 0, 4)];
    const off = (r: PatrolRoute, here: Vec3) => {
      const g = guard(world, here, { routine: [{ route: r }] });
      return must(resolveInput('offRoute'))(viewOf(world, g));
    };
    const inside = { x: 1, y: 0, z: 2 };
    expect(off(route('r', 'loop', square), inside)).toBe(1); // the closing leg d→a
    expect(off(route('r', 'ping-pong', square), inside)).toBe(2); // no closing leg
    const graph = route('r', 'random', square, [{ from: 1, to: 3, weight: 1 }]);
    expect(off(graph, { x: 0, y: 0, z: 0 })).toBeCloseTo(Math.SQRT2 * 2, 9);
    expect(off(route('r', 'random', square), { x: 0, y: 0, z: 3 })).toBe(3); // no links: its first
    expect(off(route('r', 'post', [wp('p', 3, 0)]), { x: 0, y: 0, z: 4 })).toBe(5);
    const ghost = guard(world, inside, { routine: [{ route: route('r', 'loop', square) }] }, false);
    expect(must(resolveInput('offRoute'))(viewOf(world, ghost))).toBe(0);
  });

  it('nearest falls back to the straight line when nothing can be reached, and is -1 without a placement', () => {
    const blind: AiNavigation = { travel: () => 'failure', distance: () => Infinity };
    const world = aiWorld(patrolling(), { navigation: blind });
    const r = route('r', 'loop', [wp('a', 0, 0), wp('b', 5, 0), wp('c', 9, 0)]);
    const g = guard(world, { x: 6, y: 0, z: 0 }, { routine: [{ route: r }] });
    expect(nearestWaypoint(viewOf(world, g), r)).toBe(1);
    const ghost = guard(world, { x: 0, y: 0, z: 0 }, { routine: [{ route: r }] }, false);
    expect(nearestWaypoint(viewOf(world, ghost), r)).toBe(-1);
    expect(straightDistance(world, ghost, { x: 1, y: 0, z: 0 })).toBe(Infinity);
    // A port without `distance` is measured in a straight line.
    const walker: AiNavigation = {
      travel: (w, e, request) => straightLineNavigation.travel(w, e, request),
    };
    const plain = aiWorld(patrolling(), { navigation: walker });
    const h = guard(plain, { x: 6, y: 0, z: 0 }, { routine: [{ route: r }] });
    expect(nearestWaypoint(viewOf(plain, h), r)).toBe(1);
  });

  it('move-to the nearest waypoint fails without a route', () => {
    const world = aiWorld(
      behaviour({
        states: { unaware: { activities: ['back'] } },
        activities: { back: [{ do: 'move-to', target: 'nearest-waypoint' }] },
      }),
    );
    const g = guard(world, { x: 0, y: 0, z: 0 }, {});
    world.step();
    expect(brain(world, g).ended).toEqual({ activity: 'back', ok: false });
  });

  it('scans only with a look: a look alone holds it, no look leaves facing alone', () => {
    expect(scanYaw(wp('a', 0, 0), 10, 60)).toBeUndefined();
    expect(scanYaw(wp('a', 0, 0, { look: 45 }), 10, 60)).toBe(45);
    expect(scanYaw(wp('a', 0, 0, { look: 0, scanArc: 60 }), 90, 60)).toBeCloseTo(30, 9); // 6 s sweep
  });

  it('routines are plain data: a save mid-dwell restores and continues identically', () => {
    const run = (split: boolean) => {
      const world = aiWorld(patrolling());
      const walk = route('wall', 'ping-pong', [
        wp('a', 0, 0, { dwellS: 1, look: 90, scanArc: 40 }),
        wp('b', 3, 0),
      ]);
      guard(world, { x: 0, y: 0, z: 0 }, { routine: [{ route: walk }] });
      for (let i = 0; i < 300; i++) world.step();
      let w = world;
      if (split) {
        w = aiWorld(patrolling());
        w.restore(JSON.parse(JSON.stringify(world.snapshot())) as WorldSnapshot);
      }
      for (let i = 0; i < 300; i++) w.step();
      return hashWorld(w);
    };
    expect(run(true)).toBe(run(false));
  });
});
