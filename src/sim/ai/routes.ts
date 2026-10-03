// Patrol routines (mw-e11.9): the routes a creature walks, authored as level data (content `scene`
// waypoints, routes and a spawn's `routine`) and resolved to world metres by the scene layout. This
// file is how AI reads them: which route runs now, where it goes next, the waypoint nearest the agent
// and how far it has strayed. The `follow-route` primitive walks them (./primitives.ts).
//
// - Kinds: a loop (A→B→C→A…), a ping-pong (A→B→C→B→A…, reversing at either end), a random route (each
//   next waypoint drawn by link weight from the agent's own seeded stream, `ai-route:<entity>`, so
//   one agent's draws never shift another's) and a post (one waypoint, held for good).
// - A routine lists routes, each in an optional window of hours of the day; the first whose window
//   holds the hour runs. The hour comes from the AI's `hourOfDay` port (the world clock, mw-e27.12);
//   without one, windows are not read and the first route runs.
// - A creature with the older `patrol` (a list of points) walks it as a loop named "patrol".
// - Nearest means nearest by navigation distance (the port's `distance`, a path length on the
//   navmesh), not by straight line nor the next index, so a guard back from a search walks to the
//   waypoint it can reach soonest (AC-3).

import type { RouteKind } from '@content/index';
import { cos, sin } from '../math';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { face, straightDistance } from './navigation';
import { at, getIf } from './util';
import type { AgentView } from './view';

/** A waypoint of a route, world metres. */
export interface PatrolWaypoint {
  /** Waypoint id in its scene. */
  readonly id: string;
  readonly at: Vec3;
  /** Seconds it stands here; absent = the follow-route step's dwell. */
  readonly dwellS?: number;
  /** Direction it faces here, degrees (0 faces +z, 90 faces +x). */
  readonly look?: number;
  /** Degrees it sweeps its gaze across, centred on `look`, while it stands here. */
  readonly scanArc?: number;
  /** Seconds one full sweep takes (there and back). */
  readonly scanS?: number;
  /** Idle action cue played on arrival. */
  readonly idle?: string;
}

/** A weighted way between two waypoints of a random route, by index into its waypoints. */
export interface PatrolLink {
  readonly from: number;
  readonly to: number;
  /** Positive integer. */
  readonly weight: number;
}

/** A route (see the file header). */
export interface PatrolRoute {
  /** Route id in its scene. */
  readonly id: string;
  readonly kind: RouteKind;
  readonly waypoints: readonly PatrolWaypoint[];
  /** Random routes: the ways between waypoints. */
  readonly links?: readonly PatrolLink[];
}

/** One entry of a creature's routine: a route and the hours it runs in. */
export interface PatrolRoutine {
  readonly route: PatrolRoute;
  /** From and to, hours of the day (wraps past midnight when from > to); absent = always. */
  readonly hours?: readonly [number, number];
}

/** The id of the loop a creature's `patrol` points make. */
export const PATROL_ROUTE_ID = 'patrol';

/** Seconds of one full scan sweep when a waypoint does not say. */
export const DEFAULT_SCAN_S = 6;

const patrolRoutes = new WeakMap<readonly Vec3[], PatrolRoute>();

/** The loop a list of patrol points makes (one route object per list). */
export function patrolLoop(points: readonly Vec3[]): PatrolRoute {
  let route = patrolRoutes.get(points);
  if (route === undefined) {
    route = Object.freeze({
      id: PATROL_ROUTE_ID,
      kind: 'loop' as const,
      waypoints: Object.freeze(points.map((p, i) => Object.freeze({ id: String(i), at: p }))),
    });
    patrolRoutes.set(points, route);
  }
  return route;
}

