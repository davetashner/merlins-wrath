import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import type { FieldConfigInput } from '../field/config';
import { stepField } from '../field/diffusion';
import { ElementField } from '../field/grid';
import { elementFieldOf, elementFieldSystem, installElementField } from '../field/install';
import {
  hasProperty,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { findPropertyViolations } from '../properties/derived';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { placeEntity, type Placement } from '../stimulus/placement';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { cellsInSphere, cellsOf, holdAtLeast } from './cells';
import {
  DEFAULT_FIRE_CONFIG,
  fireBurntOut,
  fireExtinguished,
  fireIgnited,
  fireRules,
  flameTemperatureOf,
  resolveFireConfig,
  type BurntMaterials,
  type FireBurnout,
  type FireExtinguishing,
  type FireIgnition,
  type FireRulesOptions,
} from './fire';
import { DEFAULT_HEAT_CONFIG } from './heat';
import { ElementRuleSet, elementRulesSystem } from './rules';

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, hp: 100 }],
  ['straw', { flammable: true, ignitionPoint: 200, fuel: 20, hp: 15 }],
  ['stone', { hp: 400 }],
  ['charred', { flammable: false, fragile: 150 }],
  ['generic', {}],
]);
const BURNT: BurntMaterials = new Map([
  ['wood', 'charred'],
  ['straw', null],
]);

interface FireLog {
  readonly ignited: FireIgnition[];
  readonly extinguished: FireExtinguishing[];
  readonly burntOut: FireBurnout[];
}

/**
 * The field the tests use: the 2×2×2 chunks around the origin (8 m cube), so fires near the origin
 * cost what they would in a walled room and the suite stays fast under coverage.
 */
const TEST_FIELD: FieldConfigInput = { maxChunks: 8 };

/** A world with properties, stimuli, a field and the fire rules, in the documented system order. */
function fireWorld(options: Partial<FireRulesOptions> = {}, fieldConfig = TEST_FIELD) {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<never>({ seed: 5 }))),
    fieldConfig,
  );
  const rules = new ElementRuleSet(fireRules({ presets: PRESETS, burnt: BURNT, ...options }));
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(rules))
    .addSystem(elementFieldSystem());
  const log: FireLog = { ignited: [], extinguished: [], burntOut: [] };
  world.events.on(fireIgnited, (e) => log.ignited.push(e));
  world.events.on(fireExtinguished, (e) => log.extinguished.push(e));
  world.events.on(fireBurntOut, (e) => log.burntOut.push(e));
  return { world, field: elementFieldOf(world), log };
}

/** Spawns an object of `material` at 20 °C (plus `init`), placed when `at` is given. */
function spawn(
  world: World<never>,
  material: string,
  init: WorldPropertyInit = {},
  at?: Placement,
): EntityId {
  const entity = world.spawn();
  addMaterialProperties(world, entity, PRESETS, { material, temperature: 20, ...init });
  if (at !== undefined) placeEntity(world, entity, at, at.radius);
  return entity;
}

const heat = (world: World<never>, target: EntityId, intensity: number) =>
  applyStimulus(world, { shape: { kind: 'contact', target }, element: 'heat', intensity });

/** Steps until `done` or `limit` ticks; returns the ticks stepped (limit + 1 when never done). */
function stepUntil(world: World<never>, done: () => boolean, limit: number): number {
  for (let t = 1; t <= limit; t++) {
    world.step();
    if (done()) return t;
  }
  return limit + 1;
}

const burning = (world: World<never>, entity: EntityId) => readProperty(world, entity, 'burning');

