// mw-e11.2 AC-5: 50 agents running a patrol behaviour, headless: AI think cost p95 ≤ 1.0 ms per tick.
// Fifty frozen fixture guards (their behaviour content, spawned by the creature spawner) walk their
// own 6 m square in a 10 × 5 grid. Every 4 s of sim time a different fifth of them hears a noise, so
// the crowd keeps climbing to Investigating, walking to the noise and returning, not only patrolling.
// Measured as a whole World.step() with only the AI system attached (perception and navigation are
// later beads and have their own budgets). p95 is read from the retained samples, as in the other sim
// benches.
import { describe, expect, test } from 'vitest';
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  installAi,
  installFactions,
  registerCreatureComponents,
  spawnCreature,
  World,
  writeBlackboard,
  type EntityId,
} from '@sim/index';

const AGENTS = 50;

function buildWorld() {
  const content = loadFixtureContent();
  const creatures = compileCreatures(content.all('creature'), content);
  const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
  const world = installFactions(registerCreatureComponents(new World<never>({ seed: 11 })));
  installAi(world, { behaviours: compileBehaviours(content.all('behaviour')) });
  const guards: EntityId[] = [];
  for (let i = 0; i < AGENTS; i++) {
    const x = (i % 10) * 10;
    const z = Math.floor(i / 10) * 10;
    const patrol = [
      { x, y: 0, z },
      { x: x + 6, y: 0, z },
      { x: x + 6, y: 0, z: z + 6 },
      { x, y: 0, z: z + 6 },
    ];
    const result = spawnCreature(
      world,
      { creatures, factions },
      { creature: 'fixture-guard', at: { x, y: 0, z }, patrol },
    );
    if (!result.ok) throw new Error(result.error.kind);
    guards.push(result.entity);
  }
  /** One tick; every 240 ticks a fifth of the guards hears a noise 5 m off its square. */
  const tick = (): void => {
    const t = world.tick;
    if (t % 240 === 0) {
      const group = (t / 240) % 5;
      guards.forEach((guard, i) => {
        if (i % 5 !== group) return;
        const x = (i % 10) * 10 + 3;
        const z = Math.floor(i / 10) * 10 - 5;
        writeBlackboard(world, guard, { awareness: 0.7, stimulus: { x, y: 0, z } });
      });
    }
    world.step();
  };
  return { tick, world };
}

describe('ai', () => {
  test('AC-5: 50 agents running a patrol behaviour think in ≤ 1.0 ms per tick p95', async ({
    bench,
  }) => {
    const { tick } = buildWorld();
    // Warm the JIT first: the budget is the steady-state per-tick cost, not the first compile.
    for (let i = 0; i < 2000; i++) tick();
    const result = await bench('ai: 50 fixture guards patrolling and investigating', tick).run({
      warmupIterations: 1000,
      time: 1000,
      retainSamples: true,
    });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Infinity;
    console.info(
      `ai: mean ${result.latency.mean.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms per tick over ${String(samples.length)} ticks`,
    );
    expect(p95).toBeLessThanOrEqual(1.0); // milliseconds
  });
});
