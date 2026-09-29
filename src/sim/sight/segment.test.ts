import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import { segmentCrossesBox, segmentCrossesSphere, segmentEntersBox } from './segment';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const MIN = v(1, 0, -1);
const MAX = v(2, 1, 1);

describe('segmentCrossesBox (mw-e09.1)', () => {
  it('finds a segment passing through, starting inside or touching a face', () => {
    expect(segmentCrossesBox(v(0, 0.5, 0), v(3, 0.5, 0), MIN, MAX)).toBe(true);
    expect(segmentCrossesBox(v(1.5, 0.5, 0), v(1.6, 0.6, 0.1), MIN, MAX)).toBe(true);
    expect(segmentCrossesBox(v(0, 0.5, 0), v(1, 0.5, 0), MIN, MAX)).toBe(true);
    expect(segmentCrossesBox(v(3, 2, 0), v(0, -1, 0), MIN, MAX)).toBe(true);
  });

  it('misses a box beyond the segment, beside it or passed diagonally', () => {
    expect(segmentCrossesBox(v(0, 0.5, 0), v(0.9, 0.5, 0), MIN, MAX)).toBe(false);
    expect(segmentCrossesBox(v(0, 0.5, 5), v(3, 0.5, 5), MIN, MAX)).toBe(false);
    expect(segmentCrossesBox(v(0, 3, 0), v(3, 1.5, 0), MIN, MAX)).toBe(false);
  });
});

describe('segmentEntersBox (mw-e09.1)', () => {
  it('gives the fraction of the way to the entry point, 0 from inside, Infinity on a miss', () => {
    expect(segmentEntersBox(v(0, 0.5, 0), v(4, 0.5, 0), MIN, MAX)).toBe(0.25);
    expect(segmentEntersBox(v(1.5, 0.5, 0), v(4, 0.5, 0), MIN, MAX)).toBe(0);
    expect(segmentEntersBox(v(0, 0.5, 5), v(4, 0.5, 5), MIN, MAX)).toBe(Infinity);
  });
});

describe('segmentCrossesSphere (mw-e09.1)', () => {
  const C = v(5, 0, 0);
  it('finds a segment passing through or ending inside the ball', () => {
    expect(segmentCrossesSphere(v(0, 0.5, 0), v(10, 0.5, 0), C, 1)).toBe(true);
    expect(segmentCrossesSphere(v(0, 0, 0), v(4.5, 0, 0), C, 1)).toBe(true);
    expect(segmentCrossesSphere(v(5, 0.5, 0), v(5, 0.5, 0), C, 1)).toBe(true);
  });

  it('misses a ball beyond either end or off to the side', () => {
    expect(segmentCrossesSphere(v(0, 0, 0), v(3, 0, 0), C, 1)).toBe(false);
    expect(segmentCrossesSphere(v(10, 0, 0), v(7, 0, 0), C, 1)).toBe(false);
    expect(segmentCrossesSphere(v(0, 2, 0), v(10, 2, 0), C, 1)).toBe(false);
    expect(segmentCrossesSphere(v(0, 0, 0), v(0, 0, 0), C, 1)).toBe(false);
  });
});
