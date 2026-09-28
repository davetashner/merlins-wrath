import { describe, expect, it } from 'vitest';
import { ElementField, type CellCoord } from '../field/grid';
import {
  airIn,
  cellsInSphere,
  cellsOf,
  exchangeWithCells,
  gasChannels,
  holdAtLeast,
  openCells,
} from './cells';

const c = (x: number, y = 0, z = 0): CellCoord => ({ x, y, z });
const v = (x: number, y = 0, z = 0) => ({ x, y, z });

/** Makes `cell` a wall. */
function wall(field: ElementField, cell: CellCoord): void {
  const centre = field.cellCenter(cell);
  field.setConductivity({ min: centre, max: centre }, 0);
}

describe('cellsInSphere / cellsOf', () => {
  it('lists cells whose centres lie in the sphere, in canonical order', () => {
    const field = new ElementField();
    expect(cellsInSphere(field, v(0.25, 0.25, 0.25), 0.5)).toEqual([
      c(-1, 0, 0),
      c(0, -1, 0),
      c(0, 0, -1),
      c(0, 0, 0),
      c(0, 0, 1),
      c(0, 1, 0),
      c(1, 0, 0),
    ]);
  });

  it('falls back to the cell holding the centre when no centre is close enough', () => {
    const field = new ElementField();
    expect(cellsInSphere(field, v(0.1, 0.1, 0.1), 0.05)).toEqual([c(0, 0, 0)]);
  });

  it('an entity touches the cells within its radius plus half a cell', () => {
    const field = new ElementField();
    const at = { ...v(0.25, 0.25, 0.25), radius: 0 };
    expect(cellsOf(field, at)).toEqual(cellsInSphere(field, at, 0.25));
    expect(cellsOf(field, { ...at, radius: 0.25 })).toHaveLength(7);
  });
});

describe('exchangeWithCells', () => {
  it('moves the entity towards the mean of its open cells and the cells the other way', () => {
    const field = new ElementField({ temperature: { decay: 0 } });
    field.add('temperature', c(0), 80); // cells at 100 and 20: mean 60
    wall(field, c(2));
    const next = exchangeWithCells(field, 'temperature', [c(0), c(1), c(2)], 20, 0.5, 1);
    expect(next).toBe(40);
    expect(field.read('temperature', c(0))).toBe(90);
    expect(field.read('temperature', c(1))).toBe(10);
    expect(field.read('temperature', c(2))).toBe(20); // a wall takes no part
  });

  it('exchanges nothing without open cells, within the tolerance or at rate 0', () => {
    const field = new ElementField();
    wall(field, c(0));
    expect(exchangeWithCells(field, 'temperature', [c(0)], 500, 1, 1)).toBe(500);
    expect(exchangeWithCells(field, 'temperature', [c(5)], 20.5, 1, 1, 1)).toBe(20.5);
    expect(exchangeWithCells(field, 'temperature', [c(5)], 90, 0, 1)).toBe(90);
    expect(exchangeWithCells(field, 'temperature', [c(5)], 20, 1, 1)).toBe(20);
    expect(field.read('temperature', c(5))).toBe(20);
  });
});

describe('openCells, holdAtLeast, gasChannels and airIn', () => {
  it('filters walls and raises cells to a held value', () => {
    const field = new ElementField();
    wall(field, c(1));
    expect(openCells(field, [c(0), c(1)])).toEqual([c(0)]);
    field.add('temperature', c(2), 900);
    holdAtLeast(field, 'temperature', [c(0), c(1), c(2)], 600);
    expect([0, 1, 2].map((x) => field.read('temperature', c(x)))).toEqual([600, 20, 920]);
  });

  it('measures the breathable air left by walls and gases', () => {
    const field = new ElementField();
    field.add('gas:smoke', c(0), 0.25);
    field.add('gas:steam', c(0), 0.25);
    field.add('gas:steam', c(1), 1);
    field.add('moisture', c(3), 1);
    wall(field, c(2));
    const gases = gasChannels(field);
    expect(gases).toEqual(['gas:smoke', 'gas:steam']);
    expect(airIn(field, [c(0)], gases)).toBe(0.5);
    expect(airIn(field, [c(0), c(1), c(2), c(4)], gases)).toBe(0.375);
    expect(airIn(field, [c(0)], [])).toBe(1);
  });
});
