// Stimulus shapes and their overlap maths (mw-e03.3). A stimulus reaches the world through a shape
// (point, sphere, cone, capsule/beam, box, contact); this module answers, for one shape and one
// target (an entity's bounding sphere, or an element-field cell centre with radius 0), whether they
// overlap and how strongly: the falloff, a factor in (0, 1]. Keeping that answer in one place means
// entities and the element field (mw-e03.4) see exactly the same fireball.
//
// Falloff (documented contract, see STIMULUS_EDGE_FALLOFF):
// - sphere, capsule: `linear` falls from 1 at the core (centre point / beam axis) to
//   STIMULUS_EDGE_FALLOFF at the rim, measured from the target's nearest surface point.
// - cone: `linear` falls from 1 at the apex to STIMULUS_EDGE_FALLOFF at `length`.
// - point, box, contact: uniform (1) — they have no core to fall off from.
// - `none` makes every shape uniform.
// Outside the shape the target receives nothing. Only + - * / and sqrt (IEEE-exact) are used, except
// the cone's half-angle, which goes through simMath.

import type { EntityId } from '../core/component';
import { cos, sin } from '../math';

/** A position or direction in world space, metres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A single point: hits targets whose bounding sphere contains it. */
export interface PointShape {
  readonly kind: 'point';
  readonly at: Vec3;
}
/** A ball around `center`. */
export interface SphereShape {
  readonly kind: 'sphere';
  readonly center: Vec3;
  /** Metres; 0 makes the stimulus a no-op. */
  readonly radius: number;
}
/** A cone from `apex` along `direction` (need not be unit length; must be non-zero). */
export interface ConeShape {
  readonly kind: 'cone';
  readonly apex: Vec3;
  readonly direction: Vec3;
  /** Reach along the axis, metres; 0 is a no-op. */
  readonly length: number;
  /** Half the opening angle, radians, in [0, π/2]; 0 is a no-op. */
  readonly halfAngle: number;
}
/** A capsule (beam, swing arc, breath line): every point within `radius` of the segment from→to. */
export interface CapsuleShape {
  readonly kind: 'capsule';
  readonly from: Vec3;
  readonly to: Vec3;
  /** Metres; 0 is a no-op. */
  readonly radius: number;
}
/** An axis-aligned box. */
export interface BoxShape {
  readonly kind: 'box';
  readonly center: Vec3;
  /** Half the size on each axis, metres; any 0 is a no-op. */
  readonly halfExtents: Vec3;
}
/** A direct hit on one entity (an arrow striking, a sword connecting), wherever it is. */
export interface ContactShape {
  readonly kind: 'contact';
  readonly target: EntityId;
}

/** Where a stimulus acts. */
export type StimulusShape =
  PointShape | SphereShape | ConeShape | CapsuleShape | BoxShape | ContactShape;

/** Every shape kind. */
export type StimulusShapeKind = StimulusShape['kind'];

/** How intensity falls off inside a shape (see the file header). */
export type StimulusFalloff = 'linear' | 'none';

/** The fraction of intensity that `linear` falloff still delivers at the shape's rim. */
export const STIMULUS_EDGE_FALLOFF = 0.25;

/** The zero vector. */
export const ORIGIN: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `v` scaled to unit length, or undefined for the zero vector. */
export function normalize(v: Vec3): Vec3 | undefined {
  const len = length(v);
  return len === 0 ? undefined : scale(v, 1 / len);
}

