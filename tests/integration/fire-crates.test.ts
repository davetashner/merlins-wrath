// mw-e03.5 AC-7: a greybox line of ten wooden crates, the real material data (content) driving the
// real fire rules (sim). Lighting the first one sets them all alight in order, purely through heat
// in the element field, and a replay of the run reproduces every state hash. Content may import the
// sim only as types, so this cross-layer check lives outside src/.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  burntMaterials,
  canonicalJson,
  fnv1a64,
  loadGameContent,
  materialPresets,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  addMaterialProperties,
  applyStimulus,
  ElementRuleSet,
  elementFieldOf,
  entitiesWithProperty,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  installElementField,
  installStimuli,
  placeEntity,
  playReplay,
  readProperty,
  recordScenario,
  registerWorldProperties,
  stimulusSystem,
  World,
  type ReplayScenario,
} from '@sim/index';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const burnt = burntMaterials(content.all('material'));
const CRATES = 10;

/** Crate i: a 1 m wooden crate (bounding radius 0.5 m) on the floor, touching its neighbours. */
const crateAt = (i: number) => ({ x: 0.25 + i, y: 0.5, z: 0.25 });

/** Command: light the crate at this index with a torch (a contact heat stimulus). */
const lightCommand = z.strictObject({
  light: z
    .number()
    .int()
    .min(0)
    .max(CRATES - 1),
});
type LightCommand = z.infer<typeof lightCommand>;

const scenario: ReplayScenario<LightCommand> = {
  name: 'fire-crates',
  usesContent: true,
  command: lightCommand,
  create: ({ seed, hz }) => {
    // The greybox level: 16 m × 8 m × 8 m of open air around the line (the 4 × 2 × 2 chunks it
    // spans), and nothing beyond it, so heat stays in the level instead of warming the void.
    const world = installElementField(
      installStimuli(registerWorldProperties(new World<LightCommand>({ seed, hz }))),
      { maxChunks: 16 },
    );
    elementFieldOf(world).setConductivity(
      { min: { x: -3.9, y: -3.9, z: -3.9 }, max: { x: 11.9, y: 3.9, z: 3.9 } },
      1,
    );
    world
      .addSystem({
        name: 'torch',
        run: ({ world: w, inputs }) => {
          for (const { light } of inputs) {
            const target = crates(w)[light];
            if (target === undefined) continue; // that crate already burnt away
            applyStimulus(w, {
              shape: { kind: 'contact', target },
              element: 'heat',
              intensity: 400,
            });
          }
        },
      })
      .addSystem(stimulusSystem())
      .addSystem(elementRulesSystem(new ElementRuleSet(fireRules({ presets, burnt }))))
      .addSystem(elementFieldSystem());
    for (let i = 0; i < CRATES; i++) {
      const crate = world.spawn();
      addMaterialProperties(world, crate, presets, { material: 'wood', temperature: 20 });
      placeEntity(world, crate, crateAt(i), 0.5);
    }
    return world;
  },
  drive: ({ tick }) => (tick === 0 ? [{ light: 0 }] : []),
};

/** The crates (the only entities with a material), in spawn order. */
const crates = (world: World<LightCommand>): readonly number[] =>
  entitiesWithProperty(world, 'material');

describe('fire spreading along a line of crates (mw-e03.5)', () => {
  // Three full runs of the scene (live, record, replay): more than the default 5 s on slow CI.
  it(
    'AC-7: lighting the first of ten wooden crates burns all ten in order; a replay matches',
    { timeout: 30_000 },
    ({ task }) => {
      markExercised(task, 'material', 'wood');
      const world = scenario.create({ seed: 11, hz: 60 });
      const ids = crates(world);
      expect(ids.map((id) => readProperty(world, id, 'material'))).toEqual(
        Array<string>(CRATES).fill('wood'),
      );
      const litAt = new Map<number, number>();
      for (let tick = 0; tick < 3600 && litAt.size < CRATES; tick++) {
        world.step(tick === 0 ? [{ light: 0 }] : []);
        for (const id of ids) {
          if (!litAt.has(id) && readProperty(world, id, 'burning')) litAt.set(id, world.tick);
        }
      }
      const order = [...litAt.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
      expect(order).toEqual(ids);
      const times = ids.map((id) => litAt.get(id) ?? Infinity);
      expect(times.every((t, i) => i === 0 || t > (times[i - 1] ?? 0))).toBe(true);

      const contentHash = fnv1a64(canonicalJson(content.all('material')));
      const ticks = times.at(-1) ?? 0;
      const replay = recordScenario(scenario, {
        seed: 11,
        ticks,
        buildSha: 'test',
        contentHash,
        checkpointInterval: 20,
      });
      expect(replay.checkpoints.length).toBeGreaterThan(5);
      const outcome = playReplay(replay, scenario, { contentHash });
      expect(outcome.status).toBe('passed');
    },
  );
});
