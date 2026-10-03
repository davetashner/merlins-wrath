// Action primitives (mw-e11.2, ADR-0005 §4): the steps activities are made of. A primitive is
// compiled once per step into a runner; the runtime calls `start` when the step begins (with
// `stepTick` set and `stepData` cleared) and `update` every tick until it returns success or failure.
// Primitives keep their memory in `brain.stepData` (plain numbers), never in closures, so a save
// taken mid-step resumes identically. Timing is in sim ticks; randomness comes from the world's `ai`
// stream; nothing reads the wall clock.
//
// No omniscience (mw-e11.8): a primitive reads only its own agent's placement. `target` aims at the
// bounded prediction of the target's memory (memory.ts), never at the target entity, so a target
// that slips out of sight is hunted where it was last seen heading; `lkp` aims at the same
// prediction while there is a target memory, else at the blackboard's guess.
//
// The compiler table is typed against the content vocabulary (BEHAVIOUR_PRIMITIVES), so a primitive
// added to the schema without a runner here fails the typecheck.

import type {
  BehaviourPrimitive,
  BehaviourStepDef,
  BehaviourTarget,
  Tunable,
} from '@content/index';
import { AttackerComponent } from '../combat/attacks/components';
import { currentAttack } from '../combat/attacks/components';
import { canStartAttack, startAttack } from '../combat/attacks/executor';
import { cos, sin } from '../math';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { emitNoise } from '../noise/system';
import { AiCuePlayed, RouteBlocked } from './components';
import { recall } from './memory';
import { face, type AiStatus } from './navigation';
import {
  activeRoute,
  faceYaw,
  nearestWaypoint,
  nextWaypoint,
  scanYaw,
  type ActiveRoute,
  type PatrolRoute,
} from './routes';
import { at, getIf } from './util';
import type { AgentView, Num } from './view';

/** A compiled step. */
export interface StepRunner {
  readonly primitive: BehaviourPrimitive;
  /** Runs once as the step begins. */
  readonly start?: (view: AgentView) => void;
  /** Runs every tick the step is current (including the tick it began). */
  readonly update: (view: AgentView) => AiStatus;
}

/** Turns a number-or-tuning-key into a reader. */
export type NumOf = (value: Tunable) => Num;

type StepOf<K extends BehaviourPrimitive> = Extract<BehaviourStepDef, { readonly do: K }>;

type Compilers = {
  readonly [K in BehaviourPrimitive]: (step: StepOf<K>, num: NumOf) => StepRunner;
};

/** The `kind` of the noises `emit-noise` raises on `noiseEmitted` (mw-e09.22). */
export const AI_NOISE_KIND = 'ai';

/** Metres within which `follow-route` counts a waypoint as reached. */
export const WAYPOINT_RADIUS = 0.25;

// `follow-route`'s step data: the tick its dwell ends (-1 walking), waypoints blocked in a row, the
// waypoint it stands at (-1 none), the tick it arrived there, and the routine entry it walks.
const REST = 0;
const BLOCKED = 1;
const AT = 2;
const SINCE = 3;
const ENTRY = 4;
/** A post's dwell: it holds its waypoint for good (a finite number, so saves keep it as JSON). */
const HOLD = Number.MAX_SAFE_INTEGER;

const ticks = (seconds: number, hz: number): number => Math.round(seconds * hz);

/** The agent's own placement (the only one a primitive may read). */
const selfAt = (v: AgentView) => getIf(v.world, v.entity, PlacementComponent);

/** Where the agent believes its target is (mw-e11.8), or undefined with no target memory. */
function believed(v: AgentView): Vec3 | undefined {
  const source = v.brain.blackboard.targetSource;
  if (source === null) return undefined;
  return recall(v.brain.memory, source, v.tick, v.hz, v.ports.memory)?.predicted;
}

/** Where `target` is for this agent now, or undefined when it has none or it is gone. */
function targetPoint(v: AgentView, target: BehaviourTarget): Vec3 | undefined {
  const bb = v.brain.blackboard;
  switch (target) {
    case 'stimulus':
      return bb.stimulus ?? undefined;
    case 'target':
      return bb.target === null ? undefined : believed(v);
    case 'lkp':
      return bb.targetSource === null ? (bb.lkp ?? undefined) : believed(v);
    case 'origin':
      return v.creature?.origin.at;
    case 'nearest-waypoint':
      return activeRoute(v)?.route.waypoints[at(v.brain.stepData, 0)]?.at;
  }
}

