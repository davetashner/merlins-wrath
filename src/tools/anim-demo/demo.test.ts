import { compileMoves, loadGameContent } from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  actionTimelineSystem,
  StaminaComponent,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  AnimDemoComponent,
  animDemoLocomotion,
  animDemoSystem,
  animDemoTransform,
  HIT_REACT_TICKS,
  IDLE_TICKS,
  MOVE_SPEED,
  MOVE_TICKS,
  spawnAnimDemo,
  type AnimDemoPhase,
} from './demo';

function demoWorld() {
  const world = new World({ seed: 1 }).register(
    AnimDemoComponent,
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
  );
  const moves = compileMoves(loadGameContent().all('move'));
  world.addSystem(animDemoSystem()).addSystem(actionTimelineSystem({ moves }));
  const entity = spawnAnimDemo(world, { at: { x: 1, y: 0, z: 2 }, attack: 'sword-light-1' });
  return { world, entity };
}

describe('animation demo characters', () => {
  it('loop idle → move → attack → hit-react through sim state', () => {
    const { world, entity } = demoWorld();
    const phases: [AnimDemoPhase, number][] = [];
    let acted = false;
    let locked = false;
    for (let i = 0; i < 600; i++) {
      world.step();
      const demo = world.get(entity, AnimDemoComponent);
      const timeline = world.get(entity, ActionTimelineComponent);
      if (demo === undefined || timeline === undefined) throw new Error('demo gone');
      if (phases.at(-1)?.[0] !== demo.phase) phases.push([demo.phase, world.tick]);
      acted ||= timeline.current?.move === 'sword-light-1';
      locked ||= timeline.lockTicks > 0 && demo.phase === 'hit-react';
    }
    expect(phases.slice(0, 5).map(([p]) => p)).toEqual([
      'idle',
      'move',
      'attack',
      'hit-react',
      'idle',
    ]);
    expect(phases[1]?.[1]).toBe(IDLE_TICKS);
    expect((phases[2]?.[1] ?? 0) - (phases[1]?.[1] ?? 0)).toBe(MOVE_TICKS + 1);
    // sword-light-1 lasts 34 ticks (seen ended on the tick after); the lock HIT_REACT_TICKS.
    expect((phases[3]?.[1] ?? 0) - (phases[2]?.[1] ?? 0)).toBe(35);
    expect((phases[4]?.[1] ?? 0) - (phases[3]?.[1] ?? 0)).toBe(HIT_REACT_TICKS);
    expect(acted && locked).toBe(true);
  });

  it('walks a circle back to its origin, reporting speed and turn rate while it moves', () => {
    const { world, entity } = demoWorld();
    for (let i = 0; i < IDLE_TICKS + 30; i++) world.step();
    expect(animDemoLocomotion(world, entity)).toEqual({
      speed: MOVE_SPEED,
      turnRate: expect.closeTo(Math.PI, 9) as number,
      grounded: true,
      state: 'walk',
    });
    const moving = animDemoTransform(world, entity);
    expect(moving?.position.x).not.toBe(1);
    for (let i = 0; i < MOVE_TICKS - 29; i++) world.step();
    const demo = world.get(entity, AnimDemoComponent);
    expect(demo?.position.x).toBeCloseTo(1, 1);
    expect(demo?.position.z).toBeCloseTo(2, 1);
    world.step();
    expect(animDemoTransform(world, entity)).toEqual({
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(animDemoLocomotion(world, entity)).toMatchObject({ speed: 0, state: 'idle' });
    const stranger = world.spawn();
    expect(animDemoTransform(world, stranger)).toBeUndefined();
    expect(animDemoLocomotion(world, stranger)).toBeUndefined();
  });
});
