// The light field (mw-e03.15): how bright is it at any position, as a deterministic number the sim
// owns. Stealth (e09 visibility), light receivers and "navigating darkness" read it; the renderer's
// lighting is neither queryable nor deterministic, so the sim keeps its own model.
//
// Sources, gathered once per tick by `lightFieldSystem` (so a change shows on the next tick):
// - Emitters: every placed entity with a non-zero `lightEmitter` property (a lamp, a glowing
//   crystal), and every placed entity that is `burning` (it gives off the config's fire light, or
//   its own emission when brighter). Nothing registers by hand: a crate that catches fire starts
//   lighting its surroundings and stops when it goes out. A `LightCone` makes an emitter a spotlight.
// - Light stimuli: each `light` stimulus resolution (a flash spell) lights its shape for that tick.
// - Directional lights (moonlight, sun shafts) and ambient zones (a moonlit courtyard, a dark cellar)
//   come from the level through `setEnvironment`.
//
// Falloff (documented contract): an emitter of intensity I and radius R lights a position at
// distance d < R with (I / fullIntensity) × (1 − d / R)², and nothing at d ≥ R. So with the default
// fullIntensity of 100, a torch (100) gives 1 at its flame, 0.25 halfway out and 0 at its radius.
// A directional light gives its level wherever the path back towards it (its `reach`) is clear.
// The level at a position is ambient + every contribution, clamped to [0, 1].
//
// Occlusion: static level geometry (`statics`, fed by the scene loader like the physics sink) and
// opaque entities (`opaque` property; their bounding sphere, or a `LightOccluderBox`) block the
// straight path from a source to the position; a blocked source contributes 0. An emitter never
// blocks its own light. Static occlusion is baked lazily per source into a 1 m grid: for each
// cell a sample falls in, the source keeps the few static occluders that could lie between it and
// any point of the cell, so later samples there only test those. The cache only speeds things up —
// every answer is exact and depends only on the world, the level and the environment, never on
// what was sampled before. It is dropped when the level geometry changes or the emitter moves.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { cos } from '../math';
import { WorldProperties } from '../properties/components';
import type { LightEmission } from '../properties/spec';
import { PlacementComponent, type Placement } from '../stimulus/placement';
import { normalize, type Vec3 } from '../stimulus/shapes';
import type { StimulusResolution } from '../stimulus/stimulus';
import { LightConeComponent, LightOccluderComponent } from './components';
import {
  boxOccluder,
  segmentHits,
  segmentHitsSphere,
  StaticOccluders,
  type Occluder,
} from './occluders';

// Bound once: under Vitest, calls to another module's exports go through export getters, which
// would distort the AC-6 benchmark of the per-sample hot path.
const blocksSegment = segmentHits;
const blocksSegmentSphere = segmentHitsSphere;

/** Tuning of the light model (plain data). */
export interface LightConfig {
  /** Emitter intensity (sim light units) that fully lights its own position (level 1); > 0. */
  readonly fullIntensity: number;
  /** What a burning object gives off unless its own `lightEmitter` is brighter. */
  readonly fireLight: LightEmission;
  /** Ambient level wherever no ambient zone applies, [0, 1]. */
  readonly defaultAmbient: number;
}

/** The default light tuning: a torch (intensity 100) is full light at its flame. */
export const DEFAULT_LIGHT_CONFIG: LightConfig = Object.freeze({
  fullIntensity: 100,
  fireLight: Object.freeze({ intensity: 100, radius: 8 }),
  defaultAmbient: 0,
});

const finite = (n: number): boolean => Number.isFinite(n);
const unitRange = (n: number): boolean => n >= 0 && n <= 1;

function check(ok: boolean, problem: string): void {
  if (!ok) throw new RangeError(problem);
}