describe('fire config', () => {
  it('fills defaults and validates every field', () => {
    expect(resolveFireConfig()).toEqual(DEFAULT_FIRE_CONFIG);
    expect(resolveFireConfig({ minAir: 0.5 }).minAir).toBe(0.5);
    const bad: Partial<typeof DEFAULT_FIRE_CONFIG>[] = [
      { flameTemperature: -300 },
      { flameTemperature: 20_000 },
      { flameMargin: -1 },
      { flameReach: Infinity },
      { smokePerSecond: -1 },
      { smokeGas: 'Smoke' },
      { burnDamagePerSecond: NaN },
      { minAir: 1.5 },
      { minAir: -0.1 },
    ];
    for (const input of bad)
      expect(() => resolveFireConfig(input), JSON.stringify(input)).toThrow(RangeError);
  });

  it('flames are at least flameMargin above the ignition point, within the property range', () => {
    const config = resolveFireConfig();
    expect(flameTemperatureOf(config, 300)).toBe(600);
    expect(flameTemperatureOf(config, 500)).toBe(700);
    expect(flameTemperatureOf(config, 9_900)).toBe(10_000);
  });

  it('rejects a burnt state naming a material without a preset', () => {
    expect(() => fireRules({ presets: PRESETS, burnt: new Map([['wood', 'ash']]) })).toThrow(
      /wood.*unknown material "ash"/,
    );
  });

  it('orders heat and fire rules so water is handled before drying and drying before ignition', () => {
    const rules = new ElementRuleSet(fireRules({ presets: PRESETS, burnt: BURNT }));
    expect(rules.rules.map((r) => r.id)).toEqual([
      'heat.exchange',
      'fire.extinguish',
      'heat.evaporate',
      'fire.ignite',
      'fire.burn',
      'fire.burnout',
    ]);
  });
});

describe('ignition', () => {
  it('AC-1: a flammable, damp (< 0.5), unfrozen object ignites on the tick it reaches its ignition point', () => {
    const { world, log } = fireWorld({ heat: { boilingPoint: 10_000 } }); // no drying in this test
    const wood = spawn(world, 'wood', { wetness: 0.4 });
    heat(world, wood, 279);
    world.step();
    expect(readProperty(world, wood, 'temperature')).toBe(299);
    expect(burning(world, wood)).toBe(false);
    heat(world, wood, 1);
    world.step();
    expect(readProperty(world, wood, 'temperature')).toBe(300);
    expect(burning(world, wood)).toBe(true);
    expect(log.ignited).toEqual([{ entity: wood }]);
  });

  it('AC-1: holds for any flammable object, whatever its material', () => {
    const { world } = fireWorld();
    const objects = [
      spawn(world, 'straw', { wetness: 0.1 }),
      spawn(world, 'stone', { flammable: true, ignitionPoint: 450, fuel: 5 }),
      spawn(world, 'generic', { flammable: true, ignitionPoint: 90, fuel: 1 }),
    ];
    for (const entity of objects) heat(world, entity, 480);
    world.step();
    expect(objects.map((e) => burning(world, e))).toEqual([true, true, true]);
  });

  it('AC-1: soaked (wetness 0.5), frozen, fuel-less or non-flammable objects do not ignite', () => {
    const { world } = fireWorld({ heat: { boilingPoint: 10_000 } }); // no drying in this test
    const objects = [
      spawn(world, 'wood', { wetness: 0.5 }),
      spawn(world, 'wood', { frozen: true }),
      spawn(world, 'wood', { fuel: 0 }),
      spawn(world, 'stone'),
      spawn(world, 'stone', { flammable: false, burning: false }),
    ];
    for (const entity of objects) heat(world, entity, 500);
    world.step();
    expect(objects.map((e) => burning(world, e))).toEqual([false, false, false, false, false]);
  });

  it('an object with no air in its cells cannot ignite', () => {
    const { world, field } = fireWorld();
    const at = { x: 0.25, y: 0.25, z: 0.25, radius: 0 };
    const wood = spawn(world, 'wood', {}, at);
    field.setConductivity({ min: at, max: at }, 0); // encased: its only cell is a wall
    heat(world, wood, 500);
    world.step();
    expect(burning(world, wood)).toBe(false);
  });
});

