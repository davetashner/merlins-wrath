// Target memory (mw-e11.8): what an agent remembers about the things it perceived once it stops
// perceiving them, so a guard hunts where it last saw the thief, not where the thief is. Breaking
// line of sight is meaningful because nothing here can find out where anything really is.
//
// One record per perceived source (the percept's opaque source, never an entity id), kept in the
// brain sorted by source, so snapshots, saves, replays and state hashes carry it:
// - lkp: where the source was last perceived (the percept's position: where the agent perceived it,
//   which for a heard noise is the doorway it came through);
// - velocity: how it was moving then, on the level (y = 0), observed from two sightings of it as a
//   seen target at most `velocityWindowS` apart; zero for any other fix and for second-hand reports;
// - firstTick / seenTick: when it was first and last perceived (or reported);
// - confidence: the certainty of that fix, decaying by `decayPerS` per second from seenTick. At 0
//   the record is forgotten and queries return nothing. Kinds in `persistent` (anomalies: a body, a
//   door left open) do not decay: they stay, with their timestamps, until their source is gone.
// The predicted position is the bounded extrapolation lkp + velocity × min(t, predictS), t the
// seconds since seenTick. The cap is what keeps an agent from tracking the player through walls:
// past it the prediction never moves again.
//
// Memory changes only from the agent's own percepts (`observePercepts`, called by awareness for every
// `perceived` report) and from ally reports (`applyReport`: tagged second-hand, at the reporter's
// confidence × `secondHand`, never overriding a surer memory of its own). This module is pure
// functions over records: it imports no world, transforms or bodies, and
// tests/toolchain/perception-boundary.test.ts keeps it that way.
//
// The tuning is PLACEHOLDER, to tune in play (mw-e11.16).

import type { Percept, PerceptKind, PerceptSource } from '../perception/percept';
import type { Vec3 } from '../stimulus/shapes';

/** Where a memory came from: the agent's own senses or an ally's report. */
export type MemoryOrigin = 'own' | 'second-hand';

/** Every memory number (see the file header). */
export interface MemoryTuning {
  /** Confidence lost per second since the record's last fix. */
  readonly decayPerS: number;
  /** Seconds of movement the prediction extrapolates at most. */
  readonly predictS: number;
  /** A second-hand report's confidence is the reporter's × this. */
  readonly secondHand: number;
  /** Two sightings further apart than this give no velocity. */
  readonly velocityWindowS: number;
  /** Percept kinds whose memories do not decay. */
  readonly persistent: readonly PerceptKind[];
}

/** The shipped memory tuning (PLACEHOLDER): a certain sighting is forgotten after 50 s. */
export const DEFAULT_MEMORY_TUNING: MemoryTuning = Object.freeze({
  decayPerS: 0.02,
  predictS: 1.5,
  secondHand: 0.7,
  velocityWindowS: 1,
  persistent: Object.freeze(['seen-anomaly'] as const),
});

/** What an agent remembers about one source (`brain.memory`, by source). Plain data. */
export interface MemoryRecord {
  readonly source: PerceptSource;
  /** What the last fix perceived (or what a report said). */
  kind: PerceptKind;
  origin: MemoryOrigin;
  /** Last-known position. */
  lkp: Vec3;
  /** Observed velocity on the level at the last fix, m/s (y = 0). */
  velocity: Vec3;
  /** The tick it was first perceived or reported. */
  readonly firstTick: number;
  /** The tick of the last fix. */
  seenTick: number;
  /** Confidence at seenTick, 0–1. */
  confidence: number;
}

/** What a memory query answers. Plain frozen data. */
export interface Recollection {
  readonly source: PerceptSource;
  readonly kind: PerceptKind;
  readonly origin: MemoryOrigin;
  readonly lkp: Vec3;
  /** The bounded prediction now. */
  readonly predicted: Vec3;
  readonly velocity: Vec3;
  readonly firstTick: number;
  readonly seenTick: number;
  /** Confidence now, after decay. */
  readonly confidence: number;
}

/** An ally's report of where a source is (a shout, a sight signal; mw-e11.12 sends them). */
export interface AllyReport {
  readonly source: PerceptSource;
  readonly position: Vec3;
  /** The reporter's confidence, 0–1 (default 1). */
  readonly confidence?: number;
  /** What it is (default `seen-target`). */
  readonly kind?: PerceptKind;
}

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const point = ({ x, y, z }: Vec3): Vec3 => ({ x, y, z });
const seconds = (from: number, to: number, hz: number): number => Math.max(0, to - from) / hz;

/** `record`'s confidence at `tick` (0 once forgotten). */
export function confidenceAt(
  record: Readonly<MemoryRecord>,
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
): number {
  if (tuning.persistent.includes(record.kind)) return record.confidence;
  const lost = tuning.decayPerS * seconds(record.seenTick, tick, hz);
  return Math.max(0, record.confidence - lost);
}

/** Where `record` predicts its source is at `tick`: lkp + velocity × min(t, predictS). */
export function predictedAt(
  record: Readonly<MemoryRecord>,
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
): Vec3 {
  const t = Math.min(seconds(record.seenTick, tick, hz), tuning.predictS);
  const { lkp, velocity: v } = record;
  return { x: lkp.x + v.x * t, y: lkp.y + v.y * t, z: lkp.z + v.z * t };
}

