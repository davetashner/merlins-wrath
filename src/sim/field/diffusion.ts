// One element-field tick (mw-e03.4): diffusion, ambient loss and sleep. Each open face between two
// cells moves trunc((a − b) × rate × conductivity) counts from the higher to the lower, where the
// face's conductivity is the smaller of its two cells' (a wall on either side blocks it). Every
// flux is computed from the values at the start of the tick into a separate delta buffer, and all
// values are integers far below 2^53, so the result is exact, conserving (every count leaving one
// cell arrives in the other) and independent of iteration order.
//
// Only awake chunks are simulated. A chunk that has a layer for a channel at the start of the tick
// "participates" in it; each face is counted exactly once: from both-participating pairs by the cell
// on the negative side, otherwise by the participating side. A non-participating neighbour holds
// ambient (0) for that channel, so pairs with no participant carry nothing. Only cells beyond the
// channel's sleep epsilon spill into a chunk that does not hold the channel (which bounds how far
// negligible tails spread); such flux wakes or allocates the chunk, and when the chunk cap refuses,
// that face acts as a wall.
//
// After applying deltas, each channel loses `decay` of its deviation (ambient loss). A chunk whose
// every value is within epsilon of ambient for `sleepTicks` ticks in a row settles to exact ambient
// and sleeps: it costs nothing until a write or a neighbour's flux touches it. Sleeping chunks with
// no walls are freed. What decay and settling remove is reported, so totals can be audited.

import * as config from './config';
import type { FieldChannel } from './config';
import type { Chunk, ElementField } from './grid';

// Local copies: hot loops should not reach through module bindings.
const { CHUNK_CELLS, CHUNK_SIZE, CONDUCTIVITY_ONE, RATE_ONE } = config;

/** What one tick of the field did. */
export interface FieldStepReport {
  /** Chunks simulated this tick (awake at its start). */
  readonly activeChunks: number;
  /** Cell-channel updates performed by the diffusion kernel. */
  readonly cellsUpdated: number;
  /** Per channel: deviation removed by ambient loss and settling this tick (units × cells). */
  readonly lost: Readonly<Record<string, number>>;
}

/** Axis steps of the six faces, positive direction first on each axis. */
const FACES: readonly (readonly [number, number, number, boolean])[] = [
  [1, 0, 0, true],
  [-1, 0, 0, false],
  [0, 1, 0, true],
  [0, -1, 0, false],
  [0, 0, 1, true],
  [0, 0, -1, false],
];
const SCALE = RATE_ONE * CONDUCTIVITY_ONE;
const LAST = CHUNK_SIZE - 1;

interface Buffer {
  readonly chunk: Chunk;
  readonly channel: FieldChannel;
  readonly values: Float64Array;
  readonly delta: Float64Array;
  readonly participating: boolean;
}

/** Monomorphic element reads for the kernel's hot loops (one per array type keeps them fast). */
const value = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;
const level = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;

/** Every cell open air: the conductivity table of a chunk without walls. */
const OPEN = new Uint16Array(CHUNK_CELLS).fill(CONDUCTIVITY_ONE);

/** Per-tick working state: every buffer, participating or receiving, by its values array. */
class Tick {
  readonly buffers = new Map<Float64Array, Buffer>();

  constructor(readonly field: ElementField) {}

  buffer(chunk: Chunk, channel: FieldChannel, values: Float64Array, participating: boolean) {
    const buffer = { chunk, channel, values, delta: new Float64Array(CHUNK_CELLS), participating };
    this.buffers.set(values, buffer);
    return buffer;
  }

  /** Chunk coordinates across face `face` of `chunk`. */
  across(chunk: Chunk, face: number): [number, number, number] {
    const [dx, dy, dz] = value(FACES, face);
    return [chunk.cx + dx, chunk.cy + dy, chunk.cz + dz];
  }
}

function conductivityAt(chunk: Chunk | undefined, index: number): number {
  const table = chunk?.conductivity;
  return table === undefined ? CONDUCTIVITY_ONE : level(table, index);
}

/** What lies across one face of a chunk for one channel, resolved once per source per tick. */
interface Side {
  other: Chunk | undefined;
  values: Float64Array | undefined;
  target: Buffer | undefined;
}

function side(tick: Tick, chunk: Chunk, face: number, channel: FieldChannel): Side {
  const other = tick.field.chunkAtCoords(...tick.across(chunk, face));
  const values = other?.layers.get(channel);
  return { other, values, target: values === undefined ? undefined : tick.buffers.get(values) };
}

/** A buffer for a non-participating neighbour receiving flux, allocating and waking as needed. */
function receive(
  tick: Tick,
  chunk: Chunk,
  face: number,
  s: Side,
  channel: FieldChannel,
): Buffer | undefined {
  const other = s.other ?? tick.field.allocate(...tick.across(chunk, face));
  if (other === undefined) return undefined;
  tick.field.wake(other);
  const values = tick.field.layerOf(other, channel);
  s.other = other;
  s.values = values;
  s.target = tick.buffer(other, channel, values, false);
  return s.target;
}

/** The truncated flux from a cell holding `a` to one holding `b` across `conductivity`. */
const fluxOf = (a: number, b: number, rate: number, conductivity: number): number =>
  Math.trunc(((a - b) * rate * conductivity) / SCALE);

/** Cell index strides of the x, y and z axes. */
const STRIDES = [1, CHUNK_SIZE, CHUNK_SIZE * CHUNK_SIZE] as const;

