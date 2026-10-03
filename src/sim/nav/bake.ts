// The navmesh bake (mw-e11.4, ADR-0006): grey-box geometry → stored navmesh data (./format.ts). It
// runs at content build time (`pnpm nav:bake`), never in the game, but lives in the sim because it is
// pure and deterministic: the same input gives the same bytes on every machine, so CI can re-bake
// and compare. The steps follow Recast's, specialised to what grey-box levels are made of
// (axis-aligned boxes and quarter-turn wedges):
//
// 1. Rasterise every solid into columns of a cell grid (a cell is solid where its centre is inside
//    the solid's footprint); merge each column's solid spans.
// 2. Every span top with `agentHeight` of headroom and a slope within `maxSlope` is a walkable
//    surface. Surfaces in neighbouring columns connect when their heights differ by at most
//    `stepHeight` and the gap between them leaves headroom.
// 3. Erode by the agent radius: a chamfer distance field from the edges (2 per straight step, 3 per
//    diagonal) drops every surface closer than the radius to a wall or a drop.
// 4. Merge the rest greedily into axis-aligned rectangles of one plane (one floor height, or one
//    ramp) and one doorway; record the shared edges between rectangles as portals.
// 5. Off-mesh links: jump and drop links across short gaps between surfaces at different heights
//    (with headroom along the way), and climb links up and down every face of a climbable solid
//    (its `climbable` world property, so ladders, ivy and ropes all qualify) wide enough for the agent.
// 6. Doorways: rectangles under a door's closed leaf are marked with the door, so a query can close
//    them while the door is shut or locked (./doors.ts).

import { encodeCanonical, xxHash32 } from '../snapshot';
import { rampAngle, type GreyboxShape } from '../character/greybox';
import type { Bounds } from '../stimulus/shapes';
import {
  NAV_BAKE_VERSION,
  NAV_LINK_KIND_NAMES,
  type NavBakeSettings,
  type NavLinkRow,
  type NavMeshData,
  type NavPolyRow,
  type NavPortalRow,
} from './format';
import { at, known } from './util';

/** The humanoid baseline (content locomotion `humanoid`): what scenes are baked for by default. */
export const DEFAULT_NAV_BAKE_SETTINGS: NavBakeSettings = Object.freeze({
  cellSize: 0.125,
  agentRadius: 0.35,
  agentHeight: 1.8,
  stepHeight: 0.4,
  maxSlope: 45,
  maxJump: 2,
  maxDrop: 4,
});

/** A solid of the level: a box or wedge, and its climb grade when its surface can be climbed. */
export interface NavBakeSolid {
  readonly shape: GreyboxShape;
  /** Climb difficulty 1–3 (src/sim/climb CLIMB_GRADE_RULES) when the solid is climbable. */
  readonly climbGrade?: number;
}

/** A door: its scene spawn id and its closed leaf, world metres. */
export interface NavBakeDoor {
  readonly id: string;
  readonly bounds: Bounds;
}

/** What the bake reads: the level's solids and doors. */
export interface NavBakeInput {
  /** The scene id (the navmesh's id). */
  readonly id: string;
  readonly solids: readonly NavBakeSolid[];
  readonly doors: readonly NavBakeDoor[];
}

/** Thrown for settings the bake cannot work with. */
export class NavBakeError extends Error {
  override readonly name = 'NavBakeError';
}

const EPS = 1e-6;
/** Most cells one jump or drop link stands for along an edge. */
const LINK_RUN_CELLS = 16;
const UNREACHED = 0xffff;
const JUMP = NAV_LINK_KIND_NAMES.indexOf('jump');
const DROP = NAV_LINK_KIND_NAMES.indexOf('drop');
const CLIMB = NAV_LINK_KIND_NAMES.indexOf('climb');

/** Neighbour directions: +x, +z, −x, −z. */
const DX = [1, 0, -1, 0] as const;
const DZ = [0, 1, 0, -1] as const;

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;

