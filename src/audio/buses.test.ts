import { describe, expect, it } from 'vitest';
import { BUS_PARENT, buildBusGraph, dbToGain, LIMITER } from './buses.ts';
import { FakeAudioContext, type FakeCompressor, type FakeGain } from './fake-context.ts';
import { BUS_IDS, PLAYABLE_BUS_IDS, type BusId } from './manifest.ts';

describe('bus graph', () => {
  it('wires master → limiter → destination and every bus to its parent', () => {
    const ctx = new FakeAudioContext();
    const graph = buildBusGraph(ctx);
    const buses = graph.buses as Record<BusId, FakeGain>;
    const limiter = graph.limiter as FakeCompressor;
    expect(Object.keys(buses).sort()).toEqual([...BUS_IDS].sort());
    expect(buses.master.outputs).toEqual([limiter]);
    expect(limiter.outputs).toEqual([ctx.destination]);
    for (const bus of PLAYABLE_BUS_IDS) {
      expect(buses[bus].outputs).toEqual([buses[BUS_PARENT[bus]]]);
    }
    expect(BUS_PARENT).toMatchObject({ combat: 'sfx', footsteps: 'sfx', creatures: 'sfx' });
  });

  it('sets the master limiter to catch peaks above −1 dB', () => {
    const { limiter } = buildBusGraph(new FakeAudioContext());
    expect({
      threshold: limiter.threshold.value,
      knee: limiter.knee.value,
      ratio: limiter.ratio.value,
      attack: limiter.attack.value,
      release: limiter.release.value,
    }).toEqual(LIMITER);
  });

  it('converts decibels to linear gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
  });
});
