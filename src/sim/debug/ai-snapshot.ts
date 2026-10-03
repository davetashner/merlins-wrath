// AI introspection snapshots (mw-e11.17): everything the AI debug overlay draws about each creature,
// read from the sim as plain data — its senses (sight cone parameters with the eye and facing they
// apply from, hearing threshold and range), its brain (alert state and time in it, the running
// activity and step, the active node path, the last think's top scores), its awareness per perceived
// source, its last-known position of its target with a confidence, and the navmesh route it walks.
// The overlay (src/render/debug/ai-overlay.ts, driven by src/tools/ai-debug) reads snapshots; the sim
// never depends on the overlay, and building one changes nothing.
//
// A snapshotter counts the snapshots it builds (`builds`), so the overlay's zero-overhead promise is
// testable: with the overlay off, nothing builds one (AC-5).
//
// - Agents are the creatures with a sense profile and a placement (as perception), in ascending id.
// - The eye is perception's: the feet raised by the tuning's eye height × the nav agent height (the
//   default eye height without one); the facing is the combat facing on the ground plane, unit
//   length (+z without one).
// - LKP confidence: the awareness of the record whose source is the target (entity source), else the
//   blackboard's overall awareness. Target memory (mw-e11.8) may refine it.
// - The route is the remaining part of the agent's `nav.route` (from its next point on), with the
//   goal and status; null without one.
// - `detail` names one agent (the overlay's selection) whose full brain readout (`introspectBrain`:
//   each top score's considerations and curves) is included; the others carry the cheap fields only.