function checkSettings(s: NavBakeSettings): void {
  const positive = ['cellSize', 'agentRadius', 'agentHeight'] as const;
  for (const key of positive) {
    if (!(s[key] > 0)) throw new NavBakeError(`${key} must be above 0 (got ${String(s[key])})`);
  }
  const nonNegative = ['stepHeight', 'maxJump', 'maxDrop'] as const;
  for (const key of nonNegative) {
    if (!(s[key] >= 0)) throw new NavBakeError(`${key} must be at least 0 (got ${String(s[key])})`);
  }
  if (!(s.maxSlope >= 0 && s.maxSlope < 90)) {
    throw new NavBakeError(`maxSlope must be in [0, 90) degrees (got ${String(s.maxSlope)})`);
  }
}

/** The fingerprint of a bake's input: everything that changes its output. */
export function navBakeSource(input: NavBakeInput, settings: NavBakeSettings): string {
  const bytes = encodeCanonical({
    version: NAV_BAKE_VERSION,
    settings: { ...settings },
    solids: input.solids.map((s) => ({
      shape: { ...s.shape },
      ...(s.climbGrade !== undefined && { climbGrade: s.climbGrade }),
    })),
    doors: input.doors.map((d) => ({ id: d.id, bounds: d.bounds })),
  });
  return xxHash32(bytes).toString(16).padStart(8, '0');
}

/** A solid's height at (x, z) inside its footprint: its top, or a wedge's surface. */
function topAt(shape: GreyboxShape, x: number, z: number): number {
  if (shape.kind === 'box') return shape.max.y;
  const { min, max } = shape;
  const t =
    shape.rises === '+x'
      ? (x - min.x) / (max.x - min.x)
      : shape.rises === '-x'
        ? (max.x - x) / (max.x - min.x)
        : shape.rises === '+z'
          ? (z - min.z) / (max.z - min.z)
          : (max.z - z) / (max.z - min.z);
  return min.y + t * (max.y - min.y);
}

/** The plane y = a + gx·x + gz·z of a solid's top. */
function planeOf(shape: GreyboxShape): readonly [number, number, number] {
  const { min, max } = shape;
  if (shape.kind === 'box') return [max.y, 0, 0];
  const rise = max.y - min.y;
  switch (shape.rises) {
    case '+x': {
      const g = rise / (max.x - min.x);
      return [min.y - min.x * g, g, 0];
    }
    case '-x': {
      const g = rise / (max.x - min.x);
      return [min.y + max.x * g, -g, 0];
    }
    case '+z': {
      const g = rise / (max.z - min.z);
      return [min.y - min.z * g, 0, g];
    }
    case '-z': {
      const g = rise / (max.z - min.z);
      return [min.y + max.z * g, 0, -g];
    }
  }
}

interface Grid {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly cs: number;
}

/** Index range [from, to) of cells whose centres lie in [lo, hi) along one axis. */
function cellRange(lo: number, hi: number, origin: number, cs: number, n: number) {
  const from = Math.max(0, Math.ceil((lo - origin) / cs - 0.5 - EPS));
  const to = Math.min(n, Math.ceil((hi - origin) / cs - 0.5 - EPS));
  return [from, to] as const;
}

/** Merged solid spans per column: [lo, hi, owner] triples. */
function rasterise(solids: readonly NavBakeSolid[], g: Grid): number[][] {
  const raw: number[][] = Array.from({ length: g.w * g.h }, () => []);
  solids.forEach(({ shape }, index) => {
    const [i0, i1] = cellRange(shape.min.x, shape.max.x, g.x0, g.cs, g.w);
    const [k0, k1] = cellRange(shape.min.z, shape.max.z, g.z0, g.cs, g.h);
    for (let k = k0; k < k1; k++) {
      const cz = g.z0 + (k + 0.5) * g.cs;
      for (let i = i0; i < i1; i++) {
        const cx = g.x0 + (i + 0.5) * g.cs;
        at(raw, k * g.w + i).push(shape.min.y, topAt(shape, cx, cz), index);
      }
    }
  });
  return raw.map((spans) => {
    const order = Array.from({ length: spans.length / 3 }, (_, n) => n).sort(
      (a, b) => at(spans, a * 3) - at(spans, b * 3) || a - b,
    );
    const merged: number[] = [];
    for (const n of order) {
      const lo = at(spans, n * 3);
      const hi = at(spans, n * 3 + 1);
      const owner = at(spans, n * 3 + 2);
      const last = merged.length - 3;
      if (last >= 0 && lo <= at(merged, last + 1) + EPS) {
        if (hi > at(merged, last + 1)) {
          merged[last + 1] = hi;
          merged[last + 2] = owner;
        }
      } else {
        merged.push(lo, hi, owner);
      }
    }
    return merged;
  });
}

