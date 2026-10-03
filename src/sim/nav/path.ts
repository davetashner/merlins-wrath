// Path queries on a navmesh (mw-e11.4): A* over polygons with per-agent capability masks, door
// states and off-mesh links, then string pulling (the "simple stupid funnel") through the portals,
// so a path hugs corners instead of zig-zagging between polygon centres.
//
// Determinism: everything is ordered by index. The open list breaks ties on f, then h, then polygon
// index; edges are tried in the mesh's data order; floating-point maths uses only + − × ÷ and sqrt.
// The same mesh, request and door states give the same path, bit for bit, on every run.
//
// A search can run in slices (`NavPathSearch.step(budget)`, one unit = one polygon expanded) so the
// request queue (./queue.ts) can bound the work done per tick.
//
// Results: `found` with the path; `unreachable` with the closest reachable point to the goal and the
// path there (AC-4: an unreachable goal is an answer, never an exception); `off-mesh` when the start
// is not on the mesh at all.

import type { Vec3 } from '../stimulus/shapes';
import { navAreaCost, navCanEnter, navCanTraverse, type NavAgentSpec } from './capabilities';
import { ALL_DOORS_CLOSED, type NavDoorLookup } from './doors';
import { NAV_AREA_NAMES, type NavLinkKindName } from './format';
import type { NavMesh, NavPoint } from './mesh';
import { known } from './util';

/** `items[index]` for an index known to be in range (module-local: the search's inner loop). */
function at<T>(items: ArrayLike<T>, index: number): T {
  return items[index] as T;
}

/** One point of a path. When `link` is set, the way from this point to the next is that link. */
export interface NavPathPoint extends Vec3 {
  readonly link?: NavLinkKindName;
}

/** What to find a path for. */
export interface NavPathRequest {
  readonly start: Vec3;
  readonly goal: Vec3;
  readonly agent: NavAgentSpec;
  /** Door states; every door counts as closed without one. */
  readonly doors?: NavDoorLookup;
}

export type NavPathResult =
  | {
      readonly status: 'found';
      readonly points: readonly NavPathPoint[];
      /** The polygons walked through, start to goal. */
      readonly polys: readonly number[];
    }
  | {
      readonly status: 'unreachable';
      /** The reachable point closest to the goal: where `points` ends. */
      readonly closest: Vec3;
      readonly points: readonly NavPathPoint[];
      readonly polys: readonly number[];
    }
  | { readonly status: 'off-mesh' };

/** Answers path requests (the sim interface AI navigation is written against). */
export interface NavQuery {
  findPath(request: NavPathRequest): NavPathResult;
}

/** How far from the start, metres, a point is looked for on the mesh (horizontally). */
export const NAV_START_REACH = 1;
/** How far from the goal, metres, a point is looked for on the mesh (horizontally). */
export const NAV_GOAL_REACH = 2;
/** How far above or below the start or goal a surface may be, metres. */
const SNAP_RISE = 2;
/** Extra cost of opening a closed door on the way, metres of walking. */
export const NAV_DOOR_COST = 1;
/** Work units a search's set-up costs (snapping start and goal), in polygon expansions. */
export const NAV_SEARCH_SETUP_UNITS = 8;
/** Cost per metre along each kind of off-mesh link, relative to walking. */
const LINK_COST: Readonly<Record<NavLinkKindName, number>> = {
  jump: 2,
  drop: 1.5,
  climb: 3,
  door: 1,
  fly: 1,
  burrow: 4,
};

const EPS = 1e-9;

const dist3 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);

/** Twice the signed area of triangle (a, b, c) in the xz plane (Detour's dtTriArea2D). */
function triArea2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (cx - ax) * (bz - az) - (bx - ax) * (cz - az);
}

/** A portal as the funnel sees it: its left and right ends for the direction of travel. */
interface Gate {
  readonly lx: number;
  readonly lz: number;
  readonly rx: number;
  readonly rz: number;
  /** Polygon entered through it (heights of points on it). */
  readonly poly: number;
}

