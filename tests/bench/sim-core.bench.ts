// mw-e00.15 AC-6: mean World.step() ≤ 1 ms with 5,000 entities × 3 components and 10 trivial
// systems, in Node. Run with `pnpm bench` (Vitest's dedicated benchmark project: one worker, no
// coverage); CI runs it in the unit job. Regression gating against a main baseline is mw-e32.2.
import { describe, expect, test } from 'vitest';
import { defineComponent, World } from '@sim/index';

interface Vec {
  x: number;
  y: number;
}
const Position = defineComponent<Vec>('Position');
const Velocity = defineComponent<Vec>('Velocity');
const Heat = defineComponent<{ t: number }>('Heat');

function buildWorld(): World {
  const world = new World({ seed: 1 }).register(Position, Velocity, Heat);
  for (let i = 0; i < 5000; i++) {
    const e = world.spawn();
    world.add(e, Position, { x: i, y: 0 });
    world.add(e, Velocity, { x: 1, y: -1 });
    world.add(e, Heat, { t: 20 });
  }
  const systems = [
    () => {
      world.query(Position, Velocity).forEach((_id, p, v) => {
        p.x += v.x;
        p.y += v.y;
      });
    },
    () => {
      world.query(Heat).forEach((_id, h) => {
        h.t *= 0.99;
      });
    },
    () => {
      world.query(Position, Heat).forEach((_id, p, h) => {
        h.t += p.x > 0 ? 0.01 : 0;
      });
    },
  ];
  for (let s = 0; s < 10; s++) {
    const run = systems[s % systems.length] ?? systems[0];
    world.addSystem({ name: `system-${String(s)}`, run: () => run?.() });
  }
  return world;
}

describe('sim core', () => {
  test('AC-6: step() with 5,000 entities × 3 components and 10 trivial systems averages ≤ 1 ms', async ({
    bench,
  }) => {
    const world = buildWorld();
    const result = await bench('World.step()', () => {
      world.step();
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(1); // milliseconds
  });
});
