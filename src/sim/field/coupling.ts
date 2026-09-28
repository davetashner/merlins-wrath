// How stimuli and entities meet the element field (mw-e03.4). A stimulus reaches field cells through
// the same shape maths it uses for entities (`shapeBounds` to find candidate cells, `shapeFalloff`
// at each cell centre with radius 0), so a fireball warms exactly the air it overlaps. Element rules
// (fire, water, gas, electricity) couple entities to the cell they sit in through
// `exchangeWithCell`, which moves a quantity between the two in one conserving step.

import type { StimulusResolution } from '../stimulus/stimulus';
import {
  shapeBounds,
  shapeFalloff,
  type StimulusFalloff,
  type StimulusShape,
  type Vec3,
} from '../stimulus/shapes';
import { checkChannelName, type FieldChannel } from './config';
import type { ElementField } from './grid';

/**
 * Adds `amount` × falloff of `channel` to every cell whose centre `shape` reaches (see
 * `shapeFalloff`; cell centres are radius-0 targets). A point, or a shape too small to contain any
 * cell centre, deposits `amount` into the cell at the middle of its bounds (the point, sphere or
 * box centre, cone apex, capsule midpoint). Contact shapes are not spatial and deposit nothing. Walls and cells the chunk cap refuses
 * receive nothing. Returns the number of cells written.
 */
export function depositInShape(
  field: ElementField,
  channel: FieldChannel,
  shape: StimulusShape,
  falloff: StimulusFalloff,
  amount: number,
): number {
  checkChannelName(channel);
  const bounds = shapeBounds(shape);
  if (bounds === undefined) return 0; // contact
  const tally = { reached: 0, written: 0 };
  if (shape.kind !== 'point') {
    field.forCellsIn(bounds, (cell) => {
      const factor = shapeFalloff(shape, falloff, field.cellCenter(cell));
      if (factor === undefined) return;
      tally.reached++;
      if (field.add(channel, cell, amount * factor)) tally.written++;
    });
  }
  if (tally.reached > 0) return tally.written;
  const { min, max } = bounds;
  const middle = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return field.addAt(channel, middle, amount) ? 1 : 0;
}

/** The field channel and sign an element acts on, if any. */
function channelOf(resolution: StimulusResolution): readonly [FieldChannel, 1 | -1] | undefined {
  const { element, gas } = resolution.stimulus;
  switch (element) {
    case 'heat':
      return ['temperature', 1];
    case 'cold':
      return ['temperature', -1];
    case 'water':
      return ['moisture', 1];
    case 'charge':
      return ['charge', 1];
    case 'gas':
      return [`gas:${String(gas)}`, 1]; // normalizeStimulus requires a gas id on gas stimuli
    default:
      return undefined; // force, light and impacts act on entities or the light field
  }
}

/**
 * Applies one stimulus resolution to the field: heat and cold raise and lower temperature, water
 * raises moisture, charge raises charge, gas adds concentration of its gas type; each cell receives
 * the resolution's amount × its falloff, in the element's unit. Other elements are ignored.
 * `installElementField` calls this for every `stimulusResolved` event.
 */
export function applyStimulusToField(field: ElementField, resolution: StimulusResolution): void {
  const target = channelOf(resolution);
  if (target === undefined) return;
  const [channel, sign] = target;
  const { shape, falloff } = resolution.stimulus;
  depositInShape(field, channel, shape, falloff, sign * resolution.amount);
}

/**
 * Exchanges `channel` between an entity holding `value` (absolute units) and the cell containing
 * `point`: the entity moves `rate` ∈ [0, 1] of the way towards the cell's value, and the cell moves
 * the opposite way by that change × `cellShare` (≥ 0; the entity's capacity relative to the cell's,
 * e.g. a crate heats the air around it less than it cools itself). Returns the entity's new value.
 * When the cell is a wall or cannot be allocated, nothing is exchanged and `value` is returned.
 */
export function exchangeWithCell(
  field: ElementField,
  channel: FieldChannel,
  point: Vec3,
  value: number,
  rate: number,
  cellShare = 1,
): number {
  if (!Number.isFinite(value)) throw new RangeError('exchanged value must be finite');
  if (!(rate >= 0 && rate <= 1)) throw new RangeError('exchange rate must be in [0, 1]');
  if (!(cellShare >= 0 && Number.isFinite(cellShare))) {
    throw new RangeError('cellShare must be a finite number ≥ 0');
  }
  const change = (field.readAt(channel, point) - value) * rate;
  if (change === 0) return value;
  return field.addAt(channel, point, -change * cellShare) ? value + change : value;
}