/**
 * String-pulls from (sx, sz) to (ex, ez) through `gates` and returns the corner points in between
 * (not the start or the end), each with the polygon its height is read from.
 */
function funnel(sx: number, sz: number, ex: number, ez: number, gates: readonly Gate[]) {
  const corners: { x: number; z: number; poly: number }[] = [];
  // The start and the end are degenerate gates (poly −1: never reported as corners).
  const all: Gate[] = [
    { lx: sx, lz: sz, rx: sx, rz: sz, poly: -1 },
    ...gates,
    { lx: ex, lz: ez, rx: ex, rz: ez, poly: -1 },
  ];
  const corner = (x: number, z: number, poly: number) => {
    if (poly >= 0) corners.push({ x, z, poly });
  };
  let ax = sx;
  let az = sz;
  let lx = sx;
  let lz = sz;
  let rx = sx;
  let rz = sz;
  let left = 0;
  let right = 0;
  const same = (x1: number, z1: number, x2: number, z2: number) =>
    Math.abs(x1 - x2) < EPS && Math.abs(z1 - z2) < EPS;
  for (let i = 1; i < all.length; i++) {
    const g = at(all, i);
    // Tighten the right side.
    if (triArea2(ax, az, rx, rz, g.rx, g.rz) <= 0) {
      if (same(ax, az, rx, rz) || triArea2(ax, az, lx, lz, g.rx, g.rz) > 0) {
        rx = g.rx;
        rz = g.rz;
        right = i;
      } else {
        // The right side crossed the left: the left end is a corner.
        corner(lx, lz, at(all, left).poly);
        ax = lx;
        az = lz;
        rx = lx;
        rz = lz;
        right = left;
        i = left;
        continue;
      }
    }
    // Tighten the left side.
    if (triArea2(ax, az, lx, lz, g.lx, g.lz) >= 0) {
      if (same(ax, az, lx, lz) || triArea2(ax, az, rx, rz, g.lx, g.lz) < 0) {
        lx = g.lx;
        lz = g.lz;
        left = i;
      } else {
        corner(rx, rz, at(all, right).poly);
        ax = rx;
        az = rz;
        lx = rx;
        lz = rz;
        left = right;
        i = right;
        continue;
      }
    }
  }
  return corners;
}

/** A binary min-heap of polygons keyed by (f, index): the A* open list. */
export class NavOpenList {
  private readonly items: number[] = [];
  constructor(private readonly f: Float64Array) {}

  get size(): number {
    return this.items.length;
  }

  private less(a: number, b: number): boolean {
    const fa = at(this.f, a);
    const fb = at(this.f, b);
    return fa !== fb ? fa < fb : a < b;
  }

  push(p: number): void {
    this.items.push(p);
    this.siftUp(this.items.length - 1);
  }

  /** Moves a polygon already in the list up after its key went down. */
  update(p: number): void {
    this.siftUp(this.items.indexOf(p));
  }

  private siftUp(from: number): void {
    const items = this.items;
    let i = from;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(at(items, i), at(items, parent))) break;
      [items[i], items[parent]] = [at(items, parent), at(items, i)];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = at(items, 0);
    const last = at(items, items.length - 1);
    items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(at(items, l), at(items, m))) m = l;
        if (r < items.length && this.less(at(items, r), at(items, m))) m = r;
        if (m === i) break;
        [items[i], items[m]] = [at(items, m), at(items, i)];
        i = m;
      }
    }
    return top;
  }
}

const OPEN = 1;
const CLOSED = 2;