/** Walkable surfaces in column order (each column's lowest first). */
interface Surfaces {
  readonly count: number;
  readonly col: Int32Array;
  readonly y: Float64Array;
  readonly ceil: Float64Array;
  readonly owner: Int32Array;
  /** First surface of each column, and one past the last (colStart[c + 1]). */
  readonly colStart: Int32Array;
}

function findSurfaces(
  columns: readonly number[][],
  solids: readonly NavBakeSolid[],
  s: NavBakeSettings,
): Surfaces {
  const steep = solids.map(({ shape }) => shape.kind === 'ramp' && rampAngle(shape) > s.maxSlope);
  const col: number[] = [];
  const y: number[] = [];
  const ceil: number[] = [];
  const owner: number[] = [];
  const colStart = new Int32Array(columns.length + 1);
  columns.forEach((spans, c) => {
    colStart[c] = col.length;
    for (let n = 0; n < spans.length; n += 3) {
      const top = at(spans, n + 1);
      const above = n + 3 < spans.length ? at(spans, n + 3) : Infinity;
      const who = at(spans, n + 2);
      if (above - top < s.agentHeight || steep[who] === true) continue;
      col.push(c);
      y.push(top);
      ceil.push(above);
      owner.push(who);
    }
  });
  colStart[columns.length] = col.length;
  return {
    count: col.length,
    col: Int32Array.from(col),
    y: Float64Array.from(y),
    ceil: Float64Array.from(ceil),
    owner: Int32Array.from(owner),
    colStart,
  };
}

/** nb[s·4 + d]: the surface stepped onto from s in direction d, or −1. */
function connect(sf: Surfaces, g: Grid, s: NavBakeSettings): Int32Array {
  const nb = new Int32Array(sf.count * 4).fill(-1);
  for (let a = 0; a < sf.count; a++) {
    const c = at(sf.col, a);
    const i = c % g.w;
    const k = (c - i) / g.w;
    for (let d = 0; d < 4; d++) {
      // Solids never reach the grid's one-cell margin, so a surface's neighbours are on the grid.
      const nc = (k + at(DZ, d)) * g.w + i + at(DX, d);
      let best = -1;
      let bestDy = Infinity;
      for (let b = at(sf.colStart, nc); b < at(sf.colStart, nc + 1); b++) {
        const dy = Math.abs(at(sf.y, b) - at(sf.y, a));
        const gap = Math.min(at(sf.ceil, a), at(sf.ceil, b)) - Math.max(at(sf.y, a), at(sf.y, b));
        if (dy > s.stepHeight + EPS || gap < s.agentHeight || dy >= bestDy) continue;
        best = b;
        bestDy = dy;
      }
      nb[a * 4 + d] = best;
    }
  }
  return nb;
}

/** Whether each surface survives erosion by the agent radius. */
function erode(sf: Surfaces, nb: Int32Array, s: NavBakeSettings): Uint8Array {
  const dist = new Uint16Array(sf.count);
  for (let a = 0; a < sf.count; a++) {
    let edge = false;
    for (let d = 0; d < 4; d++) edge ||= at(nb, a * 4 + d) < 0;
    dist[a] = edge ? 0 : UNREACHED;
  }
  const relax = (a: number, b: number, cost: number) => {
    if (b >= 0 && at(dist, b) + cost < at(dist, a)) {
      dist[a] = at(dist, b) + cost;
    }
  };
  // Forward: −x, −x−z, −z, +x−z. Backward: +x, +x+z, +z, −x+z.
  const pass = (a: number, straight1: number, diag1: number, straight2: number, diag2: number) => {
    const p = at(nb, a * 4 + straight1);
    relax(a, p, 2);
    if (p >= 0) relax(a, at(nb, p * 4 + diag1), 3);
    const q = at(nb, a * 4 + straight2);
    relax(a, q, 2);
    if (q >= 0) relax(a, at(nb, q * 4 + diag2), 3);
  };
  for (let a = 0; a < sf.count; a++) pass(a, 2, 3, 3, 0);
  for (let a = sf.count - 1; a >= 0; a--) pass(a, 0, 1, 1, 2);
  // At least one cell, so every walkable surface has all four neighbours.
  const threshold = 2 * Math.max(1, Math.ceil(s.agentRadius / s.cellSize - EPS));
  return Uint8Array.from(dist, (v) => (v >= threshold ? 1 : 0));
}

