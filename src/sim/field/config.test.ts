import { describe, expect, it } from 'vitest';
import {
  checkChannelName,
  DEFAULT_FIELD_CONFIG,
  FIXED_ONE,
  fixedChannel,
  gasOf,
  RATE_ONE,
  resolveFieldConfig,
  toCounts,
  toUnits,
  type FieldConfigInput,
} from './config';

describe('resolveFieldConfig', () => {
  it('fills every default: 0.5 m cells, 8³ chunks, sleep after 60 calm ticks', () => {
    const config = resolveFieldConfig();
    expect(config).toEqual({ ...DEFAULT_FIELD_CONFIG, gases: {} });
    expect(config.cellSize).toBe(0.5);
    expect(config.sleepTicks).toBe(60);
  });

  it('merges overrides field by field, including per-gas overrides', () => {
    const config = resolveFieldConfig({
      cellSize: 1,
      maxChunks: 7,
      sleepTicks: 3,
      temperature: { decay: 0.5 },
      gas: { diffusion: 0.1 },
      gases: { smoke: { decay: 0.01 } },
    });
    expect(config.cellSize).toBe(1);
    expect(config.maxChunks).toBe(7);
    expect(config.temperature).toEqual({ ...DEFAULT_FIELD_CONFIG.temperature, decay: 0.5 });
    expect(config.gas.diffusion).toBe(0.1);
    expect(config.gases).toEqual({ smoke: { decay: 0.01 } });
  });

  const bad: [string, FieldConfigInput][] = [
    ['zero cell size', { cellSize: 0 }],
    ['infinite cell size', { cellSize: Infinity }],
    ['fractional chunk cap', { maxChunks: 1.5 }],
    ['zero sleep ticks', { sleepTicks: 0 }],
    ['NaN rate', { temperature: { diffusion: NaN } }],
    ['non-number', { moisture: { epsilon: '1' as unknown as number } }],
    ['ambient outside range', { charge: { ambient: -1 } }],
    ['ambient above range', { charge: { ambient: 20_000 } }],
    ['span too wide', { charge: { max: 40_000 } }],
    ['span too wide below', { temperature: { min: -40_000 } }],
    ['diffusion > 1/6', { gas: { diffusion: 0.2 } }],
    ['negative diffusion', { gas: { diffusion: -0.1 } }],
    ['decay > 1', { gas: { decay: 2 } }],
    ['negative decay', { gas: { decay: -1 } }],
    ['negative epsilon', { gas: { epsilon: -1 } }],
    ['bad gas id', { gases: { Smoke: {} } }],
    ['bad gas override', { gases: { smoke: { decay: 3 } } }],
  ];
  it.each(bad)('rejects %s', (_, input) => {
    expect(() => resolveFieldConfig(input)).toThrow(RangeError);
  });
});

describe('channels', () => {
  it('names base channels and gas:<id> channels', () => {
    expect(checkChannelName('temperature')).toBe('temperature');
    expect(checkChannelName('moisture')).toBe('moisture');
    expect(checkChannelName('charge')).toBe('charge');
    expect(checkChannelName('gas:marsh-gas')).toBe('gas:marsh-gas');
    expect(gasOf('gas:smoke')).toBe('smoke');
    expect(gasOf('charge')).toBeUndefined();
    expect(() => checkChannelName('heat')).toThrow(/unknown field channel/);
    expect(() => checkChannelName('gas:Bad')).toThrow(/unknown field channel/);
  });

  it('converts specs to fixed point, with per-gas overrides over the gas default', () => {
    const config = resolveFieldConfig({ gases: { steam: { decay: 0.5 } } });
    const temperature = fixedChannel(config, 'temperature');
    expect(temperature.low).toBe(toCounts(-293.15));
    expect(temperature.high).toBe(9980 * FIXED_ONE);
    expect(temperature.rate).toBe(Math.round(0.1 * RATE_ONE));
    expect(fixedChannel(config, 'gas:steam').decay).toBe(RATE_ONE / 2);
    expect(fixedChannel(config, 'gas:smoke').decay).toBe(0);
  });

  it('never produces -0 counts', () => {
    expect(Object.is(toCounts(-1e-9), 0)).toBe(true);
    expect(toUnits(FIXED_ONE)).toBe(1);
  });
});
