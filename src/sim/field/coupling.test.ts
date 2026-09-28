import { describe, expect, it } from 'vitest';
import { shapeFalloff, type StimulusShape } from '../stimulus/shapes';
import { normalizeStimulus, type StimulusInput } from '../stimulus/stimulus';
import { applyStimulusToField, depositInShape, exchangeWithCell } from './coupling';
import { ElementField, type CellCoord } from './grid';

const c = (x: number, y = 0, z = 0): CellCoord => ({ x, y, z });
const v = (x: number, y = 0, z = 0) => ({ x, y, z });

function resolve(field: ElementField, input: StimulusInput, amount = input.intensity) {
  applyStimulusToField(field, { tick: 0, stimulus: normalizeStimulus(input), amount, hits: [] });
}

describe('depositInShape', () => {
  it('gives each cell centre the same falloff the shape gives entities', () => {
    const field = new ElementField();
    const shape: StimulusShape = { kind: 'sphere', center: v(0.25, 0.25, 0.25), radius: 1.2 };
    const written = depositInShape(field, 'temperature', shape, 'linear', 100);
    expect(written).toBeGreaterThan(20);
    for (const cell of [c(0), c(1), c(2), c(0, 2, 0), c(3)]) {
      const expected = shapeFalloff(shape, 'linear', field.cellCenter(cell));
      const got = field.read('temperature', cell) - 20;
      expect(got).toBeCloseTo(expected === undefined ? 0 : 100 * expected, 4);
    }
    expect(field.read('temperature', c(0))).toBe(120);
  });

  it('covers cones, capsules and boxes', () => {
    const field = new ElementField();
    const cone: StimulusShape = {
      kind: 'cone',
      apex: v(0),
      direction: v(1),
      length: 3,
      halfAngle: 0.5,
    };
    expect(depositInShape(field, 'moisture', cone, 'none', 0.5)).toBeGreaterThan(5);
    expect(field.readAt('moisture', v(2, 0.1, 0.1))).toBe(0.5);
    expect(field.readAt('moisture', v(-1))).toBe(0);
    const beam: StimulusShape = { kind: 'capsule', from: v(0, 5), to: v(4, 5), radius: 0.5 };
    expect(depositInShape(field, 'charge', beam, 'none', 1)).toBeGreaterThan(5);
    const box: StimulusShape = { kind: 'box', center: v(0, -5), halfExtents: v(1, 1, 1) };
    expect(depositInShape(field, 'gas:smoke', box, 'none', 0.25)).toBe(4 * 4 * 4);
  });

  it('deposits a point, or a shape too small for any cell centre, into the middle cell', () => {
    const field = new ElementField();
    expect(depositInShape(field, 'charge', { kind: 'point', at: v(1.1) }, 'linear', 3)).toBe(1);
    expect(field.read('charge', c(2))).toBe(3);
    const tiny: StimulusShape = { kind: 'sphere', center: v(-1.05), radius: 0.1 };
    expect(depositInShape(field, 'charge', tiny, 'linear', 2)).toBe(1);
    expect(field.read('charge', c(-3))).toBe(2);
  });

  it('writes nothing for contact shapes, walls or refused chunks', () => {
    const field = new ElementField({ maxChunks: 1 });
    expect(depositInShape(field, 'charge', { kind: 'contact', target: 1 }, 'none', 1)).toBe(0);
    field.setConductivity({ min: v(0.25, 0.25, 0.25), max: v(0.25, 0.25, 0.25) }, 0);
    expect(
      depositInShape(field, 'charge', { kind: 'point', at: v(0.1, 0.1, 0.1) }, 'none', 1),
    ).toBe(0);
    const far: StimulusShape = { kind: 'sphere', center: v(100), radius: 1 };
    expect(depositInShape(field, 'charge', far, 'none', 1)).toBe(0);
    expect(field.chunkCount).toBe(1);
    expect(() => depositInShape(field, 'heat' as 'charge', far, 'none', 1)).toThrow(RangeError);
  });
});

describe('applyStimulusToField', () => {
  const at: StimulusShape = { kind: 'point', at: v(0.1, 0.1, 0.1) };
  it('maps heat, cold, water, charge and gas onto their channels', () => {
    const field = new ElementField();
    resolve(field, { shape: at, element: 'heat', intensity: 30 });
    resolve(field, { shape: at, element: 'cold', intensity: 10 });
    resolve(field, { shape: at, element: 'water', intensity: 0.4 });
    resolve(field, { shape: at, element: 'charge', intensity: 5 });
    resolve(field, { shape: at, element: 'gas', gas: 'marsh-gas', intensity: 0.2 });
    expect(field.read('temperature', c(0))).toBe(40);
    expect(field.read('moisture', c(0))).toBeCloseTo(0.4, 4);
    expect(field.read('charge', c(0))).toBe(5);
    expect(field.read('gas:marsh-gas', c(0))).toBeCloseTo(0.2, 4);
  });

  it('uses the resolution amount (a share of a stimulus with a duration)', () => {
    const field = new ElementField();
    resolve(field, { shape: at, element: 'heat', intensity: 30, duration: 1 }, 0.5);
    expect(field.read('temperature', c(0))).toBe(20.5);
  });

  it('ignores force, light and impacts', () => {
    const field = new ElementField();
    for (const element of ['force', 'light', 'blunt', 'slash', 'pierce'] as const) {
      resolve(field, { shape: at, element, intensity: 10 });
    }
    expect(field.chunkCount).toBe(0);
  });
});

describe('exchangeWithCell', () => {
  it('moves an entity towards its cell and the cell the other way, conserving the total', () => {
    const field = new ElementField();
    const p = v(0.1, 0.1, 0.1);
    field.addAt('temperature', p, 80); // cell at 100 °C
    const entity = exchangeWithCell(field, 'temperature', p, 20, 0.25);
    expect(entity).toBe(40);
    expect(field.readAt('temperature', p)).toBe(80);
    const warmer = exchangeWithCell(field, 'temperature', p, 40, 0.5, 0.1);
    expect(warmer).toBe(60);
    expect(field.readAt('temperature', p)).toBe(78);
  });

  it('exchanges nothing with an equal cell, a wall or a refused chunk', () => {
    const field = new ElementField({ maxChunks: 1 });
    expect(exchangeWithCell(field, 'moisture', v(0.1), 0, 1)).toBe(0);
    field.setConductivity({ min: v(0.25, 0.25, 0.25), max: v(0.25, 0.25, 0.25) }, 0);
    expect(exchangeWithCell(field, 'moisture', v(0.1, 0.1, 0.1), 1, 1)).toBe(1);
    expect(exchangeWithCell(field, 'moisture', v(100), 1, 1)).toBe(1);
  });

  it('validates its inputs', () => {
    const field = new ElementField();
    expect(() => exchangeWithCell(field, 'charge', v(0), NaN, 1)).toThrow(RangeError);
    expect(() => exchangeWithCell(field, 'charge', v(0), 1, 2)).toThrow(RangeError);
    expect(() => exchangeWithCell(field, 'charge', v(0), 1, NaN)).toThrow(RangeError);
    expect(() => exchangeWithCell(field, 'charge', v(0), 1, 1, -1)).toThrow(RangeError);
    expect(() => exchangeWithCell(field, 'charge', v(0), 1, 1, Infinity)).toThrow(RangeError);
  });
});