describe('spread through the field', () => {
  const origin = { x: 0.25, y: 0.25, z: 0.25, radius: 0.25 };
  const next = { ...origin, x: 0.75 }; // the adjacent cell

  /** The tick a neighbour at `neighbour` ignites, predicted from field heat transfer alone. */
  function predictedIgnitionTick(source: Placement, neighbour: Placement, ignitionPoint: number) {
    const field = new ElementField(TEST_FIELD);
    const config = resolveFireConfig();
    const flame = flameTemperatureOf(config, 300);
    const flames = cellsInSphere(field, source, source.radius + config.flameReach);
    const cells = cellsOf(field, neighbour);
    const { exchangeRate, cellShare } = DEFAULT_HEAT_CONFIG;
    let temperature = 20;
    for (let tick = 1; tick <= 6000; tick++) {
      // Newton exchange with the mean of the neighbour's cells, the cells taking the opposite share.
      const mean =
        cells.reduce((sum, cell) => sum + field.read('temperature', cell), 0) / cells.length;
      const change = (mean - temperature) * exchangeRate;
      for (const cell of cells)
        field.add('temperature', cell, (-change * cellShare) / cells.length);
      temperature += change;
      if (temperature >= ignitionPoint) return tick;
      holdAtLeast(field, 'temperature', flames, flame); // the burning source's flames
      stepField(field);
    }
    return Infinity;
  }

  it('AC-2: a flammable neighbour one cell away ignites when field heat transfer predicts (± 1 tick)', () => {
    const { world } = fireWorld();
    spawn(world, 'wood', { burning: true, temperature: 600 }, origin);
    const neighbour = spawn(world, 'wood', {}, next);
    const ticks = stepUntil(world, () => burning(world, neighbour), 6000);
    const predicted = predictedIgnitionTick(origin, next, 300);
    expect(predicted).toBeLessThan(600); // well within a burning crate's 120 s
    expect(Math.abs(ticks - predicted)).toBeLessThanOrEqual(1);
  });

  it('AC-2: a neighbour half a metre from a burning crate catches too (flames reach 0.75 m)', () => {
    const { world } = fireWorld();
    spawn(world, 'wood', { burning: true, temperature: 600 }, { ...origin, radius: 0.5 });
    const crate = spawn(world, 'wood', {}, { ...origin, x: 1.75, radius: 0.5 });
    expect(stepUntil(world, () => burning(world, crate), 600)).toBeLessThan(600);
  });

  it('AC-2: a non-flammable neighbour warms but never ignites; a far one barely warms', () => {
    const { world } = fireWorld();
    spawn(world, 'wood', { burning: true, temperature: 600, fuel: 4 }, origin);
    const stone = spawn(world, 'stone', {}, next);
    const far = spawn(world, 'wood', {}, { ...origin, x: 3.25 });
    let hottest = 0;
    const ticks = stepUntil(
      world,
      () => {
        hottest = Math.max(hottest, readProperty(world, stone, 'temperature'));
        return burning(world, stone) || burning(world, far);
      },
      360,
    );
    expect(ticks).toBe(361);
    expect(hottest).toBeGreaterThan(300);
    expect(hasProperty(world, stone, 'burning')).toBe(false);
    expect(readProperty(world, far, 'temperature')).toBeLessThan(50); // 3 m away: barely warm
  });
});