function checkFinite(what: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number`);
}
function checkVec(what: string, v: Vec3): Vec3 {
  checkFinite(`${what}.x`, v.x);
  checkFinite(`${what}.y`, v.y);
  checkFinite(`${what}.z`, v.z);
  return { x: v.x, y: v.y, z: v.z };
}
function checkSize(what: string, value: number): number {
  checkFinite(what, value);
  if (value < 0) throw new RangeError(`${what} must be ≥ 0, got ${String(value)}`);
  return value;
}

/**
 * A validated plain copy of `shape` (unknown fields dropped). Throws a RangeError for non-finite
 * numbers, negative sizes, a zero cone direction, a cone half-angle outside [0, π/2] or a contact
 * target that is not an entity id.
 */
export function normalizeShape(shape: StimulusShape): StimulusShape {
  switch (shape.kind) {
    case 'point':
      return { kind: 'point', at: checkVec('point.at', shape.at) };
    case 'sphere':
      return {
        kind: 'sphere',
        center: checkVec('sphere.center', shape.center),
        radius: checkSize('sphere.radius', shape.radius),
      };
    case 'cone': {
      const direction = checkVec('cone.direction', shape.direction);
      if (normalize(direction) === undefined) {
        throw new RangeError('cone.direction must be non-zero');
      }
      const halfAngle = checkSize('cone.halfAngle', shape.halfAngle);
      if (halfAngle > Math.PI / 2) {
        throw new RangeError(`cone.halfAngle must be ≤ π/2, got ${String(halfAngle)}`);
      }
      return {
        kind: 'cone',
        apex: checkVec('cone.apex', shape.apex),
        direction,
        length: checkSize('cone.length', shape.length),
        halfAngle,
      };
    }
    case 'capsule':
      return {
        kind: 'capsule',
        from: checkVec('capsule.from', shape.from),
        to: checkVec('capsule.to', shape.to),
        radius: checkSize('capsule.radius', shape.radius),
      };
    case 'box': {
      const halfExtents = checkVec('box.halfExtents', shape.halfExtents);
      checkSize('box.halfExtents.x', halfExtents.x);
      checkSize('box.halfExtents.y', halfExtents.y);
      checkSize('box.halfExtents.z', halfExtents.z);
      return { kind: 'box', center: checkVec('box.center', shape.center), halfExtents };
    }
    case 'contact':
      if (!Number.isSafeInteger(shape.target) || shape.target < 1) {
        throw new RangeError(`contact.target must be an entity id, got ${String(shape.target)}`);
      }
      return { kind: 'contact', target: shape.target };
  }
}

/** Whether a (valid) shape has zero size, so it can reach nothing: applying it is a no-op. */
export function isDegenerateShape(shape: StimulusShape): boolean {
  switch (shape.kind) {
    case 'sphere':
    case 'capsule':
      return shape.radius === 0;
    case 'cone':
      return shape.length === 0 || shape.halfAngle === 0;
    case 'box':
      return shape.halfExtents.x === 0 || shape.halfExtents.y === 0 || shape.halfExtents.z === 0;
    case 'point':
    case 'contact':
      return false;
  }
}

/** Falloff at normalised depth `u` ∈ [0, 1] (0 = core, 1 = rim). */
function fall(mode: StimulusFalloff, u: number): number {
  return mode === 'none' ? 1 : 1 - (1 - STIMULUS_EDGE_FALLOFF) * u;
}

/** Linear falloff by `gap` (target surface to core) against `reach`, or undefined past the rim. */
function reachFalloff(mode: StimulusFalloff, gap: number, reach: number): number | undefined {
  const depth = Math.max(0, gap);
  return depth > reach ? undefined : fall(mode, depth / reach);
}

function coneFalloff(
  shape: ConeShape,
  mode: StimulusFalloff,
  point: Vec3,
  radius: number,
): number | undefined {
  const axis = scale(shape.direction, 1 / length(shape.direction)); // validated non-zero
  const v = sub(point, shape.apex);
  const distance = length(v);
  const along = dot(v, axis);
  if (along > shape.length + radius) return undefined;
  // In the (along, across) half-plane the cone's side is a ray from the apex at halfAngle.
  const across = Math.sqrt(Math.max(0, distance * distance - along * along));
  const c = cos(shape.halfAngle);
  const s = sin(shape.halfAngle);
  const outside = across * c - along * s; // signed distance past the side line
  const pastApex = along * c + across * s < 0; // nearest point of the side is the apex itself
  const gap = outside <= 0 ? 0 : pastApex ? distance : outside;
  if (gap > radius) return undefined;
  return fall(mode, clamp(distance - radius, 0, shape.length) / shape.length);
}

/**
 * How strongly `shape` reaches a target sphere at `point` with `radius` (0 for a point target such
 * as a field cell centre): a falloff in (0, 1], or undefined when they don't overlap. Contact shapes
 * are not spatial and return undefined here (they hit their target directly). Degenerate shapes
 * reach nothing.
 */
export function shapeFalloff(
  shape: StimulusShape,
  mode: StimulusFalloff,
  point: Vec3,
  radius = 0,
): number | undefined {
  if (isDegenerateShape(shape)) return undefined;
  switch (shape.kind) {
    case 'point':
      return length(sub(point, shape.at)) <= radius ? 1 : undefined;
    case 'sphere':
      return reachFalloff(mode, length(sub(point, shape.center)) - radius, shape.radius);
    case 'cone':
      return coneFalloff(shape, mode, point, radius);
    case 'capsule': {
      const ab = sub(shape.to, shape.from);
      const span = dot(ab, ab);
      const t = span === 0 ? 0 : clamp(dot(sub(point, shape.from), ab) / span, 0, 1);
      const nearest = {
        x: shape.from.x + ab.x * t,
        y: shape.from.y + ab.y * t,
        z: shape.from.z + ab.z * t,
      };
      return reachFalloff(mode, length(sub(point, nearest)) - radius, shape.radius);
    }
    case 'box': {
      const { center: c, halfExtents: h } = shape;
      const nearest = {
        x: clamp(point.x, c.x - h.x, c.x + h.x),
        y: clamp(point.y, c.y - h.y, c.y + h.y),
        z: clamp(point.z, c.z - h.z, c.z + h.z),
      };
      return length(sub(point, nearest)) <= radius ? 1 : undefined;
    }
    case 'contact':
      return undefined;
  }
}

/**
 * The direction a shape pushes a target at `point` when a force stimulus gives none: away from the
 * centre for point, sphere and box (an explosion), along the axis for cone and capsule (a gust, a
 * beam). Unit length, or undefined when there is none (a target exactly at the centre, a contact).
 */
export function shapePush(shape: StimulusShape, point: Vec3): Vec3 | undefined {
  switch (shape.kind) {
    case 'point':
      return normalize(sub(point, shape.at));
    case 'sphere':
    case 'box':
      return normalize(sub(point, shape.center));
    case 'cone':
      return normalize(shape.direction);
    case 'capsule':
      return normalize(sub(shape.to, shape.from));
    case 'contact':
      return undefined;
  }
}

/** An axis-aligned bounding box. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

function around(center: Vec3, r: Vec3): Bounds {
  return {
    min: { x: center.x - r.x, y: center.y - r.y, z: center.z - r.z },
    max: { x: center.x + r.x, y: center.y + r.y, z: center.z + r.z },
  };
}

/**
 * A box enclosing everything `shape` can reach (conservative for cones), e.g. for the element field
 * to find the cells to test. Undefined for contact shapes, which have no spatial extent.
 */
export function shapeBounds(shape: StimulusShape): Bounds | undefined {
  switch (shape.kind) {
    case 'point':
      return around(shape.at, ORIGIN);
    case 'sphere':
      return around(shape.center, { x: shape.radius, y: shape.radius, z: shape.radius });
    case 'cone':
      return around(shape.apex, { x: shape.length, y: shape.length, z: shape.length });
    case 'capsule': {
      const { from: a, to: b, radius: r } = shape;
      return {
        min: { x: Math.min(a.x, b.x) - r, y: Math.min(a.y, b.y) - r, z: Math.min(a.z, b.z) - r },
        max: { x: Math.max(a.x, b.x) + r, y: Math.max(a.y, b.y) + r, z: Math.max(a.z, b.z) + r },
      };
    }
    case 'box':
      return around(shape.center, shape.halfExtents);
    case 'contact':
      return undefined;
  }
}