/** The full, validated config for `input` over DEFAULT_LIGHT_CONFIG. Throws a RangeError. */
export function resolveLightConfig(input: Partial<LightConfig> = {}): LightConfig {
  const config = { ...DEFAULT_LIGHT_CONFIG, ...input };
  check(
    config.fullIntensity > 0 && finite(config.fullIntensity),
    'light config fullIntensity must be a finite number > 0',
  );
  const { intensity, radius } = config.fireLight;
  check(
    intensity >= 0 && finite(intensity) && radius >= 0 && finite(radius),
    'light config fireLight intensity and radius must be finite numbers ≥ 0',
  );
  check(unitRange(config.defaultAmbient), 'light config defaultAmbient must be in [0, 1]');
  return Object.freeze({ ...config, fireLight: Object.freeze({ intensity, radius }) });
}

/** A box of the level with its own ambient light (a moonlit yard, an unlit cellar). */
export interface AmbientZone {
  readonly id: string;
  /** Inclusive bounds, metres; every max above its min. */
  readonly min: Vec3;
  readonly max: Vec3;
  /** Ambient level inside, [0, 1]. */
  readonly level: number;
}

/** Light from far away along one direction (moonlight, sun): parallel rays that walls shadow. */
export interface DirectionalLight {
  readonly id: string;
  /** The direction the light travels (non-zero; e.g. { x: 0, y: -1, z: 0 } straight down). */
  readonly direction: Vec3;
  /** Level where it reaches, [0, 1]. */
  readonly level: number;
  /** How far back towards the light a position must be clear to receive it, metres (> 0). */
  readonly reach: number;
}

/** The level's static lighting. Later ambient zones take precedence over earlier ones. */
export interface LightEnvironment {
  readonly ambientZones?: readonly AmbientZone[];
  readonly directional?: readonly DirectionalLight[];
}

/** Where one contribution came from. */
export type LightSource =
  | { readonly kind: 'emitter'; readonly entity: EntityId }
  | { readonly kind: 'stimulus'; readonly source: EntityId | null }
  | { readonly kind: 'directional'; readonly id: string };

/** One source's unoccluded share of the light at a position. */
export interface LightContribution {
  readonly source: LightSource;
  /** Its level before clamping (> 0). */
  readonly level: number;
}

/** The light at one position. */
export interface LightSample {
  /** ambient + every contribution, clamped to [0, 1]. */
  readonly level: number;
  /** The ambient level that applied. */
  readonly ambient: number;
  /** The ambient zone it came from, or null for the default. */
  readonly zone: string | null;
  /** Every source that reached the position, emitters by entity id, then stimuli, then directional. */
  readonly contributions: readonly LightContribution[];
}

/** An opaque entity this tick. */
interface DynamicOccluder {
  readonly entity: EntityId;
  /** Its box (a `LightOccluderBox`), or its bounding sphere's box when `sphere`. */
  readonly box: Occluder;
  readonly sphere: boolean;
  readonly center: Placement;
}

/** Most cells a source keeps in a dense array (a 40 m cube); larger reaches use a map. */
const MAX_DENSE_CELLS = 65_536;
/** Cell coordinates |x|, |z| below 2^20 and |y| below 2^10 pack into one exact integer map key. */
const XZ_LIMIT = 1_048_576;
const Y_LIMIT = 1024;

/**
 * Marks a cell that one occluder shadows completely. The points whose path from a source meets a
 * convex occluder's interior form a convex set (the occluder and the cone behind it; for a
 * directional light, the occluder swept back along the light), so when all eight corners of a cell
 * are in it, the whole cell is.
 */
const IN_SHADOW: readonly Occluder[] = Object.freeze([]);

/**
 * Whether `o` blocks the path to every corner of cell (ix, iy, iz). The path to a corner starts at
 * the source (cx, cy, cz), or, when `moving` (a directional light), at the corner shifted by the
 * source's offset from the cell centre.
 */