/** One path search, resumable in slices (see the file header). */
export class NavPathSearch {
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly h: Float64Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly parent: Int32Array;
  /** How the polygon was entered: portal index, or −(link index) − 2; −1 for the start. */
  private readonly via: Int32Array;
  private readonly state: Uint8Array;
  private readonly open: NavOpenList;
  /** Per area index: may enter (1), and the cost multiplier. */
  private readonly areaOk: Uint8Array;
  private readonly areaCost: Float64Array;
  /** Per door index: may pass (1), and the extra cost. */
  private readonly doorOk: Uint8Array;
  private readonly doorCost: Float64Array;
  private readonly start: NavPoint | undefined;
  private readonly goal: NavPoint | undefined;
  private readonly gx: number;
  private readonly gy: number;
  private readonly gz: number;
  private readonly hScale: number;
  private best = -1;
  private charged = false;
  private outcome: NavPathResult | undefined;
  /** Work units spent so far (see NAV_SEARCH_SETUP_UNITS). */
  iterations = 0;

  constructor(
    private readonly mesh: NavMesh,
    private readonly request: NavPathRequest,
  ) {
    const n = mesh.polyCount;
    this.g = new Float64Array(n).fill(Infinity);
    this.f = new Float64Array(n);
    this.h = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.parent = new Int32Array(n).fill(-1);
    this.via = new Int32Array(n).fill(-1);
    this.state = new Uint8Array(n);
    this.open = new NavOpenList(this.f);
    const { agent } = request;
    this.areaOk = Uint8Array.from(NAV_AREA_NAMES, (area) => (navCanEnter(agent, area) ? 1 : 0));
    this.areaCost = Float64Array.from(NAV_AREA_NAMES, (area) => navAreaCost(agent, area));
    const lookup = request.doors ?? ALL_DOORS_CLOSED;
    const opens = navCanTraverse(agent, 'door', 0);
    const states = mesh.doors.map((door) => lookup(door));
    this.doorOk = Uint8Array.from(states, (st) =>
      st === 'open' || (st === 'closed' && opens) ? 1 : 0,
    );
    this.doorCost = Float64Array.from(states, (st) => (st === 'closed' ? NAV_DOOR_COST : 0));
    // The cheapest area cost keeps the heuristic admissible.
    this.hScale = Math.min(1, ...Object.values(agent.areaCosts));
    const enterable = (p: number) => at(this.areaOk, at(mesh.area, p)) === 1;
    this.start = this.snap(request.start, NAV_START_REACH, (p) => enterable(p) && this.passable(p));
    this.goal = this.snap(request.goal, NAV_GOAL_REACH, enterable);
    const target = this.goal ?? request.goal;
    this.gx = target.x;
    this.gy = target.y;
    this.gz = target.z;
    if (this.start === undefined) {
      this.outcome = Object.freeze({ status: 'off-mesh' });
      return;
    }
    const s = this.start;
    this.g[s.poly] = 0;
    this.px[s.poly] = s.x;
    this.py[s.poly] = s.y;
    this.pz[s.poly] = s.z;
    this.h[s.poly] = this.heuristic(s.x, s.y, s.z);
    this.f[s.poly] = at(this.h, s.poly);
    this.state[s.poly] = OPEN;
    this.best = s.poly;
    this.open.push(s.poly);
  }

  /** The point on the mesh for `point`: the polygon under it, else the nearest within `reach`. */
  private snap(point: Vec3, reach: number, accept: (p: number) => boolean): NavPoint | undefined {
    const under = this.mesh.locate(point);
    if (under >= 0 && accept(under)) {
      return Object.freeze({
        x: point.x,
        y: this.mesh.heightAt(under, point.x, point.z),
        z: point.z,
        poly: under,
      });
    }
    return this.mesh.nearest(point, reach, SNAP_RISE, accept);
  }

  private heuristic(x: number, y: number, z: number): number {
    return dist3(x, y, z, this.gx, this.gy, this.gz) * this.hScale;
  }

  /** Whether the agent may stand in polygon p given its door, if it has one. */
  private passable(p: number): boolean {
    const d = at(this.mesh.door, p);
    return d < 0 || at(this.doorOk, d) === 1;
  }

  /** Whether the search has finished. */
  get done(): boolean {
    return this.outcome !== undefined;
  }

  /** The answer, once `done`. */
  get result(): NavPathResult | undefined {
    return this.outcome;
  }

