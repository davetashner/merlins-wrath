// mw-e04.2 AC-7: the hit query (one run of the hit-volume system) with 24 active hitboxes and 40
// hurtboxes stays ≤ 0.5 ms per tick p95. Measured in Node as a whole World.step() with only that
// system attached; p95 is read from the retained samples. Twenty-four attackers stand in
// a ring around twenty targets (a torso and a head each: 40 hurtboxes) and swing sword arcs through
// the crowd without end: each swing reopens as soon as its 4 active ticks are spent, so every tick
// sweeps all 24 capsules, most bounds overlap something, and the one-hit registry resets per swing.
import { describe, expect, test } from 'vitest';
import {
  DAMAGE_COMPONENTS,
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  hitVolumeSystem,
  liveHitboxes,
  noAllies,
  openHitbox,
  PlacementComponent,
  placeEntity,
  simMath,
  World,
  type EntityId,
  type HitboxSpec,
  type Pose,
} from '@sim/index';

const ATTACKERS = 24;
const TARGETS = 20;

function arc(): HitboxSpec['track'] {
  const keys: Pose[] = [];
  for (let k = 0; k <= 4; k++) {
    const angle = -0.8 + k * 0.4;
    keys.push({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: simMath.sin(angle / 2), z: 0, w: simMath.cos(angle / 2) },
    });
  }
  return { id: 'bench-arc', keys };
}

function buildWorld() {
  const world = new World<never>({ seed: 1 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  const track = arc();
  const attackers: { entity: EntityId; spec: HitboxSpec }[] = [];
  for (let i = 0; i < ATTACKERS; i++) {
    const angle = (2 * Math.PI * i) / ATTACKERS;
    const at = { x: 3 * simMath.sin(angle), y: 1, z: 3 * simMath.cos(angle) };
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.4);
    giveHitboxes(world, entity);
    const spec: HitboxSpec = {
      id: 'swing',
      shape: {
        kind: 'capsule',
        from: { x: 0, y: 0, z: 0.3 },
        to: { x: 0, y: 0, z: 1.6 },
        radius: 0.06,
      },
      track,
      activeTicks: 4,
      aim: { x: -at.x, y: 0, z: -at.z },
      friendlyFire: false,
    };
    attackers.push({ entity, spec });
  }
  for (let i = 0; i < TARGETS; i++) {
    const entity = world.spawn();
    placeEntity(world, entity, { x: (i % 5) - 2, y: 0, z: Math.floor(i / 5) - 1.5 }, 1);
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
  /** One tick: reopen spent swings, then run the hit query. */
  const tick = (): void => {
    for (const { entity, spec } of attackers) {
      const [live] = liveHitboxes(world, entity);
      if (live === undefined || live.elapsed >= live.activeTicks) openHitbox(world, entity, spec);
    }
    world.step();
  };
  return { world, tick };
}

describe('hit volumes', () => {
  test('AC-7: the hit query with 24 active hitboxes and 40 hurtboxes stays ≤ 0.5 ms per tick p95', async ({
    bench,
  }) => {
    const { tick } = buildWorld();
    // Warm the JIT first: the budget is the steady-state per-tick cost, not the first compile.
    for (let i = 0; i < 2000; i++) tick();
    const result = await bench('hit-volume system: 24 hitboxes × 40 hurtboxes', tick).run({
      warmupIterations: 1000,
      time: 1000,
      retainSamples: true,
    });
    // The AC's p95, read from the sorted samples (tinybench's summary stops at p75 and p99).
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Infinity;
    expect(p95).toBeLessThanOrEqual(0.5); // milliseconds
  });
});
