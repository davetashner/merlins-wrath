import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { elementFieldOf, elementFieldSystem, installElementField } from '../field/install';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import {
  clampTemperature,
  DEFAULT_HEAT_CONFIG,
  evaporationRule,
  heatExchangeRule,
  resolveHeatConfig,
  type HeatConfig,
} from './heat';
import { ElementRuleSet, elementRulesSystem } from './rules';

/** A world running only the heat rules (exchange, evaporation) and the field. */
function heatWorld(config: Partial<HeatConfig> = {}) {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3 }))),
  );
  const heat = resolveHeatConfig(config);
  const rules = new ElementRuleSet([heatExchangeRule(heat), evaporationRule(heat)]);
  world.addSystem(elementRulesSystem(rules)).addSystem(elementFieldSystem());
  return { world, field: elementFieldOf(world) };
}

function spawn(world: World<never>, init: WorldPropertyInit, at?: { x: number }): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, init);
  if (at !== undefined) placeEntity(world, entity, { x: at.x, y: 0.25, z: 0.25 }, 0.25);
  return entity;
}

describe('heat config', () => {
  it('fills defaults and validates every field', () => {
    expect(resolveHeatConfig()).toEqual(DEFAULT_HEAT_CONFIG);
    const bad: Partial<HeatConfig>[] = [
      { exchangeRate: 1.5 },
      { exchangeRate: -0.1 },
      { cellShare: -1 },
      { cellShare: Infinity },
      { boilingPoint: -300 },
      { boilingPoint: 20_000 },
      { latentHeat: 0 },
      { latentHeat: Infinity },
      { steamYield: -1 },
      { steamYield: NaN },
      { steamGas: 'Steam' },
    ];
    for (const input of bad) {
      expect(() => resolveHeatConfig(input), JSON.stringify(input)).toThrow(RangeError);
    }
  });

  it('clamps temperatures to the property range', () => {
    expect(clampTemperature(20_000)).toBe(10_000);
    expect(clampTemperature(-500)).toBe(-273.15);
    expect(clampTemperature(42)).toBe(42);
  });
});

describe('heat.exchange', () => {
  it('a placed object warms from hot air and cools it; unplaced objects are left alone', () => {
    const { world, field } = heatWorld();
    const placed = spawn(world, { temperature: 20 }, { x: 0.25 });
    const loose = spawn(world, { temperature: 20 });
    field.add('temperature', { x: 0, y: 0, z: 0 }, 700);
    world.step();
    expect(readProperty(world, placed, 'temperature')).toBeGreaterThan(20);
    expect(readProperty(world, loose, 'temperature')).toBe(20);
  });

  it('a hot object in still air warms it, cools, and settles to exactly ambient once calm', () => {
    const { world, field } = heatWorld();
    const ember = spawn(world, { temperature: 200 }, { x: 0.25 });
    world.step();
    expect(readProperty(world, ember, 'temperature')).toBeLessThan(200);
    expect(field.readAt('temperature', { x: 0.25, y: 0.25, z: 0.25 })).toBeGreaterThan(20);
    for (let i = 0; i < 1200; i++) world.step();
    expect(readProperty(world, ember, 'temperature')).toBe(20);
    expect(field.channels()).toEqual([]);
  });

  it('never pushes a temperature outside the property range', () => {
    const { world, field } = heatWorld({ exchangeRate: 1, cellShare: 0 });
    const cold = spawn(world, { temperature: -273.15 }, { x: 0.25 });
    field.set('temperature', { x: 0, y: 0, z: 0 }, -273.15);
    world.step();
    expect(readProperty(world, cold, 'temperature')).toBeGreaterThanOrEqual(-273.15);
  });
});

describe('heat.evaporate', () => {
  it('spends heat above boiling on drying, at latentHeat °C per unit, and makes steam', () => {
    const { world, field } = heatWorld();
    const wet = spawn(world, { temperature: 500, wetness: 0.5 }, { x: 5.25 });
    const dry = spawn(world, { temperature: 500, wetness: 0 });
    const cool = spawn(world, { temperature: 90, wetness: 1 });
    world.step();
    // The exchange first cools it by 5% of 480 °C to 476 °C; the 376 °C over boiling dry 0.188.
    expect(readProperty(world, wet, 'wetness')).toBeCloseTo(0.312, 9);
    expect(readProperty(world, wet, 'temperature')).toBeCloseTo(100, 9);
    expect(field.readAt('gas:steam', { x: 5.25, y: 0.25, z: 0.25 })).toBeGreaterThan(0);
    expect(readProperty(world, dry, 'temperature')).toBe(500);
    expect(readProperty(world, cool, 'wetness')).toBe(1);
  });

  it('dries completely when the heat is enough, keeping what is left over', () => {
    const { world, field } = heatWorld({ steamYield: 0 });
    const damp = spawn(world, { temperature: 1100, wetness: 0.25 });
    world.step();
    expect(readProperty(world, damp, 'wetness')).toBe(0);
    expect(readProperty(world, damp, 'temperature')).toBe(600);
    expect(field.chunkCount).toBe(0);
  });
});
