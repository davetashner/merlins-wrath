import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  LightConeComponent,
  lightComponents,
  LightOccluderComponent,
  setLightCone,
  setLightOccluderBox,
  toLightCone,
  toLightOccluderBox,
} from './components';

describe('light components', () => {
  it('normalises and freezes a cone; rejects bad ones', () => {
    const cone = toLightCone({ direction: { x: 0, y: -2, z: 0 }, halfAngle: 0.5 });
    expect(cone).toEqual({ direction: { x: 0, y: -1, z: 0 }, halfAngle: 0.5 });
    expect(Object.isFrozen(cone) && Object.isFrozen(cone.direction)).toBe(true);
    expect(toLightCone({ direction: { x: 1, y: 0, z: 0 }, halfAngle: Math.PI }).halfAngle).toBe(
      Math.PI,
    );
    const bad: unknown[] = [
      null,
      7,
      { halfAngle: 0.5 },
      { direction: { x: 0, y: 0, z: 0 }, halfAngle: 0.5 },
      { direction: { x: NaN, y: 1, z: 0 }, halfAngle: 0.5 },
      { direction: { x: 0, y: 1, z: '0' }, halfAngle: 0.5 },
      { direction: { x: 0, y: 1, z: 0 }, halfAngle: 0 },
      { direction: { x: 0, y: 1, z: 0 }, halfAngle: 4 },
      { direction: { x: 0, y: 1, z: 0 }, halfAngle: '1' },
    ];
    for (const value of bad) {
      expect(() => toLightCone(value), JSON.stringify(value)).toThrow(RangeError);
    }
  });

  it('validates occluder boxes', () => {
    expect(toLightOccluderBox({ halfExtents: { x: 1, y: 2, z: 0.1 } })).toEqual({
      halfExtents: { x: 1, y: 2, z: 0.1 },
    });
    for (const value of [
      undefined,
      { halfExtents: null },
      { halfExtents: { x: 1, y: 0, z: 1 } },
      { halfExtents: { x: -1, y: 1, z: 1 } },
      { halfExtents: { x: 1, y: 1, z: 0 } },
    ]) {
      expect(() => toLightOccluderBox(value), JSON.stringify(value)).toThrow(RangeError);
    }
  });

  it('set* add or replace the component and survive a snapshot round trip', () => {
    const world = new World<never>({ seed: 1 });
    world.register(...lightComponents);
    const e = world.spawn();
    setLightCone(world, e, { direction: { x: 0, y: 0, z: 3 }, halfAngle: 1 });
    setLightCone(world, e, { direction: { x: 0, y: 0, z: -3 }, halfAngle: 1 });
    setLightOccluderBox(world, e, { x: 1, y: 1, z: 1 });
    setLightOccluderBox(world, e, { x: 2, y: 1, z: 1 });
    expect(world.get(e, LightConeComponent)?.direction.z).toBe(-1);
    expect(world.get(e, LightOccluderComponent)?.halfExtents.x).toBe(2);
    const copy = new World<never>({ seed: 1 });
    copy.register(...lightComponents);
    copy.restore(world.snapshot());
    expect(copy.get(e, LightConeComponent)).toEqual(world.get(e, LightConeComponent));
    expect(copy.get(e, LightOccluderComponent)).toEqual(world.get(e, LightOccluderComponent));
  });
});
