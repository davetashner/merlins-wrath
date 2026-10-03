// AI brain state (mw-e11.2, ADR-0005 §6): everything a creature's behaviour remembers between ticks,
// as plain numbers, strings and arrays in one component, so snapshots, saves, replays and state
// hashes carry an agent mid-thought. The runtime mutates the brain in place (it is the AI system's
// own state; nothing else holds a reference across ticks), and the default snapshot hook copies it.
//
// The blackboard holds what the agent believes about the world, with typed keys. Awareness
// (mw-e11.6) writes it from perception's percepts with `writeBlackboard`; primitives read and clear
// it. The brain also keeps awareness's per-source records and target memory's (mw-e11.8).

import type { AlertState, BehaviourEvent } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { PerceptSource } from '../perception/percept';
import type { Vec3 } from '../stimulus/shapes';
import type { AwarenessRecord } from './awareness';
import type { MemoryRecord } from './memory';

/** What an agent believes about the world (typed keys; perception writes them). */
export interface Blackboard {
  /** How sure it is that something is there, 0–1. */
  awareness: number;
  /** Where the thing it noticed is, or null. */
  stimulus: Vec3 | null;
  /** The tick a stimulus was last written, -1 = never (`timeoutFrom: "stimulus"` counts from it). */
  stimulusTick: number;
  /** The entity it is after, or null. */
  target: EntityId | null;
  /**
   * Which memory is its target's (mw-e11.8), or null: the source it saw as its target. Primitives
   * aim at that memory's prediction, never at the target entity itself.
   */
  targetSource: PerceptSource | null;
  /** Whether it sees its target now. */
  targetVisible: boolean;
  /** The tick it last saw its target, -1 = never. */
  targetSeenTick: number;
  /**
   * Where it believes its target is (last-known position), or null: its target memory's last-known
   * position (mw-e11.8), or, struck from the unseen, a guess back along the blow's direction
   * (mw-e11.7).
   */
  lkp: Vec3 | null;
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
  /** What it is aware of, one record per perceived source, by source (awareness.ts). */
  awareness: AwarenessRecord[];
  /** What it remembers, one record per perceived or reported source, by source (memory.ts). */
  memory: MemoryRecord[];
  /**
   * The tick its heightened baseline ends, -1 = none (mw-e11.7): standing down from a `postAlert`
   * state, it stays on edge for a while (`isPostAlert`).
   */
  postAlertUntil: number;
  /** Awareness accumulation multiplier while on edge (1 otherwise). */
  postAlertRate: number;
  /** Which way it walks a ping-pong route: 1 forward, -1 back (mw-e11.9; kept across alerts). */
  routeDir: number;
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

/** An agent's alert state changed (mw-e11.7; emitted on every transition, from the table only). */
export const AlertStateChanged = defineEvent<AlertStateChange>('aiAlertStateChanged');

/** A `play-cue` step: presentation (barks, animations, VFX) reacts to it. */
export interface AiCue {
  readonly tick: number;
  readonly entity: EntityId;
  readonly cue: string;
}

/** An agent played a cue. */
export const AiCuePlayed = defineEvent<AiCue>('aiCuePlayed');

/** A patrol waypoint the agent could not reach (mw-e11.9): it skipped to the next one. */
export interface RouteBlock {
  readonly tick: number;
  readonly entity: EntityId;
  /** Route id. */
  readonly route: string;
  /** Waypoint id. */
  readonly waypoint: string;
  /** Where the waypoint is. */
  readonly at: Vec3;
}

/**
 * An agent found its route blocked: the hook for the door-check anomaly (a guard who finds a door
 * locked that should not be notices it; mw-e11.15).
 */
export const RouteBlocked = defineEvent<RouteBlock>('aiRouteBlocked');
