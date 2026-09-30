import { describe, expect, it } from 'vitest';
import {
  ColliderFanOut,
  InMemoryColliderSink,
  type ColliderHandle,
  type StaticColliderDesc,
} from './static-colliders';

const box: StaticColliderDesc = {
  kind: 'box',
  min: { x: -1, y: 0, z: -1 },
  max: { x: 1, y: 1, z: 1 },
};
const ramp: StaticColliderDesc = {
  kind: 'ramp',
  min: { x: 0, y: 0, z: 0 },
  max: { x: 2, y: 1, z: 3 },
  rises: '+z',
};

describe('InMemoryColliderSink (mw-e00.21)', () => {
  it('adds colliders with distinct handles and counts them', () => {
    const sink = new InMemoryColliderSink();
    const a = sink.add(box);
    const b = sink.add(ramp);
    expect(a).not.toBe(b);
    expect(sink.count()).toBe(2);
    expect(sink.all()).toEqual([box, ramp]);
  });

  it('removes a collider by handle, and refuses an unknown or already removed one', () => {
    const sink = new InMemoryColliderSink();
    const a = sink.add(box);
    sink.add(ramp);
    expect(sink.has(a)).toBe(true);
    sink.remove(a);
    expect(sink.has(a)).toBe(false);
    expect(sink.count()).toBe(1);
    expect(sink.all()).toEqual([ramp]);
    expect(() => {
      sink.remove(a);
    }).toThrow(/not in this sink/);
    expect(() => {
      sink.remove(999 as ColliderHandle);
    }).toThrow(/collider 999/);
  });
});

describe('ColliderFanOut (mw-e03.42)', () => {
  it('adds to and removes from every sink under the primary handle', () => {
    const primary = new InMemoryColliderSink();
    const light = new InMemoryColliderSink();
    light.add(ramp); // the follower's handles differ from the primary's
    const fan = new ColliderFanOut(primary, light);
    const a = fan.add(box);
    const b = fan.add(ramp);
    expect([fan.count(), primary.count(), light.count()]).toEqual([2, 2, 3]);
    expect(fan.has(a) && primary.has(a)).toBe(true);
    fan.remove(a);
    expect(fan.has(a)).toBe(false);
    expect(primary.all()).toEqual([ramp]);
    expect(light.all()).toEqual([ramp, ramp]);
    fan.remove(b);
    expect([fan.count(), primary.count(), light.count()]).toEqual([0, 0, 1]);
    expect(() => {
      fan.remove(a);
    }).toThrow(/not in this sink/);
  });
});