function shadowsCell(
  o: Occluder,
  ix: number,
  iy: number,
  iz: number,
  cx: number,
  cy: number,
  cz: number,
  moving: boolean,
): boolean {
  const ox = cx - ix - 0.5;
  const oy = cy - iy - 0.5;
  const oz = cz - iz - 0.5;
  for (let corner = 0; corner < 8; corner++) {
    const px = ix + (corner & 1);
    const py = iy + ((corner >> 1) & 1);
    const pz = iz + ((corner >> 2) & 1);
    const hit = moving
      ? blocksSegment(o, px + ox, py + oy, pz + oz, px, py, pz)
      : blocksSegment(o, cx, cy, cz, px, py, pz);
    if (!hit) return false;
  }
  return true;
}

/**
 * One source's baked static occlusion: the candidate occluders of each 1 m cell (cell (i, j, k)
 * spans [i, i + 1) × [j, j + 1) × [k, k + 1)). Cells inside the source's reach live in a dense
 * array; any others in a map. Cells too far out to key are not kept (recomputed per sample).
 */
class CellCache {
  private readonly dense: (readonly Occluder[] | undefined)[];
  private readonly sparse = new Map<number, readonly Occluder[]>();

  private constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly z0: number,
    private readonly nx: number,
    private readonly ny: number,
    private readonly nz: number,
  ) {
    this.dense = new Array<readonly Occluder[] | undefined>(nx * ny * nz).fill(undefined);
  }

  /** A cache for everything a light at (x, y, z) reaching `radius` metres can light. */
  static around(x: number, y: number, z: number, radius: number): CellCache {
    const x0 = Math.floor(x - radius);
    const y0 = Math.floor(y - radius);
    const z0 = Math.floor(z - radius);
    const nx = Math.floor(x + radius) - x0 + 1;
    const ny = Math.floor(y + radius) - y0 + 1;
    const nz = Math.floor(z + radius) - z0 + 1;
    return nx * ny * nz <= MAX_DENSE_CELLS
      ? new CellCache(x0, y0, z0, nx, ny, nz)
      : CellCache.unbounded();
  }

  /** A cache with no dense region (directional lights reach everywhere). */
  static unbounded(): CellCache {
    return new CellCache(0, 0, 0, 0, 0, 0);
  }

  private denseIndex(ix: number, iy: number, iz: number): number {
    const i = ix - this.x0;
    const j = iy - this.y0;
    const k = iz - this.z0;
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return (i * this.ny + j) * this.nz + k;
  }

  get(ix: number, iy: number, iz: number): readonly Occluder[] | undefined {
    const index = this.denseIndex(ix, iy, iz);
    return index >= 0 ? this.dense[index] : this.sparse.get(sparseKey(ix, iy, iz));
  }

  set(ix: number, iy: number, iz: number, candidates: readonly Occluder[]): void {
    const index = this.denseIndex(ix, iy, iz);
    if (index >= 0) {
      this.dense[index] = candidates;
      return;
    }
    const key = sparseKey(ix, iy, iz);
    if (key >= 0) this.sparse.set(key, candidates);
  }

  clear(): void {
    this.dense.fill(undefined);
    this.sparse.clear();
  }
}

/** The map key of cell (ix, iy, iz), or -1 outside the packable range. */
function sparseKey(ix: number, iy: number, iz: number): number {
  if (ix <= -XZ_LIMIT || ix >= XZ_LIMIT || iz <= -XZ_LIMIT || iz >= XZ_LIMIT) return -1;
  if (iy <= -Y_LIMIT || iy >= Y_LIMIT) return -1;
  return ((ix + XZ_LIMIT) * 2 * Y_LIMIT + (iy + Y_LIMIT)) * 2 * XZ_LIMIT + (iz + XZ_LIMIT);
}

