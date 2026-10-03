// Awareness (mw-e11.6): how sure an agent is that something is there, built up gradually from its
// percepts so the player has time to react — a glimpse at the edge of vision is not walking into a
// torch-lit room. Each agent keeps one record per perceived source, keyed by the percept's opaque
// source (never an entity id: no omniscience, see perception/percept.ts), in its brain, so
// snapshots, saves, replays and state hashes carry it.
//
// Each evaluation of the agent's senses (a `perceived` report covering `seconds`) is one awareness
// think:
// - Every percept contributes strength × sense rate × trait modifier × difficulty `detectionSpeed`,
//   and for sight also × the sense profile's `detectionSpeed`. The sense rate is per second for
//   continuous senses (sight, special senses: × the report's seconds) and per percept for discrete
//   ones (hearing: one noise is one percept). A source's record rises by the sum of its percepts'
//   contributions, capped at 1. Its cause becomes the percept that contributed most in this think
//   (ties to the earlier, so sight before hearing): what the UI shows as why the agent noticed.
// - A percept of an instant sense (touch: a target bumping into it) sets awareness to 1 at once,
//   whatever the light.
// - A record not stimulated holds for the grace period, then decays at the decay rate; at 0 it is
//   removed. A record whose source no longer exists (the `present` port) is removed first.
// Trait modifier = Π over the tuning's traits of (1 + weight × (2 × trait − 1)): 1 for a trait at
// 0.5 (the default), 1 ± weight at its extremes. An agent on edge after standing down (mw-e11.7's
// heightened baseline) multiplies every contribution by its post-alert rate.
//
// Awareness then writes the blackboard the behaviour reads: `awareness` is the highest record's
// level; `stimulus` is where that record's cause was perceived, when it was stimulated in this think;
// a seen source the `target` port resolves becomes the `target` (and its source the `targetSource`),
// visible while its record is at the Detected threshold. Alert
// transitions read `awareness` against the behaviour's `suspiciousAt` / `investigateAt` tuning,
// whose built-in defaults (content ALERT_TUNING_DEFAULTS) equal these thresholds — one set, pinned
// by a test; the Detected threshold is awareness's alone (it decides `targetVisible`).
//
// The same report updates the agent's target memory (memory.ts, mw-e11.8), with the memory tuning
// of the world's AI: every percept gives its source a fix, and records that are forgotten, or whose
// source is gone, are dropped. While the target's memory lasts, its last-known position is the
// blackboard's `lkp` (kept in step with each fresh fix); once it is forgotten, `target`,
// `targetSource` and `lkp` are cleared. Losing the awareness record of the target clears only
// `target`: the memory of where it was outlasts the agent's sense that something is there. Ally
// reports reach memory through `hearReport`.
// The tuning is PLACEHOLDER, to tune in play; moving it into content is mw-e11.16.

import type { Frozen, SenseProfile } from '@content/index';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { CreatureSensesComponent } from '../creatures/components';
import type { DifficultyConfig } from '../difficulty';
import {
  perceived,
  type Percept,
  type PerceptKind,
  type PerceptSource,
} from '../perception/percept';
import type { Vec3 } from '../stimulus/shapes';
import { isPostAlert } from './alert';
import { BrainComponent, type Brain } from './components';
import { applyReport, observePercepts, recall, type AllyReport, type Recollection } from './memory';
import { memoryTuning, writeBlackboard, type BlackboardPatch } from './runtime';
import { getIf } from './util';

/** How fast one sense builds awareness: per second while it lasts, or per percept. */
export type SenseRate = { readonly perS: number } | { readonly perPercept: number };

/** Awareness levels at which an agent counts as Suspicious, Investigating and Detected. */
export interface AwarenessThresholds {
  readonly suspicious: number;
  readonly investigating: number;
  readonly detected: number;
}

/** Every awareness number (see the file header). */
export interface AwarenessTuning {
  /** Rate per sense name (`sight`, `hearing`, a special-sense channel). */
  readonly senses: Readonly<Record<string, SenseRate>>;
  /** Rate of a sense the table does not list. */
  readonly otherSenses: SenseRate;
  /** Senses whose percept means detection at once. */
  readonly instant: readonly string[];
  /** Trait name → weight of its modifier. */
  readonly traits: Readonly<Record<string, number>>;
  /** Seconds a record holds without stimulus before it decays. */
  readonly graceS: number;
  /** Awareness lost per second after the grace period. */
  readonly decayPerS: number;
  readonly thresholds: AwarenessThresholds;
}