  /** Runs the search to the end and returns the answer. */
  run(): NavPathResult {
    while (this.outcome === undefined) this.step(Infinity);
    return this.outcome;
  }

  /**
   * Spends about `budget` work units (at least one polygon expansion) and returns how many it
   * spent: one per polygon expanded, NAV_SEARCH_SETUP_UNITS on the first step (snapping the start
   * and goal, setting up), and one per polygon of the path in the step that finishes it (rebuilding
   * and string-pulling it). The finishing step may overrun the budget by that much.
   */
  step(budget: number): number {
    let used = 0;
    if (!this.charged) {
      this.charged = true;
      used += NAV_SEARCH_SETUP_UNITS;
    }
    const { mesh } = this;
    const { pa: PA, pgx: PGX, pgz: PGZ, area: AREA, door: DOOR } = mesh;
    const { edgeStart, edgeTo, edgeRef, portalXZ } = mesh;
    const {
      g: G,
      f: F,
      h: H,
      px: PX,
      py: PY,
      pz: PZ,
      state: STATE,
      areaOk,
      areaCost,
      doorOk,
      doorCost,
    } = this;
    const goalPoly = this.goal === undefined ? -1 : this.goal.poly;
    let expanded = 0;
    while (this.outcome === undefined && (expanded === 0 || used < budget)) {
      if (this.open.size === 0) {
        used += this.finish(this.best, false);
        break;
      }
      const c = this.open.pop();
      STATE[c] = CLOSED;
      used++;
      expanded++;
      if (c === goalPoly) {
        used += this.finish(c, true);
        break;
      }
      const hc = at(H, c);
      const hb = at(H, this.best);
      if (hc < hb - EPS || (Math.abs(hc - hb) <= EPS && c < this.best)) this.best = c;
      const cx = at(PX, c);
      const cy = at(PY, c);
      const cz = at(PZ, c);
      const gc = at(G, c);
      const costHere = at(areaCost, at(AREA, c));
      for (let e = at(edgeStart, c), end = at(edgeStart, c + 1); e < end; e++) {
        const q = at(edgeTo, e);
        if (STATE[q] === CLOSED || at(areaOk, at(AREA, q)) === 0) continue;
        const d = at(DOOR, q);
        if (d >= 0 && at(doorOk, d) === 0) continue;
        const ref = at(edgeRef, e);
        let ex: number;
        let ey: number;
        let ez: number;
        let cost: number;
        if (ref >= 0) {
          // The point of the portal closest to where c was entered.
          const ax = at(portalXZ, ref * 4);
          const az = at(portalXZ, ref * 4 + 1);
          const bx = at(portalXZ, ref * 4 + 2);
          const bz = at(portalXZ, ref * 4 + 3);
          ex = Math.min(Math.max(cx, Math.min(ax, bx)), Math.max(ax, bx));
          ez = Math.min(Math.max(cz, Math.min(az, bz)), Math.max(az, bz));
          ey = at(PA, q) + at(PGX, q) * ex + at(PGZ, q) * ez;
          cost = dist3(cx, cy, cz, ex, ey, ez) * costHere;
        } else {
          // Each link leaves one polygon, which is expanded once: checked once per search.
          const link = mesh.link(-ref - 2);
          if (!navCanTraverse(this.request.agent, link.kind, link.measure)) continue;
          const { a, b } = link;
          ex = b.x;
          ey = b.y;
          ez = b.z;
          cost =
            dist3(cx, cy, cz, a.x, a.y, a.z) * costHere +
            dist3(a.x, a.y, a.z, ex, ey, ez) * LINK_COST[link.kind];
        }
        if (q === goalPoly) {
          cost += dist3(ex, ey, ez, this.gx, this.gy, this.gz) * at(areaCost, at(AREA, q));
          ex = this.gx;
          ey = this.gy;
          ez = this.gz;
        }
        const gq = gc + cost + (d >= 0 ? at(doorCost, d) : 0);
        if (gq >= at(G, q) - EPS) continue;
        G[q] = gq;
        PX[q] = ex;
        PY[q] = ey;
        PZ[q] = ez;
        this.parent[q] = c;
        this.via[q] = ref;
        const hq = this.heuristic(ex, ey, ez);
        H[q] = hq;
        F[q] = gq + hq;
        if (STATE[q] === OPEN) {
          this.open.update(q);
        } else {
          STATE[q] = OPEN;
          this.open.push(q);
        }
      }
    }
    this.iterations += used;
    return used;
  }