/** The record of `source` in `records`, or undefined. */
function find(records: readonly MemoryRecord[], source: PerceptSource): MemoryRecord | undefined {
  return records.find((r) => r.source === source);
}

/** Keeps `records` sorted by source (sources are unique). */
function sort(records: MemoryRecord[]): void {
  records.sort((a, b) => (a.source < b.source ? -1 : 1));
}

/**
 * Removes from `records` (in place) every record forgotten by `tick` and every record whose source
 * `present` rejects. Returns the removed sources.
 */
export function forgetStale(
  records: MemoryRecord[],
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
  present: (source: PerceptSource) => boolean = () => true,
): PerceptSource[] {
  const removed: PerceptSource[] = [];
  const kept = records.filter((record) => {
    const keep = present(record.source) && confidenceAt(record, tick, hz, tuning) > 0;
    if (!keep) removed.push(record.source);
    return keep;
  });
  records.splice(0, records.length, ...kept);
  return removed;
}

/** What one round of observation did. */
export interface MemoryUpdate {
  /** Sources given a fresh fix, in first-percept order. */
  readonly updated: readonly PerceptSource[];
  /** Sources forgotten. */
  readonly removed: readonly PerceptSource[];
}

/**
 * The agent's own percepts at `tick` update `records` (in place): stale records are forgotten
 * first, then each perceived source gets a fix from its surest percept (the earlier on a tie, so
 * sight before hearing). A percept with no certainty says nothing about where its source is.
 */
export function observePercepts(
  records: MemoryRecord[],
  percepts: readonly Percept[],
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
  present?: (source: PerceptSource) => boolean,
): MemoryUpdate {
  const removed = forgetStale(records, tick, hz, tuning, present);
  const best = new Map<PerceptSource, Percept>();
  for (const p of percepts) {
    if (!(p.certainty > 0)) continue;
    const top = best.get(p.source);
    if (top === undefined || p.certainty > top.certainty) best.set(p.source, p);
  }
  for (const [source, p] of best) {
    const record = find(records, source);
    if (record === undefined) {
      records.push({
        source,
        kind: p.kind,
        origin: 'own',
        lkp: point(p.position),
        velocity: point(ZERO),
        firstTick: tick,
        seenTick: tick,
        confidence: p.certainty,
      });
      continue;
    }
    record.velocity = velocityOf(record, p, tick, hz, tuning);
    record.kind = p.kind;
    record.origin = 'own';
    record.lkp = point(p.position);
    record.seenTick = tick;
    record.confidence = p.certainty;
  }
  sort(records);
  return { updated: [...best.keys()], removed };
}

/** The velocity a fresh fix `p` at `tick` gives `record` (see the file header). */
function velocityOf(
  record: Readonly<MemoryRecord>,
  p: Percept,
  tick: number,
  hz: number,
  tuning: MemoryTuning,
): Vec3 {
  const sighted =
    p.kind === 'seen-target' && record.kind === 'seen-target' && record.origin === 'own';
  const dt = seconds(record.seenTick, tick, hz);
  if (!sighted || dt > tuning.velocityWindowS) return point(ZERO);
  if (dt === 0) return point(record.velocity); // two fixes in one tick: nothing new about motion
  return {
    x: (p.position.x - record.lkp.x) / dt,
    y: 0,
    z: (p.position.z - record.lkp.z) / dt,
  };
}

/**
 * An ally's report at `tick` updates `records` (in place): the source's memory becomes second-hand,
 * at the report's position with the reporter's confidence × `secondHand` and no velocity, unless
 * the agent's own memory of it is at least that sure now. Returns whether the report was taken.
 */
export function applyReport(
  records: MemoryRecord[],
  report: AllyReport,
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
): boolean {
  forgetStale(records, tick, hz, tuning);
  const confidence = (report.confidence ?? 1) * tuning.secondHand;
  if (!(confidence > 0)) return false;
  const record = find(records, report.source);
  if (record?.origin === 'own' && confidenceAt(record, tick, hz, tuning) >= confidence) {
    return false;
  }
  const fields = {
    kind: report.kind ?? 'seen-target',
    origin: 'second-hand' as const,
    lkp: point(report.position),
    velocity: point(ZERO),
    seenTick: tick,
    confidence,
  };
  if (record === undefined) {
    records.push({ source: report.source, firstTick: tick, ...fields });
    sort(records);
  } else {
    Object.assign(record, fields);
  }
  return true;
}

/** What `records` remember of `source` at `tick`, or undefined when nothing (or it is forgotten). */
export function recall(
  records: readonly MemoryRecord[],
  source: PerceptSource,
  tick: number,
  hz: number,
  tuning: MemoryTuning = DEFAULT_MEMORY_TUNING,
): Recollection | undefined {
  const record = find(records, source);
  if (record === undefined) return undefined;
  const confidence = confidenceAt(record, tick, hz, tuning);
  if (!(confidence > 0)) return undefined;
  return Object.freeze({
    source,
    kind: record.kind,
    origin: record.origin,
    lkp: Object.freeze(point(record.lkp)),
    predicted: Object.freeze(predictedAt(record, tick, hz, tuning)),
    velocity: Object.freeze(point(record.velocity)),
    firstTick: record.firstTick,
    seenTick: record.seenTick,
    confidence,
  });
}