/** The shipped awareness tuning (PLACEHOLDER). */
export const DEFAULT_AWARENESS_TUNING: AwarenessTuning = Object.freeze({
  senses: Object.freeze({
    sight: Object.freeze({ perS: 1 }),
    hearing: Object.freeze({ perPercept: 1 }),
  }),
  otherSenses: Object.freeze({ perS: 0.5 }),
  instant: Object.freeze(['touch']),
  traits: Object.freeze({ diligence: 0.25 }),
  graceS: 2,
  decayPerS: 0.1,
  thresholds: Object.freeze({ suspicious: 0.3, investigating: 0.6, detected: 1 }),
});

/** The percept that contributed most to a record in the think that last stimulated it. */
export interface AwarenessCause {
  readonly kind: PerceptKind;
  readonly sense: string;
  /** Where it was perceived. */
  readonly position: Vec3;
  /** Awareness it added. */
  readonly amount: number;
}

/** What an agent knows about one perceived source (`brain.awareness`, by source). */
export interface AwarenessRecord {
  readonly source: PerceptSource;
  /** 0–1. */
  level: number;
  /** Seconds since it was last stimulated. */
  quietS: number;
  cause: AwarenessCause;
}

/** Everything about the agent that scales its contributions. */
export interface AwarenessFactors {
  /** Personality traits, 0–1 (missing = 0.5). */
  readonly traits: Readonly<Record<string, number>>;
  /** The sense profile's sight `detectionSpeed` (1 without sight). */
  readonly sightSpeed: number;
  /** Difficulty `detectionSpeed`. */
  readonly difficulty: number;
  /** The heightened-baseline multiplier while on edge after standing down (default 1). */
  readonly heightened?: number;
}

/** What one think did to an agent's records. */
export interface AwarenessThink {
  /** Sources stimulated in this think, in first-percept order. */
  readonly stimulated: readonly PerceptSource[];
  /** Sources seen as a target in this think, in percept order. */
  readonly seen: readonly PerceptSource[];
  /** Sources whose records were removed. */
  readonly removed: readonly PerceptSource[];
}

/** The trait modifier of `traits` (see the file header). */
export function traitModifier(
  traits: Readonly<Record<string, number>>,
  tuning: AwarenessTuning = DEFAULT_AWARENESS_TUNING,
): number {
  let modifier = 1;
  for (const [trait, weight] of Object.entries(tuning.traits)) {
    modifier *= 1 + weight * (2 * (traits[trait] ?? 0.5) - 1);
  }
  return modifier;
}

/** Awareness percept `p` adds over `seconds` (ignoring instant senses). */
export function contribution(
  p: Percept,
  seconds: number,
  factors: AwarenessFactors,
  tuning: AwarenessTuning = DEFAULT_AWARENESS_TUNING,
): number {
  const rate = tuning.senses[p.sense] ?? tuning.otherSenses;
  const base = 'perS' in rate ? rate.perS * seconds : rate.perPercept;
  const sight = p.sense === 'sight' ? factors.sightSpeed : 1;
  const edge = factors.heightened ?? 1;
  return (
    p.strength * base * sight * traitModifier(factors.traits, tuning) * factors.difficulty * edge
  );
}

interface Stimulus {
  total: number;
  top: Percept;
  topAmount: number;
  instant: Percept | undefined;
}

/**
 * One awareness think over `records` (sorted by source, mutated in place: added, updated, removed)
 * from `percepts` covering `seconds`. Sources `present` rejects are dropped first.
 */
