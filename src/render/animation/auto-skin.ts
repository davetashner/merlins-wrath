// Automatic skin weights for an unrigged character mesh (mw-e37.21): image-to-3D tools return a static
// mesh, but the animation runtime poses a rig by bone rotations alone. Each vertex is bound to the
// bones whose rest segments pass nearest it, weighted by inverse distance, so the mesh follows the
// grey-box rig's poses with no per-model skeleton. Pure maths (no Three.js): the render glue turns the
// result into skin attributes.

import type { Rig } from './library';

/** Influences per vertex (the glTF/Three.js skinning limit). */
export const SKIN_INFLUENCES = 4;

/** A bone's rest segment, in the rig's rest space (metres, origin at the feet). */
export interface BoneSegment {
  readonly head: readonly [number, number, number];
  readonly tail: readonly [number, number, number];
}

/** Skin attributes for a mesh: `SKIN_INFLUENCES` bone indices and weights per vertex. */
export interface SkinWeights {
  readonly indices: Uint16Array;
  readonly weights: Float32Array;
}

/**
 * The rest segment of every bone: from the bone's joint to the far end of its grey-box shape (the
 * shape's centre is half its extent from the joint). A bone without a shape is a point at its joint.
 */
export function restSegments(rig: Rig): BoneSegment[] {
  const heads: [number, number, number][] = [];
  return rig.defs.map((def, i) => {
    const parent = rig.parents[i] ?? -1;
    const base = parent < 0 ? undefined : heads[parent];
    const head: [number, number, number] = [
      (base?.[0] ?? 0) + def.offset[0],
      (base?.[1] ?? 0) + def.offset[1],
      (base?.[2] ?? 0) + def.offset[2],
    ];
    heads.push(head);
    const c = def.shape?.center ?? [0, 0, 0];
    return { head, tail: [head[0] + 2 * c[0], head[1] + 2 * c[1], head[2] + 2 * c[2]] };
  });
}

/** Squared distance from point (px, py, pz) to the segment `s`. */
function distanceSquared(s: BoneSegment, px: number, py: number, pz: number): number {
  const [hx, hy, hz] = s.head;
  const dx = s.tail[0] - hx;
  const dy = s.tail[1] - hy;
  const dz = s.tail[2] - hz;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t =
    len2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((px - hx) * dx + (py - hy) * dy + (pz - hz) * dz) / len2));
  const ex = px - (hx + t * dx);
  const ey = py - (hy + t * dy);
  const ez = pz - (hz + t * dz);
  return ex * ex + ey * ey + ez * ez;
}

/**
 * Binds each vertex of `positions` (x, y, z triples) to its nearest bones. Weights fall off as
 * 1 / distance⁴ so the nearest bone dominates and joints blend over a short span; the four nearest
 * bones are kept and their weights sum to 1. `bones` must be non-empty.
 */
export function autoSkin(positions: ArrayLike<number>, bones: readonly BoneSegment[]): SkinWeights {
  const count = Math.floor(positions.length / 3);
  const indices = new Uint16Array(count * SKIN_INFLUENCES);
  const weights = new Float32Array(count * SKIN_INFLUENCES);
  const eps = 1e-6;
  const scored: { bone: number; w: number }[] = [];
  for (let v = 0; v < count; v++) {
    const px = positions[v * 3] ?? 0;
    const py = positions[v * 3 + 1] ?? 0;
    const pz = positions[v * 3 + 2] ?? 0;
    scored.length = 0;
    bones.forEach((bone, b) => {
      const d2 = distanceSquared(bone, px, py, pz) + eps;
      scored.push({ bone: b, w: 1 / (d2 * d2) });
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, SKIN_INFLUENCES);
    const total = kept.reduce((sum, k) => sum + k.w, 0);
    kept.forEach((k, i) => {
      indices[v * SKIN_INFLUENCES + i] = k.bone;
      weights[v * SKIN_INFLUENCES + i] = k.w / total;
    });
  }
  return { indices, weights };
}
