// mw-e11.5 AC-7: 24 agents and 1 target, perception at 10 Hz in the 60 Hz sim, cost p95 ≤ 0.8 ms per
// tick on the reference machine (backlog contract: M1 Pro). Measured in Node on the greybox testbed:
// sight lines against the sim's Rapier world, light from the scene's ambient and sun (shadowed by the
// level geometry through the light field's statics). The 24 humanoid guards stand in a 12 m ring
// facing its centre, where the player walks a small circle, so every guard's cone test passes and
// every evaluation traces its sight lines: the worst case for line of sight. tinybench reports p75
// and p99 but not p95, so the bench times each tick itself.
//
// It also holds the work-unit conversion (PERCEPTION_UNITS_PER_MS): with 72 agents due every tick,
// each tick spends its whole default budget, and such a tick must stay within the time the budget
// stands for. As in line-of-sight.bench.ts, CI's slower x64 runners get a 2× ceiling; the absolute
// budgets are asserted off CI on a machine of the reference class.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import {
  loadGameContent,
  type ControllerTuning,
  type Frozen,
  type NavAgent,
  type SenseProfile,
} from '@content/index';
import {
  CharacterController,
  CharacterTuning,
  ColliderFanOut,
  CombatFacingComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
  DEFAULT_PERCEPTION_TUNING,
  DEFAULT_STEALTH_TUNING,
  initialCharacterState,
  LightField,
  LineOfSight,
  loadScene,
  PERCEPTION_DEFAULT_BUDGET_MS,
  perceptionBudgetUnits,
  perceptionSystem,
  placeEntity,
  RapierPhysics,
  RapierSightWorld,
  registerCreatureComponents,
  registerSceneComponents,
  World,
  type PerceptionTuning,
} from '@sim/index';

const AGENTS = 24;
/** The AC-7 budget, milliseconds per tick. */
const BUDGET_MS = 0.8;
const TICKS = 1200;
const ON_CI = process.env['CI'] === 'true';

const content = loadGameContent();
const { sight, hearing } = content.get('sense', 'humanoid');
const HUMANOID: Frozen<SenseProfile> = { ...(sight && { sight }), ...(hearing && { hearing }) };
const CONTROLLER: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  stealth: DEFAULT_STEALTH_TUNING,
};

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
}

/** The testbed with 24 guards and the player; `step()` moves the player and runs perception. */
function testbed(tuning: PerceptionTuning, agents = AGENTS) {
  const physics = new RapierPhysics(RAPIER);
  const light = new LightField();
  const scene = content.get('scene', 'testbed');
  const level = registerSceneComponents(new World({ seed: 1 }));
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  const loaded = loadScene(level, scene, kit, new ColliderFanOut(physics, light.statics));
  light.setEnvironment(loaded.layout.light);
  physics.step(1 / 60);

  const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
  world.register(CharacterController, CharacterTuning);
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
  world.add(player, CharacterTuning, CONTROLLER);
  for (let i = 0; i < agents; i++) {
    const angle = (2 * Math.PI * i) / agents;
    const guard = world.spawn();
    world.add(guard, CreatureSensesComponent, HUMANOID);
    placeEntity(world, guard, { x: 12 * Math.cos(angle), y: 0, z: 12 * Math.sin(angle) }, 0.35);
    world.add(guard, CombatFacingComponent, {
      facing: { x: -Math.cos(angle), y: 0, z: -Math.sin(angle) },
    });
    world.add(guard, CreatureNavComponent, { height: 1.8, radius: 0.35 } as Frozen<NavAgent>);
  }
  world.addSystem({
    name: 'walk',
    run: ({ tick }) => {
      const t = tick / 60;
      const state = initialCharacterState({ x: 2 * Math.cos(t), y: 0, z: 2 * Math.sin(t) });
      world.set(player, CharacterController, {
        ...state,
        velocity: { x: -2 * Math.sin(t), y: 0, z: 2 * Math.cos(t) },
      });
    },
  });
  const system = perceptionSystem(world, {
    lineOfSight: new LineOfSight({ world: new RapierSightWorld(physics) }),
    light,
    tuning,
  });
  world.addSystem(system);
  return { world, system };
}

/** Times `ticks` world steps (perception is the only real work in them). */
function timeTicks(world: World<never>, ticks: number, each?: () => void): number[] {
  const times: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const start = performance.now();
    world.step();
    times.push(performance.now() - start);
    each?.();
  }
  return times;
}

describe('creature perception', () => {
  test('AC-7: 24 agents and 1 target at 10 Hz stay ≤ 0.8 ms per tick p95', async ({ bench }) => {
    const { world } = testbed(DEFAULT_PERCEPTION_TUNING);
    timeTicks(world, 120); // warm up
    const times = timeTicks(world, TICKS);
    await bench('perception tick, 24 agents at 10 Hz', () => {
      world.step();
    }).run();
    const tickP95 = p95(times);
    console.info(`perception 24 agents @ 10 Hz: p95 ${tickP95.toFixed(4)} ms per tick`);
    expect(tickP95).toBeLessThanOrEqual(ON_CI ? 2 * BUDGET_MS : BUDGET_MS);
  });

  test('a tick that spends its whole default budget stays within the time it stands for', () => {
    const { world, system } = testbed({ ...DEFAULT_PERCEPTION_TUNING, rateHz: 60 }, 3 * AGENTS);
    timeTicks(world, 120);
    const full: number[] = [];
    const units: number[] = [];
    const times = timeTicks(world, TICKS, () => {
      units.push(system.lastUnits);
    });
    times.forEach((time, i) => {
      if ((units[i] ?? 0) >= system.unitsPerTick) full.push(time);
    });
    const ms = median(full);
    const perMs = median(units) / ms;
    console.info(
      `perception budget: ${String(perceptionBudgetUnits(PERCEPTION_DEFAULT_BUDGET_MS))} units/tick; full-budget tick median ${ms.toFixed(4)} ms, p95 ${p95(full).toFixed(4)} ms over ${String(full.length)} ticks (~${perMs.toFixed(0)} units/ms)`,
    );
    expect(full.length).toBeGreaterThan(TICKS / 2);
    expect(ms).toBeLessThanOrEqual(
      ON_CI ? 2 * PERCEPTION_DEFAULT_BUDGET_MS : PERCEPTION_DEFAULT_BUDGET_MS,
    );
  });
});