/** The door index each surface's cell lies under (−1 for none). */
function doorways(
  sf: Surfaces,
  g: Grid,
  doors: readonly NavBakeDoor[],
  s: NavBakeSettings,
): Int32Array {
  const gate = new Int32Array(sf.count).fill(-1);
  // A thin leaf still covers at least a cell either side of its middle.
  const widen = (lo: number, hi: number) => {
    if (hi - lo >= 2 * g.cs) return [lo, hi] as const;
    const mid = (lo + hi) / 2;
    return [mid - g.cs, mid + g.cs] as const;
  };
  doors.forEach(({ bounds }, index) => {
    const [xa, xb] = widen(bounds.min.x, bounds.max.x);
    const [za, zb] = widen(bounds.min.z, bounds.max.z);
    for (let a = 0; a < sf.count; a++) {
      const c = at(sf.col, a);
      const i = c % g.w;
      const cx = g.x0 + (i + 0.5) * g.cs;
      const cz = g.z0 + ((c - i) / g.w + 0.5) * g.cs;
      const y = at(sf.y, a);
      if (cx < xa || cx >= xb || cz < za || cz >= zb) continue;
      if (y < bounds.min.y - s.stepHeight || y > bounds.min.y + s.stepHeight) continue;
      gate[a] = index;
    }
  });
  return gate;
}

interface Rects {
  readonly rows: NavPolyRow[];
  /** poly[s]: the rectangle surface s belongs to, or −1. */
  readonly poly: Int32Array;
}

/** Greedy rectangles over the walkable surfaces, one plane and one doorway each. */
function rectangles(
  sf: Surfaces,
  nb: Int32Array,
  walkable: Uint8Array,
  gate: Int32Array,
  solids: readonly NavBakeSolid[],
  g: Grid,
): Rects {
  const keys = new Map<string, number>();
  const key = new Int32Array(sf.count);
  for (let a = 0; a < sf.count; a++) {
    const shape = at(solids, at(sf.owner, a)).shape;
    const plane = shape.kind === 'box' ? `y${String(sf.y[a])}` : `r${String(sf.owner[a])}`;
    const id = `${plane}|${String(gate[a])}`;
    if (!keys.has(id)) keys.set(id, keys.size);
    key[a] = known(keys.get(id));
  }
  const poly = new Int32Array(sf.count).fill(-1);
  const rows: NavPolyRow[] = [];
  const fits = (b: number, k: number) =>
    b >= 0 && walkable[b] === 1 && poly[b] === -1 && key[b] === k;
  /** Lines of cells from a along d1, stacked along d2 while every next line fits whole. */
  const grow = (a: number, k: number, d1: number, d2: number): number[][] => {
    const first: number[] = [a];
    for (let b = at(nb, a * 4 + d1); fits(b, k); b = at(nb, b * 4 + d1)) first.push(b);
    const band = [first];
    for (;;) {
      const next = at(band, band.length - 1).map((b) => at(nb, b * 4 + d2));
      const ok = next.every(
        (b, j) => fits(b, k) && (j === 0 || nb[at(next, j - 1) * 4 + d1] === b),
      );
      if (!ok) return band;
      band.push(next);
    }
  };
  for (let a = 0; a < sf.count; a++) {
    if (walkable[a] !== 1 || poly[a] !== -1) continue;
    const k = at(key, a);
    // Rows along +x stacked along +z, or columns along +z stacked along +x: the bigger wins.
    const rowsFirst = grow(a, k, 0, 1);
    const colsFirst = grow(a, k, 1, 0);
    const area = (band: number[][]) => band.length * at(band, 0).length;
    const byCols = area(colsFirst) > area(rowsFirst);
    const band = byCols ? colsFirst : rowsFirst;
    const id = rows.length;
    for (const line of band) for (const b of line) poly[b] = id;
    const c = at(sf.col, a);
    const i0 = c % g.w;
    const k0 = (c - i0) / g.w;
    const along = at(band, 0).length;
    const [w, h] = byCols ? [band.length, along] : [along, band.length];
    const [pa, gx, gz] = planeOf(at(solids, at(sf.owner, a)).shape);
    rows.push([i0, k0, i0 + w, k0 + h, pa, gx, gz, 0, at(gate, a)]);
  }
  return { rows, poly };
}