/** A point or spot light this tick. */
interface Emitter {
  readonly source: LightSource;
  readonly entity: EntityId | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  /** radius². */
  readonly reach2: number;
  /** intensity / fullIntensity. */
  readonly scale: number;
  /** Unit axis and cos(half-angle) of a spotlight. */
  readonly cone:
    | { readonly x: number; readonly y: number; readonly z: number; readonly cos: number }
    | undefined;
  readonly cells: CellCache;
  /** Opaque entities that could stand between it and anything it reaches. */
  readonly occluders: readonly DynamicOccluder[];
}

interface Directional {
  readonly source: LightSource;
  /** Offset from a position back to the light: −direction × reach. */
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  readonly level: number;
  readonly cells: CellCache;
}

/**
 * How far a cell's candidate test grows occluders. A sample differs from its cell's centre by at
 * most 0.5 m per axis, so every point of its segment is within 0.5 m per axis of the matching point
 * of the centre's segment: an occluder that blocks the sample's path overlaps the centre's path
 * grown by 0.5 m. The extra millimetre absorbs rounding.
 */
const CELL_GROW = 0.501;

function checkVec(what: string, v: Vec3): void {
  check(finite(v.x) && finite(v.y) && finite(v.z), `${what} must have finite coordinates`);
}

function checkZone(zone: AmbientZone): AmbientZone {
  checkVec(`ambient zone "${zone.id}" min`, zone.min);
  checkVec(`ambient zone "${zone.id}" max`, zone.max);
  check(
    zone.max.x > zone.min.x && zone.max.y > zone.min.y && zone.max.z > zone.min.z,
    `ambient zone "${zone.id}" max must be above min on every axis`,
  );
  check(unitRange(zone.level), `ambient zone "${zone.id}" level must be in [0, 1]`);
  return Object.freeze({
    id: zone.id,
    min: Object.freeze({ ...zone.min }),
    max: Object.freeze({ ...zone.max }),
    level: zone.level,
  });
}

function toDirectional(light: DirectionalLight): Directional {
  checkVec(`directional light "${light.id}" direction`, light.direction);
  const unit = normalize(light.direction);
  if (unit === undefined) {
    throw new RangeError(`directional light "${light.id}" direction must not be zero`);
  }
  check(unitRange(light.level), `directional light "${light.id}" level must be in [0, 1]`);
  check(
    light.reach > 0 && finite(light.reach),
    `directional light "${light.id}" reach must be a finite number > 0`,
  );
  const { x, y, z } = unit;
  return {
    source: Object.freeze({ kind: 'directional', id: light.id }),
    bx: -x * light.reach,
    by: -y * light.reach,
    bz: -z * light.reach,
    level: light.level,
    cells: CellCache.unbounded(),
  };
}

/** Whether the open box (min, max) of `o` overlaps the box around (x, y, z) of half size `r`. */
function boxNear(o: Occluder, x: number, y: number, z: number, r: number): boolean {
  return (
    o.minX < x + r &&
    o.maxX > x - r &&
    o.minY < y + r &&
    o.maxY > y - r &&
    o.minZ < z + r &&
    o.maxZ > z - r
  );
}

/** Edge of the x/z buckets that index emitters by what they can reach, metres. */
const EMITTER_BUCKET = 8;
/** Bucket indices are clamped to ±16,383 (±131 km), so keys stay small integers. */
const EMITTER_BUCKET_LIMIT = 16_383;
const NO_EMITTERS: readonly Emitter[] = Object.freeze([]);

const emitterBucketIndex = (v: number): number => {
  const i = Math.floor(v / EMITTER_BUCKET);
  return i < -EMITTER_BUCKET_LIMIT
    ? -EMITTER_BUCKET_LIMIT
    : i > EMITTER_BUCKET_LIMIT
      ? EMITTER_BUCKET_LIMIT
      : i;
};
const emitterBucketKey = (i: number, k: number): number =>
  (i + EMITTER_BUCKET_LIMIT) * (2 * EMITTER_BUCKET_LIMIT + 1) + (k + EMITTER_BUCKET_LIMIT);