/**
 * A `start` hook that remembers the waypoint of the running route nearest by navigation distance
 * when the step targets it (mw-e11.9 AC-3), -1 when there is none.
 */
const startFor = (target: BehaviourTarget) =>
  target === 'nearest-waypoint'
    ? (v: AgentView) => {
        const active = activeRoute(v);
        v.brain.stepData[0] = active === undefined ? -1 : nearestWaypoint(v, active.route);
      }
    : undefined;

/** Ticks since the step began. */
const elapsed = (v: AgentView): number => v.tick - v.brain.stepTick;

const COMPILERS: Compilers = {
  'move-to': (step, num) => {
    const within = num(step.within);
    const start = startFor(step.target);
    return {
      primitive: 'move-to',
      ...(start !== undefined && { start }),
      update(v) {
        const goal = targetPoint(v, step.target);
        if (goal === undefined) return 'failure';
        const status = v.ports.navigation.travel(v.world, v.entity, {
          goal,
          within: within(v),
          speed: v.brain.gaits[step.gait],
          dt: 1 / v.hz,
        });
        if (status === 'success' && step.target === 'nearest-waypoint') {
          v.brain.blackboard.waypoint = at(v.brain.stepData, 0);
        }
        return status;
      },
    };
  },

  'follow-route': (step, num) => {
    const dwell = num(step.dwellS);
    /** Begins walking `active` from the waypoint nearest by navigation distance (resuming). */
    const resume = (v: AgentView, active: ActiveRoute) => {
      const data = v.brain.stepData;
      data[REST] = -1;
      data[BLOCKED] = 0;
      data[AT] = -1;
      data[SINCE] = 0;
      data[ENTRY] = active.entry;
      const nearest = nearestWaypoint(v, active.route);
      if (nearest >= 0) v.brain.blackboard.waypoint = nearest;
    };
    /** Stands at waypoint `index`: faces its look, plays its idle cue, dwells (a post holds). */
    const arrive = (v: AgentView, route: PatrolRoute, index: number) => {
      const wp = at(route.waypoints, index);
      const data = v.brain.stepData;
      if (wp.look !== undefined) faceYaw(v, wp.look);
      if (wp.idle !== undefined) {
        v.world.events.emit(AiCuePlayed, { tick: v.tick, entity: v.entity, cue: wp.idle });
      }
      data[AT] = index;
      data[SINCE] = v.tick;
      data[REST] = route.kind === 'post' ? HOLD : v.tick + ticks(wp.dwellS ?? dwell(v), v.hz);
      data[BLOCKED] = 0;
      v.brain.blackboard.waypoint = nextWaypoint(v, route, index);
    };
    return {
      primitive: 'follow-route',
      start(v) {
        const active = activeRoute(v);
        if (active !== undefined) resume(v, active);
      },
      update(v) {
        const active = activeRoute(v);
        if (active === undefined) return 'failure';
        const data = v.brain.stepData;
        if (data[ENTRY] !== active.entry) resume(v, active); // its schedule moved it to another route
        const { route } = active;
        const bb = v.brain.blackboard;
        const resting = at(data, REST);
        if (resting >= 0) {
          if (v.tick < resting) {
            const yaw = scanYaw(at(route.waypoints, at(data, AT)), v.tick - at(data, SINCE), v.hz);
            if (yaw !== undefined) faceYaw(v, yaw);
            return 'running';
          }
          data[REST] = -1;
          data[AT] = -1;
        }
        const n = route.waypoints.length;
        for (;;) {
          const index = bb.waypoint % n;
          const wp = at(route.waypoints, index);
          const status = v.ports.navigation.travel(v.world, v.entity, {
            goal: wp.at,
            within: WAYPOINT_RADIUS,
            speed: v.brain.gaits[step.gait],
            dt: 1 / v.hz,
          });
          if (status === 'running') return 'running';
          if (status === 'success') {
            arrive(v, route, index);
            return 'running';
          }
          // Unreachable (a locked door): report it and skip to the next waypoint (AC-4).
          v.world.events.emit(RouteBlocked, {
            tick: v.tick,
            entity: v.entity,
            route: route.id,
            waypoint: wp.id,
            at: wp.at,
          });
          bb.waypoint = nextWaypoint(v, route, index);
          data[BLOCKED] = at(data, BLOCKED) + 1;
          if (at(data, BLOCKED) >= n) return 'failure';
        }
      },
    };
  },

  'look-at': (step, num) => {
    const seconds = num(step.seconds);
    const start = startFor(step.target);
    return {
      primitive: 'look-at',
      ...(start !== undefined && { start }),
      update(v) {
        const point = targetPoint(v, step.target);
        const at = selfAt(v);
        if (point === undefined || at === undefined) return 'failure';
        face(v.world, v.entity, point.x - at.x, point.z - at.z);
        return elapsed(v) >= ticks(seconds(v), v.hz) ? 'success' : 'running';
      },
    };
  },

  'look-around': (step, num) => {
    const seconds = num(step.seconds);
    return {
      primitive: 'look-around',
      update(v) {
        const done = elapsed(v);
        if (done >= ticks(seconds(v), v.hz)) return 'success';
        if (done % v.hz === 0) {
          const yaw = v.world.random('ai').float() * 2 * Math.PI;
          face(v.world, v.entity, sin(yaw), cos(yaw));
        }
        return 'running';
      },
    };
  },

  wait: (step, num) => {
    const seconds = num(step.seconds);
    return {
      primitive: 'wait',
      update: (v) => (elapsed(v) >= ticks(seconds(v), v.hz) ? 'success' : 'running'),
    };
  },

  'play-cue': (step) => ({
    primitive: 'play-cue',
    update(v) {
      v.world.events.emit(AiCuePlayed, { tick: v.tick, entity: v.entity, cue: step.cue });
      return 'success';
    },
  }),

  'emit-noise': (step, num) => {
    const db = num(step.db);
    return {
      primitive: 'emit-noise',
      update(v) {
        const at = selfAt(v);
        if (at === undefined) return 'failure';
        // On the shared channel (mw-e09.22), so noise propagation carries it to every listener.
        emitNoise(v.world, {
          position: at,
          loudness: db(v),
          kind: AI_NOISE_KIND,
          entity: v.entity,
          source: v.entity,
        });
        return 'success';
      },
    };
  },

  attack: (step) => {
    const id = step.attack.id;
    return {
      primitive: 'attack',
      update(v) {
        const { world, entity } = v;
        if (v.brain.stepData[0] === 1) {
          return currentAttack(world, entity) === undefined ? 'success' : 'running';
        }
        const attack = v.ports.attacks?.get(id);
        const from = selfAt(v);
        const to = targetPoint(v, 'target');
        if (attack === undefined || from === undefined || to === undefined) return 'failure';
        if (getIf(world, entity, AttackerComponent) === undefined) return 'failure';
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!canStartAttack(world, entity, attack, { distance }).ok) return 'failure';
        startAttack(
          world,
          entity,
          attack,
          dx === 0 && dz === 0 ? { x: 0, y: 0, z: 1 } : { x: dx, y: 0, z: dz },
        );
        v.brain.stepData[0] = 1;
        return 'running';
      },
    };
  },

  'forget-stimulus': () => ({
    primitive: 'forget-stimulus',
    update(v) {
      const bb = v.brain.blackboard;
      bb.stimulus = null;
      bb.awareness = 0;
      return 'success';
    },
  }),
};

/** Whether `name` is a primitive the runtime can run. */
export function isPrimitive(name: string): name is BehaviourPrimitive {
  return Object.hasOwn(COMPILERS, name);
}

/** Compiles one step (its primitive must be known: check with `isPrimitive`). */
export function compileStep(step: BehaviourStepDef, num: NumOf): StepRunner {
  const compile = COMPILERS[step.do] as (step: BehaviourStepDef, num: NumOf) => StepRunner;
  return compile(step, num);
}
