// How element rules couple an entity to the element field (mw-e03.5). An entity touches the cells
// whose centres lie inside its bounding sphere (its placement) grown by half a cell, or just the cell
// containing its centre when no centre is that close. Rules exchange heat with those cells, hold flames in them
// and ask how much breathable air they hold, so a large crate touches more air than a candle and
// walls or a smoke-filled room matter without any per-object code.

import { gasOf, type FieldChannel } from '../field/config';
import type { CellCoord, ElementField } from '../field/grid';
import type { Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';

/**
 * The cells whose centres lie within `radius` of `center` (inclusive), in canonical order; the cell
 * containing `center` alone when no centre is that close.
 */
export function cellsInSphere(field: ElementField, center: Vec3, radius: number): CellCoord[] {
  const found: CellCoord[] = [];
  const r2 = radius * radius;
  const min = { x: center.x - radius, y: center.y - radius, z: center.z - radius };
  const max = { x: center.x + radius, y: center.y + radius, z: center.z + radius };
  field.forCellsIn({ min, max }, (cell) => {
    const c = field.cellCenter(cell);
    const dx = c.x - center.x;
    const dy = c.y - center.y;
    const dz = c.z - center.z;
    if (dx * dx + dy * dy + dz * dz <= r2) found.push(cell);
  });
  return found.length > 0 ? found : [field.cellOf(center)];
}

/**
 * The cells an entity with `placement` touches: those whose centres lie within its radius plus half
 * a cell (the air against its surface, not only the air inside it), see `cellsInSphere`.
 */
export function cellsOf(field: ElementField, placement: Placement): CellCoord[] {
  return cellsInSphere(field, placement, placement.radius + field.config.cellSize / 2);
}

/** The cells of `cells` that are not walls. */
export function openCells(field: ElementField, cells: readonly CellCoord[]): CellCoord[] {
  return cells.filter((cell) => field.conductivity(cell) > 0);
}

/**
 * Exchanges `channel` between an entity holding `value` (absolute units) and the open cells among
 * `cells`: the entity moves `rate` ∈ [0, 1] of the way towards their mean, and the cells share the
 * opposite change × `cellShare` equally (the entity's capacity relative to its cells'). Returns the
 * entity's new value. Nothing is exchanged with no open cells, or when the entity is within
 * `tolerance` of the mean (a dead band that lets calm chunks sleep). Writes the chunk cap refuses
 * are lost.
 */
export function exchangeWithCells(
  field: ElementField,
  channel: FieldChannel,
  cells: readonly CellCoord[],
  value: number,
  rate: number,
  cellShare: number,
  tolerance = 0,
): number {
  const open = openCells(field, cells);
  if (open.length === 0) return value;
  let sum = 0;
  for (const cell of open) sum += field.read(channel, cell);
  const difference = sum / open.length - value;
  const change = difference * rate;
  if (Math.abs(difference) <= tolerance || change === 0) return value;
  const share = (-change * cellShare) / open.length;
  for (const cell of open) field.add(channel, cell, share);
  return value + change;
}

/**
 * Raises `channel` in every cell of `cells` that holds less than `value` to exactly `value` (a held
 * source, e.g. flames). Walls and refused chunks are skipped.
 */
export function holdAtLeast(
  field: ElementField,
  channel: FieldChannel,
  cells: readonly CellCoord[],
  value: number,
): void {
  for (const cell of cells) {
    if (field.read(channel, cell) < value) field.set(channel, cell, value);
  }
}

/** Every gas channel that holds a value somewhere in `field`, sorted. */
export function gasChannels(field: ElementField): FieldChannel[] {
  return field.channels().filter((channel) => gasOf(channel) !== undefined);
}

/**
 * The mean fraction of breathable air in `cells`: per cell its conductivity (a wall has none) times
 * what the gases in `gases` leave free (1 − their total concentration, at least 0).
 */
export function airIn(
  field: ElementField,
  cells: readonly CellCoord[],
  gases: readonly FieldChannel[],
): number {
  let air = 0;
  for (const cell of cells) {
    let filled = 0;
    for (const gas of gases) filled += field.read(gas, cell);
    air += field.conductivity(cell) * Math.max(0, 1 - filled);
  }
  return air / cells.length;
}
