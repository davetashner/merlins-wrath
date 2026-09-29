import { describe, expect, it } from 'vitest';
import { cos, sin } from '../math';
import {
  DEFAULT_FOCUS_SETTINGS,
  facing,
  focusScore,
  selectFocus,
  type ActorView,
  type FocusCandidate,
} from './focus';

const DEG = Math.PI / 180;
/** An actor at the origin facing −z (yaw 0). */
const VIEW: ActorView = { origin: { x: 0, y: 1, z: 0 }, yaw: 0 };

/** A point candidate `d` metres away at `deg` degrees to the right of −z, at reach height. */
function at(entity: number, d: number, deg: number, extra: Partial<FocusCandidate> = {}) {
  return {
    entity,
    center: { x: d * sin(deg * DEG), y: 1, z: -d * cos(deg * DEG) },
    radius: 0,
    ...extra,
  };
}

describe('focus scoring (mw-e02.5)', () => {
  it('faces −z at yaw 0 and turns left (−x) for positive yaw', () => {
    expect(facing(0)).toEqual({ x: 0, z: -1 });
    const left = facing(Math.PI / 2);
    expect(left.x).toBeCloseTo(-1, 12);
    expect(left.z).toBeCloseTo(0, 12);
  });

  it('AC-1: 1.0 m at 30° off-axis beats 2.0 m straight ahead, as documented, every run', () => {
    const near = at(2, 1, 30);
    const ahead = at(1, 2, 0);
    const expected = (d: number, deg: number) => 1 * (1 - d / 2.5) + 1 * cos(deg * DEG);
    const nearScore = focusScore(VIEW, near);
    const aheadScore = focusScore(VIEW, ahead);
    expect(nearScore).toBeCloseTo(expected(1, 30), 12);
    expect(aheadScore).toBeCloseTo(expected(2, 0), 12);
    const runs = [0, 1, 2].map(() => {
      const scored = [near, ahead].map((c) => ({ entity: c.entity, score: focusScore(VIEW, c) }));
      return selectFocus(
        scored.map((s) => ({ entity: s.entity, score: s.score ?? 0 })),
        null,
      );
    });
    expect(runs.map((r) => r?.entity)).toEqual([2, 2, 2]);
    expect(new Set(runs.map((r) => r?.score)).size).toBe(1);
  });

  it('rejects candidates beyond range (after the radius) or beyond 45°', () => {
    expect(focusScore(VIEW, at(1, 2.6, 0))).toBeUndefined();
    expect(focusScore(VIEW, at(1, 2.6, 0, { radius: 0.2 }))).toBeCloseTo(2 - 2.4 / 2.5, 12);
    expect(focusScore(VIEW, at(1, 3, 0, { range: 3 }))).toBeCloseTo(1, 12);
    expect(focusScore(VIEW, at(1, 1, 46))).toBeUndefined();
    expect(focusScore(VIEW, at(1, 1, 44))).toBeDefined();
    expect(focusScore(VIEW, at(1, 1, 180))).toBeUndefined();
  });

  it('measures the angle in the horizontal plane; straight above counts as ahead', () => {
    const above = { entity: 1, center: { x: 0, y: 2.5, z: 0 }, radius: 0 };
    expect(focusScore(VIEW, above)).toBeCloseTo(1 - 1.5 / 2.5 + 1, 12);
    const high = { entity: 1, center: { x: 0, y: 2, z: -1 }, radius: 0 };
    expect(focusScore(VIEW, high)).toBeCloseTo(1 - Math.SQRT2 / 2.5 + 1, 12);
    const inside = { entity: 1, center: { x: 0, y: 1, z: -0.2 }, radius: 0.5 };
    expect(focusScore(VIEW, inside)).toBeCloseTo(2, 12);
  });

  it('breaks equal scores by the lower entity id, whatever the order', () => {
    const a = { entity: 7, score: 1.5 };
    const b = { entity: 3, score: 1.5 };
    expect(selectFocus([a, b], null)?.entity).toBe(3);
    expect(selectFocus([b, a], null)?.entity).toBe(3);
    expect(selectFocus([], null)).toBeUndefined();
    expect(selectFocus([], 3)).toBeUndefined();
  });

  it('AC-3: keeps the current focus while a challenger scores within 10%', () => {
    const current = { entity: 1, score: 1.0 };
    expect(selectFocus([current, { entity: 2, score: 1.09 }], 1)?.entity).toBe(1);
    expect(selectFocus([{ entity: 2, score: 1.1 }, current], 1)?.entity).toBe(1);
    expect(selectFocus([current, { entity: 2, score: 1.11 }], 1)?.entity).toBe(2);
    // Without a current focus the best simply wins.
    expect(selectFocus([current, { entity: 2, score: 1.09 }], null)?.entity).toBe(2);
    // A current focus that is no longer a candidate is dropped.
    expect(selectFocus([{ entity: 2, score: 0.5 }], 1)?.entity).toBe(2);
    expect(DEFAULT_FOCUS_SETTINGS.hysteresis).toBe(0.1);
  });
});
