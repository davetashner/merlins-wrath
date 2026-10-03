// Navmesh-backed AI travel (mw-e11.4): the `AiNavigation` port the `move-to` and `follow-route`
// primitives call each tick (src/sim/ai/navigation.ts), backed by a navmesh instead of a straight
// line. Install it with `installAi(world, { navigation: navmeshNavigation({ mesh, doors }) })`.
//
// Per agent, a route lives in the `nav.route` component (plain data, so snapshots, hashes and saves
// carry it): the goal it was planned for, the path, the next point and the door states it was
// planned with. Travel asks the request queue for a path when the agent has none, its goal moved
// more than NAV_REPLAN_DISTANCE or a door changed state, and waits (running, standing still) until
// the queue answers; the queue spends its budget once per tick, on the first travel call that
// tick. A found path is walked at the gait speed: walking segments follow the surface; off-mesh
// links (jump, drop, climb) are crossed in a straight line between their ends. Walking agents keep
// apart from other routed agents with simple separation (./steering.ts) as long as the push keeps
// them on the mesh. An unreachable goal or a start off the mesh is a failure, which the behaviour
// handles (ADR-0005 §4).
//
// `distance` (patrol routines picking the nearest waypoint, mw-e11.9) measures the length of the path
// to a point with one search run to completion, outside the queue's budget: it is asked rarely (when
// a creature resumes its route), and a resume must not wait ticks for its answer.
//
// `approach` (mw-e11.13) is travel for a goal that may be out of reach: when the goal cannot be
// reached, the search's answer still holds the path to the reachable point closest to it, and the
// agent walks that, answering `unreachable` on the way and once there (a fighter waits below the
// player's ledge). Such a route is `partial`, and an approach route replans for a moved goal at
// most once per NAV_APPROACH_REPLAN_S, so a target pacing a ledge costs at most one path request a
// second. A route planned by one call kind is reused by the other: travel answers failure for a
// partial route, and an approach replans a route travel found unreachable.
//
// The queue's search progress is not saved: a save taken while a request waits resubmits it on load.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { World } from '../core/world';
import {
  face,
  type AiNavigation,
  type AiStatus,
  type ApproachStatus,
  type TravelRequest,
} from '../ai/navigation';
import { getIf } from '../ai/util';
import { CreatureNavComponent } from '../creatures/components';
import { PlacementComponent, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { DEFAULT_NAV_AGENT } from './capabilities';
import { ALL_DOORS_CLOSED, type NavDoorLookup } from './doors';
import type { NavMesh } from './mesh';
import { NavMeshQuery, type NavPathPoint } from './path';
import { NavPathQueue, type NavQueueOptions } from './queue';
import { separation, type NavNeighbour } from './steering';
import { at } from './util';

/** An agent's route (see the file header). */
export interface NavRoute {
  readonly goal: Vec3;
  readonly status: 'pending' | 'ready' | 'failed';
  /** The queue request while pending, else 0. */
  readonly request: number;
  readonly points: readonly NavPathPoint[];
  /** The next point to reach. */
  readonly index: number;
  /** The door states it was planned with, one letter per door (o, c, l). */
  readonly doors: string;
  /** Its path ends at the reachable point closest to the goal (an approach's; absent = no). */
  readonly partial?: true;
  /** The tick an approach planned it (absent: travel did). */
  readonly planned?: number;
}

/** The route component (`nav.route`; a snapshot and save key, never renamed). */
export const NavRouteComponent = defineComponent<NavRoute>('nav.route');

/** How far, metres, the goal may move before the route is planned again. */
export const NAV_REPLAN_DISTANCE = 0.5;

/** Seconds an approach waits at least before planning again for a goal that moved. */
export const NAV_APPROACH_REPLAN_S = 1;

/** How navmesh travel is set up. */
export interface NavmeshNavigationOptions {
  readonly mesh: NavMesh;
  /** Door states (`worldNavDoors`); every door counts as closed without one. */
  readonly doors?: NavDoorLookup;
  readonly queue?: NavQueueOptions;
}

/** Navmesh travel for AI, with its request queue. */
export interface NavmeshNavigation extends AiNavigation {
  readonly queue: NavPathQueue;
  readonly approach: NonNullable<AiNavigation['approach']>;
}

const EPS = 1e-9;

const horizontal = (a: Vec3, b: Vec3): number => Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);

