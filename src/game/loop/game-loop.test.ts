import { defineComponent, World } from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { FakeFrames } from './fake-frames';
import { createGameLoop, droppedTimeLogger } from './game-loop';
import { IDENTITY_ROTATION, type SceneBinding } from './render-sync';

const X = defineComponent<number>('X');

function sources(fake: FakeFrames) {
  return { now: fake.now, scheduler: fake, visibility: fake };
}

describe('createGameLoop', () => {
  it('captures after each step, interpolates, then draws', () => {
    const world = new World<string>({ seed: 1 }).register(X);
    const id = world.spawn();
    world.add(id, X, 0);
    world.addSystem({
      name: 'move',
      run: ({ world: w }) => {
        w.set(id, X, (w.get(id, X) ?? 0) + 6);
      },
    });
    const fake = new FakeFrames();
    const draws: number[] = [];
    const { loop, sync } = createGameLoop({
      world,
      sources: sources(fake),
      draw: ({ steps }) => draws.push(steps),
      sampleCommands: () => ['go'],
    });
    const xs: number[] = [];
    const binding: SceneBinding<null> = {
      object: null,
      read: (view, e) => ({
        position: { x: view.get(e, X) ?? 0, y: 0, z: 0 },
        rotation: IDENTITY_ROTATION,
      }),
      apply: (_o, t) => xs.push(t.position.x),
      dispose: vi.fn(),
    };
    sync.bind(id, binding);
    loop.start();
    fake.frame(1.5 * (1000 / 60)); // one step (0 → 6), alpha 0.5
    expect(draws).toEqual([1]);
    expect(xs.at(-1)).toBeCloseTo(3, 10);
  });

  it('calls onStep after every step, once render sync has captured it', () => {
    const world = new World<string>({ seed: 1 });
    const fake = new FakeFrames();
    const order: string[] = [];
    const { loop, sync } = createGameLoop({
      world,
      sources: sources(fake),
      draw: () => order.push('draw'),
      onStep: (tick) => order.push(`step ${String(tick)}`),
    });
    const capture = vi.spyOn(sync, 'capture').mockImplementation(() => order.push('capture'));
    loop.start();
    fake.frame(2.5 * (1000 / 60));
    expect(order).toEqual(['capture', 'step 1', 'capture', 'step 2', 'draw']);
    capture.mockRestore();
  });

  it('passes the step cap and warning hook through', () => {
    const world = new World({ seed: 1 });
    const fake = new FakeFrames();
    const warn = vi.fn();
    const { loop } = createGameLoop({
      world,
      sources: sources(fake),
      draw: () => undefined,
      maxStepsPerFrame: 2,
      warn,
    });
    loop.start();
    fake.frame(100);
    expect(world.tick).toBe(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('AC-2: by default, dropped time is a console warning in dev builds', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const world = new World({ seed: 1 });
    const fake = new FakeFrames();
    const { loop } = createGameLoop({ world, sources: sources(fake), draw: () => undefined });
    loop.start();
    fake.frame(1000);
    expect(spy).toHaveBeenCalledOnce(); // Vitest runs as a dev build
    spy.mockRestore();
  });
});

describe('droppedTimeLogger', () => {
  it('AC-2: warns in dev builds and logs at debug level in production', () => {
    const logger = { warn: vi.fn(), debug: vi.fn() };
    droppedTimeLogger(true, logger)('dev hitch');
    droppedTimeLogger(false, logger)('prod hitch');
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('dev hitch');
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('prod hitch');
  });

  it('defaults to this build and the console', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    droppedTimeLogger()('hitch');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
