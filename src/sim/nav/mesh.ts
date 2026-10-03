// A loaded navmesh (mw-e11.4): the baked data (./format.ts) unpacked into flat arrays, with a
// bucket grid for point lookups and per-polygon edge lists for the path search. Read-only after
// construction, so one instance serves every query of a level.

import type { Vec3 } from '../stimulus/shapes';
import {
  NAV_AREA_NAMES,
  NAV_BAKE_VERSION,
  NAV_LINK_KIND_NAMES,
  type NavAreaName,
  type NavLinkKindName,
  type NavMeshData,
} from './format';
/** `items[index]` for an index known to be in range (module-local: a hot path). */
function at<T>(items: ArrayLike<T>, index: number): T {
  return items[index] as T;
}

/** Thrown for navmesh data the runtime cannot use. */
export class NavMeshError extends Error {
  override readonly name = 'NavMeshError';
}

/** One way out of a polygon: across a portal or along an off-mesh link. */
export interface NavEdge {
  /** The polygon it leads to. */
  readonly to: number;
  /** Portal index (`via: 'portal'`) or link index (`via: 'link'`). */
  readonly index: number;
  readonly via: 'portal' | 'link';
}

/** A portal in world metres: the segment (ax, az)–(bx, bz) shared by polygons a and b. */
export interface NavPortal {
  readonly a: number;
  readonly b: number;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/** An off-mesh link in world metres. */
export interface NavLinkInfo {
  readonly kind: NavLinkKindName;
  readonly from: number;
  readonly to: number;
  readonly a: Vec3;
  readonly b: Vec3;
  /** Rise (jump), fall (drop) or climb grade (climb). */
  readonly measure: number;
}

/** A point on the mesh and the polygon it lies in. */
export interface NavPoint extends Vec3 {
  readonly poly: number;
}

const EPS = 1e-6;
/** Bucket size of the lookup grid, metres. */
const BUCKET = 2;

const vec = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });

export class NavMesh {
  readonly id: string;
  readonly data: NavMeshData;
  readonly polyCount: number;
  /** Door spawn ids; a polygon's `door` indexes this. */
  readonly doors: readonly string[];
  // Flat per-polygon arrays, read directly by the path search's inner loop (./path.ts).
  /** Footprint, world metres. */
  readonly x0: Float64Array;
  readonly z0: Float64Array;
  readonly x1: Float64Array;
  readonly z1: Float64Array;
  /** Surface plane y = pa + pgx·x + pgz·z. */
  readonly pa: Float64Array;
  readonly pgx: Float64Array;
  readonly pgz: Float64Array;
  /** NAV_AREA_NAMES index. */
  readonly area: Uint8Array;
  /** `doors` index, or −1. */
  readonly door: Int32Array;
  /** Polygon p's edges are edgeTo/edgeRef[edgeStart[p] … edgeStart[p + 1]). */
  readonly edgeStart: Int32Array;
  readonly edgeTo: Int32Array;
  /** Portal index (≥ 0), or −(link index) − 2. */
  readonly edgeRef: Int32Array;
  /** Portal n's segment: portalXZ[4n … 4n + 3] = ax, az, bx, bz. */
  readonly portalXZ: Float64Array;
  private readonly portalList: readonly NavPortal[];
  private readonly linkList: readonly NavLinkInfo[];
  private readonly edgeList: readonly (readonly NavEdge[])[];
  private readonly bx0: number;
  private readonly bz0: number;
  private readonly bw: number;
  private readonly bh: number;
  private readonly buckets: readonly (readonly number[])[];