/** Travel along navmesh paths (see the file header). */
export function navmeshNavigation(options: NavmeshNavigationOptions): NavmeshNavigation {
  const { mesh } = options;
  const doors = options.doors ?? ALL_DOORS_CLOSED;
  const queue = new NavPathQueue(mesh, options.queue);
  const query = new NavMeshQuery(mesh);
  const pumped = new WeakMap<World<never>, number>();

  const pump = (world: World<never>) => {
    if (pumped.get(world) === world.tick) return;
    pumped.set(world, world.tick);
    queue.update();
  };

  const signature = () => mesh.doors.map((door) => doors(door).charAt(0)).join('');

  const write = (world: World<never>, entity: EntityId, route: NavRoute) => {
    const frozen = Object.freeze(route);
    if (world.has(entity, NavRouteComponent)) world.set(entity, NavRouteComponent, frozen);
    else world.add(entity, NavRouteComponent, frozen);
  };

  /** Other routed agents near `at`, ascending id. */
  const neighbours = (world: World<never>, entity: EntityId, here: Placement): NavNeighbour[] => {
    const out: NavNeighbour[] = [];
    world.query(NavRouteComponent, PlacementComponent).forEach((other, _route, place) => {
      if (other === entity || Math.abs(place.y - here.y) > 1) return;
      out.push({ x: place.x, z: place.z, radius: place.radius });
    });
    return out;
  };

  /** Moves the agent along its route; returns the new route index and status. */
  const follow = (
    world: World<never>,
    entity: EntityId,
    here: Placement,
    route: NavRoute,
    request: TravelRequest,
  ): { index: number; status: AiStatus } => {
    const { points } = route;
    let stride = request.speed * request.dt;
    if (!(stride > 0)) return { index: route.index, status: 'failure' };
    let x = here.x;
    let y = here.y;
    let z = here.z;
    let index = route.index;
    let linked = false;
    while (index < points.length && stride > EPS) {
      const target = at(points, index);
      const prev = at(points, index - 1);
      linked = prev.link !== undefined;
      const dx = target.x - x;
      const dz = target.z - z;
      const dy = linked ? target.y - y : 0;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (d <= stride + EPS) {
        ({ x, y, z } = target);
        stride -= d;
        index++;
        continue;
      }
      const t = stride / d;
      x += dx * t;
      z += dz * t;
      if (linked) {
        y += dy * t;
      } else {
        // Height along the segment by how far there is left to go (from behind its start: its start).
        const length = horizontal(prev, target);
        const left = Math.sqrt(dx * dx + dz * dz) * (1 - t);
        y = prev.y + (target.y - prev.y) * (left >= length ? 0 : 1 - left / length);
      }
      stride = 0;
    }
    if (!linked) {
      const push = separation(
        x,
        z,
        here.radius,
        neighbours(world, entity, here),
        request.speed * request.dt,
      );
      const nudged = { x: x + push.dx, y, z: z + push.dz };
      const poly = push.dx === 0 && push.dz === 0 ? -1 : mesh.locate(nudged);
      if (poly >= 0) {
        x = nudged.x;
        z = nudged.z;
        y = mesh.heightAt(poly, x, z);
      }
    }
    world.set(entity, PlacementComponent, Object.freeze({ x, y, z, radius: here.radius }));
    face(world, entity, x - here.x, z - here.z);
    const arrived =
      index >= points.length || horizontal({ x, y, z }, request.goal) <= request.within;
    return { index, status: arrived ? 'success' : 'running' };
  };

  /** One tick of travel (`closest` false) or approach (true); see the file header. */
  const move = (
    world: World<never>,
    entity: EntityId,
    request: TravelRequest,
    closest: boolean,
  ): ApproachStatus => {
    const here = getIf(world, entity, PlacementComponent);
    if (here === undefined) return 'failure';
    if (horizontal(here, request.goal) <= request.within) return 'success';
    if (!world.isRegistered(NavRouteComponent)) world.register(NavRouteComponent);
    const doorStates = signature();
    let route = world.get(entity, NavRouteComponent);
    const lost =
      route?.status === 'pending' &&
      !queue.isPending(route.request) &&
      queue.result(route.request) === undefined;
    const moved = route !== undefined && horizontal(route.goal, request.goal) > NAV_REPLAN_DISTANCE;
    // An approach's own route waits NAV_APPROACH_REPLAN_S before following a moved goal; a route
    // travel planned and found unreachable has no closest point yet, so an approach replans it.
    const settled =
      closest &&
      route?.planned !== undefined &&
      world.tick - route.planned < Math.round(NAV_APPROACH_REPLAN_S * world.clock.hz);
    const blind = closest && route?.planned === undefined && route?.status === 'failed';
    if (route === undefined || lost || (moved && !settled) || blind || route.doors !== doorStates) {
      if (route?.status === 'pending') queue.cancel(route.request);
      const agent = getIf(world, entity, CreatureNavComponent) ?? DEFAULT_NAV_AGENT;
      const id = queue.submit({ start: here, goal: request.goal, agent, doors });
      route = {
        goal: request.goal,
        status: 'pending',
        request: id,
        points: [],
        index: 0,
        doors: doorStates,
        ...(closest && { planned: world.tick }),
      };
    }
    if (route.status === 'pending') {
      pump(world);
      const result = queue.take(route.request);
      if (result === undefined) {
        write(world, entity, route);
        return 'running';
      }
      route =
        result.status === 'found'
          ? { ...route, status: 'ready', request: 0, points: result.points, index: 1 }
          : result.status === 'unreachable' && closest
            ? { ...route, status: 'ready', request: 0, points: result.points, index: 1 }
            : { ...route, status: 'failed', request: 0, points: [], index: 0 };
      if (result.status === 'unreachable' && closest) route = { ...route, partial: true };
    }
    if (route.status === 'failed' || (route.partial === true && !closest)) {
      write(world, entity, route);
      return 'failure';
    }
    const walked = follow(world, entity, here, route, request);
    write(world, entity, { ...route, index: walked.index });
    return route.partial === true && walked.status !== 'failure' ? 'unreachable' : walked.status;
  };

  return Object.freeze({
    queue,
    distance(world: World<never>, entity: EntityId, goal: Vec3): number {
      const here = getIf(world, entity, PlacementComponent);
      if (here === undefined) return Infinity;
      const agent = getIf(world, entity, CreatureNavComponent) ?? DEFAULT_NAV_AGENT;
      const result = query.findPath({ start: here, goal, agent, doors });
      if (result.status !== 'found') return Infinity;
      let length = 0;
      for (let i = 1; i < result.points.length; i++) {
        const a = at(result.points, i - 1);
        const b = at(result.points, i);
        length += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
      }
      return length;
    },
    travel(world: World<never>, entity: EntityId, request: TravelRequest): AiStatus {
      // Only an approach walks a partial route, so travel never answers `unreachable`.
      return move(world, entity, request, false) as AiStatus;
    },
    approach(world: World<never>, entity: EntityId, request: TravelRequest): ApproachStatus {
      return move(world, entity, request, true);
    },
  });
}
