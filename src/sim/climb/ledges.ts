// Ledges from greybox geometry (mw-e03.22). A load-time pass over a scene's laid-out parts finds the
// edges a character can grab or mantle onto: the top edges of solid boxes with a real drop beneath
// them. Designers never draw ledges by hand; they only switch edges off (a decorative cornice) or on
// (an edge the heuristics reject) with per-edge overrides in the scene file.
//
// For every solid box part, each of its four top edges is a candidate. Sections of an edge are
// rejected where other solid geometry
//   - stands just outside the edge higher than `minDrop` below its top (a step, a kerb, a neighbour
//     of the same height, a wall rising beside it: no drop there), or
//   - sits on top just inside the edge within `handClearance` (a crate stacked on a crate).
// What is left, in pieces at least `minLength` long, are the ledges. Vertical edges are never
// candidates. Wedges (ramps) have no ledges of their own but block like boxes. An override on a
// placement disables an edge (no ledge at all) or enables it (the whole edge is a ledge, whatever
// the heuristics say); later overrides win over earlier ones.
//
// Ledges are geometry: a charred crate still has edges to mantle. Their surface state is read live
// by the query (`LedgeIndex.near`), which leaves out ledges whose piece is gone and reports whether
// the piece is slippery, so a property change shows up in the next query (AC-3, AC-4). Headroom,
// standing room and reach are the mantle feature's checks (mw-e02.12), not this pass's.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { at } from '../geom/vec';
import type { LoadedScene } from '../scene/loader';
import type { LedgeOverrideSpec, LedgeSide, SceneLayout, ScenePart } from '../scene/layout';
import { rotateYaw } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';
import { climbabilityOf, type Climbability } from './surfaces';

/** Tuning of the ledge pass, metres. */
export interface LedgeConfig {
  /** Solid geometry just outside an edge must be at least this far below its top. */
  readonly minDrop: number;
  /** Solid geometry on top of an edge must be at least this far above it (room for hands). */
  readonly handClearance: number;
  /** How far outside and inside an edge the pass looks for blockers. */
  readonly probe: number;
  /** Shorter sections are dropped. */
  readonly minLength: number;
}

/** Default tuning: a 0.5 m drop (steps and kerbs are not ledges), a hand's clearance, 0.3 m pieces. */
export const DEFAULT_LEDGE_CONFIG: LedgeConfig = Object.freeze({
  minDrop: 0.5,
  handClearance: 0.25,
  probe: 0.05,
  minLength: 0.3,
});

/** One ledge: a horizontal segment along the top edge of a part. */
export interface Ledge {
  /** Index in the extraction's output (stable for a given scene and config). */
  readonly id: number;
  /** Placement (scene order) and part (within the piece) the edge belongs to. */
  readonly placement: number;
  readonly part: number;
  /** World side of the part the edge is on. */
  readonly side: LedgeSide;
  /** Ends of the segment (start has the lower coordinate along it), at the part's top. */
  readonly start: Vec3;
  readonly end: Vec3;
  /** Horizontal unit vector pointing out of the part, away from the top face. */
  readonly normal: Vec3;
}

/** Candidate sides of a part, in extraction order. */
export const LEDGE_SIDES: readonly LedgeSide[] = Object.freeze(['-x', '+x', '-z', '+z']);

const EPS = 1e-6;

const vec = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });

const NORMALS: Readonly<Record<LedgeSide, Vec3>> = Object.freeze({
  '-x': vec(-1, 0, 0),
  '+x': vec(1, 0, 0),
  '-z': vec(0, 0, -1),
  '+z': vec(0, 0, 1),
});

/** The world side a piece-local side faces after the piece's yaw. */
function worldSide(local: LedgeSide, part: ScenePart): LedgeSide {
  const n = rotateYaw(NORMALS[local], part.yaw);
  if (n.x !== 0) return n.x > 0 ? '+x' : '-x';
  return n.z > 0 ? '+z' : '-z';
}

interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.min.x < b.max.x - EPS &&
  a.max.x > b.min.x + EPS &&
  a.min.y < b.max.y - EPS &&
  a.max.y > b.min.y + EPS &&
  a.min.z < b.max.z - EPS &&
  a.max.z > b.min.z + EPS;

/** An edge: its fixed coordinate across, and its span along, the horizontal axis it runs on. */
interface Edge {
  /** Axis the edge runs along. */
  readonly along: 'x' | 'z';
  readonly lo: number;
  readonly hi: number;
  /** Coordinate of the edge on the other horizontal axis. */
  readonly at: number;
  /** +1 when the part lies on the negative side of `at` (a + side), −1 otherwise. */
  readonly out: 1 | -1;
}

function edgeOf(part: ScenePart, side: LedgeSide): Edge {
  const { min, max } = part;
  switch (side) {
    case '-x':
      return { along: 'z', lo: min.z, hi: max.z, at: min.x, out: -1 };
    case '+x':
      return { along: 'z', lo: min.z, hi: max.z, at: max.x, out: 1 };
    case '-z':
      return { along: 'x', lo: min.x, hi: max.x, at: min.z, out: -1 };
    case '+z':
      return { along: 'x', lo: min.x, hi: max.x, at: max.z, out: 1 };
  }
}

/** A thin box next to `edge`: from the edge `depth` metres outwards (negative: inwards), y range. */
function strip(edge: Edge, depth: number, y0: number, y1: number): Box {
  const a = edge.at;
  const b = edge.at + edge.out * depth;
  const across0 = Math.min(a, b);
  const across1 = Math.max(a, b);
  return edge.along === 'x'
    ? { min: vec(edge.lo, y0, across0), max: vec(edge.hi, y1, across1) }
    : { min: vec(across0, y0, edge.lo), max: vec(across1, y1, edge.hi) };
}