export function thinkAwareness(
  records: AwarenessRecord[],
  percepts: readonly Percept[],
  seconds: number,
  factors: AwarenessFactors,
  tuning: AwarenessTuning = DEFAULT_AWARENESS_TUNING,
  present: (source: PerceptSource) => boolean = () => true,
): AwarenessThink {
  const removed: PerceptSource[] = [];
  const keep = (record: AwarenessRecord, still: boolean) => {
    if (!still) removed.push(record.source);
    return still;
  };
  const live = records.filter((r) => keep(r, present(r.source)));

  const stimuli = new Map<PerceptSource, Stimulus>();
  const seen: PerceptSource[] = [];
  for (const p of percepts) {
    if (p.kind === 'seen-target' && !seen.includes(p.source)) seen.push(p.source);
    const amount = contribution(p, seconds, factors, tuning);
    const instant = tuning.instant.includes(p.sense) ? p : undefined;
    const s = stimuli.get(p.source);
    if (s === undefined) {
      stimuli.set(p.source, { total: amount, top: p, topAmount: amount, instant });
      continue;
    }
    s.total += amount;
    if (amount > s.topAmount) {
      s.top = p;
      s.topAmount = amount;
    }
    s.instant ??= instant;
  }

  const bySource = new Map(live.map((r) => [r.source, r]));
  for (const [source, s] of stimuli) {
    let record = bySource.get(source);
    if (record === undefined) {
      record = { source, level: 0, quietS: 0, cause: causeOf(s.top, s.topAmount) };
      bySource.set(source, record);
      live.push(record);
    }
    const before = record.level;
    record.level = s.instant === undefined ? Math.min(1, before + s.total) : 1;
    record.quietS = 0;
    record.cause =
      s.instant === undefined ? causeOf(s.top, s.topAmount) : causeOf(s.instant, 1 - before);
  }

  const kept = live.filter((record) => {
    if (stimuli.has(record.source)) return true;
    const quietBefore = record.quietS;
    record.quietS += seconds;
    const decaying = record.quietS - Math.max(quietBefore, tuning.graceS);
    if (decaying > 0) record.level = Math.max(0, record.level - tuning.decayPerS * decaying);
    return keep(record, record.level > 0);
  });
  kept.sort((a, b) => (a.source < b.source ? -1 : 1)); // sources are unique
  records.splice(0, records.length, ...kept);
  return { stimulated: [...stimuli.keys()], seen, removed };
}

function causeOf(p: Percept, amount: number): AwarenessCause {
  const { x, y, z } = p.position;
  return { kind: p.kind, sense: p.sense, position: { x, y, z }, amount };
}

/** The record with the highest level (the earliest by source on a tie), or undefined. */
export function topRecord(records: readonly AwarenessRecord[]): AwarenessRecord | undefined {
  let top: AwarenessRecord | undefined;
  for (const record of records) if (top === undefined || record.level > top.level) top = record;
  return top;
}

/** The highest threshold `level` has reached, or `unaware` below them all. */
export function awarenessBand(
  level: number,
  thresholds: AwarenessThresholds = DEFAULT_AWARENESS_TUNING.thresholds,
): 'unaware' | keyof AwarenessThresholds {
  if (level >= thresholds.detected) return 'detected';
  if (level >= thresholds.investigating) return 'investigating';
  return level >= thresholds.suspicious ? 'suspicious' : 'unaware';
}

/** How awareness is wired to a world. */
export interface AwarenessOptions {
  readonly tuning?: AwarenessTuning;
  /**
   * Whether what a source names still exists (`perceptSourcePresent` in perception/system.ts, bound
   * to the world); everything does by default.
   */
  readonly present?: (source: PerceptSource) => boolean;
  /**
   * The entity a source is, for sources the agent may fight (the player), else undefined; none by
   * default. Wiring outside agent code supplies it.
   */
  readonly target?: (source: PerceptSource) => EntityId | undefined;
}

/** An agent's awareness records, by source (live: read them, do not keep them); none without a brain. */
export function awarenessOf(world: World<never>, agent: EntityId): readonly AwarenessRecord[] {
  return getIf(world, agent, BrainComponent)?.awareness ?? [];
}

function factorsOf(
  world: World<never>,
  agent: EntityId,
  brain: Brain,
  difficulty: DifficultyConfig,
): AwarenessFactors {
  const senses: Frozen<SenseProfile> | undefined = getIf(world, agent, CreatureSensesComponent);
  return {
    traits: brain.traits,
    sightSpeed: senses?.sight?.detectionSpeed ?? 1,
    difficulty: difficulty.detectionSpeed,
    heightened: isPostAlert(brain, world.tick) ? brain.postAlertRate : 1,
  };
}