describe('burning', () => {
  it('AC-3: burns for exactly F seconds after igniting, then becomes charred per data', () => {
    const { world, log } = fireWorld();
    const wood = spawn(world, 'wood', { fuel: 2 });
    heat(world, wood, 400);
    world.step(); // ignites on this tick
    const ignitedAt = world.tick;
    const ticks = stepUntil(world, () => !burning(world, wood), 1000);
    expect(ticks).toBe(2 * 60);
    expect(world.tick - ignitedAt).toBe(120);
    expect(readProperty(world, wood, 'material')).toBe('charred');
    expect(readProperty(world, wood, 'flammable')).toBe(false);
    expect(readProperty(world, wood, 'fuel')).toBe(0);
    expect(readProperty(world, wood, 'fragile')).toBe(150);
    expect(log.burntOut).toEqual([{ entity: wood, becomes: 'charred' }]);
    expect(findPropertyViolations(world)).toEqual([]);
    world.step(); // still hot, but charred remains never reignite
    expect(burning(world, wood)).toBe(false);
  });

  it('AC-3: straw burns away (destroyed per data); a material without data burns away too', () => {
    const { world, log } = fireWorld();
    const straw = spawn(world, 'straw', { fuel: 0.5 });
    const odd = spawn(world, 'generic', { flammable: true, ignitionPoint: 100, fuel: 0.5 });
    heat(world, straw, 400);
    heat(world, odd, 400);
    stepUntil(world, () => !world.isAlive(straw), 100);
    expect(world.isAlive(straw)).toBe(false);
    expect(world.isAlive(odd)).toBe(false);
    expect(log.burntOut).toEqual([
      { entity: straw, becomes: null },
      { entity: odd, becomes: null },
    ]);
  });

  it('burning holds flame temperature, heats its flames, gives off smoke and loses structural hp', () => {
    const { world, field } = fireWorld();
    const at = { x: 0.25, y: 0.25, z: 0.25, radius: 0.25 };
    const wood = spawn(world, 'wood', { burning: true, temperature: 350 }, at);
    world.step();
    expect(readProperty(world, wood, 'temperature')).toBe(600);
    expect(readProperty(world, wood, 'hp')).toBeCloseTo(100 - 0.5 / 60, 9);
    expect(readProperty(world, wood, 'fuel')).toBe(7199 / 60);
    for (let i = 0; i < 59; i++) world.step();
    expect(readProperty(world, wood, 'hp')).toBeCloseTo(99.5, 6);
    expect(field.readAt('temperature', { x: 1, y: 0.25, z: 0.25 })).toBeGreaterThan(300);
    expect(field.readAt('gas:smoke', at)).toBeGreaterThan(0);
  });

  it('an unplaced burning object burns out without touching the field; spent hp stays at 0', () => {
    const { world, field } = fireWorld({ fire: { burnDamagePerSecond: 1000, smokePerSecond: 0 } });
    const wood = spawn(world, 'wood', { burning: true, fuel: 0.1, temperature: 300 });
    const flame = spawn(world, 'generic', {
      flammable: true,
      burning: true,
      fuel: 0.05,
      temperature: 300,
    });
    stepUntil(world, () => !burning(world, wood), 10);
    expect(readProperty(world, wood, 'hp')).toBe(0);
    expect(readProperty(world, wood, 'material')).toBe('charred');
    expect(world.isAlive(flame)).toBe(false); // generic has no burnt state: it burnt away
    expect(field.chunkCount).toBe(0);
  });

  it('a placed fire with no smoke configured adds none', () => {
    const { world, field } = fireWorld({ fire: { smokePerSecond: 0 } });
    spawn(world, 'wood', { burning: true, temperature: 600 }, { x: 0, y: 0, z: 0, radius: 0 });
    world.step();
    expect(field.channels()).toEqual(['temperature']);
  });
});