/** The sections of [lo, hi] not covered by `blocked` (each clipped to it), in ascending order. */
function freeSpans(lo: number, hi: number, blocked: readonly (readonly [number, number])[]) {
  const sorted = [...blocked].sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let from = lo;
  for (const [a, b] of sorted) {
    if (a > from) spans.push([from, Math.min(a, hi)]);
    from = Math.max(from, b);
  }
  if (from < hi) spans.push([from, hi]);
  return spans;
}

/** Override state per placement, part and local side: true forced on, false off, absent auto. */
function overrideFor(
  overrides: readonly LedgeOverrideSpec[],
  part: number,
  side: LedgeSide,
): boolean | undefined {
  let state: boolean | undefined;
  for (const o of overrides) {
    if ((o.part === undefined || o.part === part) && (o.side === undefined || o.side === side)) {
      state = o.ledge;
    }
  }
  return state;
}

/**
 * Every ledge of a laid-out scene, in part order then LEDGE_SIDES order then along the edge.
 * Deterministic: the same layout and config always give the same ledges.
 * @throws RangeError when an override names a part its piece does not have.
 */
export function extractLedges(
  layout: SceneLayout,
  config: LedgeConfig = DEFAULT_LEDGE_CONFIG,
): Ledge[] {
  const solids = layout.parts.filter((part) => part.collider !== undefined);
  for (const piece of layout.pieces) {
    const count = layout.parts.filter((part) => part.placement === piece.placement).length;
    for (const o of piece.ledges ?? []) {
      if (o.part !== undefined && o.part >= count) {
        throw new RangeError(
          `placement ${String(piece.placement)} overrides the ledges of part ${String(o.part)}, ` +
            `but kit piece "${piece.piece}" has ${String(count)} part(s)`,
        );
      }
    }
  }
  const ledges: Ledge[] = [];
  const seen = new Map<number, number>();
  for (const part of layout.parts) {
    const index = seen.get(part.placement) ?? 0;
    seen.set(part.placement, index + 1);
    if (part.collider === undefined || part.shape !== 'box') continue;
    const overrides = at(layout.pieces, part.placement).ledges ?? [];
    // Local sides turned into world sides, so an override follows the piece's yaw.
    const forced = new Map<LedgeSide, boolean | undefined>();
    for (const local of LEDGE_SIDES) {
      forced.set(worldSide(local, part), overrideFor(overrides, index, local));
    }
    for (const side of LEDGE_SIDES) {
      const state = forced.get(side);
      if (state === false) continue;
      const edge = edgeOf(part, side);
      const top = part.max.y;
      const blocked: (readonly [number, number])[] = [];
      if (state === undefined) {
        const outside = strip(edge, config.probe, top - config.minDrop, top + config.handClearance);
        const above = strip(edge, -config.probe, top, top + config.handClearance);
        for (const other of solids) {
          if (other === part || !(overlaps(other, outside) || overlaps(other, above))) continue;
          blocked.push([other.min[edge.along], other.max[edge.along]]);
        }
      }
      for (const [lo, hi] of freeSpans(edge.lo, edge.hi, blocked)) {
        if (hi - lo < config.minLength - EPS) continue;
        const point = (t: number): Vec3 =>
          edge.along === 'x' ? vec(t, top, edge.at) : vec(edge.at, top, t);
        ledges.push(
          Object.freeze({
            id: ledges.length,
            placement: part.placement,
            part: index,
            side,
            start: point(lo),
            end: point(hi),
            normal: NORMALS[side],
          }),
        );
      }
    }
  }
  return ledges;
}

/** A ledge found by a query, with its piece's live surface state. */
export interface LedgeHit {
  readonly ledge: Ledge;
  /** The piece entity the ledge belongs to. */
  readonly entity: EntityId;
  /** Closest point of the ledge to the query point. */
  readonly point: Vec3;
  readonly distance: number;
  /** How the piece climbs now; `slippery` (frozen) means hands cannot hold the ledge. */
  readonly surface: Climbability;
}

/** Closest point of segment a–b to p. */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return vec(a.x + dx * t, a.y, a.z + dz * t);
}

/** A scene's ledges and the piece entities they belong to, for queries. */
export class LedgeIndex {
  /**
   * @param ledges from `extractLedges`
   * @param pieces piece entity per placement (`LoadedScene.pieces`)
   */
  constructor(
    readonly ledges: readonly Ledge[],
    private readonly pieces: readonly EntityId[],
  ) {}

  /** The piece entity a ledge belongs to. */
  entityOf(ledge: Ledge): EntityId | undefined {
    return this.pieces[ledge.placement];
  }

  /**
   * Ledges within `radius` metres of `point` whose piece still exists, nearest first (ties by id),
   * each with its piece's current surface state (read now, so property changes show at once).
   */
  near(world: World<never>, point: Vec3, radius: number): LedgeHit[] {
    const hits: LedgeHit[] = [];
    for (const ledge of this.ledges) {
      const entity = this.entityOf(ledge);
      if (entity === undefined || !world.isAlive(entity)) continue;
      const closest = closestOnSegment(ledge.start, ledge.end, point);
      const dx = closest.x - point.x;
      const dy = closest.y - point.y;
      const dz = closest.z - point.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > radius) continue;
      hits.push({
        ledge,
        entity,
        point: closest,
        distance,
        surface: climbabilityOf(world, entity),
      });
    }
    return hits.sort((a, b) => a.distance - b.distance || a.ledge.id - b.ledge.id);
  }
}

/** Runs the ledge pass over a loaded scene and indexes the result by its piece entities. */
export function sceneLedges(loaded: LoadedScene, config?: LedgeConfig): LedgeIndex {
  return new LedgeIndex(extractLedges(loaded.layout, config), loaded.pieces);
}
