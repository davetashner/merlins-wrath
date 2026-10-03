// @vitest-environment happy-dom
// mw-e11.17 AC-4: the AI debug overlay on with 24 agents adds ≤ 2 ms frame time p95. Twenty-four
// frozen fixture guards (their behaviour content, AI running) patrol their own squares in a 6 × 4
// grid, two of them heard a noise and are investigating, and a noise rings every half second. Each
// measured frame is the overlay's whole per-frame work on a frame whose sim tick changed (the worst
// case: with a 60 Hz sim, every frame on a 60 Hz display): a fresh introspection snapshot of all 24
// agents (with the selected agent's full brain readout), the overlay model, and the drawing — pooled
// Three.js objects and the DOM labels (happy-dom, slower than a browser's DOM, so the measure is
// conservative). The sim step before each frame is not the overlay's cost and is not measured
// (tinybench's beforeEach). p95 is read from the retained samples, as in the other benches.
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { createAiOverlay } from '@render/debug/ai-overlay';
import {
  buildFactionTable,
  compileBehaviours,
  emitNoise,
  factionSpecFromDef,
  installAi,
  installFactions,
  registerCreatureComponents,
  spawnCreature,
  World,
  writeBlackboard,
  type EntityId,
} from '@sim/index';
import { AiDebug } from '@tools/ai-debug/controller';
import { PerspectiveCamera } from 'three';
import { describe, expect, test } from 'vitest';

const AGENTS = 24;

function build() {
  const content = loadFixtureContent();
  const creatures = compileCreatures(content.all('creature'), content);
  const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
  const world = installFactions(registerCreatureComponents(new World<never>({ seed: 17 })));
  installAi(world, { behaviours: compileBehaviours(content.all('behaviour')) });
  const guards: EntityId[] = [];
  for (let i = 0; i < AGENTS; i++) {
    const x = (i % 6) * 8 - 20;
    const z = -Math.floor(i / 6) * 8 - 6;
    const patrol = [
      { x, y: 0, z },
      { x: x + 4, y: 0, z },
      { x: x + 4, y: 0, z: z - 4 },
      { x, y: 0, z: z - 4 },
    ];
    const result = spawnCreature(
      world,
      { creatures, factions },
      { creature: 'fixture-guard', at: { x, y: 0, z }, patrol },
    );
    if (!result.ok) throw new Error(result.error.kind);
    guards.push(result.entity);
  }
  for (let t = 0; t < 600; t++) {
    if (t === 300) {
      for (const guard of guards.slice(0, 2)) {
        writeBlackboard(world, guard, { awareness: 0.7, stimulus: { x: 0, y: 0, z: -10 } });
      }
    }
    world.step();
  }
  const debug = new AiDebug({
    world,
    loop: { stepOnce: () => undefined },
    light: { levelAt: () => 0.5 },
    cursorPoint: () => ({ x: 0, y: 0, z: -10 }),
  });
  debug.enabled = true;
  for (let i = 0; i < 6; i++) {
    emitNoise(world, { position: { x: i * 3, y: 0, z: -12 }, loudness: 55, kind: 'pot' });
  }
  world.step();
  const layer = document.createElement('div');
  document.body.append(layer);
  const overlay = createAiOverlay({ labels: layer });
  overlay.enabled = true;
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 25, 15);
  camera.lookAt(0, 0, -16);
  debug.selected = guards[0];
  /** The next sim tick (not measured), with a noise every 30 ticks. */
  const tick = (): void => {
    if (world.tick % 30 === 0) {
      emitNoise(world, { position: { x: 0, y: 0, z: -12 }, loudness: 55, kind: 'pot' });
    }
    world.step();
  };
  /** One overlay frame (on a new tick: the snapshot is rebuilt). */
  const frame = (): void => {
    const drawn = debug.frame();
    if (drawn !== undefined) overlay.update(drawn.model, camera, 1920, 1080);
  };
  return { tick, frame, overlay, debug };
}

describe('ai debug overlay', () => {
  test('AC-4: the overlay on with 24 agents adds ≤ 2 ms frame time p95', async ({ bench }) => {
    const { tick, frame, overlay, debug } = build();
    frame();
    expect(overlay.stats()).toMatchObject({ agents: AGENTS, cones: AGENTS, noises: 6 });
    for (let i = 0; i < 500; i++) {
      tick();
      frame();
    }
    expect(overlay.stats().labels).toBeGreaterThan(0);
    const result = await bench(
      'ai debug overlay: 24 agents, snapshot + model + draw',
      { beforeEach: tick },
      frame,
    ).run({
      warmupIterations: 200,
      time: 1000,
      retainSamples: true,
    });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Infinity;
    console.info(
      `ai debug overlay: mean ${result.latency.mean.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms per frame over ${String(samples.length)} frames (${String(debug.builds)} snapshots)`,
    );
    expect(p95).toBeLessThanOrEqual(2); // milliseconds
  });
});
