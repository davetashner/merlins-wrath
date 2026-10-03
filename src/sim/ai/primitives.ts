// Action primitives (mw-e11.2, ADR-0005 §4): the steps activities are made of. A primitive is
// compiled once per step into a runner; the runtime calls `start` when the step begins (with
// `stepTick` set and `stepData` cleared) and `update` every tick until it returns success or failure.
// Primitives keep their memory in `brain.stepData` (plain numbers), never in closures, so a save
// taken mid-step resumes identically. Timing is in sim ticks; randomness comes from the world's `ai`
// stream; nothing reads the wall clock.
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
import type { EntityId } from '../core/component';
import { cos, sin } from '../math';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { AiCuePlayed, AiNoiseEmitted } from './components';
import { face, type AiStatus } from './navigation';
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

/** Metres within which `follow-route` counts a waypoint as reached. */
export const WAYPOINT_RADIUS = 0.25;

const ticks = (seconds: number, hz: number): number => Math.round(seconds * hz);

const placementOf = (v: AgentView, entity: EntityId) => getIf(v.world, entity, PlacementComponent);

/** Index of the patrol waypoint nearest the agent, or -1 without a route or placement. */
function nearestWaypoint(v: AgentView): number {
  const route = v.creature?.origin.patrol ?? [];
  const at = placementOf(v, v.entity);
  if (at === undefined) return -1;
  let best = -1;
  let bestDistance = Infinity;
  route.forEach((p, i) => {
    const d = (p.x - at.x) * (p.x - at.x) + (p.z - at.z) * (p.z - at.z);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** Where `target` is for this agent now, or undefined when it has none or it is gone. */
function targetPoint(v: AgentView, target: BehaviourTarget): Vec3 | undefined {
  const bb = v.brain.blackboard;
  switch (target) {
    case 'stimulus':
      return bb.stimulus ?? undefined;
    case 'target':
      return bb.target === null ? undefined : placementOf(v, bb.target);
    case 'lkp':
      return bb.lkp ?? undefined;
    case 'origin':
      return v.creature?.origin.at;
    case 'nearest-waypoint':
      return v.creature?.origin.patrol?.[at(v.brain.stepData, 0)];
  }
}

/** A `start` hook that remembers the nearest waypoint when the step targets it. */
const startFor = (target: BehaviourTarget) =>
  target === 'nearest-waypoint'
    ? (v: AgentView) => {
        v.brain.stepData[0] = nearestWaypoint(v);
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
    return {
      primitive: 'follow-route',
      update(v) {
        const route = v.creature?.origin.patrol ?? [];
        if (route.length === 0) return 'failure';
        const bb = v.brain.blackboard;
        const resting = v.brain.stepData[0] ?? -1;
        if (v.tick < resting) return 'running';
        const index = bb.waypoint % route.length;
        const status = v.ports.navigation.travel(v.world, v.entity, {
          goal: at(route, index),
          within: WAYPOINT_RADIUS,
          speed: v.brain.gaits[step.gait],
          dt: 1 / v.hz,
        });
        if (status === 'failure') return 'failure';
        if (status === 'success') {
          bb.waypoint = (index + 1) % route.length;
          v.brain.stepData[0] = v.tick + ticks(dwell(v), v.hz);
        }
        return 'running';
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
        const at = placementOf(v, v.entity);
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
        const at = placementOf(v, v.entity);
        if (at === undefined) return 'failure';
        const point = Object.freeze({ x: at.x, y: at.y, z: at.z });
        v.world.events.emit(AiNoiseEmitted, {
          tick: v.tick,
          entity: v.entity,
          at: point,
          db: db(v),
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
        const target = v.brain.blackboard.target;
        const from = placementOf(v, entity);
        const to = target === null ? undefined : placementOf(v, target);
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
