// AI brain state (mw-e11.2, ADR-0005 §6): everything a creature's behaviour remembers between ticks,
// as plain numbers, strings and arrays in one component, so snapshots, saves, replays and state
// hashes carry an agent mid-thought. The runtime mutates the brain in place (it is the AI system's
// own state; nothing else holds a reference across ticks), and the default snapshot hook copies it.
//
// The blackboard holds what the agent believes about the world, with typed keys. Perception
// (mw-e11.5) and awareness (mw-e11.6) write it with `writeBlackboard`; primitives read and clear it.

import type { AlertState, BehaviourEvent } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { Vec3 } from '../stimulus/shapes';

/** What an agent believes about the world (typed keys; perception writes them). */
export interface Blackboard {
  /** How sure it is that something is there, 0–1. */
  awareness: number;
  /** Where the thing it noticed is, or null. */
  stimulus: Vec3 | null;
  /** The entity it is after, or null. */
  target: EntityId | null;
  /** Whether it sees its target now. */
  targetVisible: boolean;
  /** The tick it last saw its target, -1 = never. */
  targetSeenTick: number;
  /** The patrol waypoint it walks toward next. */
  waypoint: number;
}

/** How the last activity ended (for `done` and `failed` conditions), or null. */
export interface ActivityEnd {
  readonly activity: string;
  readonly ok: boolean;
}

/** An agent's brain (`ai.brain`; a snapshot and save key, never renamed). */
export interface Brain {
  /** Behaviour id. */
  behaviour: string;
  /** Current alert state. */
  state: AlertState;
  /** The tick it entered `state`. */
  enteredTick: number;
  /** The running activity, or null when idle. */
  activity: string | null;
  /** Index of the running step in the activity. */
  step: number;
  /** The tick the running step started. */
  stepTick: number;
  /** Scratch numbers of the running step's primitive (cleared when a step starts). */
  stepData: number[];
  /** How the last activity ended, until the next think reads it. */
  ended: ActivityEnd | null;
  /** Failed activities and the tick each may be chosen again: [activity, tick]. */
  retry: [string, number][];
  /** External events queued since the last think, in arrival order. */
  events: BehaviourEvent[];
  /** It was due to think but the think budget ran out; it thinks first next tick. */
  owed: boolean;
  /** The tick it last thought, -1 = never. */
  thoughtTick: number;
  /** The top-3 scores of the last think, best first: [activity, score]. */
  scores: [string, number][];
  /** Personality traits, 0–1, by trait name (missing = 0.5). */
  traits: Record<string, number>;
  /** Speed per gait, m/s. */
  gaits: { sneak: number; walk: number; run: number };
  blackboard: Blackboard;
}

/** The brain component. */
export const BrainComponent = defineComponent<Brain>('ai.brain');

/** Why the alert state changed: a timeout, or the transition's condition kind and name. */
export interface AlertStateChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly from: AlertState;
  readonly to: AlertState;
  /** `timeout`, `input:<input>`, `event:<event>`, `done:<activity>` or `failed:<activity>`. */
  readonly cause: string;
}

/** An agent's alert state changed (mw-e11.7 consumes it; emitted on every transition). */
export const AlertStateChanged = defineEvent<AlertStateChange>('aiAlertStateChanged');

/** A `play-cue` step: presentation (barks, animations, VFX) reacts to it. */
export interface AiCue {
  readonly tick: number;
  readonly entity: EntityId;
  readonly cue: string;
}

/** An agent played a cue. */
export const AiCuePlayed = defineEvent<AiCue>('aiCuePlayed');

/** An `emit-noise` step: a noise at the agent's position (sound propagation, mw-e09). */
export interface AiNoise {
  readonly tick: number;
  readonly entity: EntityId;
  readonly at: Vec3;
  /** Loudness at the source, dB. */
  readonly db: number;
}

/** An agent made a noise. */
export const AiNoiseEmitted = defineEvent<AiNoise>('aiNoiseEmitted');
