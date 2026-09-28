import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLayers, readLayers, vitestThresholds } from './coverage-layers.ts';

const layer = (overrides: Record<string, unknown> = {}) => ({
  layers: { sim: { globs: ['src/sim/**'], thresholds: { lines: 100 }, ...overrides } },
});

describe('coverage-layers.json', () => {
  it('the committed file declares the contract §3 layers', () => {
    const layers = readLayers();
    for (const name of ['sim', 'content', 'save', 'scripts']) {
      expect(layers[name]?.thresholds).toEqual({
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      });
      expect(layers[name]?.perFile).toBe(true);
    }
    for (const name of ['game', 'ui', 'audio', 'tools']) {
      expect(layers[name]?.thresholds).toEqual({ lines: 90, branches: 90 });
      expect(layers[name]?.perFile).toBe(false);
    }
  });

  it('reads a file from an explicit path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-layers-'));
    try {
      writeFileSync(join(dir, 'layers.json'), JSON.stringify(layer({ perFile: true })));
      expect(readLayers(join(dir, 'layers.json'))).toEqual({
        sim: { globs: ['src/sim/**'], thresholds: { lines: 100 }, perFile: true },
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('defaults perFile to false', () => {
    expect(parseLayers(layer())['sim']?.perFile).toBe(false);
  });

  it.each([
    ['a non-object', 42, /"layers" object/],
    ['missing layers', {}, /"layers" object/],
    ['a non-object layer', { layers: { sim: 'x' } }, /must be an object/],
    ['empty globs', layer({ globs: [] }), /non-empty "globs"/],
    ['non-string globs', layer({ globs: [1] }), /non-empty "globs"/],
    ['non-array globs', layer({ globs: 'src/**' }), /non-empty "globs"/],
    ['missing thresholds', layer({ thresholds: undefined }), /"thresholds" object/],
    ['an unknown metric', layer({ thresholds: { lnes: 100 } }), /unknown metric "lnes"/],
    ['a threshold over 100', layer({ thresholds: { lines: 101 } }), /0–100/],
    ['a negative threshold', layer({ thresholds: { lines: -1 } }), /0–100/],
    ['a non-numeric threshold', layer({ thresholds: { lines: '90' } }), /0–100/],
    ['a non-boolean perFile', layer({ perFile: 'yes' }), /"perFile" must be a boolean/],
  ])('rejects %s', (_name, json, error) => {
    expect(() => parseLayers(json)).toThrow(error);
  });

  it('maps every glob of every layer to a Vitest threshold entry', () => {
    const thresholds = vitestThresholds({
      sim: { globs: ['src/sim/**'], thresholds: { lines: 100, branches: 100 }, perFile: true },
      glue: { globs: ['src/ui/**', 'src/audio/**'], thresholds: { lines: 90 }, perFile: false },
    });
    expect(thresholds).toEqual({
      'src/sim/**': { lines: 100, branches: 100, perFile: true },
      'src/ui/**': { lines: 90, perFile: false },
      'src/audio/**': { lines: 90, perFile: false },
    });
  });
});