  /** Builds the answer for a path ending in polygon `end`; returns its work units (its length). */
  private finish(end: number, reached: boolean): number {
    const { mesh } = this;
    const start = known(this.start);
    const polys: number[] = [];
    for (let p = end; p >= 0; p = at(this.parent, p)) polys.push(p);
    polys.reverse();
    let target: Vec3;
    if (reached) {
      target = known(this.goal);
    } else {
      // The point of the closest polygon nearest the goal.
      const goal = this.goal ?? this.request.goal;
      const [x0, z0, x1, z1] = mesh.boundsOf(end);
      const x = Math.min(Math.max(goal.x, x0), x1);
      const z = Math.min(Math.max(goal.z, z0), z1);
      target = Object.freeze({ x, y: mesh.heightAt(end, x, z), z });
    }
    const points: NavPathPoint[] = [];
    const push = (point: NavPathPoint) => {
      const last = points[points.length - 1];
      if (
        last?.link === undefined &&
        last !== undefined &&
        Math.abs(last.x - point.x) < EPS &&
        Math.abs(last.z - point.z) < EPS &&
        Math.abs(last.y - point.y) < EPS
      ) {
        if (point.link !== undefined) points[points.length - 1] = point;
        return;
      }
      points.push(Object.freeze(point));
    };
    let from: Vec3 = start;
    let gates: Gate[] = [];
    const walk = (to: Vec3) => {
      push({ x: from.x, y: from.y, z: from.z });
      for (const corner of funnel(from.x, from.z, to.x, to.z, gates)) {
        push({ x: corner.x, y: mesh.heightAt(corner.poly, corner.x, corner.z), z: corner.z });
      }
      gates = [];
    };
    for (let n = 1; n < polys.length; n++) {
      const p = at(polys, n);
      const prev = at(polys, n - 1);
      const via = at(this.via, p);
      if (via >= 0) {
        const portal = mesh.portal(via);
        // Right end: on the right of the direction of travel (prev → p).
        const c0 = mesh.centreOf(prev);
        const c1 = mesh.centreOf(p);
        const dx = c1.x - c0.x;
        const dz = c1.z - c0.z;
        const mx = (portal.ax + portal.bx) / 2;
        const mz = (portal.az + portal.bz) / 2;
        const aRight = dx * (portal.az - mz) - dz * (portal.ax - mx) < 0;
        gates.push(
          aRight
            ? { lx: portal.bx, lz: portal.bz, rx: portal.ax, rz: portal.az, poly: p }
            : { lx: portal.ax, lz: portal.az, rx: portal.bx, rz: portal.bz, poly: p },
        );
      } else {
        const link = mesh.link(-via - 2);
        walk(link.a);
        push({ x: link.a.x, y: link.a.y, z: link.a.z, link: link.kind });
        from = link.b;
      }
    }
    walk(target);
    push({ x: target.x, y: target.y, z: target.z });
    const frozenPoints = Object.freeze(points);
    const frozenPolys = Object.freeze(polys);
    this.outcome = reached
      ? Object.freeze({ status: 'found', points: frozenPoints, polys: frozenPolys })
      : Object.freeze({
          status: 'unreachable',
          closest: target,
          points: frozenPoints,
          polys: frozenPolys,
        });
    return polys.length;
  }
}

/** Path queries on one navmesh, each run to completion. */
export class NavMeshQuery implements NavQuery {
  constructor(readonly mesh: NavMesh) {}

  findPath(request: NavPathRequest): NavPathResult {
    return new NavPathSearch(this.mesh, request).run();
  }
}
