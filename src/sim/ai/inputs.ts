// Named inputs (mw-e11.2, ADR-0005 §5): the numbers considerations and transition conditions read.
// Names are resolved once, when a behaviour is compiled, into accessor functions, so the think loop
// does no string work. The fixed names are typed against the content vocabulary (BEHAVIOUR_INPUTS),
// so content and runtime cannot drift.

import type { BehaviourInput } from '@content/index';
import { HealthComponent } from '../combat/damage/components';
import { offRoute } from './routes';
import { getIf } from './util';
import type { AgentView } from './view';

/** Reads one input for one agent. */
export type InputFn = (view: AgentView) => number;

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
  /** Metres off the ways its route walks (routes.ts). */
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
