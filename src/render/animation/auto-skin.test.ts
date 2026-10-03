import { describe, expect, it } from 'vitest';
import { autoSkin, restSegments, SKIN_INFLUENCES, type BoneSegment } from './auto-skin';
import { compileRig } from './library';
import { parseGraph, TEST_GRAPH } from './fixtures';

const LEG: BoneSegment = { head: [0, 1, 0], tail: [0, 0, 0] };
const ARM: BoneSegment = { head: [0, 1.5, 0], tail: [0.5, 1.5, 0] };

/** The weight a vertex gives `bone`, 0 when it is not among the kept influences. */
function weightOf(skin: ReturnType<typeof autoSkin>, vertex: number, bone: number): number {
  for (let i = 0; i < SKIN_INFLUENCES; i++) {
    if (skin.indices[vertex * SKIN_INFLUENCES + i] === bone) {
      return skin.weights[vertex * SKIN_INFLUENCES + i] ?? 0;
    }
  }
  return 0;
}

describe('restSegments', () => {
  it('runs each bone from its joint to the far end of its shape, in rest space', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const segments = restSegments(rig);
    expect(segments).toHaveLength(rig.bones.length);
    // root is at [0, 1, 0]; legs hang 0.5 below it, arms rise 0.5 above it.
    expect(segments[0]?.head).toEqual([0, 1, 0]);
    expect(segments[1]?.head).toEqual([0, 0.5, 0]);
    expect(segments[2]?.head).toEqual([0, 1.5, 0]);
  });

  it('makes a bone without a shape a point at its joint', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const segments = restSegments(rig);
    const shapeless = rig.defs.findIndex((d) => d.shape === undefined);
    expect(shapeless).toBeGreaterThanOrEqual(0);
    expect(segments[shapeless]?.tail).toEqual(segments[shapeless]?.head);
  });
});

describe('autoSkin', () => {
  it('binds a vertex mostly to the bone whose segment it sits on', () => {
    const skin = autoSkin([0.02, 0.5, 0, 0.3, 1.5, 0.01], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(0.95);
    expect(weightOf(skin, 1, 1)).toBeGreaterThan(0.95);
  });

  it('blends the two bones at a joint between them', () => {
    const skin = autoSkin([0.0, 1.25, 0], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeCloseTo(weightOf(skin, 0, 1), 1);
  });

  it('keeps at most four influences and normalises their weights to 1', () => {
    const bones: BoneSegment[] = Array.from({ length: 7 }, (_, i) => ({
      head: [i * 0.1, 0, 0],
      tail: [i * 0.1, 1, 0],
    }));
    const skin = autoSkin([0.2, 0.4, 0.1, 0.5, 0.9, 0.3], bones);
    expect(skin.indices).toHaveLength(2 * SKIN_INFLUENCES);
    for (let v = 0; v < 2; v++) {
      let sum = 0;
      for (let i = 0; i < SKIN_INFLUENCES; i++) sum += skin.weights[v * SKIN_INFLUENCES + i] ?? 0;
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('handles a zero-length segment and a vertex sitting exactly on a bone', () => {
    const point: BoneSegment = { head: [1, 1, 1], tail: [1, 1, 1] };
    const skin = autoSkin([1, 1, 1], [point, LEG]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(0.99);
    expect(Number.isFinite(skin.weights[0])).toBe(true);
  });

  it('clamps to the segment ends rather than extending the bone to infinity', () => {
    // 5 m below the leg's foot: the arm (1.5 m up) is nearer in a straight line to nothing, so the
    // leg's tail end is the closest point and still dominates.
    const skin = autoSkin([0, -5, 0], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(weightOf(skin, 0, 1));
  });
});
