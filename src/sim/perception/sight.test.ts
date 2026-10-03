// Sight's cone test and sighting strength (mw-e11.5), as pure functions of sampled values.
import { describe, expect, it } from 'vitest';
import { cos, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import { anomalySource, clamp01, entitySource, percept, soundSource } from './percept';
import { coneHit, pointDistance, rangeFalloff, sightPercept, type SightProfile } from './sight';
import { DEFAULT_PERCEPTION_TUNING as TUNING } from './tuning';

/** The humanoid profile's sight (primary 35°, range 20 m). */
const GUARD: SightProfile = {
  nearRange: 8,
  farRange: 20,
  primaryHalfAngle: 35,
  peripheralHalfAngle: 80,
  verticalHalfAngle: 40,
  darkVision: 0.2,
  detectionSpeed: 1,
};
/** awareness ≥ 0.3 makes an Unaware creature Suspicious (behaviour tuning `suspiciousAt`). */
const SUSPICIOUS_AT = 0.3;

const EYE: Vec3 = { x: 0, y: 1.6, z: 0 };
const NORTH: Vec3 = { x: 0, y: 0, z: 1 };
const DEG = Math.PI / 180;

/** A point `metres` away at eye height, `degrees` off the +z facing (toward +x). */
const off = (metres: number, degrees: number, dy = 0): Vec3 => ({
  x: metres * sin(degrees * DEG),
  y: EYE.y + dy,
  z: metres * cos(degrees * DEG),
});

function seen(point: Vec3, visibility: number, inSight = 1) {
  const cone = coneHit(GUARD, EYE, NORTH, point);
  if (cone === undefined) return undefined;
  return sightPercept(
    GUARD,
    'seen-target',
    { source: entitySource(7), position: point, cone, visibility, inSight },
    TUNING,
  );
}

describe('sight cones (mw-e11.5)', () => {
  it('AC-1: a fully visible target 10 m away and 20° off-axis is seen with strength > 0.5', () => {
    const target = off(10, 20);
    expect(coneHit(GUARD, EYE, NORTH, target)?.zone).toBe('primary');
    expect(coneHit(GUARD, EYE, NORTH, target)?.distance).toBeCloseTo(10, 9);
    const percept = seen(target, 1);
    expect(percept).toMatchObject({
      source: 'entity:7',
      kind: 'seen-target',
      sense: 'sight',
      certainty: 1,
    });
    expect(percept?.strength).toBeGreaterThan(0.5);
    expect(percept?.strength).toBeCloseTo(10 / 12, 9); // range falloff from 8 m to 20 m
  });

  it('AC-2: the same target 120° off-axis, outside the peripheral cone, is not seen', () => {
    expect(coneHit(GUARD, EYE, NORTH, off(10, 120))).toBeUndefined();
    expect(seen(off(10, 120), 1)).toBeUndefined();
    expect(coneHit(GUARD, EYE, NORTH, off(10, -120))).toBeUndefined();
  });

  it('AC-4: a target with visibility 0.1 at 15 m registers below the Suspicious threshold', () => {
    const percept = seen(off(15, 0), 0.1);
    expect(percept).toBeDefined();
    expect(percept?.strength).toBeLessThan(SUSPICIOUS_AT);
    expect(percept?.strength).toBeCloseTo(0.1 * (5 / 12), 9);
  });

  it('weighs the periphery down: half the strength and half the certainty', () => {
    const side = off(5, 60);
    expect(coneHit(GUARD, EYE, NORTH, side)?.zone).toBe('peripheral');
    expect(seen(side, 0.8, 0.5)).toMatchObject({ strength: 0.4, certainty: 0.25 });
  });

  it('sees nothing past far range, above or below the vertical limit, or at zero visibility', () => {
    expect(coneHit(GUARD, EYE, NORTH, off(20.01, 0))).toBeUndefined();
    expect(coneHit(GUARD, EYE, NORTH, off(20, 0))).toBeDefined();
    // 40° up or down: |dy| ≤ d · sin 40° (d the whole sight line: 10 m across and 8 up is 12.8 m).
    expect(coneHit(GUARD, EYE, NORTH, off(10, 0, 8))).toBeDefined();
    expect(coneHit(GUARD, EYE, NORTH, off(10, 0, 9))).toBeUndefined();
    expect(coneHit(GUARD, EYE, NORTH, off(10, 0, -9))).toBeUndefined();
    expect(seen(off(10, 0), 0)).toBeUndefined();
    // At far range the falloff is 0: in view, but nothing registers.
    expect(seen(off(20, 0), 1)).toBeUndefined();
  });

  it('treats a point straight above or below the eye, or a facing of zero length, as primary', () => {
    const owl: SightProfile = { ...GUARD, verticalHalfAngle: 90 };
    expect(coneHit(owl, EYE, NORTH, { x: 0, y: 5, z: 0 })).toEqual({
      zone: 'primary',
      distance: 3.4,
    });
    expect(coneHit(GUARD, EYE, NORTH, { x: 0, y: 5, z: 0 })).toBeUndefined();
    expect(coneHit(GUARD, EYE, NORTH, EYE)).toEqual({ zone: 'primary', distance: 0 });
    expect(coneHit(GUARD, EYE, { x: 0, y: 0, z: 0 }, off(5, 170))?.zone).toBe('primary');
    // The facing need not be unit length.
    expect(coneHit(GUARD, EYE, { x: 0, y: 0, z: 4 }, off(5, 30))?.zone).toBe('primary');
  });

  it('falls off linearly from near range to far range', () => {
    expect(rangeFalloff(GUARD, 0)).toBe(1);
    expect(rangeFalloff(GUARD, 8)).toBe(1);
    expect(rangeFalloff(GUARD, 14)).toBe(0.5);
    expect(rangeFalloff(GUARD, 20)).toBe(0);
    expect(rangeFalloff(GUARD, 30)).toBe(0);
    expect(pointDistance({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 })).toBe(5);
  });

  it('reports anomalies as seen-anomaly percepts', () => {
    const point = off(4, 0);
    const cone = coneHit(GUARD, EYE, NORTH, point);
    if (cone === undefined) throw new Error('in view');
    const percept = sightPercept(
      GUARD,
      'seen-anomaly',
      { source: entitySource(1), position: point, cone, visibility: 0.5, inSight: 1 },
      TUNING,
    );
    expect(percept).toMatchObject({ kind: 'seen-anomaly', strength: 0.5, certainty: 1 });
    expect(Object.isFrozen(percept)).toBe(true);
    expect(Object.isFrozen(percept?.position)).toBe(true);
  });

  it('freezes percepts with strength and certainty clamped to 0–1, under opaque source keys', () => {
    expect([clamp01(-0.5), clamp01(0.25), clamp01(3)]).toEqual([0, 0.25, 1]);
    const p = percept({
      source: anomalySource('door-3'),
      kind: 'seen-anomaly',
      sense: 'sight',
      position: EYE,
      strength: 1.5,
      certainty: -1,
    });
    expect(p).toMatchObject({ source: 'anomaly:door-3', strength: 1, certainty: 0 });
    expect(soundSource('throw')).toBe('sound:throw');
  });
});