/** A sighting of a source the agent may fight. */
interface Sighting {
  readonly source: PerceptSource;
  readonly target: EntityId;
  readonly position: Vec3;
}

/** The first seen source that is a target (the player): the one it is after. */
function sightingOf(
  percepts: readonly Percept[],
  resolve: (source: PerceptSource) => EntityId | undefined,
): Sighting | undefined {
  for (const p of percepts) {
    if (p.kind !== 'seen-target') continue;
    const target = resolve(p.source);
    if (target !== undefined) return { source: p.source, target, position: p.position };
  }
  return undefined;
}

/**
 * Runs awareness on every `perceived` report in `world` for agents with a brain, and writes their
 * blackboards (see the file header). Install it with the perception system, before AI runs. Returns
 * a function that uninstalls it.
 */
export function installAwareness(world: World<never>, options: AwarenessOptions = {}): () => void {
  const tuning = options.tuning ?? DEFAULT_AWARENESS_TUNING;
  const resolve = options.target ?? (() => undefined);
  return world.events.on(perceived, ({ agent, seconds, percepts }) => {
    const brain = getIf(world, agent, BrainComponent);
    if (brain === undefined) return;
    const factors = factorsOf(world, agent, brain, world.difficulty);
    const think = thinkAwareness(
      brain.awareness,
      percepts,
      seconds,
      factors,
      tuning,
      options.present,
    );
    const board = brain.blackboard;
    const top = topRecord(brain.awareness);
    const lost = think.removed.some((source) => {
      const entity = resolve(source);
      return entity !== undefined && entity === board.target;
    });
    const sighting = sightingOf(percepts, resolve);
    const visible = brain.awareness.some(
      (r) => r.source === sighting?.source && r.level >= tuning.thresholds.detected,
    );
    const memory = memoryTuning(world);
    const hz = world.clock.hz;
    const remembered = observePercepts(
      brain.memory,
      percepts,
      world.tick,
      hz,
      memory,
      options.present,
    );
    const targetSource = sighting?.source ?? board.targetSource;
    const fix =
      targetSource !== null && remembered.updated.includes(targetSource)
        ? recall(brain.memory, targetSource, world.tick, hz, memory)
        : undefined;
    const forgotten =
      targetSource !== null &&
      remembered.removed.includes(targetSource) &&
      !remembered.updated.includes(targetSource);
    writeBlackboard(world, agent, {
      awareness: top?.level ?? 0,
      ...(top !== undefined && think.stimulated.includes(top.source)
        ? { stimulus: top.cause.position }
        : {}),
      ...(sighting !== undefined
        ? { target: sighting.target, targetSource: sighting.source }
        : lost
          ? { target: null }
          : {}),
      ...(fix !== undefined ? { lkp: fix.lkp } : {}),
      ...(forgotten ? { target: null, targetSource: null, lkp: null } : {}),
      targetVisible: visible,
    });
  });
}

/**
 * An ally's report reaches `listener`'s memory (memory.ts `applyReport`: second-hand, at the
 * reporter's confidence × the tuning's `secondHand`). A report of its target's source, or of a seen
 * target while it has no target memory, also becomes its target memory and last-known position.
 * Returns whether the report was taken (false without a brain, or when its own memory is surer).
 */
export function hearReport(world: World<never>, listener: EntityId, report: AllyReport): boolean {
  const brain = getIf(world, listener, BrainComponent);
  if (brain === undefined) return false;
  const tuning = memoryTuning(world);
  const taken = applyReport(brain.memory, report, world.tick, world.clock.hz, tuning);
  const board = brain.blackboard;
  const target =
    board.targetSource === null
      ? (report.kind ?? 'seen-target') === 'seen-target'
      : board.targetSource === report.source;
  if (taken && target) {
    const patch: BlackboardPatch = { targetSource: report.source, lkp: report.position };
    writeBlackboard(world, listener, patch);
  }
  return taken;
}

/** What `agent` remembers of its target now (`brain.blackboard.targetSource`), or undefined. */
export function recallTarget(world: World<never>, agent: EntityId): Recollection | undefined {
  const brain = getIf(world, agent, BrainComponent);
  const source = brain?.blackboard.targetSource ?? null;
  if (brain === undefined || source === null) return undefined;
  return recall(brain.memory, source, world.tick, world.clock.hz, memoryTuning(world));
}
