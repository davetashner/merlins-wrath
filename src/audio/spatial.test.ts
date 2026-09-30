import { describe, expect, it } from 'vitest';
import { FakeListener, FakePanner } from './fake-context.ts';
import {
  applyListener,
  configurePanner,
  DEFAULT_LISTENER,
  distance,
  inverseDistanceGain,
  listenerPose,
  rotate,
  setPannerPosition,
} from './spatial.ts';

describe('positional audio parameters', () => {
  it('inverse distance with a 2 m reference: unity inside 2 m, half at 4 m, 1/20 at 40 m', () => {
    expect(inverseDistanceGain(0)).toBe(1);
    expect(inverseDistanceGain(2)).toBe(1);
    expect(inverseDistanceGain(4)).toBe(0.5);
    expect(inverseDistanceGain(40)).toBe(0.05);
  });

  it('configures the panner per quality tier', () => {
    const panner = new FakePanner();
    configurePanner(panner, 'low');
    expect(panner).toMatchObject({
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 2,
      maxDistance: 40,
      rolloffFactor: 1,
    });
    configurePanner(panner, 'high');
    expect(panner.panningModel).toBe('HRTF');
    setPannerPosition(panner, { x: 1, y: 2, z: 3 });
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([
      1, 2, 3,
    ]);
  });

  it('measures euclidean distance', () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 })).toBe(13);
  });

  it('writes listener AudioParams when present', () => {
    const listener = new FakeListener(false);
    applyListener(listener, {
      position: { x: 1, y: 2, z: 3 },
      forward: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    });
    expect(listener.calls).toEqual([]);
    expect(
      [listener.positionX, listener.positionY, listener.positionZ].map((p) => p?.value),
    ).toEqual([1, 2, 3]);
    expect([listener.forwardX, listener.forwardY, listener.forwardZ].map((p) => p?.value)).toEqual([
      1, 0, 0,
    ]);
    expect([listener.upX, listener.upY, listener.upZ].map((p) => p?.value)).toEqual([0, 0, 1]);
  });

  it('falls back to the setters for any missing param group', () => {
    const noPosition = new FakeListener(false);
    delete noPosition.positionZ;
    applyListener(noPosition, DEFAULT_LISTENER);
    expect(noPosition.calls.map((c) => c.method)).toEqual(['setPosition']);

    for (const key of ['forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'] as const) {
      const listener = new FakeListener(false);
      Reflect.deleteProperty(listener, key);
      applyListener(listener, DEFAULT_LISTENER);
      expect(listener.calls.map((c) => c.method)).toEqual(['setOrientation']);
    }
    const positionless = ['positionX', 'positionY'] as const;
    for (const key of positionless) {
      const listener = new FakeListener(false);
      Reflect.deleteProperty(listener, key);
      applyListener(listener, DEFAULT_LISTENER);
      expect(listener.calls.map((c) => c.method)).toEqual(['setPosition']);
    }
  });
});

describe('listener pose from a camera (mw-e28.2)', () => {
  const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 9);
    expect(v.y).toBeCloseTo(y, 9);
    expect(v.z).toBeCloseTo(z, 9);
  };

  it('an unrotated camera looks down -z with +y up, at its position', () => {
    const pose = listenerPose({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(pose.position).toEqual({ x: 1, y: 2, z: 3 });
    close(pose.forward, 0, 0, -1);
    close(pose.up, 0, 1, 0);
  });

  it('a camera yawed 90° left looks down -x; pitched 90° down looks down -y', () => {
    const s = Math.SQRT1_2;
    const yaw = listenerPose({ x: 0, y: 0, z: 0 }, { x: 0, y: s, z: 0, w: s });
    close(yaw.forward, -1, 0, 0);
    close(yaw.up, 0, 1, 0);
    const pitch = { x: -s, y: 0, z: 0, w: s };
    close(rotate({ x: 0, y: 0, z: -1 }, pitch), 0, -1, 0);
    close(rotate({ x: 0, y: 1, z: 0 }, pitch), 0, 0, -1);
  });
});