/** The key of the bucket containing (x, ·, z). */
function bucketOf(x: number, z: number): number {
  return emitterBucketKey(emitterBucketIndex(x), emitterBucketIndex(z));
}

/**
 * Each emitter listed under every bucket its reach overlaps, in emitter order, so a sample only
 * visits emitters that might reach it and still sums them in the documented order.
 */
function emitterBuckets(emitters: readonly Emitter[]): Map<number, Emitter[]> {
  const buckets = new Map<number, Emitter[]>();
  for (const e of emitters) {
    const i1 = emitterBucketIndex(e.x + e.radius);
    const k1 = emitterBucketIndex(e.z + e.radius);
    for (let i = emitterBucketIndex(e.x - e.radius); i <= i1; i++) {
      for (let k = emitterBucketIndex(e.z - e.radius); k <= k1; k++) {
        const key = emitterBucketKey(i, k);
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [e]);
        else list.push(e);
      }
    }
  }
  return buckets;
}

/**
 * Clips the open t-interval (lo, hi) by k·t < r; returns false when it becomes empty. k = 0 (always
 * +0 here) divides to +∞ and leaves the interval alone: `hullMeets` only runs after the bounding-box
 * test, which guarantees r > 0 whenever k = 0.
 */
function clipT(range: [number, number], k: number, r: number): boolean {
  if (k >= 0) range[1] = Math.min(range[1], r / k);
  else range[0] = Math.max(range[0], r / k);
  return range[0] < range[1];
}

/**
 * Whether `o`'s box meets the hull of point e and the 1 m cell centred on c, i.e. every segment
 * from e into the cell. The hull is the union over t ∈ [0, 1] of the cell scaled by t about e: a
 * cube centred on e + t·(c − e) with half-size t / 2. Per axis, overlap with the box is two linear
 * inequalities in t, so this is exact for boxes (a ramp is tested as its box). Half-sizes are grown
 * by a millimetre so rounding can only add candidates, never drop one.
 */
function hullMeets(
  o: Occluder,
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  const h = CELL_GROW;
  const t: [number, number] = [0, 1];
  return (
    clipT(t, cx - ex - h, o.maxX - ex) &&
    clipT(t, ex - cx - h, ex - o.minX) &&
    clipT(t, cy - ey - h, o.maxY - ey) &&
    clipT(t, ey - cy - h, ey - o.minY) &&
    clipT(t, cz - ez - h, o.maxZ - ez) &&
    clipT(t, ez - cz - h, ez - o.minZ)
  );
}

