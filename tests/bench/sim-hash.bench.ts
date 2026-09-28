// mw-e00.16 AC-4: hashing a world of 5,000 entities × 3 components takes ≤ 5 ms (mean) in Node.
// hashWorld covers the whole path a replay checkpoint pays: taking the (shared) snapshot, encoding
// it canonically and xxHash32-ing the bytes. Run with `pnpm bench`; CI runs it in the unit job.
import { describe, expect, test } from 'vitest';
import { defineComponent, hashWorld, World } from '@sim/index';

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
    world.add(e, Position, { x: i * 0.5, y: -i / 3 });
    world.add(e, Velocity, { x: 1.25, y: -1 });
    world.add(e, Heat, { t: 20.1 });
  }
  world.random('ai').nextU32();
  world.random('loot').nextU32();
  return world;
}

describe('sim state hash', () => {
  test('AC-4: hashWorld() with 5,000 entities × 3 components averages ≤ 5 ms', async ({
    bench,
  }) => {
    const world = buildWorld();
    const result = await bench('hashWorld()', () => {
      hashWorld(world);
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(5); // milliseconds
  });
});
