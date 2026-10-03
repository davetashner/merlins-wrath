import { describe, expect, it } from 'vitest';
import type { NavAgent } from '@content/index';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureNavComponent } from '../creatures/components';
import { PlacementComponent, placeEntity, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import type { NavDoorState } from './doors';
import { CLIMBER, IN_A, IN_B, ON_PLATFORM, twoRooms } from './fixtures';
import {
  NAV_REPLAN_DISTANCE,
  navmeshNavigation,
  NavRouteComponent,
  type NavmeshNavigationOptions,
} from './navigation';

const mesh = twoRooms();
const DT = 1 / 60;

function setup(options: Partial<NavmeshNavigationOptions> = {}) {
  const world = new World<never>({ seed: 1 });
  world.register(PlacementComponent, CreatureNavComponent);
  const nav = navmeshNavigation({ mesh, doors: () => 'open', ...options });
  const spawn = (at: Vec3, radius = 0.35, agent?: Partial<NavAgent>) => {
    const entity = world.spawn();
    placeEntity(world, entity, at, radius);
    if (agent !== undefined) world.add(entity, CreatureNavComponent, agent as NavAgent);
    return entity;
  };
  const place = (entity: EntityId): Placement => {
    const at = world.get(entity, PlacementComponent);
    if (at === undefined) throw new Error('no placement');
    return at;
  };
  const travel = (entity: EntityId, goal: Vec3, speed = 3, within = 0.2) =>
    nav.travel(world, entity, { goal, within, speed, dt: DT });
  return { world, nav, spawn, place, travel };
}

/** Travels until success or failure (at most `ticks`), stepping the world; returns the trail. */
function walk(t: ReturnType<typeof setup>, entity: EntityId, goal: Vec3, ticks = 2000) {
  const trail: Placement[] = [];
  for (let n = 0; n < ticks; n++) {
    const status = t.travel(entity, goal);
    trail.push(t.place(entity));
    t.world.step();
    if (status !== 'running') return { status, trail, ticks: n + 1 };
  }
  return { status: 'running' as const, trail, ticks };
}

describe('navmesh travel for AI (mw-e11.4)', () => {
  it('walks an agent through the doorway to the other room, on the mesh all the way', () => {
    const t = setup();
    const guard = t.spawn(IN_A);
    const { status, trail } = walk(t, guard, IN_B);
    expect(status).toBe('success');
    const end = t.place(guard);
    expect(Math.abs(end.x - IN_B.x) + Math.abs(end.z - IN_B.z)).toBeLessThan(0.3);
    for (const p of trail) expect(mesh.locate(p, 0.45, 0.45)).toBeGreaterThanOrEqual(0);
    // It went through the doorway, not the wall.
    expect(trail.some((p) => Math.abs(p.x - 7) < 0.1 && p.z > 2.4 && p.z < 3.6)).toBe(true);
    expect(t.world.get(guard, NavRouteComponent)?.status).toBe('ready');
  });

  it('counts doors as closed without a door lookup: a walker cannot leave the room', () => {
    const world = new World<never>({ seed: 1 });
    world.register(PlacementComponent);
    const nav = navmeshNavigation({ mesh });
    const guard = world.spawn();
    placeEntity(world, guard, IN_A, 0.35);
    let status = nav.travel(world, guard, { goal: IN_B, within: 0.2, speed: 3, dt: DT });
    for (let n = 0; n < 10 && status === 'running'; n++) {
      world.step();
      status = nav.travel(world, guard, { goal: IN_B, within: 0.2, speed: 3, dt: DT });
    }
    expect(status).toBe('failure');
  });

  it('walks onto the mesh from just off it, behind the start of its path', () => {
    const t = setup();
    const guard = t.spawn({ x: 4, y: 0, z: 0.1 });
    const { status, trail } = walk(t, guard, { x: 4, y: 0, z: 3 });
    expect(status).toBe('success');
    expect(trail[0]?.y).toBe(0);
    expect(t.place(guard).z).toBeGreaterThan(2.75);
  });

  it('is deterministic: two runs leave the same trail', () => {
    const a = setup();
    const b = setup();
    expect(walk(a, a.spawn(IN_A), IN_B).trail).toEqual(walk(b, b.spawn(IN_A), IN_B).trail);
  });

  it('stands still (running) while its request waits in the queue', () => {
    const t = setup({ queue: { unitsPerTick: 1 } });
    const guard = t.spawn(IN_A);
    const first = walk(t, guard, IN_B, 3);
    expect(first.status).toBe('running');
    expect(first.trail.every((p) => p.x === IN_A.x && p.z === IN_A.z)).toBe(true);
    expect(t.world.get(guard, NavRouteComponent)?.status).toBe('pending');
    expect(walk(t, guard, IN_B).status).toBe('success');
  });

  it('succeeds at once within reach, and fails without a placement, speed or a reachable goal', () => {
    const t = setup();
    const guard = t.spawn(IN_A);
    expect(t.travel(guard, { x: 4.1, y: 0, z: 1 })).toBe('success');
    expect(
      t.nav.travel(t.world, t.world.spawn(), { goal: IN_B, within: 0.2, speed: 3, dt: DT }),
    ).toBe('failure');
    // Speed 0: the path is found (the queue answers this tick) but it cannot move along it.
    expect(t.travel(guard, IN_B, 0)).toBe('failure');
    t.world.step();
    const locked = setup({ doors: () => 'locked' });
    const stuck = locked.spawn(IN_A, 0.35, {
      mask: 0b100000001,
      jumpHeight: 0.6,
      maxDrop: 2.5,
      maxClimbGrade: 0,
      maxAltitude: 0,
      burrowMaterials: [],
      areaCosts: { ground: 1 },
    });
    expect(walk(locked, stuck, IN_B).status).toBe('failure');
    expect(locked.world.get(stuck, NavRouteComponent)?.status).toBe('failed');
    // A failed route stays failed for the same goal without asking again.
    expect(locked.travel(stuck, IN_B)).toBe('failure');
    const lost = setup();
    const offMesh = lost.spawn({ x: 50, y: 0, z: 50 });
    expect(walk(lost, offMesh, IN_B).status).toBe('failure');
  });

  it('climbs the climb link with a climber’s nav agent', () => {
    const t = setup();
    const climber = t.spawn(IN_A, 0.35, CLIMBER);
    const { status, trail } = walk(t, climber, ON_PLATFORM);
    expect(status).toBe('success');
    expect(t.place(climber).y).toBe(1.5);
    // Mid-climb it is off the floor and below the top, against the platform's face.
    expect(trail.some((p) => p.y > 0.3 && p.y < 1.2)).toBe(true);
  });

  it('plans again when the goal moves or a door changes', () => {
    let gate: NavDoorState = 'locked';
    const t = setup({ doors: () => gate });
    const guard = t.spawn(IN_A, 0.35, { ...(CLIMBER as NavAgent) });
    expect(walk(t, guard, IN_B).status).toBe('failure');
    gate = 'open';
    expect(walk(t, guard, IN_B).status).toBe('success');
    const before = t.world.get(guard, NavRouteComponent);
    const goal = { x: IN_A.x, y: 0, z: IN_A.z + NAV_REPLAN_DISTANCE * 3 };
    t.travel(guard, goal);
    expect(t.world.get(guard, NavRouteComponent)?.goal).toEqual(goal);
    expect(t.world.get(guard, NavRouteComponent)).not.toEqual(before);
  });

  it('asks again when its pending request was lost (a save loaded mid-search)', () => {
    const t = setup({ queue: { unitsPerTick: 1 } });
    const guard = t.spawn(IN_A);
    t.travel(guard, IN_B);
    t.world.step();
    const route = t.world.get(guard, NavRouteComponent);
    expect(route?.status).toBe('pending');
    t.nav.queue.cancel(route?.request ?? 0);
    t.travel(guard, IN_B);
    const again = t.world.get(guard, NavRouteComponent);
    expect(again?.status).toBe('pending');
    expect(again?.request).not.toBe(route?.request);
    // Moving the goal while pending drops the old request.
    t.world.step();
    t.travel(guard, { x: 12, y: 0, z: 5 });
    expect(t.nav.queue.isPending(again?.request ?? 0)).toBe(false);
  });

  it('keeps two agents on the same route apart (separation), never pushing one off the mesh', () => {
    const t = setup();
    const a = t.spawn(IN_A);
    const b = t.spawn({ x: IN_A.x + 0.1, y: 0, z: IN_A.z });
    const gap = () => Math.abs(t.place(a).x - t.place(b).x) + Math.abs(t.place(a).z - t.place(b).z);
    const start = gap();
    for (let n = 0; n < 30; n++) {
      t.travel(a, IN_B);
      t.travel(b, IN_B);
      t.world.step();
    }
    expect(gap()).toBeGreaterThan(start);
    for (const e of [a, b]) expect(mesh.locate(t.place(e), 0.45, 0.45)).toBeGreaterThanOrEqual(0);
    // Two agents on one spot still separate (pushed along +x).
    const u = setup();
    const c = u.spawn(IN_A);
    const d = u.spawn(IN_A);
    u.travel(c, IN_B);
    u.travel(d, IN_B);
    u.world.step();
    u.travel(c, IN_B);
    expect(u.place(c).x).not.toBe(u.place(d).x);
    // Pinned in the corner of the mesh, a push off it is refused.
    const w = setup();
    const corner = mesh.boundsOf(mesh.locate(IN_A));
    const e1 = w.spawn({ x: corner[0], y: 0, z: corner[1] });
    w.spawn({ x: corner[0] + 0.2, y: 0, z: corner[1] + 0.2 });
    w.travel(e1, { x: corner[0], y: 0, z: corner[1] + 3 });
    w.world.step();
    w.travel(e1, { x: corner[0], y: 0, z: corner[1] + 3 });
    expect(mesh.locate(w.place(e1), 0.45, 0.45)).toBeGreaterThanOrEqual(0);
  });

  it('mw-e11.9: measures the path length to a point, Infinity when it cannot get there', () => {
    let gate: NavDoorState = 'open';
    const t = setup({ doors: () => gate });
    const guard = t.spawn(IN_A);
    const distance = (goal: Vec3, entity = guard) => {
      const measure = t.nav.distance;
      if (measure === undefined) throw new Error('navmesh travel measures distance');
      return measure(t.world, entity, goal);
    };
    // Within one room: the straight line.
    expect(distance({ x: 2, y: 0, z: 1 })).toBeCloseTo(2, 6);
    // To the other room: round through the doorway, longer than the straight line.
    const through = distance(IN_B);
    expect(through).toBeGreaterThan(IN_B.x - IN_A.x + 0.5);
    expect(through).toBeLessThan(20);
    // It is what travel walks.
    const { status, trail } = walk(t, guard, IN_B);
    expect(status).toBe('success');
    let walked = 0;
    trail.forEach((p, i) => {
      const prev = trail[i - 1] ?? IN_A;
      walked += Math.sqrt((p.x - prev.x) ** 2 + (p.z - prev.z) ** 2);
    });
    expect(walked).toBeCloseTo(through, 0);
    gate = 'locked';
    const back = t.spawn(IN_A);
    expect(distance(IN_B, back)).toBe(Infinity);
    const ghost = t.world.spawn();
    expect(distance(IN_B, ghost)).toBe(Infinity);
  });
});