/** Whether any of `occluders` blocks the segment a → b. */
function anyHit(
  occluders: readonly Occluder[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  for (const occluder of occluders) {
    if (blocksSegment(occluder, ax, ay, az, bx, by, bz)) return true;
  }
  return false;
}

function dynamicBlocks(
  occluders: readonly DynamicOccluder[],
  self: EntityId | null,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  for (const o of occluders) {
    if (o.entity === self) continue;
    const hit = o.sphere
      ? blocksSegmentSphere(
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          o.center.x,
          o.center.y,
          o.center.z,
          o.center.radius,
        )
      : blocksSegment(o.box, ax, ay, az, bx, by, bz);
    if (hit) return true;
  }
  return false;
}

/** A light stimulus as an emitter (intensity, centre, reach, optional cone), or undefined. */
function stimulusEmitter(
  resolution: StimulusResolution,
): { at: Vec3; radius: number; cone?: { direction: Vec3; halfAngle: number } } | undefined {
  const { shape } = resolution.stimulus;
  switch (shape.kind) {
    case 'sphere':
      return { at: shape.center, radius: shape.radius };
    case 'cone':
      return {
        at: shape.apex,
        radius: shape.length,
        cone: { direction: shape.direction, halfAngle: shape.halfAngle },
      };
    case 'capsule': {
      const dx = shape.to.x - shape.from.x;
      const dy = shape.to.y - shape.from.y;
      const dz = shape.to.z - shape.from.z;
      return {
        at: {
          x: shape.from.x + dx / 2,
          y: shape.from.y + dy / 2,
          z: shape.from.z + dz / 2,
        },
        radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 + shape.radius,
      };
    }
    case 'box': {
      const { x, y, z } = shape.halfExtents;
      return { at: shape.center, radius: Math.sqrt(x * x + y * y + z * z) };
    }
    default:
      return undefined; // a point or a contact has no reach to light
  }
}

/** A cone's unit axis and cos(half-angle); cone directions are validated non-zero upstream. */
function spot(cone: { readonly direction: Vec3; readonly halfAngle: number }) {
  const { x, y, z } = cone.direction;
  const length = Math.sqrt(x * x + y * y + z * z);
  return { x: x / length, y: y / length, z: z / length, cos: cos(cone.halfAngle) };
}

/** An emitter entity's baked cells and the position and reach they were baked for. */
interface Baked {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly cells: CellCache;
}

/**
 * The sim's light model. Create one per level, hand `statics` to the scene loader (alongside
 * physics), install it with `installLightField` and add `lightFieldSystem` after `stimulusSystem`
 * and the element rules; then sample it with `levelAt` / `sample`.
 */
export class LightField {
  readonly config: LightConfig;
  /** The level's static light occluders; a `StaticColliderSink` for the scene loader. */
  readonly statics = new StaticOccluders();
  private zones: readonly AmbientZone[] = [];
  private directional: readonly Directional[] = [];
  private emitters: readonly Emitter[] = [];
  /** This tick's emitters by x/z bucket (see `emitterBuckets`). */
  private buckets = new Map<number, Emitter[]>();
  private occluders: readonly DynamicOccluder[] = [];
  /** Baked static occlusion per emitter entity, kept while it stays put. */
  private entityCells = new Map<EntityId, Baked>();
  private staticVersion: number;
  private pendingStimuli: StimulusResolution[] = [];
  /** The ambient level and zone of the last measurement. */
  private ambient = 0;
  private zone: string | null = null;

  constructor(config: Partial<LightConfig> = {}) {
    this.config = resolveLightConfig(config);
    this.staticVersion = this.statics.version;
  }

  /** Replaces the level's ambient zones and directional lights (validated; a RangeError). */
  setEnvironment(environment: LightEnvironment): void {
    const zones = (environment.ambientZones ?? []).map(checkZone);
    const directional = (environment.directional ?? []).map(toDirectional);
    this.zones = Object.freeze(zones);
    this.directional = Object.freeze(directional);
  }

  /** Queues a resolved stimulus; `update` turns this tick's light stimuli into emitters. */
  noteStimulus(resolution: StimulusResolution): void {
    if (resolution.stimulus.element === 'light') this.pendingStimuli.push(resolution);
  }

  /** Number of point and spot lights this tick (entities and light stimuli). */
  get emitterCount(): number {
    return this.emitters.length;
  }

  /** Drops every baked cell when the level geometry changed. */
  private syncStatics(): void {
    if (this.staticVersion === this.statics.version) return;
    this.staticVersion = this.statics.version;
    this.entityCells.clear();
    for (const light of this.emitters) light.cells.clear();
    for (const light of this.directional) light.cells.clear();
  }

  /**
   * Gathers this tick's emitters and opaque entities from `world` (which must have light components,
   * placements and world properties registered). `lightFieldSystem` calls it once per tick.
   */
  update(world: World<never>): void {
    this.syncStatics();
    const occluders: DynamicOccluder[] = [];
    world.query(PlacementComponent, WorldProperties.opaque).forEach((entity, at, opaque) => {
      if (!opaque) return;
      const shape = world.get(entity, LightOccluderComponent);
      const half = shape?.halfExtents ?? { x: at.radius, y: at.radius, z: at.radius };
      const box = boxOccluder(
        { x: at.x - half.x, y: at.y - half.y, z: at.z - half.z },
        { x: at.x + half.x, y: at.y + half.y, z: at.z + half.z },
      );
      occluders.push({ entity, box, sphere: shape === undefined, center: at });
    });
    this.occluders = occluders;

    const lit = new Map<EntityId, { at: Placement; intensity: number; radius: number }>();
    world.query(PlacementComponent, WorldProperties.lightEmitter).forEach((entity, at, light) => {
      lit.set(entity, { at, intensity: light.intensity, radius: light.radius });
    });
    const fire = this.config.fireLight;
    world.query(PlacementComponent, WorldProperties.burning).forEach((entity, at, burning) => {
      if (!burning) return;
      const own = lit.get(entity);
      lit.set(entity, {
        at,
        intensity: Math.max(own?.intensity ?? 0, fire.intensity),
        radius: Math.max(own?.radius ?? 0, fire.radius),
      });
    });

    const emitters: Emitter[] = [];
    const kept = new Map<EntityId, Baked>();
    for (const [entity, { at, intensity, radius }] of [...lit].sort(([a], [b]) => a - b)) {
      if (intensity === 0 || radius === 0) continue;
      const previous = this.entityCells.get(entity);
      const baked =
        previous?.x === at.x &&
        previous.y === at.y &&
        previous.z === at.z &&
        previous.radius === radius
          ? previous
          : {
              x: at.x,
              y: at.y,
              z: at.z,
              radius,
              cells: CellCache.around(at.x, at.y, at.z, radius),
            };
      kept.set(entity, baked);
      const cone = world.get(entity, LightConeComponent);
      emitters.push(
        this.emitter({ kind: 'emitter', entity }, entity, at, intensity, radius, cone, baked.cells),
      );
    }
    this.entityCells = kept;

    for (const resolution of this.pendingStimuli) {
      if (resolution.tick !== world.tick) continue;
      const light = stimulusEmitter(resolution);
      if (light === undefined) continue;
      emitters.push(
        this.emitter(
          { kind: 'stimulus', source: resolution.stimulus.source },
          null,
          light.at,
          resolution.stimulus.intensity,
          light.radius,
          light.cone,
          CellCache.around(light.at.x, light.at.y, light.at.z, light.radius),
        ),
      );
    }
    this.pendingStimuli = [];
    this.emitters = emitters;
    this.buckets = emitterBuckets(emitters);
  }

  private emitter(
    source: LightSource,
    entity: EntityId | null,
    at: Vec3,
    intensity: number,
    radius: number,
    cone: { readonly direction: Vec3; readonly halfAngle: number } | undefined,
    cells: CellCache,
  ): Emitter {
    return {
      source,
      entity,
      x: at.x,
      y: at.y,
      z: at.z,
      radius,
      reach2: radius * radius,
      scale: intensity / this.config.fullIntensity,
      cone: cone === undefined ? undefined : spot(cone),
      cells,
      occluders: this.occluders.filter((o) => boxNear(o.box, at.x, at.y, at.z, radius)),
    };
  }

  /** The light level at `position`, in [0, 1] (see the file header). Throws for non-finite input. */
  levelAt(position: Vec3): number {
    return this.measure(position, undefined);
  }

  /** The light at `position` with the ambient zone and every contribution. */
  sample(position: Vec3): LightSample {
    const contributions: LightContribution[] = [];
    const level = this.measure(position, contributions);
    return { level, ambient: this.ambient, zone: this.zone, contributions };
  }

  /** The level at `position`; leaves the ambient that applied in `ambient` and `zone`. */
  private measure(position: Vec3, out: LightContribution[] | undefined): number {
    checkVec('light sample position', position);
    this.syncStatics();
    const { x, y, z } = position;
    let zone: AmbientZone | undefined;
    for (const candidate of this.zones) {
      const { min, max } = candidate;
      if (x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z) {
        zone = candidate;
      }
    }
    const ambient = zone === undefined ? this.config.defaultAmbient : zone.level;
    this.ambient = ambient;
    this.zone = zone === undefined ? null : zone.id;
    let total = ambient;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    for (const e of this.buckets.get(bucketOf(x, z)) ?? NO_EMITTERS) {
      const dx = x - e.x;
      const dy = y - e.y;
      const dz = z - e.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= e.reach2) continue;
      const d = Math.sqrt(d2);
      if (
        e.cone !== undefined &&
        d > 0 &&
        dx * e.cone.x + dy * e.cone.y + dz * e.cone.z < e.cone.cos * d
      ) {
        continue;
      }
      const near = e.cells.get(ix, iy, iz) ?? this.bake(e.cells, ix, iy, iz, e.x, e.y, e.z, 0);
      if (near === IN_SHADOW || anyHit(near, e.x, e.y, e.z, x, y, z)) continue;
      if (e.occluders.length > 0 && dynamicBlocks(e.occluders, e.entity, e.x, e.y, e.z, x, y, z)) {
        continue;
      }
      const falloff = 1 - d / e.radius;
      const level = e.scale * falloff * falloff;
      total += level;
      out?.push({ source: e.source, level });
    }

    for (const light of this.directional) {
      if (light.level === 0) continue;
      const fx = x + light.bx;
      const fy = y + light.by;
      const fz = z + light.bz;
      const cx = ix + 0.5 + light.bx;
      const cy = iy + 0.5 + light.by;
      const cz = iz + 0.5 + light.bz;
      const near =
        light.cells.get(ix, iy, iz) ?? this.bake(light.cells, ix, iy, iz, cx, cy, cz, 0.5);
      if (near === IN_SHADOW || anyHit(near, fx, fy, fz, x, y, z)) continue;
      if (dynamicBlocks(this.occluders, null, fx, fy, fz, x, y, z)) continue;
      total += light.level;
      out?.push({ source: light.source, level: light.level });
    }

    return total >= 1 ? 1 : total;
  }

  /**
   * Bakes and returns the static candidates of cell (ix, iy, iz) for a source at c — fixed for an
   * emitter (`spread` 0) or, for a directional light, within `spread` (0.5) metres per axis of c
   * for every sample in the cell, since its source moves with the sample. Candidates are the
   * occluders any such path could meet, or IN_SHADOW when one of them blocks the whole cell.
   */
  private bake(
    cells: CellCache,
    ix: number,
    iy: number,
    iz: number,
    cx: number,
    cy: number,
    cz: number,
    spread: number,
  ): readonly Occluder[] {
    // Grown test against the centre's path, then the bounding box of the swept region.
    const lx = Math.min(ix, cx - spread);
    const ly = Math.min(iy, cy - spread);
    const lz = Math.min(iz, cz - spread);
    const hx = Math.max(ix + 1, cx + spread);
    const hy = Math.max(iy + 1, cy + spread);
    const hz = Math.max(iz + 1, cz + spread);
    const near = this.statics
      .along(cx, cy, cz, ix + 0.5, iy + 0.5, iz + 0.5, CELL_GROW)
      .filter(
        (o) =>
          o.minX < hx &&
          o.maxX > lx &&
          o.minY < hy &&
          o.maxY > ly &&
          o.minZ < hz &&
          o.maxZ > lz &&
          (spread > 0 || hullMeets(o, cx, cy, cz, ix + 0.5, iy + 0.5, iz + 0.5)),
      );
    const shadowed = near.some((o) => shadowsCell(o, ix, iy, iz, cx, cy, cz, spread > 0));
    const candidates = shadowed ? IN_SHADOW : near;
    cells.set(ix, iy, iz, candidates);
    return candidates;
  }
}
