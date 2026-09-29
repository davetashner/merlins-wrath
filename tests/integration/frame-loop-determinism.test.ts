// mw-e00.20 AC-4: the display refresh rate never reaches the sim. The same per-tick inputs run for
// 600 ticks under a 144 Hz, a 60 Hz and a jittery display must end in identical sim state hashes.
import { createFrameLoop, FakeFrames } from '@game/loop/index';
import { defineComponent, hashWorld, World, type System } from '@sim/index';
import { describe, expect, it } from 'vitest';

interface Body {
  x: number;
  vx: number;
  hits: number;
}
const Body = defineComponent<Body>('Body');

/** A trivial opaque per-tick payload: a push to apply. */
type Push = number;

const TICKS = 600;

/** Inputs depend only on the tick, as recorded input would. */
const inputsFor = (tick: number): readonly Push[] =>
  tick % 7 === 0 ? [((tick * 37) % 11) - 5] : tick % 13 === 0 ? [1, -2] : [];

const physics: System<Push> = {
  name: 'bodies',
  run: ({ world, inputs }) => {
    const push = inputs.reduce((sum, p) => sum + p, 0);
    const rng = world.random('wind');
    world.query(Body).forEach((_id, body) => {
      body.vx = body.vx * 0.98 + push * 0.1 + (rng.float() - 0.5) * 0.01;
      body.x += body.vx / 60;
      if (Math.abs(body.x) > 5) {
        body.x = Math.sign(body.x) * 5;
        body.vx = -body.vx;
        body.hits++;
      }
    });
  },
};

function newWorld(): World<Push> {
  const world = new World<Push>({ seed: 0xbe11 }).register(Body).addSystem(physics);
  for (let i = 0; i < 3; i++) world.add(world.spawn(), Body, { x: i, vx: 0, hits: 0 });
  return world;
}

/** Runs frames of the given deltas (cycled) until the sim has stepped TICKS times. */
function runDisplay(deltas: readonly number[]): { hash: string; frames: number; tick: number } {
  const world = newWorld();
  const fake = new FakeFrames(500);
  const loop = createFrameLoop<Push>({
    sim: world,
    hz: world.clock.hz,
    now: fake.now,
    scheduler: fake,
    visibility: fake,
    sampleCommands: inputsFor,
    // Stop exactly at TICKS even when a frame would run several steps.
    onStep: (tick) => {
      if (tick === TICKS) loop.stop();
    },
  });
  loop.start();
  let frames = 0;
  while (loop.running) fake.frame(deltas[frames++ % deltas.length] ?? 0);
  return { hash: hashWorld(world), frames, tick: world.tick };
}

describe('frame loop determinism', () => {
  it('AC-4: 600 ticks on a 144 Hz and a 60 Hz display end in identical sim state hashes', () => {
    const at144 = runDisplay([1000 / 144]);
    const at60 = runDisplay([1000 / 60]);
    expect(at144.tick).toBe(TICKS);
    expect(at60.tick).toBe(TICKS);
    // Different numbers of rendered frames, same sim.
    expect(at144.frames).toBeGreaterThan(at60.frames * 2);
    expect(at144.hash).toBe(at60.hash);
  });

  it('AC-4: a jittery display with hitches (catch-up steps) ends in the same hash', () => {
    const at60 = runDisplay([1000 / 60]);
    const jittery = runDisplay([7, 9.5, 16.7, 33.4, 4.2, 60, 11]);
    expect(jittery.tick).toBe(TICKS);
    expect(jittery.hash).toBe(at60.hash);
  });
});