/** Shared edges between rectangles, merged into runs. */
function portals(sf: Surfaces, nb: Int32Array, poly: Int32Array, g: Grid): NavPortalRow[] {
  const runs = new Map<string, Set<number>>();
  for (let a = 0; a < sf.count; a++) {
    const p = at(poly, a);
    if (p < 0) continue;
    const c = at(sf.col, a);
    const i = c % g.w;
    const k = (c - i) / g.w;
    for (let d = 0; d < 4; d++) {
      const q = at(poly, at(nb, a * 4 + d));
      if (q < 0 || q === p) continue;
      const alongX = d === 0 || d === 2;
      const line = alongX ? i + (d === 0 ? 1 : 0) : k + (d === 1 ? 1 : 0);
      const id = `${String(Math.min(p, q))},${String(Math.max(p, q))},${alongX ? 'x' : 'z'},${String(line)}`;
      const set = runs.get(id) ?? new Set<number>();
      set.add(alongX ? k : i);
      runs.set(id, set);
    }
  }
  const out: NavPortalRow[] = [];
  for (const [id, set] of runs) {
    const [a, b, axis, line] = id.split(',') as [string, string, string, string];
    const cells = [...set].sort((u, v) => u - v);
    let start = at(cells, 0);
    for (let n = 1; n <= cells.length; n++) {
      if (n < cells.length && cells[n] === at(cells, n - 1) + 1) continue;
      const end = at(cells, n - 1) + 1;
      const l = Number(line);
      out.push(
        axis === 'x'
          ? [Number(a), Number(b), l, start, l, end]
          : [Number(a), Number(b), start, l, end, l],
      );
      start = cells[n] ?? end;
    }
  }
  return out;
}

/** Point-in-rectangle and nearest-point helpers over the baked rectangles (bake time only). */
class RectLookup {
  constructor(
    private readonly rows: readonly NavPolyRow[],
    private readonly g: Grid,
  ) {}

  height(p: number, x: number, z: number): number {
    const r = at(this.rows, p);
    return r[4] + r[5] * x + r[6] * z;
  }

  /** World bounds of rectangle p: [x0, z0, x1, z1]. */
  bounds(p: number): readonly [number, number, number, number] {
    const r = at(this.rows, p);
    const { x0, z0, cs } = this.g;
    return [x0 + r[0] * cs, z0 + r[1] * cs, x0 + r[2] * cs, z0 + r[3] * cs];
  }

  /** The rectangle nearest (x, y, z) within `reach` horizontally and `rise` vertically, and the point. */
  nearest(x: number, y: number, z: number, reach: number, rise: number, not = -1) {
    let best: { poly: number; x: number; y: number; z: number } | undefined;
    let bestD = Infinity;
    for (let p = 0; p < this.rows.length; p++) {
      if (p === not) continue;
      const [ax, az, bx, bz] = this.bounds(p);
      const px = Math.min(Math.max(x, ax), bx);
      const pz = Math.min(Math.max(z, az), bz);
      const py = this.height(p, px, pz);
      const h = (px - x) ** 2 + (pz - z) ** 2;
      if (h > reach * reach + EPS || Math.abs(py - y) > rise + EPS) continue;
      const d = h + (py - y) ** 2;
      if (d < bestD - EPS) {
        bestD = d;
        best = { poly: p, x: px, y: py, z: pz };
      }
    }
    return best;
  }

  /** Rectangles containing (x, z). */
  containing(x: number, z: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < this.rows.length; p++) {
      const [ax, az, bx, bz] = this.bounds(p);
      if (x >= ax - EPS && x <= bx + EPS && z >= az - EPS && z <= bz + EPS) out.push(p);
    }
    return out;
  }
}