describe('drying and extinguishing', () => {
  const at = { x: 0.25, y: 0.25, z: 0.25, radius: 0.25 };

  it('AC-4: a soaked object beside a fire dries first and only ignites once wetness < 0.5', () => {
    const { world } = fireWorld();
    spawn(world, 'wood', { burning: true, temperature: 600 }, { ...at, x: -0.25 });
    const wet = spawn(world, 'wood', { wetness: 1 }, at);
    const wetness: number[] = [];
    const ticks = stepUntil(
      world,
      () => {
        wetness.push(readProperty(world, wet, 'wetness'));
        return burning(world, wet);
      },
      6000,
    );
    expect(ticks).toBeLessThan(6000);
    const atIgnition = wetness.at(-1) ?? 1;
    expect(atIgnition).toBeLessThan(0.5);
    expect(wetness.every((w, i) => i === 0 || w <= (wetness[i - 1] ?? 1))).toBe(true);
    expect(wetness.filter((w) => w < 1).length).toBeGreaterThan(30); // it dried over many ticks
  });

  it('AC-4: a wet object hit by a burst of heat spends it boiling off water instead of igniting', () => {
    const { world } = fireWorld();
    const wet = spawn(world, 'wood', { wetness: 1 }); // unplaced: no exchange with the air
    heat(world, wet, 1000);
    world.step();
    expect(burning(world, wet)).toBe(false);
    expect(readProperty(world, wet, 'wetness')).toBeCloseTo(1 - 0.46, 9); // 920 °C over boiling
    expect(readProperty(world, wet, 'temperature')).toBeCloseTo(100, 6);
  });

  it('AC-5: water that soaks a burning object puts it out with a puff of steam, and it stays out', () => {
    const { world, field, log } = fireWorld();
    const wood = spawn(world, 'wood', { burning: true, temperature: 600, wetness: 0 }, at);
    for (let i = 0; i < 30; i++) world.step();
    applyStimulus(world, {
      shape: { kind: 'contact', target: wood },
      element: 'water',
      intensity: 0.5,
    });
    world.step();
    expect(readProperty(world, wood, 'burning')).toBe(false);
    expect(log.extinguished).toEqual([{ entity: wood, cause: 'water' }]);
    expect(field.readAt('gas:steam', at)).toBeGreaterThan(0.1);
    expect(readProperty(world, wood, 'temperature')).toBeCloseTo(100, 6);
    expect(stepUntil(world, () => burning(world, wood), 600)).toBe(601);
  });

  it('a light splash sizzles off a burning object without putting it out', () => {
    const { world, log } = fireWorld();
    const wood = spawn(world, 'wood', { burning: true, temperature: 600, wetness: 0 }, at);
    applyStimulus(world, {
      shape: { kind: 'contact', target: wood },
      element: 'water',
      intensity: 0.2,
    });
    world.step();
    expect(burning(world, wood)).toBe(true);
    expect(readProperty(world, wood, 'wetness')).toBe(0);
    expect(log.extinguished).toEqual([]);
  });

  it('cold below the ignition point, freezing, losing flammability and smothering put fires out', () => {
    const { world, field, log } = fireWorld();
    const cold = spawn(world, 'wood', { burning: true, temperature: 600 });
    const frozen = spawn(world, 'wood', { burning: true, temperature: 600, frozen: false });
    const inert = spawn(world, 'wood', { burning: true, temperature: 600 });
    const walled = spawn(world, 'wood', { burning: true, temperature: 600 }, at);
    const steamed = spawn(world, 'wood', { burning: true, temperature: 600 }, { ...at, x: 2.25 });
    applyStimulus(world, {
      shape: { kind: 'contact', target: cold },
      element: 'cold',
      intensity: 400,
    });
    setProperty(world, frozen, 'frozen', true);
    setProperty(world, inert, 'flammable', false);
    for (const cell of cellsOf(field, at)) {
      const centre = field.cellCenter(cell);
      field.setConductivity({ min: centre, max: centre }, 0); // walled in
    }
    for (const cell of cellsOf(field, { ...at, x: 2.25 })) field.add('gas:steam', cell, 0.9);
    world.step();
    expect(log.extinguished).toEqual([
      { entity: cold, cause: 'cold' },
      { entity: frozen, cause: 'frozen' },
      { entity: inert, cause: 'not-flammable' },
      { entity: walled, cause: 'smothered' },
      { entity: steamed, cause: 'smothered' },
    ]);
    world.step();
    // The steam clears within a tick and the still-hot object relights; the others stay out.
    expect([cold, frozen, inert, walled, steamed].map((e) => burning(world, e))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('termination', () => {
  // Ten simulated minutes: a long scenario, so it gets more than the default 5 s on slow CI.
  it(
    'AC-6: a fire in a sealed room burns its fuel, ends, and the field returns to ambient',
    { timeout: 30_000 },
    () => {
      const { world, field } = fireWorld();
      // A 3 m sealed room: walls on the shell of cells [-4, 4]³ (0.5 m cells), open air inside.
      for (const axis of ['x', 'y', 'z'] as const) {
        for (const side of [-4, 4]) {
          const min = { x: -4, y: -4, z: -4, [axis]: side };
          const max = { x: 4, y: 4, z: 4, [axis]: side };
          field.setConductivity({ min: field.cellCenter(min), max: field.cellCenter(max) }, 0);
        }
      }
      const crate = spawn(world, 'wood', { fuel: 10 }, { x: 0.25, y: 0.25, z: 0.25, radius: 0.5 });
      const bale = spawn(world, 'straw', { fuel: 5 }, { x: 1.25, y: 0.25, z: 0.25, radius: 0.4 });
      const rock = spawn(world, 'stone', {}, { x: -1, y: 0.25, z: 0.25, radius: 0.4 });
      heat(world, crate, 400);
      let burnedAtSomePoint = false;
      for (let t = 0; t < 10 * 60 * 60; t++) {
        world.step();
        if (t === 300) burnedAtSomePoint = burning(world, crate) || !world.isAlive(bale);
      }
      expect(burnedAtSomePoint).toBe(true);
      expect(burning(world, crate)).toBe(false);
      expect(readProperty(world, crate, 'material')).toBe('charred');
      expect(world.isAlive(bale)).toBe(false);
      expect(readProperty(world, crate, 'temperature')).toBe(20);
      expect(readProperty(world, rock, 'temperature')).toBe(20);
      expect(field.channels()).toEqual([]);
      for (const channel of ['temperature', 'gas:smoke', 'gas:steam'] as const) {
        expect(field.total(channel)).toBe(0);
      }
      expect(findPropertyViolations(world)).toEqual([]);
    },
  );
});
