// Named inputs (mw-e11.2, ADR-0005 §5): the numbers considerations and transition conditions read.
// Names are resolved once, when a behaviour is compiled, into accessor functions, so the think loop
// does no string work. The fixed names are typed against the content vocabulary (BEHAVIOUR_INPUTS),
// so content and runtime cannot drift.

import type { BehaviourInput } from '@content/index';
import { HealthComponent } from '../combat/damage/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { at, getIf } from './util';
import type { AgentView } from './view';

/** Reads one input for one agent. */
export type InputFn = (view: AgentView) => number;

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

/** Metres from the agent to its closed patrol loop (0 without a route or placement). */
export function offRoute(view: AgentView): number {
  const route = view.creature?.origin.patrol;
  const here = getIf(view.world, view.entity, PlacementComponent);
  if (route === undefined || route.length === 0 || here === undefined) return 0;
  let best = Infinity;
  for (let i = 0; i < route.length; i++) {
    const a = at(route, i);
    const b = at(route, (i + 1) % route.length);
    best = Math.min(best, segmentDistance(here.x, here.z, a, b));
  }
  return best;
}

const secondsInState = (v: AgentView): number => (v.tick - v.brain.enteredTick) / v.hz;

const FIXED: Readonly<Record<BehaviourInput, InputFn>> = {
  awareness: (v) => v.brain.blackboard.awareness,
  hasStimulus: (v) => (v.brain.blackboard.stimulus === null ? 0 : 1),
  targetVisible: (v) => (v.brain.blackboard.targetVisible ? 1 : 0),
  /** Seconds since it last saw its target (0 while visible; time in state when never seen). */
  targetLostS: (v) => {
    const { targetVisible, targetSeenTick } = v.brain.blackboard;
    if (targetVisible) return 0;
    return targetSeenTick < 0 ? secondsInState(v) : (v.tick - targetSeenTick) / v.hz;
  },
  healthFraction: (v) => {
    const health = getIf(v.world, v.entity, HealthComponent);
    return health === undefined ? 1 : health.current / health.max;
  },
  timeInState: secondsInState,
  offRoute,
};

/** The accessor of input `name`, or undefined when there is no such input. */
export function resolveInput(name: string): InputFn | undefined {
  if (Object.hasOwn(FIXED, name)) return FIXED[name as BehaviourInput];
  if (name.startsWith('trait.')) {
    const trait = name.slice('trait.'.length);
    return (v) => v.brain.traits[trait] ?? 0.5;
  }
  if (name.startsWith('need.')) {
    const need = name.slice('need.'.length);
    return (v) => (v.creature?.needs[need] ?? 0) / 100;
  }
  return undefined;
}
