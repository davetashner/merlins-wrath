// Reads coverage-layers.json: the single source for which globs form a coverage layer and the
// thresholds each must meet (backlog contract §3). Used by vite.config.ts and coverage-ratchet.ts.
import { readFileSync } from 'node:fs';

export const METRICS = ['lines', 'branches', 'functions', 'statements'] as const;
export type Metric = (typeof METRICS)[number];

export interface Layer {
  globs: string[];
  thresholds: Partial<Record<Metric, number>>;
  perFile: boolean;
}

export type Layers = Record<string, Layer>;

export interface GlobThresholds extends Partial<Record<Metric, number>> {
  perFile: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validates the parsed coverage-layers.json and returns its layers; throws on any malformed entry. */
export function parseLayers(json: unknown): Layers {
  if (!isRecord(json) || !isRecord(json['layers'])) {
    throw new Error('coverage-layers.json: expected an object with a "layers" object');
  }
  const layers: Layers = {};
  for (const [name, raw] of Object.entries(json['layers'])) {
    if (!isRecord(raw)) throw new Error(`coverage-layers.json: layer "${name}" must be an object`);
    const { globs, thresholds, perFile = false } = raw;
    if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === 'string')) {
      throw new Error(
        `coverage-layers.json: layer "${name}" needs a non-empty "globs" string array`,
      );
    }
    if (!isRecord(thresholds)) {
      throw new Error(`coverage-layers.json: layer "${name}" needs a "thresholds" object`);
    }
    const checked: Partial<Record<Metric, number>> = {};
    for (const [metric, value] of Object.entries(thresholds)) {
      if (!(METRICS as readonly string[]).includes(metric)) {
        throw new Error(`coverage-layers.json: layer "${name}" has unknown metric "${metric}"`);
      }
      if (typeof value !== 'number' || value < 0 || value > 100) {
        throw new Error(`coverage-layers.json: layer "${name}" ${metric} must be a number 0–100`);
      }
      checked[metric as Metric] = value;
    }
    if (typeof perFile !== 'boolean') {
      throw new Error(`coverage-layers.json: layer "${name}" "perFile" must be a boolean`);
    }
    layers[name] = { globs, thresholds: checked, perFile };
  }
  return layers;
}

export function readLayers(path = 'coverage-layers.json'): Layers {
  return parseLayers(JSON.parse(readFileSync(path, 'utf8')));
}

/** Vitest `coverage.thresholds` glob entries: each layer's thresholds applied to each of its globs. */
export function vitestThresholds(layers: Layers): Record<string, GlobThresholds> {
  const out: Record<string, GlobThresholds> = {};
  for (const layer of Object.values(layers)) {
    for (const glob of layer.globs) out[glob] = { ...layer.thresholds, perFile: layer.perFile };
  }
  return out;
}
