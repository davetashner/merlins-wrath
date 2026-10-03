// Introspection for debug visualisation (mw-e11.2 AC-6, ADR-0005 §7; drawn by mw-e11.17): an
// agent's state, time in state, activity, step and its active node path, plus the top-3 activity
// scores of its last think with each consideration's current input value and curve. Built only when
// asked, as plain serialisable data; reading it changes nothing.

import type { AlertState, BehaviourCurveDef } from '@content/index';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { isPostAlert } from './alert';
import { BrainComponent } from './components';
import { aiBehaviour, aiPorts } from './runtime';
import { at, getIf, got } from './util';
import type { AgentView } from './view';

/** One consideration of a scored activity. */
export interface ConsiderationReadout {
  readonly input: string;
  /** The input's value now. */
  readonly value: number;
  readonly curve: BehaviourCurveDef;
}

/** One of the top-3 activities of the last think. */
export interface ScoreReadout {
  readonly activity: string;
  readonly score: number;
  readonly considerations: readonly ConsiderationReadout[];
}

/** What an agent is doing and why. */
export interface BrainReadout {
  readonly entity: EntityId;
  readonly behaviour: string;
  readonly state: AlertState;
  /** Seconds in the current state. */
  readonly timeInState: number;
  /** It stood down recently and is still on edge (heightened baseline, mw-e11.7). */
  readonly postAlert: boolean;
  readonly activity: string | null;
  /** Index of the running step (0 when idle). */
  readonly step: number;
  /** The running step's primitive, or null when idle. */
  readonly primitive: string | null;
  /** The active node path: state, then activity and primitive while one runs. */
  readonly path: readonly string[];
  /** The last think's best three activities, best first. */
  readonly scores: readonly ScoreReadout[];
}

/**
 * `entity`'s brain readout, or undefined when it has no brain or its behaviour is unknown to this
 * world's AI.
 */
export function introspectBrain(world: World<never>, entity: EntityId): BrainReadout | undefined {
  const brain = getIf(world, entity, BrainComponent);
  const behaviour = brain === undefined ? undefined : aiBehaviour(world, brain.behaviour);
  if (brain === undefined || behaviour === undefined) return undefined;
  const hz = world.clock.hz;
  const view: AgentView = {
    world,
    entity,
    brain,
    creature: getIf(world, entity, CreatureComponent),
    tuning: behaviour.tuning,
    tick: world.tick,
    hz,
    ports: aiPorts(world),
  };
  const activity = brain.activity === null ? undefined : behaviour.activities.get(brain.activity);
  const primitive = activity === undefined ? null : at(activity.steps, brain.step).primitive;
  const path: string[] = [brain.state];
  if (activity !== undefined)
    path.push(activity.name, `${String(brain.step)}:${String(primitive)}`);
  return {
    entity,
    behaviour: brain.behaviour,
    state: brain.state,
    timeInState: (world.tick - brain.enteredTick) / hz,
    postAlert: isPostAlert(brain, world.tick),
    activity: activity?.name ?? null,
    step: brain.step,
    primitive,
    path,
    scores: brain.scores.map(([name, score]) => ({
      activity: name,
      score,
      considerations: got(behaviour.activities, name).considerations.map((c) => ({
        input: c.input,
        value: c.read(view),
        curve: structuredClone(c.def),
      })),
    })),
  };
}
