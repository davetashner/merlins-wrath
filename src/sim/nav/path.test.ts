import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import { bakeNavMesh, type NavBakeInput } from './bake';
import { NAV_AGENT_BITS } from './capabilities';
import {
  CLIMBER,
  IN_A,
  IN_B,
  ON_PILLAR,
  ON_PLATFORM,
  OPENER,
  TWO_ROOMS,
  twoRooms,
  WALKER,
} from './fixtures';
import { NavMesh } from './mesh';
import {
  NAV_DOOR_COST,
  NAV_SEARCH_SETUP_UNITS,
  NavMeshQuery,
  NavOpenList,
  NavPathSearch,
  type NavPathPoint,
  type NavPathResult,
} from './path';

const query = (mesh = twoRooms()) => new NavMeshQuery(mesh);
/** `items[i]`, which the test knows is there. */
const nth = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) throw new Error(`no item ${String(i)}`);
  return item;
};

const hyp = (...v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));

/** The points of a found or unreachable result. */
function pointsOf(result: NavPathResult): readonly NavPathPoint[] {
  if (result.status === 'off-mesh') throw new Error('no path');
  return result.points;
}

/** Every walking segment of `points` lies on `mesh` (sampled every 5 cm), within 5 cm of its surface. */
function assertOnMesh(mesh: NavMesh, points: readonly NavPathPoint[]): void {
  for (let n = 1; n < points.length; n++) {
    const a = nth(points, n - 1);
    const b = nth(points, n);
    if (a.link !== undefined) continue;
    const length = hyp(b.x - a.x, b.z - a.z);
    const samples = Math.max(1, Math.ceil(length / 0.05));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      const poly = mesh.locate(p, 0.45, 0.45);
      expect(
        poly,
        `segment ${String(n)} at t=${t.toFixed(2)} (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(0);
    }
  }
}

const length = (points: readonly Vec3[]) =>
  points.slice(1).reduce((sum, p, n) => {
    const q = nth(points, n);
    return sum + hyp(p.x - q.x, p.y - q.y, p.z - q.z);
  }, 0);

describe('navmesh paths (mw-e11.4)', () => {
  it('AC-1: a path between connected points is on-mesh and identical across runs and bakes', () => {
    const first = query().findPath({ start: IN_A, goal: { x: 5, y: 0, z: 3.5 }, agent: WALKER });
    expect(first.status).toBe('found');
    assertOnMesh(twoRooms(), pointsOf(first));
    const again = query(new NavMesh(bakeNavMesh(TWO_ROOMS))).findPath({
      start: IN_A,
      goal: { x: 5, y: 0, z: 3.5 },
      agent: WALKER,
    });
    expect(again).toEqual(first);
    // Starts and ends where asked, on the surface.
    const points = pointsOf(first);
    expect(points[0]).toEqual({ x: 4, y: 0, z: 1 });
    expect(points.at(-1)).toEqual({ x: 5, y: 0, z: 3.5 });
  });

  it('AC-1: through the open door between rooms, the path is on-mesh and hugs the doorway', () => {
    const mesh = twoRooms();
    const result = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: OPENER,
      doors: () => 'open',
    });
    expect(result.status).toBe('found');
    const points = pointsOf(result);
    assertOnMesh(mesh, points);
    // String pulling: two corners at the doorway, no zig-zag through rectangle centres.
    expect(points.length).toBe(4);
    expect(points[1]?.x).toBeLessThan(7);
    expect(points[2]?.x).toBeGreaterThan(7);
    for (const p of points.slice(1, 3)) expect(p.z).toBeGreaterThan(2.4);
  });

  it('AC-2: a locked door blocks the only way through; unlocked and opened, the path is found', () => {
    const mesh = twoRooms();
    const locked = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: OPENER,
      doors: () => 'locked',
    });
    expect(locked.status).toBe('unreachable');
    const door = mesh.doors.indexOf('gate');
    expect(door).toBe(0);
    if (locked.status !== 'unreachable') return;
    expect(locked.polys.some((p) => mesh.doorOf(p) === 'gate')).toBe(false);
    expect(locked.closest.x).toBeLessThan(7);
    const opened = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: OPENER,
      doors: () => 'open',
    });
    expect(opened.status).toBe('found');
    if (opened.status === 'found')
      expect(opened.polys.some((p) => mesh.doorOf(p) === 'gate')).toBe(true);
  });

  it('AC-2: a closed (unlocked) door lets door openers through at a cost and stops the rest', () => {
    const mesh = twoRooms();
    const closed = (agent = OPENER) =>
      query(mesh).findPath({ start: IN_A, goal: IN_B, agent, doors: () => 'closed' });
    expect(closed().status).toBe('found');
    expect(closed(WALKER).status).toBe('unreachable');
    // Without a lookup every door counts as closed.
    expect(query(mesh).findPath({ start: IN_A, goal: IN_B, agent: OPENER })).toEqual(closed());
    expect(NAV_DOOR_COST).toBeGreaterThan(0);
  });

  it('AC-3: only the climber takes the climb link; the walker goes round by the ramp', () => {
    const mesh = twoRooms();
    const climber = query(mesh).findPath({ start: IN_A, goal: ON_PLATFORM, agent: CLIMBER });
    const walker = query(mesh).findPath({ start: IN_A, goal: ON_PLATFORM, agent: WALKER });
    expect(climber.status).toBe('found');
    expect(walker.status).toBe('found');
    const climbs = (r: NavPathResult) => pointsOf(r).filter((p) => p.link === 'climb').length;
    expect(climbs(climber)).toBe(1);
    expect(climbs(walker)).toBe(0);
    assertOnMesh(mesh, pointsOf(walker));
    assertOnMesh(mesh, pointsOf(climber));
    expect(length(pointsOf(climber))).toBeLessThan(length(pointsOf(walker)));
    // The walker's way up is the ramp: it passes its low end.
    expect(pointsOf(walker).some((p) => p.x > 5 && p.z > 4.5)).toBe(true);
  });

  it('AC-3: a climber of a lower grade than the surface keeps off the link', () => {
    const mesh = new NavMesh(
      bakeNavMesh({
        ...TWO_ROOMS,
        solids: TWO_ROOMS.solids.map((s) =>
          s.climbGrade === undefined ? s : { ...s, climbGrade: 2 },
        ),
      }),
    );
    const result = query(mesh).findPath({ start: IN_A, goal: ON_PLATFORM, agent: CLIMBER });
    expect(pointsOf(result).some((p) => p.link === 'climb')).toBe(false);
  });

  it('AC-4: an unreachable goal answers Unreachable with the closest reachable point', () => {
    const mesh = twoRooms();
    let result: NavPathResult | undefined;
    expect(() => {
      result = query(mesh).findPath({ start: IN_B, goal: ON_PILLAR, agent: CLIMBER });
    }).not.toThrow();
    expect(result?.status).toBe('unreachable');
    if (result?.status !== 'unreachable') return;
    // The closest point is on the floor beside the pillar, where the path ends.
    expect(result.closest.y).toBe(0);
    expect(hyp(result.closest.x - 10.5, result.closest.z - 3)).toBeLessThan(1.5);
    expect(result.points.at(-1)).toEqual({ ...result.closest });
    assertOnMesh(mesh, result.points);
  });

  it('AC-4: a goal far off the mesh is unreachable too, ending at the closest point', () => {
    const mesh = twoRooms();
    const result = query(mesh).findPath({
      start: IN_A,
      goal: { x: -30, y: 0, z: 3 },
      agent: WALKER,
    });
    expect(result.status).toBe('unreachable');
    if (result.status === 'unreachable') expect(result.closest.x).toBeLessThan(1);
  });

  it('answers off-mesh when the start is nowhere near the mesh', () => {
    expect(query().findPath({ start: { x: 50, y: 0, z: 50 }, goal: IN_A, agent: WALKER })).toEqual({
      status: 'off-mesh',
    });
    expect(
      query().findPath({ start: IN_A, goal: IN_A, agent: { ...WALKER, mask: 0 } }).status,
    ).toBe('off-mesh');
  });

  it('snaps a start or goal just off the mesh onto it', () => {
    const mesh = twoRooms();
    // Hard against the wall (inside the eroded margin) and a little above the floor.
    const result = query(mesh).findPath({
      start: { x: 4, y: 0.2, z: 0.1 },
      goal: { x: 13.95, y: 0, z: 5.9 },
      agent: OPENER,
      doors: () => 'open',
    });
    expect(result.status).toBe('found');
    const points = pointsOf(result);
    expect(points[0]?.z).toBeGreaterThan(0.3);
    expect(points.at(-1)?.x).toBeLessThan(13.7);
    assertOnMesh(mesh, points);
  });

  it('starts from a doorway it may stand in, and steps out of one it may not', () => {
    const mesh = twoRooms();
    const doorway = { x: 7, y: 0, z: 3 };
    const open = query(mesh).findPath({
      start: doorway,
      goal: IN_B,
      agent: OPENER,
      doors: () => 'open',
    });
    expect(pointsOf(open)[0]).toEqual(doorway);
    const locked = query(mesh).findPath({
      start: doorway,
      goal: IN_A,
      agent: OPENER,
      doors: () => 'locked',
    });
    expect(locked.status).toBe('found');
    expect(mesh.doorOf(mesh.locate(pointsOf(locked)[0] ?? doorway))).toBeUndefined();
  });

  it('walks down the drop link rather than all the way round the ramp', () => {
    const mesh = twoRooms();
    const result = query(mesh).findPath({ start: ON_PLATFORM, goal: IN_A, agent: WALKER });
    const points = pointsOf(result);
    expect(points.some((p) => p.link === 'drop')).toBe(true);
    // An agent that never drops (no more than a step) goes round by the ramp.
    const timid = query(mesh).findPath({
      start: ON_PLATFORM,
      goal: IN_A,
      agent: { ...WALKER, maxDrop: 0.3 },
    });
    expect(pointsOf(timid).some((p) => p.link !== undefined)).toBe(false);
  });

  it('jumps up a ledge it can reach', () => {
    const jumper = { ...WALKER, jumpHeight: 1.6 };
    const result = query().findPath({ start: IN_A, goal: ON_PLATFORM, agent: jumper });
    expect(pointsOf(result).some((p) => p.link === 'jump')).toBe(true);
  });

  it('weighs areas by the agent’s costs and keeps out of areas it cannot enter', () => {
    const data = bakeNavMesh(TWO_ROOMS);
    // Make every polygon of room B shallow water.
    const cs = data.settings.cellSize;
    const wet = {
      ...data,
      polys: data.polys.map((p) =>
        data.origin[0] + p[0] * cs >= 7.1
          ? ([...p.slice(0, 7), 1, p[8]] as unknown as typeof p)
          : p,
      ),
    };
    const mesh = new NavMesh(wet);
    const dry = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: OPENER,
      doors: () => 'open',
    });
    expect(dry.status).toBe('unreachable');
    const wader = {
      ...OPENER,
      mask: OPENER.mask | NAV_AGENT_BITS.wade,
      areaCosts: { ground: 1, 'water-shallow': 3 },
    };
    const wading = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: wader,
      doors: () => 'open',
    });
    expect(wading.status).toBe('found');
    // A cheap area makes the heuristic scale down with it (still found, still on-mesh).
    const fond = { ...wader, areaCosts: { ground: 1, 'water-shallow': 0.5 } };
    const result = query(mesh).findPath({
      start: IN_A,
      goal: IN_B,
      agent: fond,
      doors: () => 'open',
    });
    expect(result.status).toBe('found');
    assertOnMesh(mesh, pointsOf(result));
  });

  it('runs in slices of at least one expansion and gives the same answer as a full run', () => {
    const mesh = twoRooms();
    const request = { start: IN_A, goal: IN_B, agent: OPENER, doors: () => 'open' as const };
    const sliced = new NavPathSearch(mesh, request);
    expect(sliced.done).toBe(false);
    expect(sliced.result).toBeUndefined();
    // The first slice pays for the set-up; then one expansion per slice until the finishing one.
    expect(sliced.step(0)).toBe(NAV_SEARCH_SETUP_UNITS + 1);
    let spent = NAV_SEARCH_SETUP_UNITS + 1;
    while (!sliced.done) {
      const used = sliced.step(0);
      expect(used).toBeGreaterThanOrEqual(1);
      spent += used;
    }
    expect(spent).toBe(sliced.iterations);
    expect(sliced.step(5)).toBe(0);
    expect(sliced.result).toEqual(new NavPathSearch(mesh, request).run());
  });

  it('starts on a link when asked from its very foot', () => {
    const mesh = twoRooms();
    const climbs = [...Array(mesh.linkCount).keys()]
      .map((n) => mesh.link(n))
      .filter((l) => l.kind === 'climb' && l.b.y > l.a.y);
    const foot = climbs[0]?.a ?? IN_A;
    const result = query(mesh).findPath({ start: foot, goal: ON_PLATFORM, agent: CLIMBER });
    const points = pointsOf(result);
    expect(points[0]).toEqual({ ...foot, link: 'climb' });
  });

  it('orders the open list by f, then by polygon index', () => {
    const f = Float64Array.from([3, 1, 1, 2, 0.5]);
    const open = new NavOpenList(f);
    for (const p of [0, 2, 1, 3]) open.push(p);
    expect(open.size).toBe(4);
    open.push(4);
    f[0] = 0;
    open.update(0);
    expect([open.pop(), open.pop(), open.pop(), open.pop(), open.pop()]).toEqual([0, 4, 1, 2, 3]);
  });

  it('finds the straight line within one polygon', () => {
    const result = query().findPath({
      start: { x: 9, y: 0, z: 1 },
      goal: { x: 13, y: 0, z: 1 },
      agent: WALKER,
    });
    expect(pointsOf(result)).toEqual([
      { x: 9, y: 0, z: 1 },
      { x: 13, y: 0, z: 1 },
    ]);
  });

  it('turns both ways round corners (left- and right-hand bends)', () => {
    // An S-bend: a corridor with two offset walls.
    const s: NavBakeInput = {
      id: 's-bend',
      solids: [
        { shape: { kind: 'box', min: { x: 0, y: -0.2, z: 0 }, max: { x: 10, y: 0, z: 10 } } },
        { shape: { kind: 'box', min: { x: 3, y: 0, z: 0 }, max: { x: 3.2, y: 3, z: 7 } } },
        { shape: { kind: 'box', min: { x: 6, y: 0, z: 3 }, max: { x: 6.2, y: 3, z: 10 } } },
      ],
      doors: [],
    };
    const mesh = new NavMesh(bakeNavMesh(s));
    for (const [start, goal] of [
      [
        { x: 1, y: 0, z: 1 },
        { x: 9, y: 0, z: 9 },
      ],
      [
        { x: 9, y: 0, z: 9 },
        { x: 1, y: 0, z: 1 },
      ],
      [
        { x: 1, y: 0, z: 9 },
        { x: 9, y: 0, z: 1 },
      ],
    ] as const) {
      const result = query(mesh).findPath({ start, goal, agent: WALKER });
      expect(result.status).toBe('found');
      const points = pointsOf(result);
      assertOnMesh(mesh, points);
      expect(points.length).toBeGreaterThanOrEqual(3);
    }
  });
});