/** Whether a solid span of `columns` overlaps (lo, hi) at (x, z). */
function solidBetween(
  columns: readonly number[][],
  g: Grid,
  x: number,
  z: number,
  lo: number,
  hi: number,
) {
  // Only called between two points on baked polygons, so (x, z) is on the grid.
  const i = Math.floor((x - g.x0) / g.cs);
  const k = Math.floor((z - g.z0) / g.cs);
  const spans = at(columns, k * g.w + i);
  for (let n = 0; n < spans.length; n += 3) {
    if (at(spans, n) < hi && at(spans, n + 1) > lo) return true;
  }
  return false;
}

const link = (
  kind: number,
  from: number,
  to: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  measure: number,
): NavLinkRow => [
  kind,
  from,
  to,
  round4(a[0]),
  round4(a[1]),
  round4(a[2]),
  round4(b[0]),
  round4(b[1]),
  round4(b[2]),
  round4(measure),
];

/** Jump and drop links across short gaps from every open edge of every rectangle. */
function gapLinks(
  sf: Surfaces,
  nb: Int32Array,
  rects: Rects,
  lookup: RectLookup,
  columns: readonly number[][],
  g: Grid,
  s: NavBakeSettings,
): NavLinkRow[] {
  // Surfaces of each rectangle's cells, by cell, to walk its edges.
  const cellOf = new Map<number, number>();
  for (let a = 0; a < sf.count; a++) {
    const p = at(rects.poly, a);
    if (p >= 0) cellOf.set(p * g.w * g.h + at(sf.col, a), a);
  }
  const reach = 2 * s.agentRadius + 4 * g.cs;
  const steps = Math.ceil(reach / g.cs);
  const out: NavLinkRow[] = [];
  rects.rows.forEach((row, p) => {
    const [i0, k0, i1, k1] = row;
    for (let d = 0; d < 4; d++) {
      // Cells along side d, in order.
      const side: number[] = [];
      const alongX = d === 1 || d === 3;
      const n0 = alongX ? i0 : k0;
      const n1 = alongX ? i1 : k1;
      for (let n = n0; n < n1; n++) {
        const i = alongX ? n : d === 0 ? i1 - 1 : i0;
        const k = alongX ? (d === 1 ? k1 - 1 : k0) : n;
        const a = known(cellOf.get(p * g.w * g.h + k * g.w + i));
        side.push(at(rects.poly, at(nb, a * 4 + d)) >= 0 ? -1 : n);
      }
      // Runs of open cells, cut to at most LINK_RUN_CELLS each.
      let n = 0;
      while (n < side.length) {
        if (side[n] === -1) {
          n++;
          continue;
        }
        let end = n;
        while (end < side.length && side[end] !== -1 && end - n < LINK_RUN_CELLS) end++;
        const mid = (at(side, n) + at(side, end - 1) + 1) / 2;
        n = end;
        const nx = at(DX, d);
        const nz = at(DZ, d);
        const edge = d === 0 ? i1 : d === 2 ? i0 : d === 1 ? k1 : k0;
        const ex = g.x0 + (alongX ? mid : edge) * g.cs;
        const ez = g.z0 + (alongX ? edge : mid) * g.cs;
        const ax = ex - nx * g.cs * 0.5;
        const az = ez - nz * g.cs * 0.5;
        const ay = lookup.height(p, ax, az);
        for (let j = 1; j <= steps; j++) {
          const bx = ex + nx * g.cs * j;
          const bz = ez + nz * g.cs * j;
          // The first (lowest-index) surface beyond the edge at a jumpable or droppable height; the
          // probe is outside p, so p is never among them.
          const target = lookup.containing(bx, bz).find((q) => {
            const dy = lookup.height(q, bx, bz) - ay;
            return Math.abs(dy) > s.stepHeight && dy <= s.maxJump && -dy <= s.maxDrop;
          });
          if (target === undefined) continue;
          const rise = lookup.height(target, bx, bz) - ay;
          const top = Math.max(ay, ay + rise);
          let clear = true;
          for (let t = 0; t <= j && clear; t++) {
            const x = ax + nx * g.cs * t;
            const z = az + nz * g.cs * t;
            clear = !solidBetween(columns, g, x, z, top + 0.01, top + s.agentHeight);
          }
          if (clear) {
            const by = lookup.height(target, bx, bz);
            const kind = rise > 0 ? JUMP : DROP;
            out.push(link(kind, p, target, [ax, ay, az], [bx, by, bz], Math.abs(rise)));
          }
          break;
        }
      }
    }
  });
  return out;
}

