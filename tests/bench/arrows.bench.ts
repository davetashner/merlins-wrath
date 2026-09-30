// mw-e05.2 AC-7: projectile update with 60 arrows in flight stays ≤ 0.4 ms per tick p95. Measured in
// Node as a whole World.step() with only the arrow system attached, over a level of a floor, walls and
// posts (the in-memory CollisionWorld) and twenty creatures with a torso and a head each (40
// hurtboxes). The arrows are loosed from a ring around the crowd at different speeds and pitches, so
// every tick some fly clear, some pass the crowd's bounds and some hit; any that land or expire are
// replaced (and landed ones cleared) before the next tick, so exactly 60 are always in flight. p95 is read from the retained
// samples, as in the other sim benches.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  ArrowComponent,
  arrowLookup,
  ArrowRestComponent,
  box,
  DAMAGE_COMPONENTS,
  DamageModel,
  FakeCollisionWorld,
  fireArrow,
  giveCombatant,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  installArrows,
  PlacementComponent,
  placeEntity,
  registerWorldProperties,
  simMath,
  World,
} from '@sim/index';

const ARROWS_IN_FLIGHT = 60;
const TARGETS = 20;

function buildWorld() {
  const arrows = arrowLookup(loadGameContent().all('arrow'));
  const ids = [...arrows.keys()];
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(PlacementComponent, ...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const collision = new FakeCollisionWorld([
    box({ x: -60, y: -1, z: -60 }, { x: 60, y: 0, z: 60 }),
    box({ x: -60, y: 0, z: 40 }, { x: 60, y: 8, z: 41 }),
    box({ x: 40, y: 0, z: -60 }, { x: 41, y: 8, z: 60 }),
    box({ x: -3, y: 0, z: 6 }, { x: -2.6, y: 3, z: 6.4 }),
    box({ x: 2.6, y: 0, z: -6.4 }, { x: 3, y: 3, z: -6 }),
  ]);
  installArrows(world, { arrows, damage: new DamageModel(), collision });
  for (let i = 0; i < TARGETS; i++) {
    const entity = world.spawn();
    placeEntity(world, entity, { x: (i % 5) * 2 - 4, y: 0, z: Math.floor(i / 5) * 2 - 3 }, 1);
    giveCombatant(world, entity, { health: 1e9 });
    giveHurtboxes(world, entity, {
      boxes: [
        {
          id: 'torso',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.5, z: 0 },
            to: { x: 0, y: 1.3, z: 0 },
            radius: 0.3,
          },
        },
        {
          id: 'head',
          socket: 'root',
          region: 'head',
          armored: false,
          multiplier: 1.5,
          shape: { kind: 'sphere', center: { x: 0, y: 1.6, z: 0 }, radius: 0.15 },
        },
      ],
    });
  }
  let loosed = 0;
  /** Looses the next arrow of the deterministic cycle from the ring, 25 m out. */
  const loose = () => {
    const n = loosed++;
    const angle = (2 * Math.PI * ((n * 7) % 60)) / 60;
    const from = { x: 25 * simMath.sin(angle), y: 1.5, z: 25 * simMath.cos(angle) };
    const pitch = ((n % 9) - 1) * 0.03;
    const speed = 40 + (n % 5) * 8;
    const skew = ((n % 11) - 5) * 0.02;
    const dx = -simMath.sin(angle + skew);
    const dz = -simMath.cos(angle + skew);
    fireArrow(world, arrows, {
      arrow: ids[n % ids.length] ?? 'standard',
      origin: from,
      velocity: { x: dx * speed, y: pitch * speed, z: dz * speed },
    });
  };
  const flying = world.query(ArrowComponent);
  const rested = world.query(ArrowRestComponent);
  /** One tick: clear landed arrows, top the volley back up to 60 in flight, step the arrows. */
  const tick = (): void => {
    for (const arrow of [...rested.ids()]) world.destroy(arrow);
    for (let i = flying.ids().length; i < ARROWS_IN_FLIGHT; i++) loose();
    world.step();
  };
  return { tick, flying };
}

describe('arrows', () => {
  test('AC-7: projectile update with 60 arrows in flight stays ≤ 0.4 ms per tick p95', async ({
    bench,
  }) => {
    const { tick, flying } = buildWorld();
    // Warm the JIT first: the budget is the steady-state per-tick cost, not the first compile.
    for (let i = 0; i < 2000; i++) tick();
    const result = await bench('arrow system: 60 arrows, 40 hurtboxes, level rays', tick).run({
      warmupIterations: 1000,
      time: 1000,
      retainSamples: true,
    });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Infinity;
    console.info(
      `arrows: mean ${result.latency.mean.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms per tick over ${String(samples.length)} ticks`,
    );
    expect(flying.ids().length).toBeLessThanOrEqual(60);
    expect(p95).toBeLessThanOrEqual(0.4); // milliseconds
  });
});
