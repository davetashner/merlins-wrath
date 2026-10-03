// mw-e09.3 AC-8: 20 noise events per tick in a 60-room level, propagated, p95 ≤ 0.5 ms per tick.
// The level is a 10 × 6 grid of 6 m rooms that all touch (every neighbour pair shares a wall), with a
// doorway between most neighbours: open, ajar or closed in a fixed pattern, so walls, doors and
// routes round closed doors all take part. Each tick, 20 noises from 30 to 90 dB go off at rotating
// positions and every one is heard at 8 listeners spread over the level (the search is bounded by
// the audibility floor, so the loud ones reach most of the level). Measured as the propagation calls
// themselves (pure sim; nothing else to step). p95 is read from the retained samples, as in the
// other sim benches.
import { describe, expect, test } from 'vitest';
import {
  buildSoundGraph,
  propagateNoise,
  type PortalGain,
  type SoundPortalSpec,
  type SoundRoomSpec,
} from '@sim/index';

const COLS = 10;
const ROWS = 6;
const SIZE = 6;
const NOISES = 20;

const v = (x: number, y: number, z: number) => ({ x, y, z });
const id = (c: number, r: number) => `r${String(c)}-${String(r)}`;

const rooms: SoundRoomSpec[] = [];
const portals: SoundPortalSpec[] = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    rooms.push({
      id: id(c, r),
      min: v(c * SIZE, 0, r * SIZE),
      max: v((c + 1) * SIZE, 3, (r + 1) * SIZE),
    });
    // A doorway east and north of most rooms (every fifth pair is wall only).
    if (c + 1 < COLS && (c + r) % 5 !== 4) {
      portals.push({
        id: `e${id(c, r)}`,
        rooms: [id(c, r), id(c + 1, r)],
        position: v((c + 1) * SIZE, 1, r * SIZE + SIZE / 2),
      });
    }
    if (r + 1 < ROWS && (c * 3 + r) % 5 !== 2) {
      portals.push({
        id: `n${id(c, r)}`,
        rooms: [id(c, r), id(c, r + 1)],
        position: v(c * SIZE + SIZE / 2, 1, (r + 1) * SIZE),
      });
    }
  }
}
const graph = buildSoundGraph({ rooms, portals });
const STATES = [0, -6, -20];
const portalGain: PortalGain = (portal) => STATES[portal.id.length % 3] ?? 0;
const listeners = Array.from({ length: 8 }, (_, i) =>
  v(((i * 7) % COLS) * SIZE + 3, 1, ((i * 5) % ROWS) * SIZE + 3),
);

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

let tick = 0;
let sink = 0;
function runTick(): void {
  for (let n = 0; n < NOISES; n++) {
    const k = tick * NOISES + n;
    const source = v(((k * 13) % (COLS * SIZE)) + 0.5, 1, ((k * 7) % (ROWS * SIZE)) + 0.5);
    const field = propagateNoise(graph, source, 30 + ((k * 11) % 61), { portalGain });
    for (const ear of listeners) sink += field.hear(ear)?.level ?? 0;
  }
  tick++;
}

describe('noise propagation', () => {
  test('AC-8: 20 noises per tick in a 60-room level propagate in ≤ 0.5 ms per tick p95', async ({
    bench,
  }) => {
    expect(graph.rooms).toHaveLength(COLS * ROWS + 1);
    for (let i = 0; i < 2000; i++) runTick();
    const result = await bench('noise: 20 noises × 8 listeners, 60 rooms', runTick).run({
      warmupIterations: 500,
      time: 1000,
      retainSamples: true,
    });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const budget = p95(samples);
    console.info(
      `noise: mean ${result.latency.mean.toFixed(4)} ms, p95 ${budget.toFixed(4)} ms per tick over ${String(samples.length)} ticks (checksum ${sink.toFixed(0)})`,
    );
    expect(budget).toBeLessThanOrEqual(0.5); // milliseconds
  });
});