/** Whether `hour` falls in the window [from, to), wrapping past midnight when from > to. */
export function inWindow(hours: readonly [number, number] | undefined, hour: number): boolean {
  if (hours === undefined) return true;
  const [from, to] = hours;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** The route running now and its index in the routine (0 for a `patrol` loop). */
export interface ActiveRoute {
  readonly route: PatrolRoute;
  readonly entry: number;
}

/** The agent's route running now, or undefined (no routine, or no window holds the hour). */
export function activeRoute(view: AgentView): ActiveRoute | undefined {
  const origin = view.creature?.origin;
  const routine = origin?.routine;
  if (routine !== undefined) {
    const hour = view.ports.hourOfDay?.(view.world);
    const entry =
      hour === undefined ? 0 : routine.findIndex((r) => inWindow(r.hours, ((hour % 24) + 24) % 24));
    return entry < 0 ? undefined : { route: at(routine, entry).route, entry };
  }
  const patrol = origin?.patrol;
  return patrol === undefined || patrol.length === 0
    ? undefined
    : { route: patrolLoop(patrol), entry: 0 };
}

/**
 * Index of `route`'s waypoint nearest the agent by navigation distance (ties: the lower index), or
 * -1 when it has no placement. When none can be reached it is the nearest in a straight line, so
 * the walk there fails and reports the block.
 */
export function nearestWaypoint(view: AgentView, route: PatrolRoute): number {
  const here = getIf(view.world, view.entity, PlacementComponent);
  if (here === undefined) return -1;
  const measure = view.ports.navigation.distance ?? straightDistance;
  let best = -1;
  let bestDistance = Infinity;
  route.waypoints.forEach((wp, i) => {
    const d = measure(view.world, view.entity, wp.at);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  if (best >= 0) return best;
  route.waypoints.forEach((wp, i) => {
    const d = straightDistance(view.world, view.entity, wp.at);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * The waypoint after `index` on `route`. A ping-pong reverses at either end (the direction is the
 * brain's `routeDir`, so it is remembered across alerts); a random route draws by link weight from
 * the agent's own stream; a post stays put.
 */
export function nextWaypoint(view: AgentView, route: PatrolRoute, index: number): number {
  const n = route.waypoints.length;
  switch (route.kind) {
    case 'loop':
      return (index + 1) % n;
    case 'post':
      return index;
    case 'ping-pong': {
      const brain = view.brain;
      let next = index + brain.routeDir;
      if (next < 0 || next >= n) {
        brain.routeDir = -brain.routeDir;
        next = index + brain.routeDir;
      }
      return Math.max(0, Math.min(n - 1, next));
    }
    case 'random': {
      const ways = (route.links ?? []).filter((link) => link.from === index);
      if (ways.length === 0) return index;
      return view.world
        .random(`ai-route:${String(view.entity)}`)
        .weighted(ways.map((link) => ({ value: link.to, weight: link.weight })));
    }
  }
}

/** Horizontal distance from (x, z) to segment a–b. */
function segmentDistance(x: number, z: number, a: Vec3, b: Vec3): number {
  const sx = b.x - a.x;
  const sz = b.z - a.z;
  const lengthSq = sx * sx + sz * sz;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / lengthSq));
  const dx = a.x + sx * t - x;
  const dz = a.z + sz * t - z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** The legs of `route` as waypoint index pairs: the ways it walks. */
function legs(route: PatrolRoute): (readonly [number, number])[] {
  const n = route.waypoints.length;
  switch (route.kind) {
    case 'loop':
      return route.waypoints.map((_, i) => [i, (i + 1) % n] as const);
    case 'ping-pong':
      return route.waypoints.slice(1).map((_, i) => [i, i + 1] as const);
    case 'random':
      return (route.links ?? []).map((link) => [link.from, link.to] as const);
    case 'post':
      return [[0, 0]];
  }
}

/** Metres from the agent to the ways its route walks (0 without a route or placement). */
export function offRoute(view: AgentView): number {
  const active = activeRoute(view);
  const here = getIf(view.world, view.entity, PlacementComponent);
  if (active === undefined || here === undefined) return 0;
  const { waypoints } = active.route;
  const ways = legs(active.route);
  if (ways.length === 0) ways.push([0, 0]);
  let best = Infinity;
  for (const [a, b] of ways) {
    best = Math.min(
      best,
      segmentDistance(here.x, here.z, at(waypoints, a).at, at(waypoints, b).at),
    );
  }
  return best;
}

/** Turns the agent to face yaw `degrees` (0 faces +z, 90 faces +x). */
export function faceYaw(view: AgentView, degrees: number): void {
  const r = (degrees * Math.PI) / 180;
  face(view.world, view.entity, sin(r), cos(r));
}

/**
 * Where the agent looks `elapsed` ticks into standing at `wp`: its look direction, swept across the
 * scan arc (a sine, there and back once per `scanS`). Undefined when the waypoint sets no look.
 */
export function scanYaw(wp: PatrolWaypoint, elapsed: number, hz: number): number | undefined {
  if (wp.look === undefined) return undefined;
  if (wp.scanArc === undefined) return wp.look;
  const period = Math.max(1, Math.round((wp.scanS ?? DEFAULT_SCAN_S) * hz));
  return wp.look + (wp.scanArc / 2) * sin((2 * Math.PI * (elapsed % period)) / period);
}