import type { AlertState, Frozen, SenseProfile } from '@content/index';
import type { EntityId } from '../core/component';
import type { Query } from '../core/query';
import type { World } from '../core/world';
import { isPostAlert } from '../ai/alert';
import { DEFAULT_AWARENESS_TUNING, type AwarenessThresholds } from '../ai/awareness';
import { BrainComponent, type Brain } from '../ai/components';
import { introspectBrain, type BrainReadout } from '../ai/introspect';
import { aiBehaviour } from '../ai/runtime';
import { at, getIf } from '../ai/util';
import { facingOf } from '../combat/melee/components';
import {
  CreatureComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
} from '../creatures/components';
import { creaturesInstalled } from '../creatures/spawn';
import { NavRouteComponent, type NavRoute } from '../nav/navigation';
import { entitySource, type PerceptKind } from '../perception/percept';
import { DEFAULT_PERCEPTION_TUNING, type PerceptionTuning } from '../perception/tuning';
import { PlacementComponent, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';

/** A sight cone: degrees and metres, as the sense profile has them. */
export interface AiConeReadout {
  readonly primaryHalfAngle: number;
  readonly peripheralHalfAngle: number;
  readonly verticalHalfAngle: number;
  readonly nearRange: number;
  readonly farRange: number;
}

/** Hearing: the quietest level heard, dB, and the straight-line range, metres. */
export interface AiHearingReadout {
  readonly thresholdDb: number;
  readonly range: number;
}

/** One perceived source an agent is aware of. */
export interface AiAwarenessReadout {
  readonly source: string;
  /** 0–1. */
  readonly level: number;
  /** Seconds since it was last stimulated. */
  readonly quietS: number;
  /** The sense and percept kind that contributed most when it was last stimulated. */
  readonly sense: string;
  readonly kind: PerceptKind;
  /** Where that was perceived. */
  readonly position: Vec3;
}

/** Where an agent believes its target is, and how sure it is (0–1). */
export interface AiLkpReadout {
  readonly position: Vec3;
  readonly confidence: number;
}

/** The part of a route still to walk. */
export interface AiRouteReadout {
  readonly status: NavRoute['status'];
  readonly goal: Vec3;
  /** The remaining path points, the next first. */
  readonly points: readonly Vec3[];
}

/** An agent's brain at a glance. */
export interface AiBrainGlance {
  readonly behaviour: string;
  readonly state: AlertState;
  /** Seconds in the current state. */
  readonly timeInState: number;
  readonly postAlert: boolean;
  readonly activity: string | null;
  readonly step: number;
  readonly primitive: string | null;
  /** The active node path: state, then activity and `step:primitive` while one runs. */
  readonly nodePath: readonly string[];
  /** The last think's best three activities, best first: [activity, score]. */
  readonly scores: readonly (readonly [string, number])[];
}

/** One agent as the overlay draws it. */
export interface AiAgentSnapshot {
  readonly entity: EntityId;
  /** Creature id, or null for a sensing entity that is not a creature. */
  readonly creature: string | null;
  readonly feet: Vec3;
  readonly eye: Vec3;
  /** Unit, horizontal. */
  readonly facing: Vec3;
  /** Null for a blind agent. */
  readonly cone: AiConeReadout | null;
  /** Null for a deaf agent. */
  readonly hearing: AiHearingReadout | null;
  /** Null for an agent without a brain (AI not installed, or a profile AI does not know). */
  readonly brain: AiBrainGlance | null;
  /** Awareness per perceived source, highest first. */
  readonly awareness: readonly AiAwarenessReadout[];
  readonly lkp: AiLkpReadout | null;
  readonly route: AiRouteReadout | null;
  /** The full brain readout, for the `detail` agent only. */
  readonly detail?: BrainReadout;
}

/** Every agent at one tick. */
export interface AiDebugSnapshot {
  readonly tick: number;
  readonly agents: readonly AiAgentSnapshot[];
  /** Awareness levels at which an agent counts as Suspicious, Investigating and Detected. */
  readonly thresholds: AwarenessThresholds;
}

export interface AiSnapshotOptions {
  /** Perception tuning, for the eye height; defaults to the shipped one. */
  readonly perception?: PerceptionTuning;
  /** Awareness thresholds drawn on the bars; default the shipped ones. */
  readonly thresholds?: AwarenessThresholds;
}

/** Builds snapshots of one world and counts them. */
export interface AiSnapshotter {
  /** Snapshots built so far. */
  readonly builds: number;
  /** The snapshot now; `detail` is the agent whose full brain readout to include. */
  build(detail?: EntityId): AiDebugSnapshot;
}

const EMPTY: readonly never[] = Object.freeze([]);

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

function unitFacing(world: World<never>, entity: EntityId): Vec3 {
  const { x, z } = facingOf(world, entity);
  const length = Math.sqrt(x * x + z * z);
  return length > 1e-9 ? { x: x / length, y: 0, z: z / length } : { x: 0, y: 0, z: 1 };
}

function glance(world: World<never>, brain: Brain): AiBrainGlance {
  const activity =
    brain.activity === null
      ? undefined
      : aiBehaviour(world, brain.behaviour)?.activities.get(brain.activity);
  const primitive = activity === undefined ? null : at(activity.steps, brain.step).primitive;
  const nodePath: string[] = [brain.state];
  if (brain.activity !== null)
    nodePath.push(brain.activity, `${String(brain.step)}:${String(primitive)}`);
  return {
    behaviour: brain.behaviour,
    state: brain.state,
    timeInState: (world.tick - brain.enteredTick) / world.clock.hz,
    postAlert: isPostAlert(brain, world.tick),
    activity: brain.activity,
    step: brain.step,
    primitive,
    nodePath,
    scores: brain.scores.map(([name, score]) => [name, score] as const),
  };
}

function awarenessOf(brain: Brain): AiAwarenessReadout[] {
  return brain.awareness
    .map((record) => ({
      source: record.source,
      level: record.level,
      quietS: record.quietS,
      sense: record.cause.sense,
      kind: record.cause.kind,
      position: copy(record.cause.position),
    }))
    .sort((a, b) => b.level - a.level);
}

function lkpOf(brain: Brain): AiLkpReadout | null {
  const { lkp, target, awareness } = brain.blackboard;
  if (lkp === null) return null;
  const source = target === null ? undefined : entitySource(target);
  const record = brain.awareness.find((r) => r.source === source);
  return { position: copy(lkp), confidence: record?.level ?? awareness };
}

function routeOf(route: NavRoute | undefined): AiRouteReadout | null {
  if (route === undefined) return null;
  return {
    status: route.status,
    goal: copy(route.goal),
    points: route.points.slice(route.index).map(copy),
  };
}

/** A snapshotter for `world` (see the file header). */
export function aiSnapshotter(world: World<never>, options: AiSnapshotOptions = {}): AiSnapshotter {
  const tuning = options.perception ?? DEFAULT_PERCEPTION_TUNING;
  const thresholds = options.thresholds ?? DEFAULT_AWARENESS_TUNING.thresholds;
  let builds = 0;
  let sensing:
    Query<readonly [typeof CreatureSensesComponent, typeof PlacementComponent]> | undefined;

  const agentOf = (
    entity: EntityId,
    senses: Frozen<SenseProfile>,
    at: Placement,
    detail: EntityId | undefined,
  ): AiAgentSnapshot => {
    const nav = world.get(entity, CreatureNavComponent);
    const raise =
      nav === undefined ? tuning.sight.defaultEyeHeight : tuning.sight.eyeHeight * nav.height;
    const brain = getIf(world, entity, BrainComponent);
    const sight = senses.sight;
    const hearing = senses.hearing;
    const readout = entity === detail ? introspectBrain(world, entity) : undefined;
    return {
      entity,
      creature: world.get(entity, CreatureComponent)?.origin.creature ?? null,
      feet: { x: at.x, y: at.y, z: at.z },
      eye: { x: at.x, y: at.y + raise, z: at.z },
      facing: unitFacing(world, entity),
      cone:
        sight === undefined
          ? null
          : {
              primaryHalfAngle: sight.primaryHalfAngle,
              peripheralHalfAngle: sight.peripheralHalfAngle,
              verticalHalfAngle: sight.verticalHalfAngle,
              nearRange: sight.nearRange,
              farRange: sight.farRange,
            },
      hearing:
        hearing === undefined ? null : { thresholdDb: hearing.thresholdDb, range: hearing.range },
      brain: brain === undefined ? null : glance(world, brain),
      awareness: brain === undefined ? EMPTY : awarenessOf(brain),
      lkp: brain === undefined ? null : lkpOf(brain),
      route: routeOf(getIf(world, entity, NavRouteComponent)),
      ...(readout !== undefined && { detail: readout }),
    };
  };

  return {
    get builds() {
      return builds;
    },
    build(detail) {
      builds++;
      const agents: AiAgentSnapshot[] = [];
      if (creaturesInstalled(world)) {
        sensing ??= world.query(CreatureSensesComponent, PlacementComponent);
        sensing.forEach((entity, senses, at) => {
          agents.push(agentOf(entity, senses, at, detail));
        });
      }
      return { tick: world.tick, agents, thresholds };
    },
  };
}