/** Moves the flux across face `face` of the source chunk, for the 64 cell pairs on it. */
function boundary(tick: Tick, source: Buffer, face: number, rate: number, epsilon: number): void {
  const { chunk, channel, values, delta } = source;
  const positive = value(FACES, face)[3];
  const axis = face >> 1;
  const stride = value(STRIDES, axis);
  const s1 = value(STRIDES, (axis + 1) % 3);
  const s2 = value(STRIDES, (axis + 2) % 3);
  const ownBase = positive ? LAST * stride : 0;
  const otherBase = positive ? 0 : LAST * stride;
  const s = side(tick, chunk, face, channel);
  if (s.target?.participating === true && !positive) return; // counted from the other side
  for (let u = 0; u < CHUNK_SIZE; u++) {
    for (let v = 0; v < CHUNK_SIZE; v++) {
      const offset = u * s1 + v * s2;
      const index = ownBase + offset;
      const a = value(values, index);
      // Calm cells never spill into a chunk that doesn't hold the channel.
      if (s.target?.participating !== true && a <= epsilon && a >= -epsilon) continue;
      const nIndex = otherBase + offset;
      const b = s.values === undefined ? 0 : value(s.values, nIndex);
      if (a === b) continue;
      const own = conductivityAt(chunk, index);
      const flux = fluxOf(a, b, rate, Math.min(own, conductivityAt(s.other, nIndex)));
      if (flux === 0) continue;
      const target = s.target ?? receive(tick, chunk, face, s, channel);
      if (target === undefined) return; // the chunk cap refused the neighbour: a wall
      delta[index] = value(delta, index) - flux;
      target.delta[nIndex] = value(target.delta, nIndex) + flux;
    }
  }
}

/** Computes every face flux of `source`'s cells into the tick's delta buffers. */
function diffuse(tick: Tick, source: Buffer, rate: number, epsilon: number): number {
  const { values, delta } = source;
  const table = source.chunk.conductivity ?? OPEN;
  let updated = 0;
  for (let index = 0; index < CHUNK_CELLS; index++) {
    const own = level(table, index);
    if (own === 0) continue;
    updated++;
    const a = value(values, index);
    // The +x, +y and +z neighbours inside the chunk; each interior face is counted once, here.
    for (let axis = 0; axis < 3; axis++) {
      const shift = axis * 3;
      if (((index >> shift) & LAST) === LAST) continue;
      const next = index + (1 << shift);
      const b = value(values, next);
      if (a === b) continue;
      const flux = fluxOf(a, b, rate, Math.min(own, level(table, next)));
      delta[index] = value(delta, index) - flux;
      delta[next] = value(delta, next) + flux;
    }
  }
  for (let face = 0; face < FACES.length; face++) boundary(tick, source, face, rate, epsilon);
  return updated;
}

/** Adds `amount` counts to `lost[channel]`. */
function account(lost: Map<string, number>, channel: FieldChannel, amount: number): void {
  lost.set(channel, (lost.get(channel) ?? 0) + amount);
}

/** Applies deltas and ambient loss to every buffer. */
function apply(tick: Tick, lost: Map<string, number>): void {
  for (const { channel, values, delta } of tick.buffers.values()) {
    const { decay } = tick.field.channel(channel);
    let removed = 0;
    for (let i = 0; i < CHUNK_CELLS; i++) {
      const next = value(values, i) + value(delta, i);
      const loss = decay === 0 ? 0 : Math.trunc((next * decay) / RATE_ONE);
      values[i] = next - loss;
      removed += loss;
    }
    if (removed !== 0) account(lost, channel, removed);
  }
}

/** Updates calm counts of awake chunks; settles and sleeps (or frees) the ones calm long enough. */
function settle(field: ElementField, lost: Map<string, number>): void {
  const { sleepTicks } = field.config;
  for (const chunk of [...field.chunkList()]) {
    if (chunk.asleep) continue;
    let calm = true;
    for (const [channel, values] of chunk.layers) {
      const { epsilon } = field.channel(channel);
      let empty = true;
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const v = value(values, i);
        if (v !== 0) empty = false;
        if (v > epsilon || v < -epsilon) {
          calm = false;
          break; // not empty either: nothing more to learn from this layer
        }
      }
      if (empty) chunk.layers.delete(channel);
    }
    chunk.calm = calm ? chunk.calm + 1 : 0;
    if (chunk.calm < sleepTicks) continue;
    for (const [channel, values] of chunk.layers) {
      let residue = 0;
      for (let i = 0; i < CHUNK_CELLS; i++) residue += value(values, i);
      if (residue !== 0) account(lost, channel, residue);
    }
    chunk.layers.clear();
    chunk.asleep = true;
    if (chunk.conductivity === undefined) field.release(chunk);
  }
}

/**
 * Advances `field` one tick: diffusion, ambient loss, then sleep (see the file header). Returns what
 * it did; `lost` lets callers check conservation (initial total = final total + Σ lost).
 */
export function stepField(field: ElementField): FieldStepReport {
  const tick = new Tick(field);
  const active = field.chunkList().filter((chunk) => !chunk.asleep);
  for (const chunk of active) {
    for (const [channel, values] of chunk.layers) tick.buffer(chunk, channel, values, true);
  }
  let cellsUpdated = 0;
  for (const source of [...tick.buffers.values()]) {
    const { rate, epsilon } = field.channel(source.channel);
    if (rate > 0) cellsUpdated += diffuse(tick, source, rate, epsilon);
  }
  const lost = new Map<string, number>();
  apply(tick, lost);
  settle(field, lost);
  const units = Object.fromEntries(
    [...lost].map(([channel, counts]) => [channel, config.toUnits(counts)]),
  );
  return { activeChunks: active.length, cellsUpdated, lost: units };
}
