// mw-e28.1 AC-7: main-thread audio update ≤ 0.5 ms per frame p95 with 48 positional voices on
// moving entities. Measured in Node against the fake context (tinybench reports p99, which is
// stricter than p95), so this gates the engine's own per-frame work; the in-browser cost of real
// AudioParam writes is budgeted on the reference machine by mw-e28.15 / the e32 perf suite.
import { describe, expect, test } from 'vitest';
import { AudioEngine, SoundRegistry, type Vec3 } from '@audio/index';
import { FakeAudioContext } from '@audio/fake-context';

const VOICES = 48;

async function buildEngine(): Promise<{ engine: AudioEngine; move: () => void }> {
  const positions: { x: number; y: number; z: number }[] = Array.from(
    { length: VOICES },
    (_, i) => ({
      x: i % 8,
      y: 0,
      z: Math.floor(i / 8),
    }),
  );
  const engine = new AudioEngine({
    registry: new SoundRegistry().register([
      {
        id: 'sfx-torch-loop',
        variants: ['sfx-torch-loop-01'],
        bus: 'sfx',
        spatial: true,
        loop: true,
      },
    ]),
    createContext: () => new FakeAudioContext(),
    fetchBytes: (url) =>
      url.endsWith('.json')
        ? Promise.reject(new Error('404'))
        : Promise.resolve(new ArrayBuffer(1)),
    resolveUrl: (id, ext) => `${id}.${ext}`,
    format: 'ogg',
    now: () => 0,
    entityPosition: (entity): Vec3 | undefined => positions[entity],
  });
  for (let entity = 0; entity < VOICES; entity++) engine.play('sfx-torch-loop', { entity });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let t = 0;
  const move = (): void => {
    t += 1 / 60;
    for (const p of positions) {
      p.x += 0.05;
      p.z -= 0.03;
    }
    engine.update({
      position: { x: t, y: 1.7, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    });
  };
  return { engine, move };
}

describe('audio engine', () => {
  test('AC-7: update() with 48 positional voices on moving entities stays ≤ 0.5 ms per frame p95', async ({
    bench,
  }) => {
    const { engine, move } = await buildEngine();
    expect(engine.stats().voices).toBe(VOICES);
    const result = await bench('AudioEngine.update()', move).run();
    expect(result.latency.p99).toBeLessThanOrEqual(0.5); // milliseconds
  });
});