  /** @throws NavMeshError for data of another bake version or with out-of-range indices. */
  constructor(data: NavMeshData) {
    if (data.version !== NAV_BAKE_VERSION) {
      throw new NavMeshError(
        `navmesh "${data.id}" is bake version ${String(data.version)}; this build reads ${String(NAV_BAKE_VERSION)} (re-run pnpm nav:bake)`,
      );
    }
    this.id = data.id;
    this.data = data;
    this.doors = data.doors;
    const n = data.polys.length;
    this.polyCount = n;
    const cs = data.settings.cellSize;
    const [ox, oz] = data.origin;
    this.x0 = new Float64Array(n);
    this.z0 = new Float64Array(n);
    this.x1 = new Float64Array(n);
    this.z1 = new Float64Array(n);
    this.pa = new Float64Array(n);
    this.pgx = new Float64Array(n);
    this.pgz = new Float64Array(n);
    this.area = new Uint8Array(n);
    this.door = new Int32Array(n);
    const poly = (p: number, what: string) => {
      if (!Number.isInteger(p) || p < 0 || p >= n) {
        throw new NavMeshError(
          `navmesh "${data.id}": ${what} names polygon ${String(p)} of ${String(n)}`,
        );
      }
      return p;
    };
    data.polys.forEach(([i0, k0, i1, k1, a, gx, gz, area, door], p) => {
      if (NAV_AREA_NAMES[area] === undefined) {
        throw new NavMeshError(
          `navmesh "${data.id}": polygon ${String(p)} has unknown area ${String(area)}`,
        );
      }
      if (door < -1 || door >= data.doors.length) {
        throw new NavMeshError(
          `navmesh "${data.id}": polygon ${String(p)} names door ${String(door)}`,
        );
      }
      this.x0[p] = ox + i0 * cs;
      this.z0[p] = oz + k0 * cs;
      this.x1[p] = ox + i1 * cs;
      this.z1[p] = oz + k1 * cs;
      this.pa[p] = a;
      this.pgx[p] = gx;
      this.pgz[p] = gz;
      this.area[p] = area;
      this.door[p] = door;
    });
    const edges: NavEdge[][] = Array.from({ length: n }, () => []);
    this.portalList = data.portals.map(([a, b, i0, k0, i1, k1], index) => {
      poly(a, `portal ${String(index)}`);
      poly(b, `portal ${String(index)}`);
      at(edges, a).push({ to: b, index, via: 'portal' });
      at(edges, b).push({ to: a, index, via: 'portal' });
      return Object.freeze({
        a,
        b,
        ax: ox + i0 * cs,
        az: oz + k0 * cs,
        bx: ox + i1 * cs,
        bz: oz + k1 * cs,
      });
    });
    this.linkList = data.links.map(([kind, from, to, ax, ay, az, bx, by, bz, measure], index) => {
      const name = NAV_LINK_KIND_NAMES[kind];
      if (name === undefined) {
        throw new NavMeshError(
          `navmesh "${data.id}": link ${String(index)} has unknown kind ${String(kind)}`,
        );
      }
      poly(from, `link ${String(index)}`);
      poly(to, `link ${String(index)}`);
      at(edges, from).push({ to, index, via: 'link' });
      return Object.freeze({
        kind: name,
        from,
        to,
        a: vec(ax, ay, az),
        b: vec(bx, by, bz),
        measure,
      });
    });
    this.edgeList = edges;
    this.edgeStart = new Int32Array(n + 1);
    const flat = edges.flat();
    this.edgeTo = Int32Array.from(flat, (e) => e.to);
    this.edgeRef = Int32Array.from(flat, (e) => (e.via === 'portal' ? e.index : -e.index - 2));
    edges.forEach((list, p) => {
      this.edgeStart[p + 1] = at(this.edgeStart, p) + list.length;
    });
    this.portalXZ = Float64Array.from(this.portalList.flatMap((q) => [q.ax, q.az, q.bx, q.bz]));
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let p = 0; p < n; p++) {
      minX = Math.min(minX, at(this.x0, p));
      minZ = Math.min(minZ, at(this.z0, p));
      maxX = Math.max(maxX, at(this.x1, p));
      maxZ = Math.max(maxZ, at(this.z1, p));
    }
    this.bx0 = n === 0 ? 0 : minX;
    this.bz0 = n === 0 ? 0 : minZ;
    this.bw = n === 0 ? 0 : Math.floor((maxX - minX) / BUCKET) + 1;
    this.bh = n === 0 ? 0 : Math.floor((maxZ - minZ) / BUCKET) + 1;
    const buckets: number[][] = Array.from({ length: this.bw * this.bh }, () => []);
    for (let p = 0; p < n; p++) {
      const [ia, ib] = this.bucketRange(at(this.x0, p), at(this.x1, p), this.bx0, this.bw);
      const [ka, kb] = this.bucketRange(at(this.z0, p), at(this.z1, p), this.bz0, this.bh);
      for (let k = ka; k <= kb; k++)
        for (let i = ia; i <= ib; i++) at(buckets, k * this.bw + i).push(p);
    }
    this.buckets = buckets;
  }

  private bucketRange(lo: number, hi: number, origin: number, count: number) {
    const a = Math.max(0, Math.floor((lo - EPS - origin) / BUCKET));
    const b = Math.min(count - 1, Math.floor((hi + EPS - origin) / BUCKET));
    return [a, b] as const;
  }

  /** Polygons whose bucket overlaps the box (x ± r, z ± r), ascending, without repeats. */
  private candidates(x: number, z: number, r: number): readonly number[] {
    if (this.polyCount === 0) return [];
    const [ia, ib] = this.bucketRange(x - r, x + r, this.bx0, this.bw);
    const [ka, kb] = this.bucketRange(z - r, z + r, this.bz0, this.bh);
    if (ia === ib && ka === kb) return at(this.buckets, ka * this.bw + ia);
    const seen = new Set<number>();
    for (let k = ka; k <= kb; k++) {
      for (let i = ia; i <= ib; i++) for (const p of at(this.buckets, k * this.bw + i)) seen.add(p);
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** Surface height of polygon p at (x, z), metres. */
  heightAt(p: number, x: number, z: number): number {
    return at(this.pa, p) + at(this.pgx, p) * x + at(this.pgz, p) * z;
  }

  /** Polygon p's nav area. */
  areaOf(p: number): NavAreaName {
    return at(NAV_AREA_NAMES, at(this.area, p));
  }

  /** The door polygon p lies under (its spawn id), or undefined. */
  doorOf(p: number): string | undefined {
    const d = at(this.door, p);
    return d < 0 ? undefined : this.doors[d];
  }

  /** Polygon p's footprint: [x0, z0, x1, z1], metres. */
  boundsOf(p: number): readonly [number, number, number, number] {
    return [at(this.x0, p), at(this.z0, p), at(this.x1, p), at(this.z1, p)];
  }

  /** The centre of polygon p's footprint, on its surface. */
  centreOf(p: number): Vec3 {
    const x = (at(this.x0, p) + at(this.x1, p)) / 2;
    const z = (at(this.z0, p) + at(this.z1, p)) / 2;
    return vec(x, this.heightAt(p, x, z), z);
  }

  /** Whether (x, z) is inside polygon p's footprint (edges included, within `eps`). */
  contains(p: number, x: number, z: number, eps = EPS): boolean {
    return (
      x >= at(this.x0, p) - eps &&
      x <= at(this.x1, p) + eps &&
      z >= at(this.z0, p) - eps &&
      z <= at(this.z1, p) + eps
    );
  }

  /** Ways out of polygon p, portals first then links, in data order. */
  edgesOf(p: number): readonly NavEdge[] {
    return at(this.edgeList, p);
  }

  portal(index: number): NavPortal {
    return at(this.portalList, index);
  }

  link(index: number): NavLinkInfo {
    return at(this.linkList, index);
  }

  get portalCount(): number {
    return this.portalList.length;
  }

  get linkCount(): number {
    return this.linkList.length;
  }

  /**
   * The polygon under `point`: one whose footprint contains it and whose surface is at most `above`
   * metres above it and `below` metres below it; the closest surface wins, then the lower index.
   * −1 when there is none.
   */
  locate(point: Vec3, above = 0.5, below = 1): number {
    let best = -1;
    let bestDy = Infinity;
    for (const p of this.candidates(point.x, point.z, 0)) {
      if (!this.contains(p, point.x, point.z)) continue;
      const dy = this.heightAt(p, point.x, point.z) - point.y;
      if (dy > above + EPS || -dy > below + EPS) continue;
      if (Math.abs(dy) < bestDy - EPS) {
        best = p;
        bestDy = Math.abs(dy);
      }
    }
    return best;
  }

  /**
   * The closest point on the mesh to `point` within `reach` metres horizontally whose surface is
   * within `rise` metres vertically (closest in 3D, then lower index), or undefined.
   */
  nearest(
    point: Vec3,
    reach: number,
    rise: number,
    accept?: (p: number) => boolean,
  ): NavPoint | undefined {
    let best: NavPoint | undefined;
    let bestD = Infinity;
    for (const p of this.candidates(point.x, point.z, reach)) {
      if (accept !== undefined && !accept(p)) continue;
      const x = Math.min(Math.max(point.x, at(this.x0, p)), at(this.x1, p));
      const z = Math.min(Math.max(point.z, at(this.z0, p)), at(this.z1, p));
      const y = this.heightAt(p, x, z);
      const h = (x - point.x) ** 2 + (z - point.z) ** 2;
      if (h > reach * reach + EPS || Math.abs(y - point.y) > rise + EPS) continue;
      const d = h + (y - point.y) ** 2;
      if (d < bestD - EPS) {
        bestD = d;
        best = Object.freeze({ x, y, z, poly: p });
      }
    }
    return best;
  }

  /** Whether `point` is on the mesh: inside a footprint, within `tolerance` metres of its surface. */
  isOnMesh(point: Vec3, tolerance = 0.05): boolean {
    return this.locate(point, tolerance, tolerance) >= 0;
  }
}