/** Climb links up and down every face of every climbable solid wide enough for the agent. */
function climbLinks(
  solids: readonly NavBakeSolid[],
  lookup: RectLookup,
  s: NavBakeSettings,
): NavLinkRow[] {
  const out: NavLinkRow[] = [];
  const reach = 2 * s.agentRadius + 2 * s.cellSize;
  const off = s.agentRadius + s.cellSize;
  for (const { shape, climbGrade } of solids) {
    if (climbGrade === undefined) continue;
    const { min, max } = shape;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    for (let d = 0; d < 4; d++) {
      const nx = at(DX, d);
      const nz = at(DZ, d);
      const width = nx !== 0 ? max.z - min.z : max.x - min.x;
      if (width < 2 * s.agentRadius - EPS) continue;
      const fx = nx > 0 ? max.x : nx < 0 ? min.x : cx;
      const fz = nz > 0 ? max.z : nz < 0 ? min.z : cz;
      const foot = lookup.nearest(fx + nx * off, min.y, fz + nz * off, reach, s.stepHeight);
      if (foot === undefined) continue;
      const top = lookup.nearest(
        fx - nx * off,
        max.y,
        fz - nz * off,
        reach,
        s.stepHeight,
        foot.poly,
      );
      if (top === undefined || top.y - foot.y <= s.stepHeight) continue;
      const a = [foot.x, foot.y, foot.z] as const;
      const b = [top.x, top.y, top.z] as const;
      out.push(link(CLIMB, foot.poly, top.poly, a, b, climbGrade));
      out.push(link(CLIMB, top.poly, foot.poly, b, a, climbGrade));
    }
  }
  return out;
}

/**
 * Bakes `input` into navmesh data for an agent described by `settings` (see the file header).
 * @throws NavBakeError for unusable settings.
 */
export function bakeNavMesh(
  input: NavBakeInput,
  settings: NavBakeSettings = DEFAULT_NAV_BAKE_SETTINGS,
): NavMeshData {
  checkSettings(settings);
  const cs = settings.cellSize;
  const source = navBakeSource(input, settings);
  const empty = (origin: readonly [number, number]): NavMeshData => ({
    id: input.id,
    version: NAV_BAKE_VERSION,
    source,
    settings: { ...settings },
    origin,
    polys: [],
    portals: [],
    links: [],
    doors: input.doors.map((d) => d.id),
  });
  if (input.solids.length === 0) return empty([0, 0]);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const { shape } of input.solids) {
    minX = Math.min(minX, shape.min.x);
    minZ = Math.min(minZ, shape.min.z);
    maxX = Math.max(maxX, shape.max.x);
    maxZ = Math.max(maxZ, shape.max.z);
  }
  const x0 = (Math.floor(minX / cs) - 1) * cs + 0;
  const z0 = (Math.floor(minZ / cs) - 1) * cs + 0;
  const g: Grid = {
    x0,
    z0,
    w: Math.ceil((maxX - x0) / cs) + 1,
    h: Math.ceil((maxZ - z0) / cs) + 1,
    cs,
  };
  const columns = rasterise(input.solids, g);
  const sf = findSurfaces(columns, input.solids, settings);
  const nb = connect(sf, g, settings);
  const walkable = erode(sf, nb, settings);
  const gate = doorways(sf, g, input.doors, settings);
  const rects = rectangles(sf, nb, walkable, gate, input.solids, g);
  const lookup = new RectLookup(rects.rows, g);
  return {
    ...empty([x0, z0]),
    polys: rects.rows,
    portals: portals(sf, nb, rects.poly, g),
    links: [
      ...gapLinks(sf, nb, rects, lookup, columns, g, settings),
      ...climbLinks(input.solids, lookup, settings),
    ],
  };
}
