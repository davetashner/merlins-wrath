// Dynamic bodies on the Rapier port (mw-e03.10), below the physics-object layer: lifecycle, mass,
// material, impulses, sleep, impacts and snapshots.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { BodyDesc } from './bodies';
import { RapierPhysics } from './rapier';
import type { ColliderHandle } from './static-colliders';

const BALL: BodyDesc = {
  shape: { kind: 'sphere', radius: 0.5 },
  position: { x: 0, y: 3, z: 0 },
  mass: 2,
  friction: 0.5,
  restitution: 0,
};

function floorWorld() {
  const physics = new RapierPhysics(RAPIER);
  const floor = physics.add(box({ x: -5, y: -1, z: -5 }, { x: 5, y: 0, z: 5 }));
  return { physics, floor };
}

describe('Rapier dynamic bodies (mw-e03.10)', () => {
  it('adds a body that falls, lands with one impact and can be removed', () => {
    const { physics, floor } = floorWorld();
    const ball = physics.addBody(BALL);
    expect(physics.motionOf(ball)).toMatchObject({
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sleeping: false,
    });
    expect(physics.motionOf(ball).mass).toBeCloseTo(2);
    const impacts = [];
    for (let i = 0; i < 60; i++) {
      physics.step(1 / 60);
      impacts.push(...physics.impacts());
    }
    expect(impacts).toHaveLength(1);
    expect(new Set([impacts[0]?.a, impacts[0]?.b])).toEqual(new Set([floor, ball]));
    expect(impacts[0]?.speed).toBeGreaterThan(5);
    expect(physics.motionOf(ball).position.y).toBeCloseTo(0.5, 2);
    physics.remove(ball);
    expect(physics.count()).toBe(1);
    expect(() => physics.motionOf(ball)).toThrow(`collider ${String(ball)} is not a body`);
    physics.dispose();
  });

  it('applies impulses, sleeps on demand and changes mass and material', () => {
    const { physics, floor } = floorWorld();
    const ball = physics.addBody({ ...BALL, position: { x: 0, y: 0.5, z: 0 } });
    physics.sleep(ball);
    expect(physics.motionOf(ball).sleeping).toBe(true);
    physics.applyImpulse(ball, { x: 4, y: 0, z: 0 }); // 2 m/s on 2 kg, and it wakes
    expect(physics.motionOf(ball)).toMatchObject({ sleeping: false, linvel: { x: 2, y: 0, z: 0 } });
    physics.setMass(ball, 8);
    physics.setMaterial(ball, { friction: 0.9, restitution: 0.3 });
    physics.setMaterial(floor, { friction: 0.1, restitution: 0 });
    physics.step(1 / 60);
    expect(physics.motionOf(ball).mass).toBeCloseTo(8);
    expect(() => {
      physics.setMass(ball, 0);
    }).toThrow('body mass must be positive');
    expect(() => {
      physics.setMass(floor, 1);
    }).toThrow(`collider ${String(floor)} is not a body`);
    expect(() => {
      physics.setMaterial(99 as ColliderHandle, { friction: 0, restitution: 0 });
    }).toThrow('collider 99 is not in this port');
  });

  it('moves a body at once, stopped and awake (mw-e33.17), and knows its handles', () => {
    const { physics, floor } = floorWorld();
    const ball = physics.addBody({ ...BALL, velocity: { x: 3, y: 0, z: 0 } });
    expect([physics.has(floor), physics.has(ball), physics.has(99 as ColliderHandle)]).toEqual([
      true,
      true,
      false,
    ]);
    physics.sleep(ball);
    physics.moveBody(ball, { x: 2, y: 4, z: -1 });
    expect(physics.motionOf(ball)).toMatchObject({
      position: { x: 2, y: 4, z: -1 },
      linvel: { x: 0, y: 0, z: 0 },
      angvel: { x: 0, y: 0, z: 0 },
      sleeping: false,
    });
    expect(() => {
      physics.moveBody(ball, { x: Infinity, y: 0, z: 0 });
    }).toThrow('body position must be finite');
    expect(() => {
      physics.moveBody(ball, { x: 0, y: 0, z: NaN });
    }).toThrow(RangeError);
    expect(() => {
      physics.moveBody(floor, { x: 0, y: 0, z: 0 });
    }).toThrow(`collider ${String(floor)} is not a body`);
    physics.remove(ball);
    expect(physics.has(ball)).toBe(false);
  });

  it('restores bodies from a snapshot and goes on exactly as if never stopped', () => {
    const { physics } = floorWorld();
    const ball = physics.addBody({ ...BALL, velocity: { x: 1, y: 0, z: 0 } });
    const capsule = physics.addBody({
      ...BALL,
      shape: { kind: 'capsule', halfHeight: 0.3, radius: 0.2 },
      position: { x: 2, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
    });
    physics.add({
      ...box({ x: 3, y: 0, z: 3 }, { x: 4, y: 0.2, z: 4 }),
      velocity: { x: 0, y: 0, z: 1 },
    });
    for (let i = 0; i < 20; i++) physics.step(1 / 60);
    const saved = physics.snapshot();
    const copy = new RapierPhysics(RAPIER);
    copy.restore(saved);
    expect(copy.impacts()).toEqual([]);
    for (let i = 0; i < 40; i++) {
      physics.step(1 / 60);
      copy.step(1 / 60);
      expect(copy.impacts()).toEqual(physics.impacts());
    }
    expect(copy.motionOf(ball)).toEqual(physics.motionOf(ball));
    expect(copy.motionOf(capsule)).toEqual(physics.motionOf(capsule));
    expect(copy.snapshot()).toEqual(physics.snapshot());
  });

  it('refuses invalid bodies', () => {
    const { physics } = floorWorld();
    expect(() => physics.addBody({ ...BALL, mass: -1 })).toThrow('body mass must be positive');
    expect(physics.count()).toBe(1);
  });
});
