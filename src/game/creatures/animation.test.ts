import { describe, expect, it } from 'vitest';
import { PlacementComponent, World, type EntityId } from '@sim/index';
import { creatureLocomotion, RUN_SPEED, SPEED_SMOOTHING, STAND_SPEED } from './animation';

function setup() {
  const world = new World<never>({ seed: 1 }).register(PlacementComponent);
  const entity = world.spawn();
  world.add(entity, PlacementComponent, { x: 0, y: 0, z: 0, radius: 0.4 });
  const read = creatureLocomotion(60);
  const moveTo = (e: EntityId, x: number, z: number) => {
    world.set(e, PlacementComponent, { x, y: 0, z, radius: 0.4 });
  };
  return { world, entity, read, moveTo };
}

describe('creature locomotion (mw-e37.402)', () => {
  it('stands at first sight and when it has not moved', () => {
    const s = setup();
    expect(s.read(s.world, s.entity)).toMatchObject({ speed: 0, state: 'idle', grounded: true });
    expect(s.read(s.world, s.entity)).toMatchObject({ speed: 0, state: 'idle' });
  });

  it('walks at a walking pace, smoothed, and runs when fast', () => {
    const s = setup();
    s.read(s.world, s.entity);
    // 0.03 m a step at 60 Hz = 1.8 m/s: the first read takes SPEED_SMOOTHING of it.
    s.moveTo(s.entity, 0.03, 0);
    const first = s.read(s.world, s.entity);
    expect(first?.speed).toBeCloseTo(1.8 * SPEED_SMOOTHING, 6);
    let x = 0.03;
    for (let i = 0; i < 30; i++) {
      x += 0.03;
      s.moveTo(s.entity, x, 0);
      s.read(s.world, s.entity);
    }
    expect(s.read(s.world, s.entity)).toMatchObject({ state: 'walk' });
    for (let i = 0; i < 60; i++) {
      x += 0.1;
      s.moveTo(s.entity, x, 0);
      s.read(s.world, s.entity);
    }
    const fast = s.read(s.world, s.entity);
    expect(fast?.speed).toBeGreaterThan(RUN_SPEED);
    expect(fast?.state).toBe('run');
  });

  it('returns to idle once it stops, and has nothing for an entity without a placement', () => {
    const s = setup();
    s.read(s.world, s.entity);
    s.moveTo(s.entity, 0.05, 0);
    s.read(s.world, s.entity);
    let last = s.read(s.world, s.entity);
    for (let i = 0; i < 40; i++) last = s.read(s.world, s.entity);
    expect(last?.speed).toBeLessThan(STAND_SPEED);
    expect(last?.state).toBe('idle');
    expect(s.read(s.world, s.world.spawn())).toBeUndefined();
  });
});
